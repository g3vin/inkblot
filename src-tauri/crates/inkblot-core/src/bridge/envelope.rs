//! What actually goes over the wire, and the one part of the protocol that is not
//! fire-and-forget.
//!
//! Most of the bridge is one-way: the shell commands, the webview reports. Two things
//! are not, and both are the same shape — the shell needs an answer *now*, from the
//! live document, before it can do the next thing.
//!
//! The motivating case is the context menu. It is built when the user right-clicks and
//! it has to be built from the selection as it is at that moment; a pushed
//! `SelectionContext` from the last selection change is a different question's answer.
//! `Toolbar` has the same need on first mount, before any selection has changed.

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use super::command::NativeCommand;
use super::common::EditorTarget;
use super::event::{ReadAloudPayloadEvent, SelectionContext, ToolbarState, WebviewEvent};

/// A question aimed at a particular editor, or at whichever one is active.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorQuery {
    /// Absent means "whichever editor is active" — which is what a context menu wants,
    /// since the click that opened it is what decided.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<EditorTarget>,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAloudQuery {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<EditorTarget>,
    /// Read only the selection rather than the whole document.
    pub selection_only: bool,
}

/// The plain text of a document, with the positions it was read from.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentText {
    pub doc_path: String,
    pub text: String,
}

/// What the shell can ask the document surface.
///
/// Kept deliberately small. Every question here is one that only a live ProseMirror
/// document can answer; anything answerable from a file on disk belongs in
/// `inkblot-core` proper, where it needs no round trip at all.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
pub enum BridgeRequest {
    GetSelectionContext(EditorQuery),
    GetToolbarState(EditorQuery),
    GetReadAloudPayload(ReadAloudQuery),
    GetDocumentText(EditorQuery),
}

/// Why a request could not be answered.
///
/// A reply is always sent, including this one. A shell blocked on an answer that never
/// arrives is a hang, and the commonest cause is entirely ordinary: the user closed the
/// pane between the right-click and the menu being built.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeError {
    pub code: BridgeErrorCode,
    pub message: String,
}

#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BridgeErrorCode {
    /// No live editor to answer for — an empty pane, or a canvas with no card open.
    NoEditor,
    /// The editor named by `target` is not the one that exists.
    WrongTarget,
    /// The webview raised while answering.
    Failed,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
pub enum BridgeReply {
    SelectionContext(SelectionContext),
    ToolbarState(ToolbarState),
    ReadAloudPayload(ReadAloudPayloadEvent),
    DocumentText(DocumentText),
    Error(BridgeError),
}

/// A command, with its place in the stream.
///
/// `seq` is monotonic per direction. It is not used for ordering — the transports this
/// protocol is built for deliver in order — but for *noticing*: a gap means a message
/// was dropped, and a bridge that silently drops a `setContent` loses the user's
/// document. The reference transport asserts on a gap rather than logging one.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandEnvelope {
    pub seq: u32,
    pub command: NativeCommand,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventEnvelope {
    pub seq: u32,
    pub event: WebviewEvent,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestEnvelope {
    /// Correlates the reply. Opaque to the webview, which echoes it back.
    pub id: String,
    pub request: BridgeRequest,
}

#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyEnvelope {
    pub id: String,
    pub reply: BridgeReply,
}

/// Everything the shell sends in.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
// Boxing variants would change the generated TypeScript, and a message is serialized
// as soon as it is built, so its size is never copied around.
#[allow(clippy::large_enum_variant)]
pub enum InboundMessage {
    Command(CommandEnvelope),
    Request(RequestEnvelope),
}

/// Everything the document surface sends out.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
// As InboundMessage.
#[allow(clippy::large_enum_variant)]
pub enum OutboundMessage {
    Event(EventEnvelope),
    Reply(ReplyEnvelope),
}
