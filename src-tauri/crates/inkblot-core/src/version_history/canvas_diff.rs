//! The card-level canvas diff, its description, and the merge that builds a canvas
//! from per-card choices. Part of [`super`]; parity with `src/lib/versionHistory.js`
//! covers it.

use super::*;

/// What a card says, for previews and text diffs.
pub fn canvas_node_text(node: &CanvasNode) -> String {
    // Each fall-through is JS truthiness, so an empty string moves on to the next.
    let non_empty = |value: &Option<String>| value.clone().filter(|text| !text.is_empty());

    if let Some(text) = non_empty(&node.text) {
        return text;
    }
    if let Some(label) = non_empty(&node.label) {
        return label;
    }
    if let Some(url) = non_empty(&node.url) {
        return url;
    }
    if let Some(file) = non_empty(&node.file) {
        // `split('/').pop() || file` — a trailing slash falls back to the whole path.
        let last = file.split('/').next_back().unwrap_or("");
        return if last.is_empty() {
            file
        } else {
            last.to_string()
        };
    }
    String::new()
}

/// Nodes by id, keeping the order they appear in, with O(1) lookup.
///
/// A repeated id takes the later node's content at the earlier one's position, which
/// is what `Map.set` does. The map is what makes this linear: a canvas can hold
/// hundreds of cards, and scanning a Vec per lookup would make the diff quadratic.
fn canvas_nodes_by_id(canvas: &CanvasFile) -> (Vec<&str>, HashMap<&str, &CanvasNode>) {
    let mut order: Vec<&str> = Vec::new();
    let mut by_id: HashMap<&str, &CanvasNode> = HashMap::new();

    for node in &canvas.nodes {
        if node.id.is_empty() {
            continue;
        }
        if by_id.insert(&node.id, node).is_none() {
            order.push(&node.id);
        }
    }

    (order, by_id)
}

/// Whether two cards differ in anything the user typed or chose.
///
/// JS compares `JSON.stringify` of each key, which makes two TipTap documents with the
/// same content but different key order count as an edit. Comparing the parsed values
/// here does not. That is the one place this is deliberately less faithful, and it is
/// less faithful in the direction of being right.
fn node_content_changed(a: &CanvasNode, b: &CanvasNode) -> bool {
    a.text != b.text
        || a.inkblot_tip_tap != b.inkblot_tip_tap
        || a.label != b.label
        || a.file != b.file
        || a.url != b.url
        || a.color != b.color
        || a.inkblot_note_id != b.inkblot_note_id
}

fn node_moved(a: &CanvasNode, b: &CanvasNode) -> bool {
    a.x != b.x || a.y != b.y || a.width != b.width || a.height != b.height
}

/// Card-level diff of two serialized canvases (left = older, right = newer).
pub fn diff_canvases(left: &CanvasFile, right: &CanvasFile) -> CanvasDiff {
    let (left_order, left_nodes) = canvas_nodes_by_id(left);
    let (right_order, right_nodes) = canvas_nodes_by_id(right);

    let mut diff = CanvasDiff::default();

    for id in &right_order {
        let node = right_nodes[id];
        match left_nodes.get(id) {
            None => diff.added.push(node.clone()),
            Some(before) if node_content_changed(before, node) => {
                diff.edited.push(CanvasNodeChange {
                    before: (*before).clone(),
                    after: node.clone(),
                })
            }
            Some(before) if node_moved(before, node) => diff.moved.push(CanvasNodeChange {
                before: (*before).clone(),
                after: node.clone(),
            }),
            Some(_) => {}
        }
    }
    for id in &left_order {
        if !right_nodes.contains_key(id) {
            diff.removed.push(left_nodes[id].clone());
        }
    }

    fn edge_ids(canvas: &CanvasFile) -> HashSet<&str> {
        canvas
            .edges
            .iter()
            .map(|edge| edge.id.as_str())
            .filter(|id| !id.is_empty())
            .collect()
    }
    let left_edge_ids = edge_ids(left);
    let right_edge_ids = edge_ids(right);
    let kept = |edges: &[CanvasEdge], seen: &HashSet<&str>| -> Vec<CanvasEdge> {
        edges
            .iter()
            .filter(|edge| !edge.id.is_empty() && !seen.contains(edge.id.as_str()))
            .cloned()
            .collect()
    };
    diff.edges_added = kept(&right.edges, &left_edge_ids);
    diff.edges_removed = kept(&left.edges, &right_edge_ids);

    diff
}

