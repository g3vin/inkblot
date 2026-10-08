//! One writer at a time, per document.
//!
//! Every version write is a read-modify-write of the same file: read the version list,
//! add to it, write the whole thing back. Left unsynchronized they interleave — an
//! autosave reads the list, the user hits "Snapshot now", the snapshot lands, and then
//! the autosave writes back the list it read BEFORE the snapshot existed. The snapshot
//! is gone, and nothing errors.
//!
//! The JS version is a promise chain per document, which serializes the *scheduling* of
//! the writes within one webview. This is a real mutex, so it also holds against a
//! second thread and a second caller from native code.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct DocLocks {
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl DocLocks {
    /// Run `task` with this document's lock held.
    ///
    /// A task that panics must not wedge the document for the rest of the session, so
    /// the poison is cleared rather than propagated — the same reasoning as the JS
    /// running its next task whether the previous one resolved or rejected.
    pub fn with_doc_lock<T>(
        &self,
        project_name: &str,
        doc_name: &str,
        task: impl FnOnce() -> T,
    ) -> T {
        let key = format!("{project_name}\u{0}{doc_name}");

        let lock = {
            let mut locks = self
                .locks
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            Arc::clone(locks.entry(key).or_default())
        };

        let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        task()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread;

    use super::*;

    #[test]
    fn two_threads_writing_one_document_do_not_interleave() {
        let locks = Arc::new(DocLocks::default());
        let inside = Arc::new(AtomicUsize::new(0));
        let overlaps = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let (locks, inside, overlaps) = (
                    Arc::clone(&locks),
                    Arc::clone(&inside),
                    Arc::clone(&overlaps),
                );
                thread::spawn(move || {
                    for _ in 0..50 {
                        locks.with_doc_lock("p", "doc", || {
                            if inside.fetch_add(1, Ordering::SeqCst) != 0 {
                                overlaps.fetch_add(1, Ordering::SeqCst);
                            }
                            inside.fetch_sub(1, Ordering::SeqCst);
                        });
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }

        assert_eq!(overlaps.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_panicking_task_does_not_wedge_the_document() {
        let locks = DocLocks::default();
        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            locks.with_doc_lock("p", "doc", || panic!("write failed"));
        }));
        assert!(panicked.is_err());
        assert_eq!(locks.with_doc_lock("p", "doc", || 7), 7);
    }

    #[test]
    fn different_documents_do_not_block_each_other() {
        let locks = DocLocks::default();
        locks.with_doc_lock("p", "a", || {
            // Taking a second document's lock from inside the first must not deadlock.
            locks.with_doc_lock("p", "b", || {})
        });
    }
}
