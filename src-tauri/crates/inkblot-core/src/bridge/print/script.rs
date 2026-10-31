//! Screenplay reports: scene numbering, scene and script summaries, and the
//! report command.

use super::*;

/// How a script's scenes are numbered.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SceneNumbering {
    #[default]
    Off,
    /// Numbered in order, renumbering as scenes come and go.
    On,
    /// Fixed where they are, for a shooting script: a scene added later is 12A.
    Locked,
}

/// One scene of a script.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneSummary {
    /// Its number, when scenes are numbered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
    pub heading: String,
    /// The page it starts on, once the script is laid out; 0 before.
    pub page: u32,
}

/// A script's scenes and cast.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptSummary {
    pub format: WritingFormat,
    pub scene_numbers: SceneNumbering,
    /// Everyone who speaks, most lines first.
    pub characters: Vec<String>,
    pub scenes: Vec<SceneSummary>,
}

/// Number the active script's scenes, stop, or lock them.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSceneNumbersCommand {
    pub mode: SceneNumbering,
}

/// A breakdown of the active script.
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScriptReportKind {
    /// Who speaks, how often, in which scenes.
    Characters,
    /// Every scene: its page, its length in eighths of a page, who is in it.
    Scenes,
    /// Every place, and the scenes set there.
    Locations,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReportOutput {
    /// Printed, on the script's own pages.
    Print,
    /// A spreadsheet file.
    Csv,
}

/// Print or save a report on the active script.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptReportCommand {
    pub report: ScriptReportKind,
    pub output: ReportOutput,
}
