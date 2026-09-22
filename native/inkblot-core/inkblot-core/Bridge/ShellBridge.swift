import Foundation
import Observation
import os

/// The shell's end of the bridge protocol — the Swift twin of `createShellBridge` in
/// `src/bridge/client.ts`, and held to the same four rules:
///
///  - **Sequence numbers are checked.** A gap is a message the page sent and this side
///    never saw, which is otherwise indistinguishable from the page having nothing to
///    say. It is logged, loudly, rather than trusted.
///  - **A request is always settled** — by its reply, by a timeout, or by the page
///    going away. A caller awaiting an answer that never comes is a hang with no
///    symptom.
///  - **A message that does not decode is reported, not dropped.** The generated
///    `Codable` enums reject anything that is not the protocol, so a decode failure is
///    the protocol and the page disagreeing — the one thing `npm run types:check`
///    exists to prevent, and worth hearing about when it happens anyway.
///  - **No bare document positions.** Nothing here constructs one; everything that
///    addresses text goes through a `TextAnchor` the page handed out.
///
/// Everything is on the main actor. `WKWebView` delivers there, the UI reads from here,
/// and there is nothing on this path slow enough to be worth a hop.
@MainActor
@Observable
final class ShellBridge {
    /* ---------------- what the UI reads ---------------- */

    /// The last toolbar state the page published. `nil` until it has.
    private(set) var toolbar: ToolbarState?
    /// Which editor the page elected, and which document it is showing.
    private(set) var activeEditor: ActiveEditorChanged?
    /// The open project. `nil` name is the landing screen.
    private(set) var project = ProjectChanged(projectName: nil, projectRoot: nil)
    /// The last `docChanged` — what made the file tree stale, among other things.
    private(set) var lastDocChanged: DocChanged?

    /* ---------------- the wire ---------------- */

    /// Where serialized `InboundMessage`s go. Set by the web view once its page can
    /// hear them; until then they wait in `outbox`.
    @ObservationIgnored private var deliver: ((String) -> Void)?
    @ObservationIgnored private var outbox: [String] = []

    /// How many events the page sent that never arrived, since launch. Kept rather than
    /// only logged so a test — or a diagnostics panel — can see it.
    @ObservationIgnored private(set) var droppedEventCount = 0

    @ObservationIgnored private var nextSeq: UInt32 = 0
    @ObservationIgnored private var expectedEventSeq: UInt32 = 0
    @ObservationIgnored private var nextRequestId = 0
    @ObservationIgnored private var pending: [String: CheckedContinuation<BridgeReply, Error>] = [:]
    @ObservationIgnored private var listeners: [UUID: (WebviewEvent) -> Void] = [:]

    @ObservationIgnored private let encoder = JSONEncoder()
    @ObservationIgnored private let decoder = JSONDecoder()
    @ObservationIgnored private let log = Logger(subsystem: "inkblot", category: "bridge")

    static let requestTimeout: Duration = .seconds(5)

    enum BridgeFailure: LocalizedError {
        case timedOut(String)
        case pageGone
        case surface(BridgeError)
        case unexpectedReply(String)

        var errorDescription: String? {
            switch self {
            case .timedOut(let what): "The document surface did not answer \(what) in time."
            case .pageGone: "The document surface went away before it answered."
            case .surface(let error): error.message
            case .unexpectedReply(let what): "The document surface answered \(what) with the wrong reply."
            }
        }
    }

    /* ---------------- lifecycle ---------------- */

    /// A page has committed: from here it may start talking, and it counts from zero.
    ///
    /// Called on every navigation, reloads included, and *before* the page's scripts run
    /// — resetting at `attach` instead would count the events a loading page sends as a
    /// gap. Anything still waiting on the old page is failed rather than left to time
    /// out: the page that would have answered no longer exists. Messages sent from here
    /// until `attach` wait in the outbox.
    func detach() {
        deliver = nil
        failPending()
        nextSeq = 0
        expectedEventSeq = 0
        outbox.removeAll()
    }

    /// The page has loaded and can hear us.
    func attach(_ deliver: @escaping (String) -> Void) {
        self.deliver = deliver
        let queued = outbox
        outbox.removeAll()
        queued.forEach(deliver)
    }

