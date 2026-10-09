//! The built-in story folder presets and how a tree entry resolves to one.
//!
//! Mirrors `src/lib/storyStructure.js`; `npm run parity` asserts the two agree.

use crate::types::story::{StoryFolderAncestor, StoryFolderPreset};

fn preset(
    key: &str,
    name: &str,
    menu_label: &str,
    entry_label: &str,
    // Semantic icon names (src/ui/icons.js): the folder's, and each document's in it.
    (folder_icon, file_icon): (&str, &str),
    aliases: &[&str],
) -> StoryFolderPreset {
    StoryFolderPreset {
        key: key.to_string(),
        name: name.to_string(),
        menu_label: menu_label.to_string(),
        entry_label: entry_label.to_string(),
        folder_icon: folder_icon.to_string(),
        file_icon: file_icon.to_string(),
        aliases: aliases.iter().map(|alias| alias.to_string()).collect(),
    }
}

/// `STORY_FOLDER_PRESETS`, in declaration order — which is the order the menu shows.
pub fn story_folder_presets() -> Vec<StoryFolderPreset> {
    vec![
        preset("characters", "Characters", "Character folder", "Character", ("users", "characters"), &[]),
        preset("settings", "Settings", "Setting folder", "Setting", ("map-world", "map-pin"), &["Locations", "Places"]),
        preset("outline", "Outline", "Outline folder", "Outline entry", ("list", "list-bullets"), &[]),
        preset("novel", "Novel", "Novel folder", "Chapter", ("book", "notebook"), &["Book"]),
    ]
}

pub fn get_story_folder_preset_by_key(key: &str) -> Option<StoryFolderPreset> {
    story_folder_presets()
        .into_iter()
        .find(|preset| preset.key == key)
}

/// A preset matched by its own name or by one of its aliases.
pub fn get_story_folder_preset_by_name(name: &str) -> Option<StoryFolderPreset> {
    story_folder_presets()
        .into_iter()
        .find(|preset| preset.name == name || preset.aliases.iter().any(|alias| alias == name))
}

fn segments(entry_path: &str) -> Vec<&str> {
    entry_path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect()
}

/// The preset for a tree entry: folders match by their own name, files by the nearest
/// preset ancestor folder.
pub fn get_story_folder_preset_for_entry(
    entry_path: &str,
    entry_type: &str,
) -> Option<StoryFolderPreset> {
    let segments = segments(entry_path);
    if segments.is_empty() {
        return None;
    }

    if entry_type == "folder" {
        return get_story_folder_preset_by_name(segments[segments.len() - 1]);
    }

    segments[..segments.len() - 1]
        .iter()
        .rev()
        .find_map(|segment| get_story_folder_preset_by_name(segment))
}

/// A doc filed under a Settings folder (or one called Locations or Places) — what a
/// map pin links to by default.
pub fn is_location_doc(doc_path: &str) -> bool {
    get_story_folder_preset_for_entry(doc_path, "file").is_some_and(|preset| preset.key == "settings")
}

/// A doc filed under a Characters folder — what travels a map's routes.
pub fn is_character_doc(doc_path: &str) -> bool {
    get_story_folder_preset_for_entry(doc_path, "file").is_some_and(|preset| preset.key == "characters")
}

/// The nearest preset folder a file lives in, with the path to create siblings in.
/// `None` for files outside any preset folder.
pub fn get_story_folder_ancestor(entry_path: &str) -> Option<StoryFolderAncestor> {
    let segments = segments(entry_path);
    if segments.len() < 2 {
        return None;
    }

    for index in (0..segments.len() - 1).rev() {
        if let Some(preset) = get_story_folder_preset_by_name(segments[index]) {
            return Some(StoryFolderAncestor {
                preset,
                path: segments[..=index].join("/"),
            });
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_alias_resolves_to_its_preset() {
        assert_eq!(
            get_story_folder_preset_by_name("Book").unwrap().key,
            "novel"
        );
        assert_eq!(
            get_story_folder_preset_by_name("Novel").unwrap().key,
            "novel"
        );
        assert!(get_story_folder_preset_by_name("book").is_none());
    }

    #[test]
    fn a_file_matches_its_nearest_preset_ancestor() {
        let nearest = get_story_folder_preset_for_entry("Novel/Characters/Ada", "file").unwrap();
        assert_eq!(nearest.key, "characters");
        // A folder matches on its own name, not on its ancestors'.
        assert_eq!(
            get_story_folder_preset_for_entry("Novel/Characters", "folder")
                .unwrap()
                .key,
            "characters"
        );
        // A file named after a preset is still matched by where it lives.
        assert!(get_story_folder_preset_for_entry("Characters", "file").is_none());
    }

    #[test]
    fn the_ancestor_carries_the_path_to_create_siblings_in() {
        let ancestor = get_story_folder_ancestor("Book/Chapter One").unwrap();
        assert_eq!(ancestor.preset.key, "novel");
        assert_eq!(ancestor.path, "Book");
        assert!(get_story_folder_ancestor("Characters").is_none());
    }
}
