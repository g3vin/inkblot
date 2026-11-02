//! The word-level token diff and the paragraph-level block diff, with the merge that
//! turns per-chunk choices back into HTML. Part of [`super`]; parity with
//! `src/lib/versionHistory.js` covers it.

use super::*;

/// Above this many DP cells the middle is treated as a plain replace: edits in prose
/// are local, so the prefix/suffix trim almost always keeps us under it.
const LCS_CELL_LIMIT: u64 = 400_000;

/// Diff two token slices into runs of equal, added and removed tokens.
///
/// Common prefix and suffix are trimmed first; the middle gets a real LCS when it is
/// small enough and a whole-run replace when it is not.
pub fn diff_tokens(a: &[String], b: &[String]) -> Vec<DiffOp> {
    let mut start = 0;
    while start < a.len() && start < b.len() && a[start] == b[start] {
        start += 1;
    }

    let mut end = 0;
    while end < a.len() - start
        && end < b.len() - start
        && a[a.len() - 1 - end] == b[b.len() - 1 - end]
    {
        end += 1;
    }

    let mid_a = &a[start..a.len() - end];
    let mid_b = &b[start..b.len() - end];

    let mut ops: Vec<DiffOp> = Vec::new();
    let mut push = |op_type: DiffOpType, tokens: &[String]| {
        if tokens.is_empty() {
            return;
        }
        match ops.last_mut() {
            Some(last) if last.op_type == op_type => last.tokens.extend_from_slice(tokens),
            _ => ops.push(DiffOp {
                op_type,
                tokens: tokens.to_vec(),
            }),
        }
    };

    push(DiffOpType::Equal, &a[..start]);

    let cells = mid_a.len() as u64 * mid_b.len() as u64;
    if mid_a.is_empty() || mid_b.is_empty() || cells > LCS_CELL_LIMIT {
        push(DiffOpType::Removed, mid_a);
        push(DiffOpType::Added, mid_b);
    } else {
        // Standard LCS table over the trimmed middles, walked back into runs.
        let rows = mid_a.len() + 1;
        let cols = mid_b.len() + 1;
        let mut table = vec![0u32; rows * cols];
        for i in 1..rows {
            for j in 1..cols {
                table[i * cols + j] = if mid_a[i - 1] == mid_b[j - 1] {
                    table[(i - 1) * cols + (j - 1)] + 1
                } else {
                    table[(i - 1) * cols + j].max(table[i * cols + (j - 1)])
                };
            }
        }

        let mut reversed: Vec<(DiffOpType, &String)> = Vec::new();
        let mut i = mid_a.len();
        let mut j = mid_b.len();
        while i > 0 || j > 0 {
            if i > 0 && j > 0 && mid_a[i - 1] == mid_b[j - 1] {
                reversed.push((DiffOpType::Equal, &mid_a[i - 1]));
                i -= 1;
                j -= 1;
            } else if j > 0 && (i == 0 || table[i * cols + (j - 1)] >= table[(i - 1) * cols + j]) {
                reversed.push((DiffOpType::Added, &mid_b[j - 1]));
                j -= 1;
            } else {
                reversed.push((DiffOpType::Removed, &mid_a[i - 1]));
                i -= 1;
            }
        }
        for (op_type, token) in reversed.into_iter().rev() {
            push(op_type, std::slice::from_ref(token));
        }
    }

    push(
        DiffOpType::Equal,
        if end > 0 { &a[a.len() - end..] } else { &[] },
    );
    ops
}

/// Word diff of two plain texts.
pub fn diff_words(a_text: &str, b_text: &str) -> Vec<DiffOp> {
    diff_tokens(&text_words(a_text), &text_words(b_text))
}

/// How many words a change added and removed.
pub fn word_delta(a_text: &str, b_text: &str) -> WordDelta {
    let mut delta = WordDelta::default();
    for op in diff_words(a_text, b_text) {
        match op.op_type {
            DiffOpType::Added => delta.added += op.tokens.len() as u32,
            DiffOpType::Removed => delta.removed += op.tokens.len() as u32,
            DiffOpType::Equal => {}
        }
    }
    delta
}

/* ============================================================
Block diff (paragraph level, for side-by-side compare/merge)
============================================================ */

/// Diff two block lists into aligned chunks for a two-column view.
///
/// Takes the blocks rather than the HTML: splitting HTML into blocks needs a real
/// `DOMParser`, so `htmlToBlocks` stays in the webview and hands its result here.
pub fn diff_block_lists(a_blocks: &[HtmlBlock], b_blocks: &[HtmlBlock]) -> Vec<DiffChunk> {
    let a_keys: Vec<String> = a_blocks.iter().map(|block| block.text.clone()).collect();
    let b_keys: Vec<String> = b_blocks.iter().map(|block| block.text.clone()).collect();
    let ops = diff_tokens(&a_keys, &b_keys);

    let mut chunks: Vec<DiffChunk> = Vec::new();
    let mut ai = 0;
    let mut bi = 0;

    let push_changed = |chunks: &mut Vec<DiffChunk>, left: &[HtmlBlock], right: &[HtmlBlock]| {
        if let Some(last) = chunks.last_mut() {
            if let (Some(last_left), Some(last_right)) = (&mut last.left, &mut last.right) {
                last_left.extend_from_slice(left);
                last_right.extend_from_slice(right);
                return;
            }
        }
        chunks.push(DiffChunk::changed(left.to_vec(), right.to_vec()));
    };

    for op in ops {
        let count = op.tokens.len();
        match op.op_type {
            DiffOpType::Equal => {
                chunks.push(DiffChunk::equal(b_blocks[bi..bi + count].to_vec()));
                ai += count;
                bi += count;
            }
            DiffOpType::Removed => {
                push_changed(&mut chunks, &a_blocks[ai..ai + count], &[]);
                ai += count;
            }
            DiffOpType::Added => {
                push_changed(&mut chunks, &[], &b_blocks[bi..bi + count]);
                bi += count;
            }
        }
    }

    chunks
}

/// Build merged HTML from compare chunks and the user's per-chunk choices.
///
/// A chunk with no choice defaults to the right side; equal chunks pass through.
pub fn merge_chunks_to_html(chunks: &[DiffChunk], choices: &HashMap<usize, MergeChoice>) -> String {
    let mut parts: Vec<&str> = Vec::new();

    for (index, chunk) in chunks.iter().enumerate() {
        if let Some(blocks) = &chunk.blocks {
            for block in blocks {
                parts.push(&block.html);
            }
            continue;
        }

        let choice = choices.get(&index).copied().unwrap_or(MergeChoice::Right);
        if matches!(choice, MergeChoice::Left | MergeChoice::Both) {
            for block in chunk.left.iter().flatten() {
                parts.push(&block.html);
            }
        }
        if matches!(choice, MergeChoice::Right | MergeChoice::Both) {
            for block in chunk.right.iter().flatten() {
                parts.push(&block.html);
            }
        }
    }

    let merged = parts.concat();
    if merged.is_empty() {
        "<p></p>".to_string()
    } else {
        merged
    }
}