    private func failPending() {
        let waiting = pending
        pending.removeAll()
        for continuation in waiting.values {
            continuation.resume(throwing: BridgeFailure.pageGone)
        }
    }

    /* ---------------- sending ---------------- */

    /// Fire and forget, as every command is. A command for an editor that has gone is
    /// not an error on the page side, so it is not one here either.
    func send(_ command: NativeCommand) {
        let envelope = CommandEnvelope(seq: nextSeq, command: command)
        nextSeq &+= 1
        post(.command(envelope))
    }

    /// Ask the live document something, and wait for the answer.
    func request(_ request: BridgeRequest) async throws -> BridgeReply {
        let id = "r\(nextRequestId)"
        nextRequestId += 1

        let reply: BridgeReply = try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            post(.request(RequestEnvelope(id: id, request: request)))
            Task { [weak self] in
                try? await Task.sleep(for: Self.requestTimeout)
                self?.settle(id, with: .failure(BridgeFailure.timedOut(request.name)))
            }
        }
        if case .error(let error) = reply { throw BridgeFailure.surface(error) }
        return reply
    }

    func toolbarState(for target: EditorTarget? = nil) async throws -> ToolbarState {
        let reply = try await request(.getToolbarState(EditorQuery(target: target)))
        guard case .toolbarState(let state) = reply else { throw BridgeFailure.unexpectedReply("getToolbarState") }
        return state
    }

    private func settle(_ id: String, with result: Result<BridgeReply, Error>) {
        guard let continuation = pending.removeValue(forKey: id) else { return }
        continuation.resume(with: result)
    }

    private func post(_ message: InboundMessage) {
        guard let data = try? encoder.encode(message), let json = String(data: data, encoding: .utf8) else {
            log.fault("A protocol message would not encode: \(String(describing: message), privacy: .public)")
            return
        }
        log.debug("\(self.deliver == nil ? "queued" : "sent"): \(json.prefix(160), privacy: .public)")
        if let deliver { deliver(json) } else { outbox.append(json) }
    }

    /* ---------------- receiving ---------------- */

    /// Subscribe to every event. Returns the token `removeListener` takes.
    @discardableResult
    func addListener(_ handler: @escaping (WebviewEvent) -> Void) -> UUID {
        let token = UUID()
        listeners[token] = handler
        return token
    }

    func removeListener(_ token: UUID) {
        listeners.removeValue(forKey: token)
    }

    /// One `OutboundMessage`, as the page serialized it.
    func receive(json: String) {
        let message: OutboundMessage
        do {
            message = try decoder.decode(OutboundMessage.self, from: Data(json.utf8))
        } catch {
            log.error("The page sent something that is not the protocol: \(json.prefix(300), privacy: .public)")
            return
        }

        switch message {
        case .reply(let envelope):
            settle(envelope.id, with: .success(envelope.reply))
        case .event(let envelope):
            log.debug("event \(envelope.seq): \(json.prefix(160), privacy: .public)")
            checkSequence(envelope.seq)
            apply(envelope.event)
            for listener in Array(listeners.values) { listener(envelope.event) }
        }
    }

    private func checkSequence(_ seq: UInt32) {
        if seq != expectedEventSeq {
            droppedEventCount += max(0, Int(seq) - Int(expectedEventSeq))
            log.error("Bridge dropped \(Int(seq) - Int(self.expectedEventSeq)) event(s): expected seq \(self.expectedEventSeq), got \(seq).")
        }
        expectedEventSeq = max(expectedEventSeq, seq) &+ 1
    }

    private func apply(_ event: WebviewEvent) {
        switch event {
        case .toolbarState(let state): toolbar = state
        case .activeEditorChanged(let info): activeEditor = info
        case .projectChanged(let changed): project = changed
        case .docChanged(let changed): lastDocChanged = changed
        default: break
        }
    }
}

extension BridgeRequest {
    /// The wire name, for messages about a request.
    var name: String {
        switch self {
        case .getSelectionContext: "getSelectionContext"
        case .getToolbarState: "getToolbarState"
        case .getReadAloudPayload: "getReadAloudPayload"
        case .getDocumentText: "getDocumentText"
        }
    }
}
