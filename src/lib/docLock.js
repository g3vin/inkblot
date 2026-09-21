/**
 * docLock.js — one writer at a time, per document.
 */

// Every write below is a read-modify-write of the same file: read the version list,
// add to it, write the whole thing back. Left unsynchronized they interleave — an
// autosave reads the list, the user hits "Snapshot now", the snapshot lands, and
// then the autosave writes back the list it read BEFORE the snapshot existed. The
// snapshot is gone, and nothing errors. Queueing per document makes each cycle see
// the previous one's result.
const docWriteQueues = new Map()

export function withDocLock(projectName, docName, task) {
  const key = `${projectName}\u0000${docName}`
  const previous = docWriteQueues.get(key) || Promise.resolve()

  // `task` runs whether the previous write resolved or rejected — one failed save
  // must not wedge the queue for the rest of the session.
  const run = previous.then(task, task)
  const settled = run.catch(() => {})

  docWriteQueues.set(key, settled)
  settled.then(() => {
    if (docWriteQueues.get(key) === settled) docWriteQueues.delete(key)
  })

  return run
}

