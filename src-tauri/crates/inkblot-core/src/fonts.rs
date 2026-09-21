//! System font enumeration. No Tauri, no UI — just font-kit.


/// Every font family installed on the machine, so anything the user adds in
/// Font Book shows up in the editor without a rebuild.
///
/// Families whose names start with a dot are Apple's private system faces
/// (".SF NS", ".LastResort", …). They are hidden from Font Book too, and
/// several refuse to render, so they are filtered out.
pub fn list_system_fonts() -> Result<Vec<String>, String> {
    use font_kit::source::SystemSource;

    let mut families = SystemSource::new()
        .all_families()
        .map_err(|e| format!("Failed to enumerate system fonts: {e}"))?;

    families.retain(|family| !family.trim().is_empty() && !family.starts_with('.'));
    families.sort_by_key(|family| family.to_lowercase());
    families.dedup();

    Ok(families)
}
