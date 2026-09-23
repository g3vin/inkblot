#if os(macOS)
import AppKit
#else
import UIKit
#endif
import Foundation
import os
import UniformTypeIdentifiers
import WebKit

/// The Swift side of `Web/tauri-shim.js`: the Tauri commands the bundle still makes,
/// answered natively.
///
/// Only what needs the machine arrives here — callbacks, events and the menu tree are
/// kept in the page (see the shim's header). What is left is a short list, and each
/// case below says which package in the bundle makes the call, so that when that
/// caller moves onto the bridge protocol the case can be deleted with confidence.
///
/// The synonym model, rhymes, Kokoro speech, whisper dictation and the Pinterest
/// scrape channel are `ModelService`'s — `inkblot-models` through `inkblot-ffi`, the
/// same engines the Tauri app's `*_commands.rs` wrap.
@MainActor
final class TauriHost {
    private let core: CoreService
    private let menus: WebMenus
    private let models = ModelService.shared
    private let log = Logger(subsystem: "inkblot", category: "tauri")
    weak var window: PlatformWindow?
    /// Which window's page this answers: `main`, or a detached document's label.
    let label: String

    /// `@tauri-apps/api/path`'s `BaseDirectory.AppData`.
    private static let appDataBaseDirectory = 14

    init(core: CoreService, menus: WebMenus, label: String = AuxiliaryWindows.mainLabel) {
        self.core = core
        self.menus = menus
        self.label = label
    }

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
        init(_ message: String) { self.message = message }
    }

    /// What a handler hands back: a JSON value, or bytes for the shim to turn into an
    /// `ArrayBuffer`.
    enum Reply {
        case value(Any?)
        case bytes(Data)
    }

    /// One request from the shim, as JSON. Always answers with JSON — a failure is a
    /// reply saying so, never a dropped promise.
    func handle(json: String) async -> String {
        guard let data = json.data(using: .utf8),
              let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cmd = request["cmd"] as? String
        else {
            return Self.encode(["ok": false, "error": "Malformed request from the page"])
        }

        log.debug("\(cmd, privacy: .public)")
        let args = request["args"] as? [String: Any] ?? [:]
        let headers = request["headers"] as? [String: String] ?? [:]
        let bytes = (request["bytes"] as? String).flatMap { Data(base64Encoded: $0) }

        do {
            let reply = try await dispatch(cmd, args: args, headers: headers, bytes: bytes)
            announceChange(cmd, args: args, headers: headers)
            switch reply {
            case .value(let value):
                return Self.encode(["ok": true, "value": value ?? NSNull()])
            case .bytes(let data):
                return Self.encode(["ok": true, "bytes": data.base64EncodedString()])
            }
        } catch {
            return Self.encode(["ok": false, "error": "\(cmd): \(error.localizedDescription)"])
        }
    }

    private static func encode(_ object: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.fragmentsAllowed])
        else { return #"{"ok":false,"error":"Reply was not JSON"}"# }
        return String(decoding: data, as: UTF8.self)
    }

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    private func dispatch(_ cmd: String, args: [String: Any], headers: [String: String], bytes: Data?) async throws -> Reply {
        switch cmd {
        /* ---------------- @tauri-apps/plugin-fs: FileSystem.js, assets.js, noteImageUtils.js ---------------- */

        case "plugin:fs|read_text_file", "plugin:fs|read_file":
            return .bytes(try Data(contentsOf: try path(args["path"], options: args["options"])))

        case "plugin:fs|write_text_file", "plugin:fs|write_file":
            // plugin-fs puts the path in a header because the body is the file.
            let options = headers["options"].flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) }
            let target = try path(headers["path"]?.removingPercentEncoding, options: options)
            try FileManager.default.createDirectory(
                at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try (bytes ?? Data()).write(to: target, options: .atomic)
            return .value(nil)

        case "plugin:fs|exists":
            return .value(FileManager.default.fileExists(atPath: try path(args["path"], options: args["options"]).path))

        case "plugin:fs|mkdir":
            let recursive = (args["options"] as? [String: Any])?["recursive"] as? Bool ?? false
            try FileManager.default.createDirectory(
                at: try path(args["path"], options: args["options"]), withIntermediateDirectories: recursive)
            return .value(nil)

        case "plugin:fs|read_dir":
            let directory = try path(args["path"], options: args["options"])
            let entries = try FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey])
            return .value(entries.map { entry -> [String: Any] in
                let values = try? entry.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey])
                return [
                    "name": entry.lastPathComponent,
                    "isDirectory": values?.isDirectory ?? false,
                    "isFile": values?.isRegularFile ?? false,
                    "isSymlink": values?.isSymbolicLink ?? false,
                ]
            })

        case "plugin:fs|rename":
            let from = try path(args["oldPath"], options: args["options"])
            let to = try path(args["newPath"], options: args["options"])
            // POSIX rename replaces an existing file; FileManager.moveItem refuses to.
            // FileSystem.js relies on the former when it rewrites through a temp file.
            if FileManager.default.fileExists(atPath: to.path), !Self.isDirectory(to) {
                _ = try FileManager.default.replaceItemAt(to, withItemAt: from)
            } else {
                try FileManager.default.moveItem(at: from, to: to)
            }
            return .value(nil)

        case "plugin:fs|remove":
            let target = try path(args["path"], options: args["options"])
            let recursive = (args["options"] as? [String: Any])?["recursive"] as? Bool ?? false
            // FileManager always recurses. plugin-fs does not unless asked, and a caller
            // that did not ask has not decided to delete a folder's contents.
            if Self.isDirectory(target), !recursive,
               !(try FileManager.default.contentsOfDirectory(atPath: target.path)).isEmpty {
                throw Failure("Directory not empty: \(target.path)")
            }
            try FileManager.default.removeItem(at: target)
            return .value(nil)

        case "plugin:fs|copy_file":
            let from = try path(args["fromPath"], options: args["options"])
            let to = try path(args["toPath"], options: args["options"])
            if FileManager.default.fileExists(atPath: to.path) { try FileManager.default.removeItem(at: to) }
            try FileManager.default.copyItem(at: from, to: to)
            return .value(nil)

        /* ---------------- @tauri-apps/api/path: projectPaths.ts ---------------- */

        case "plugin:path|resolve_directory":
            guard (args["directory"] as? Int) == Self.appDataBaseDirectory else {
                throw Failure("Only AppData is resolvable here; asked for \(args["directory"] ?? "nothing")")
            }
            return .value(core.appDataRoot.path)

        /* ---------------- @tauri-apps/plugin-dialog ---------------- */

        case "plugin:dialog|open":
            return .value(await openPanel(args["options"] as? [String: Any] ?? [:]))

        case "plugin:dialog|save":
            return .value(await savePanel(args["options"] as? [String: Any] ?? [:]))

        case "plugin:dialog|confirm", "plugin:dialog|ask":
            return .value(await alert(
                message: args["message"] as? String ?? "",
                title: args["title"] as? String,
                kind: args["kind"] as? String,
                ok: (args["okButtonLabel"] ?? args["yesButtonLabel"]) as? String ?? (cmd.hasSuffix("ask") ? "Yes" : "OK"),
                cancel: (args["cancelButtonLabel"] ?? args["noButtonLabel"]) as? String ?? (cmd.hasSuffix("ask") ? "No" : "Cancel")))

        case "plugin:dialog|message":
            _ = await alert(
                message: args["message"] as? String ?? "",
                title: args["title"] as? String,
                kind: args["kind"] as? String,
                ok: args["okButtonLabel"] as? String ?? "OK",
                cancel: nil)
            return .value("Ok")

        /* ---------------- @tauri-apps/plugin-opener ---------------- */

        case "plugin:opener|open_url":
            guard let string = args["url"] as? String, let url = URL(string: string) else { throw Failure("Not a URL") }
            Platform.open(url)
            return .value(nil)

        case "plugin:opener|open_path":
            Platform.open(try path(args["path"], options: nil))
            return .value(nil)

        case "plugin:opener|reveal_item_in_dir":
            #if os(macOS)
            let paths = (args["paths"] as? [String]) ?? (args["path"] as? String).map { [$0] } ?? []
            NSWorkspace.shared.activateFileViewerSelecting(paths.map { URL(fileURLWithPath: $0) })
            #endif
            return .value(nil)

        /* ---------------- the shim's own: menus and the window ---------------- */

        case "menu.popup":
            guard let tree = args["menu"] as? [String: Any] else { throw Failure("No menu to show") }
            return .value(menus.popup(tree, in: window))

        case "menu.setApp":
            // The menu bar is the main window's page's: its items activate there, so a
            // detached window's menu would install items nothing could answer.
            guard label == AuxiliaryWindows.mainLabel else { return .value(nil) }
            guard let tree = args["menu"] as? [String: Any] else { throw Failure("No menu to install") }
            menus.setAppMenu(tree)
            return .value(nil)

        case "window.startDrag":
            #if os(macOS)
            // The page asks after its mousedown has already been delivered, so the
            // event that started the drag is the one recorded on the way in — and the
            // drag only starts if that button is still down.
            guard let window, let mouseDown = MouseDownRecorder.shared.last,
                  NSEvent.pressedMouseButtons & 1 == 1
            else { return .value(nil) }
            window.performDrag(with: mouseDown)
            #endif
            return .value(nil)

        case "window.isFullscreen":
            #if os(macOS)
            return .value(window?.styleMask.contains(.fullScreen) ?? false)
            #else
            return .value(false)
            #endif

        case "window.setTitle":
            // On iPadOS the scene's title is what the app switcher shows.
            #if os(macOS)
            window?.title = args["title"] as? String ?? ""
            #else
            window?.windowScene?.title = args["title"] as? String ?? ""
            #endif
            return .value(nil)

        /* ---------------- other windows: docWindow.js, openPinterest.js, pinterestScrape.js ---------------- */

        case "window.list":
            return .value(AuxiliaryWindows.shared.labels)

        case "window.create":
            try AuxiliaryWindows.shared.create(args["options"] as? [String: Any] ?? [:], core: core, menus: menus)
            return .value(nil)

        case "window.op":
            let target = args["label"] as? String ?? label
            let op = try string(args, "op")
            if target == label {
                return .value(window.flatMap { WindowOps.perform(op, value: args["value"], on: $0) })
            }
            if target == AuxiliaryWindows.mainLabel {
                let main = AuxiliaryWindows.shared.mainWindow
                return .value(main.flatMap { WindowOps.perform(op, value: args["value"], on: $0) })
            }
            return .value(AuxiliaryWindows.shared.window(target)?.perform(op, value: args["value"]))

        case "navigate_webview":
            let aux = try auxiliary(args)
            guard let url = URL(string: try string(args, "url")) else { throw Failure("Invalid URL") }
            aux.navigate(to: url)
            return .value(nil)

        case "eval_webview":
            try auxiliary(args).evaluate(try string(args, "script"))
            return .value(nil)

        case "get_webview_url":
            return .value(try auxiliary(args).currentURL)

        /* ---------------- the app's own commands (src-tauri/src/lib.rs and friends) ---------------- */

        case "preferences_load":
            let json = try core.core.preferencesLoadJson()
            return .value(try JSONSerialization.jsonObject(with: Data(json.utf8)))

        case "preferences_set":
            try core.core.preferencesSet(
                scope: try string(args, "scope"), key: try string(args, "key"), value: try string(args, "value"))
            return .value(nil)

        case "preferences_remove":
            try core.core.preferencesRemove(scope: try string(args, "scope"), key: try string(args, "key"))
            return .value(nil)

        case "preferences_rename_prefix":
            try core.core.preferencesRenamePrefix(
                scope: try string(args, "scope"),
                fromPrefix: try string(args, "fromPrefix"),
                toPrefix: try string(args, "toPrefix"))
            return .value(nil)

        case "list_system_fonts":
            return .value(try listSystemFonts())

        case "perform_haptic":
            Platform.haptic(args["pattern"] as? String)
            return .value(nil)

        /* ---------------- inkblot-models: SynonymTile, RhymeTile, readAloud.js, dictation.js, pinterestScrape.js ---------------- */

        case _ where ModelService.commands.contains(cmd):
            return .value(try await models.invoke(cmd, args: args))

        default:
            log.info("Unanswered Tauri command: \(cmd, privacy: .public)")
            throw Failure("not available in the native shell yet")
        }
    }

    /// Say which path a filesystem command just changed (`.inkblotFileChanged`) — the
    /// project tree's change feed on iOS, where there are no FSEvents.
    private func announceChange(_ cmd: String, args: [String: Any], headers: [String: String]) {
        let raw: Any? = switch cmd {
        case "plugin:fs|write_text_file", "plugin:fs|write_file": headers["path"]?.removingPercentEncoding
        case "plugin:fs|mkdir", "plugin:fs|remove": args["path"]
        case "plugin:fs|rename": args["newPath"]
        case "plugin:fs|copy_file": args["toPath"]
        default: nil
        }
        guard let raw else { return }
        let options: Any? = cmd.hasPrefix("plugin:fs|write")
            ? headers["options"].flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) }
            : args["options"]
        guard let changed = try? path(raw, options: options) else { return }
        NotificationCenter.default.post(name: .inkblotFileChanged, object: changed.path)
    }

    /* ---------------- arguments ---------------- */

    /// The window a `*_webview` command names, refused as Tauri refuses it.
    private func auxiliary(_ args: [String: Any]) throws -> AuxiliaryWindow {
        let target = try string(args, "label")
        guard let window = AuxiliaryWindows.shared.window(target) else {
            throw Failure("Webview '\(target)' not found")
        }
        return window
    }

    private func string(_ args: [String: Any], _ key: String) throws -> String {
        guard let value = args[key] as? String else { throw Failure("Missing \(key)") }
        return value
    }

    /// A plugin-fs path: absolute, a `file://` URL, or relative to `options.baseDir`.
    private func path(_ raw: Any?, options: Any?) throws -> URL {
        guard var string = raw as? String, !string.isEmpty else { throw Failure("Missing path") }
        if string.hasPrefix("file://"), let url = URL(string: string) { string = url.path }
        if string.hasPrefix("/") { return URL(fileURLWithPath: string) }

        let baseDir = (options as? [String: Any])?["baseDir"] as? Int
        guard baseDir == Self.appDataBaseDirectory else {
            throw Failure("A relative path needs baseDir AppData: \(string)")
        }
        return core.appDataRoot.appendingPathComponent(string)
    }

    private static func isDirectory(_ url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
    }

    /* ---------------- panels ---------------- */

    #if os(macOS)
    private func openPanel(_ options: [String: Any]) async -> Any? {
        let panel = NSOpenPanel()
        let directory = options["directory"] as? Bool ?? false
        let multiple = options["multiple"] as? Bool ?? false
        panel.canChooseDirectories = directory
        panel.canChooseFiles = !directory
        panel.canCreateDirectories = directory
        panel.allowsMultipleSelection = multiple
        if let title = options["title"] as? String { panel.message = title }
        if let defaultPath = options["defaultPath"] as? String {
            panel.directoryURL = URL(fileURLWithPath: defaultPath)
        }
        let extensions = (options["filters"] as? [[String: Any]] ?? [])
            .flatMap { $0["extensions"] as? [String] ?? [] }
        if !extensions.isEmpty, !extensions.contains("*") {
            panel.allowedContentTypes = extensions.compactMap { UTType(filenameExtension: $0) }
        }

        guard await run(panel) == .OK else { return nil }
        let paths = panel.urls.map(\.path)
        return multiple ? paths : paths.first
    }

    private func savePanel(_ options: [String: Any]) async -> Any? {
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        if let title = options["title"] as? String { panel.message = title }
        if let defaultPath = options["defaultPath"] as? String {
            let url = URL(fileURLWithPath: defaultPath)
            if Self.isDirectory(url) {
                panel.directoryURL = url
            } else {
                panel.directoryURL = url.deletingLastPathComponent()
                panel.nameFieldStringValue = url.lastPathComponent
            }
        }
        guard await run(panel) == .OK else { return nil }
        return panel.url?.path
    }

    /// As a sheet on the window when there is one — a delete confirmation that floats
    /// free of the window it is about reads as a system prompt, not the app's.
    private func run(_ panel: NSSavePanel) async -> NSApplication.ModalResponse {
        guard let window else { return panel.runModal() }
        return await withCheckedContinuation { continuation in
            panel.beginSheetModal(for: window) { continuation.resume(returning: $0) }
        }
    }

    private func alert(message: String, title: String?, kind: String?, ok: String, cancel: String?) async -> Bool {
        let alert = NSAlert()
        alert.messageText = title ?? message
        if title != nil { alert.informativeText = message }
        alert.alertStyle = switch kind {
        case "warning": .warning
        case "error": .critical
        default: .informational
        }
        alert.addButton(withTitle: ok)
        if let cancel { alert.addButton(withTitle: cancel) }

        let response: NSApplication.ModalResponse
        if let window {
            response = await withCheckedContinuation { continuation in
                alert.beginSheetModal(for: window) { continuation.resume(returning: $0) }
            }
        } else {
            response = alert.runModal()
        }
        return response == .alertFirstButtonReturn
    }
    #else
    /// The page asks for files by path; the document picker answers with URLs lent for
    /// the duration of a security scope, which nothing here can hold open while the page
    /// reads through plugin-fs. So files are picked `asCopy` — the picker copies them
    /// into the app's container, and those paths are what the page gets. A folder cannot
    /// be copied, so a folder pick is still a lent URL: choosing a project folder
    /// outside the app's container does not work on iOS yet.
    private func openPanel(_ options: [String: Any]) async -> Any? {
        let directory = options["directory"] as? Bool ?? false
        let multiple = options["multiple"] as? Bool ?? false
        let extensions = (options["filters"] as? [[String: Any]] ?? [])
            .flatMap { $0["extensions"] as? [String] ?? [] }
        let types: [UTType] = directory ? [.folder]
            : (extensions.isEmpty || extensions.contains("*")) ? [.item]
            : extensions.compactMap { UTType(filenameExtension: $0) }

        guard let presenter = Self.presenter(for: window) else { return nil }
        let urls: [URL] = await withCheckedContinuation { continuation in
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: !directory)
            picker.allowsMultipleSelection = multiple
            let delegate = DocumentPickerDelegate { continuation.resume(returning: $0) }
            picker.delegate = delegate
            objc_setAssociatedObject(picker, &DocumentPickerDelegate.key, delegate, .OBJC_ASSOCIATION_RETAIN)
            presenter.present(picker, animated: true)
        }
        guard !urls.isEmpty else { return nil }
        let paths = urls.map(\.path)
        return multiple ? paths : paths.first
    }

    /// Not yet: a save panel on iOS exports a file that already exists, and the page
    /// asks where to write before it writes. A cancelled panel is the answer the page
    /// already handles.
    private func savePanel(_ options: [String: Any]) async -> Any? { nil }

    private func alert(message: String, title: String?, kind: String?, ok: String, cancel: String?) async -> Bool {
        guard let presenter = Self.presenter(for: window) else { return false }
        return await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: title ?? message, message: title == nil ? nil : message,
                                          preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: ok, style: kind == "warning" ? .destructive : .default) { _ in
                continuation.resume(returning: true)
            })
            if let cancel {
                alert.addAction(UIAlertAction(title: cancel, style: .cancel) { _ in
                    continuation.resume(returning: false)
                })
            }
            presenter.present(alert, animated: true)
        }
    }

    /// The view controller at the top of the window, to present from.
    static func presenter(for window: UIWindow?) -> UIViewController? {
        let window = window ?? UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
    #endif
}

#if !os(macOS)
/// `UIDocumentPickerViewController`'s delegate, answering once — picked or cancelled.
private final class DocumentPickerDelegate: NSObject, UIDocumentPickerDelegate {
    nonisolated(unsafe) static var key: UInt8 = 0
    private var answer: (([URL]) -> Void)?

    init(_ answer: @escaping ([URL]) -> Void) { self.answer = answer }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        answer?(urls)
        answer = nil
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        answer?([])
        answer = nil
    }
}
#endif

#if os(macOS)
/// The last left mouse-down in the app, for a window drag the page asks for after the
/// event has gone by. `performDrag(with:)` needs the event that began the gesture.
@MainActor
final class MouseDownRecorder {
    static let shared = MouseDownRecorder()
    private(set) var last: NSEvent?
    private var monitor: Any?

    private init() {
        monitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            self?.last = event
            return event
        }
    }
}
#endif
