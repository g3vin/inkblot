import Foundation
import Testing
@testable import inkblot_core

/// The Swift end of the bridge, against the wire format the page actually sends.
///
/// The JSON here is written out by hand rather than produced by the Swift encoder:
/// what has to be true is that Swift reads what `src/bridge/client.ts` writes, and a
/// test that encodes with Swift and decodes with Swift proves only that Swift agrees
/// with itself. The page-side half of the same contract is `scripts/canvas-tests/bridge.mjs`.
@MainActor
struct ShellBridgeTests {
    /// A bridge attached to a page that records what it was sent.
    private func attached() -> (ShellBridge, Box<[String]>) {
        let bridge = ShellBridge()
        let sent = Box<[String]>([])
        bridge.detach()
        bridge.attach { sent.value.append($0) }
        return (bridge, sent)
    }

    private func event(_ seq: Int, _ type: String, _ payload: String) -> String {
        #"{"kind":"event","message":{"seq":\#(seq),"event":{"type":"\#(type)","payload":\#(payload)}}}"#
    }

    private let toolbar = #"""
    {"target":"primary","color":"#000000","highlight":"#ffff00","font":"Georgia","fontSize":"18px",
     "alignment":"center","activeMarks":{"bold":true,"italic":false,"underline":false,"strike":false,"table":false},
     "lastHighlightColor":"#ffff00"}
    """#

    @Test func aPushedToolbarStateIsWhatTheMenuReads() {
        let (bridge, _) = attached()
        bridge.receive(json: event(0, "toolbarState", toolbar))
        #expect(bridge.toolbar?.activeMarks.bold == true)
        #expect(bridge.toolbar?.alignment == .center)
        #expect(bridge.toolbar?.target == .primary)
    }

    @Test func theProjectFollowsTheLandingScreen() {
        let (bridge, _) = attached()
        bridge.receive(json: event(0, "projectChanged", #"{"projectName":"Novel","projectRoot":"/Users/me/Novel"}"#))
        #expect(bridge.project.projectName == "Novel")
        // `{}` — no project — is the landing screen, and must decode, not fail.
        bridge.receive(json: event(1, "projectChanged", "{}"))
        #expect(bridge.project.projectName == nil)
        #expect(bridge.droppedEventCount == 0)
    }

    @Test func aGapInTheEventStreamIsCounted() {
        let (bridge, _) = attached()
        bridge.receive(json: event(0, "projectChanged", "{}"))
        bridge.receive(json: event(3, "projectChanged", "{}"))
        #expect(bridge.droppedEventCount == 2)
    }

    @Test func somethingThatIsNotTheProtocolIsDroppedNotApplied() {
        let (bridge, _) = attached()
        bridge.receive(json: event(0, "toolbarState", ##"{"color":"#000"}"##))
        bridge.receive(json: "{not json")
        #expect(bridge.toolbar == nil)
    }

    @Test func commandsGoOutSequencedFromZeroInTheShapeThePageReads() throws {
        let (bridge, sent) = attached()
        bridge.send(.applyMark(ApplyMarkCommand(target: .primary, mark: .bold)))
        bridge.send(.insertPlainText(InsertPlainTextCommand(target: .secondary, text: "<b>x</b>")))

        let first = try JSONSerialization.jsonObject(with: Data(sent.value[0].utf8)) as! [String: Any]
        let message = first["message"] as! [String: Any]
        let command = message["command"] as! [String: Any]
        #expect(first["kind"] as? String == "command")
        #expect(message["seq"] as? Int == 0)
        #expect(command["type"] as? String == "applyMark")
        #expect((command["payload"] as? [String: Any])?["mark"] as? String == "bold")

        let second = try JSONSerialization.jsonObject(with: Data(sent.value[1].utf8)) as! [String: Any]
        #expect((second["message"] as? [String: Any])?["seq"] as? Int == 1)
    }

    @Test func aNewPageRestartsTheCounters() throws {
        let (bridge, sent) = attached()
        bridge.send(.applyMark(ApplyMarkCommand(target: .primary, mark: .bold)))
        bridge.receive(json: event(0, "projectChanged", "{}"))

        bridge.detach()
        bridge.attach { sent.value.append($0) }
        bridge.send(.applyMark(ApplyMarkCommand(target: .primary, mark: .italic)))
        bridge.receive(json: event(0, "projectChanged", "{}"))

        let last = try JSONSerialization.jsonObject(with: Data(sent.value.last!.utf8)) as! [String: Any]
        #expect((last["message"] as? [String: Any])?["seq"] as? Int == 0)
        #expect(bridge.droppedEventCount == 0)
    }

    @Test func aCommandSentBeforeThePageLoadsWaitsForIt() {
        let bridge = ShellBridge()
        bridge.detach()
        bridge.send(.applyMark(ApplyMarkCommand(target: .primary, mark: .bold)))
        let sent = Box<[String]>([])
        bridge.attach { sent.value.append($0) }
        #expect(sent.value.count == 1)
    }

    @Test func aRequestIsAnsweredByItsOwnReply() async throws {
        let (bridge, sent) = attached()
        let state = Task { try await bridge.toolbarState() }
        // Let the request go out, then answer it the way the page does.
        while sent.value.isEmpty { await Task.yield() }
        let request = try JSONSerialization.jsonObject(with: Data(sent.value[0].utf8)) as! [String: Any]
        let id = (request["message"] as! [String: Any])["id"] as! String
        bridge.receive(json: #"{"kind":"reply","message":{"id":"\#(id)","reply":{"type":"toolbarState","payload":\#(toolbar)}}}"#)
        #expect(try await state.value.fontSize == "18px")
    }

    @Test func aRequestTheSurfaceRefusesThrowsItsMessage() async throws {
        let (bridge, sent) = attached()
        let answer = Task { try await bridge.request(.getReadAloudPayload(ReadAloudQuery(target: nil, selectionOnly: false))) }
        while sent.value.isEmpty { await Task.yield() }
        bridge.receive(json: #"{"kind":"reply","message":{"id":"r0","reply":{"type":"error","payload":{"code":"failed","message":"no handler"}}}}"#)
        // The surface's own refusal, not a timeout that happens to be the same type.
        do {
            _ = try await answer.value
            Issue.record("A refused request returned a value")
        } catch ShellBridge.BridgeFailure.surface(let error) {
            #expect(error.message == "no handler")
        }
    }

    @Test func aRequestOutstandingWhenThePageGoesIsFailedNotLeftHanging() async {
        let (bridge, sent) = attached()
        let answer = Task { try await bridge.toolbarState() }
        while sent.value.isEmpty { await Task.yield() }
        bridge.detach()
        await #expect(throws: ShellBridge.BridgeFailure.self) { try await answer.value }
    }
}

/// A reference cell, so a closure handed to the bridge can record into the test.
final class Box<T> {
    var value: T
    init(_ value: T) { self.value = value }
}