pub fn canvas_diff_is_empty(diff: &CanvasDiff) -> bool {
    diff.added.is_empty()
        && diff.removed.is_empty()
        && diff.edited.is_empty()
        && diff.moved.is_empty()
        && diff.edges_added.is_empty()
        && diff.edges_removed.is_empty()
}

/// One-line summary for a condensed history row: "+2 cards · 1 edited · 3 moved".
pub fn describe_canvas_diff(diff: &CanvasDiff) -> String {
    let plural = |count: usize| if count == 1 { "" } else { "s" };
    let mut parts: Vec<String> = Vec::new();

    if !diff.added.is_empty() {
        parts.push(format!(
            "+{} card{}",
            diff.added.len(),
            plural(diff.added.len())
        ));
    }
    if !diff.removed.is_empty() {
        // U+2212 MINUS SIGN, to line up with the + above it.
        parts.push(format!(
            "\u{2212}{} card{}",
            diff.removed.len(),
            plural(diff.removed.len())
        ));
    }
    if !diff.edited.is_empty() {
        parts.push(format!("{} edited", diff.edited.len()));
    }
    if !diff.moved.is_empty() {
        parts.push(format!("{} moved", diff.moved.len()));
    }
    let edge_count = diff.edges_added.len() + diff.edges_removed.len();
    if edge_count > 0 {
        parts.push(format!("{edge_count} arrow{}", plural(edge_count)));
    }

    if parts.is_empty() {
        "No card changes".to_string()
    } else {
        parts.join(" · ")
    }
}

/// Merge two canvases from per-change decisions.
///
/// The result starts as the RIGHT side; each decision key flips one change back to the
/// left side:
///
/// ```text
///   added:<id>    take 'left'  -> drop the card right added
///   removed:<id>  take 'left'  -> bring back the card right deleted
///   edited:<id>   take 'left'  -> keep the older card content
///   moved:<id>    take 'left'  -> keep the older position
/// ```
///
/// Edges survive when both endpoints do; edge add/removes follow the same keys.
pub fn merge_canvases(
    right: &CanvasFile,
    diff: &CanvasDiff,
    decisions: &HashMap<String, MergeChoice>,
) -> CanvasFile {
    let take = |key: &str| decisions.get(key) == Some(&MergeChoice::Left);
    let mut nodes: Vec<CanvasNode> = Vec::new();

    let added_ids: HashSet<&str> = diff.added.iter().map(|node| node.id.as_str()).collect();
    let edited_by_id: HashMap<&str, &CanvasNodeChange> = diff
        .edited
        .iter()
        .map(|edit| (edit.after.id.as_str(), edit))
        .collect();
    let moved_by_id: HashMap<&str, &CanvasNodeChange> = diff
        .moved
        .iter()
        .map(|moved| (moved.after.id.as_str(), moved))
        .collect();

    for node in &right.nodes {
        if added_ids.contains(node.id.as_str()) && take(&format!("added:{}", node.id)) {
            continue;
        }

        if let Some(edit) = edited_by_id.get(node.id.as_str()) {
            if take(&format!("edited:{}", node.id)) {
                nodes.push(edit.before.clone());
                continue;
            }
        }

        if let Some(moved) = moved_by_id.get(node.id.as_str()) {
            if take(&format!("moved:{}", node.id)) {
                nodes.push(moved.before.clone());
                continue;
            }
        }

        nodes.push(node.clone());
    }

    for node in &diff.removed {
        if take(&format!("removed:{}", node.id)) {
            nodes.push(node.clone());
        }
    }

    let node_ids: Vec<&str> = nodes.iter().map(|node| node.id.as_str()).collect();
    let mut edges: Vec<CanvasEdge> = Vec::new();
    let mut seen_edges: Vec<String> = Vec::new();
    let push_edge = |edges: &mut Vec<CanvasEdge>, seen: &mut Vec<String>, edge: &CanvasEdge| {
        if edge.id.is_empty() || seen.contains(&edge.id) {
            return;
        }
        if !node_ids.contains(&edge.from_node.as_str())
            || !node_ids.contains(&edge.to_node.as_str())
        {
            return;
        }
        seen.push(edge.id.clone());
        edges.push(edge.clone());
    };

    for edge in &right.edges {
        if diff.edges_added.iter().any(|added| added.id == edge.id)
            && take(&format!("edgeAdded:{}", edge.id))
        {
            continue;
        }
        push_edge(&mut edges, &mut seen_edges, edge);
    }
    for edge in &diff.edges_removed {
        if take(&format!("edgeRemoved:{}", edge.id)) {
            push_edge(&mut edges, &mut seen_edges, edge);
        }
    }

    CanvasFile {
        nodes,
        edges,
        ..right.clone()
    }
}
