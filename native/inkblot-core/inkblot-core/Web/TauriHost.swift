import AppKit
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
/// **Not answered yet**, and rejected by name so the bundle's own fallbacks run: the
/// synonym model, Kokoro speech, whisper dictation and the Pinterest scrape. Each is
/// a Rust module in the Tauri app crate (`src-tauri/src/*_commands.rs`) rather than in
/// `inkblot-core`, so there is nothing for `inkblot-ffi` to expose until they move.
/// HANDOFF.md tracks them.
@MainActor
final class TauriHost {
    private let core: CoreService
    private let menus: WebMenus
    private let log = Logger(subsystem: "inkblot", category: "tauri")
    weak var window: NSWindow?

    /// `@tauri-apps/api/path`'s `BaseDirectory.AppData`.
    private static let appDataBaseDirectory = 14

    init(core: CoreService, menus: WebMenus) {
        self.core = core
        self.menus = menus
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
            switch try await dispatch(cmd, args: args, headers: headers, bytes: bytes) {
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
            NSWorkspace.shared.open(url)
            return .value(nil)

        case "plugin:opener|open_path":
            NSWorkspace.shared.open(try path(args["path"], options: nil))
            return .value(nil)

        case "plugin:opener|reveal_item_in_dir":
            let paths = (args["paths"] as? [String]) ?? (args["path"] as? String).map { [$0] } ?? []
            NSWorkspace.shared.activateFileViewerSelecting(paths.map { URL(fileURLWithPath: $0) })
            return .value(nil)

        /* ---------------- the shim's own: menus and the window ---------------- */

        case "menu.popup":
            guard let tree = args["menu"] as? [String: Any] else { throw Failure("No menu to show") }
            return .value(menus.popup(tree, in: window))

        case "menu.setApp":
            guard let tree = args["menu"] as? [String: Any] else { throw Failure("No menu to install") }
            menus.setAppMenu(tree)
            return .value(nil)

        case "window.isFullscreen":
            return .value(window?.styleMask.contains(.fullScreen) ?? false)

        case "window.setTitle":
            window?.title = args["title"] as? String ?? ""
            return .value(nil)

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
            let pattern: NSHapticFeedbackManager.FeedbackPattern = switch args["pattern"] as? String {
            case "alignment": .alignment
            case "levelChange", "level_change": .levelChange
            default: .generic
            }
            NSHapticFeedbackManager.defaultPerformer.perform(pattern, performanceTime: .now)
            return .value(nil)

        default:
            log.info("Unanswered Tauri command: \(cmd, privacy: .public)")
            throw Failure("not available in the native shell yet")
        }
    }

    /* ---------------- arguments ---------------- */

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
}
