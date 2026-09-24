import AppKit
import Foundation
import Testing
@testable import inkblot_core

/// The small pieces with exact contracts: AnyCodable's fidelity, byte ranges, and the
/// Tauri accelerator syntax.
struct AnyCodableTests {
    private func roundTrip(_ json: String) throws -> String {
        let value = try JSONDecoder().decode(AnyCodable.self, from: Data(json.utf8))
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return String(decoding: try encoder.encode(value), as: UTF8.self)
    }

    /// A TipTap document that said `1` must not come back saying `1.0` — the diff
    /// engine and the parity harness both compare numbers by their text.
    @Test func integersStayIntegers() throws {
        #expect(try roundTrip(#"{"level":1,"x":1.5}"#) == #"{"level":1,"x":1.5}"#)
    }

    @Test func everyJSONShapeSurvives() throws {
        let json = #"{"a":[true,null,"s",{"b":[]}],"c":{}}"#
        #expect(try roundTrip(json) == json)
    }

    @Test func equalityIsByValue() throws {
        let decode = { (json: String) in try JSONDecoder().decode(AnyCodable.self, from: Data(json.utf8)) }
        #expect(try decode(#"{"a":[1,2]}"#) == decode(#"{"a":[1,2]}"#))
        #expect(try decode(#"{"a":[1,2]}"#) != decode(#"{"a":[2,1]}"#))
        #expect(try decode("1") != decode("true"))
    }

    /// The generated protocol decodes through AnyCodable wherever content is untyped.
    @Test func aCommandCarryingDocumentContentRoundTrips() throws {
        let json = #"{"type":"setContent","payload":{"pane":"primary","docPath":"one","content":{"type":"doc","content":[{"type":"paragraph"}]},"isLoad":true}}"#
        let command = try JSONDecoder().decode(NativeCommand.self, from: Data(json.utf8))
        guard case .setContent(let payload) = command else { Issue.record("wrong case"); return }
        #expect(payload.docPath == "one")
        let again = try JSONDecoder().decode(NativeCommand.self, from: try JSONEncoder().encode(command))
        #expect(again == command)
    }
}

struct AppSchemeHandlerTests {
    @Test func rangesAreClampedToTheFile() {
        #expect(AppSchemeHandler.parseRange("bytes=0-99", length: 50)! == (0, 49))
        #expect(AppSchemeHandler.parseRange("bytes=10-", length: 50)! == (10, 49))
        #expect(AppSchemeHandler.parseRange("bytes=-5", length: 50)! == (45, 49))
    }

    @Test func anUnsatisfiableRangeIsIgnoredRatherThanServedWrong() {
        #expect(AppSchemeHandler.parseRange("bytes=60-70", length: 50) == nil)
        #expect(AppSchemeHandler.parseRange("bytes=9-3", length: 50) == nil)
        #expect(AppSchemeHandler.parseRange("items=0-1", length: 50) == nil)
    }

    @Test func wasmAndModulesGetTheTypesBrowsersInsistOn() {
        #expect(AppSchemeHandler.mimeType(for: URL(fileURLWithPath: "/x/ort.wasm")) == "application/wasm")
        #expect(AppSchemeHandler.mimeType(for: URL(fileURLWithPath: "/x/index.mjs")) == "text/javascript")
    }
}

@MainActor
struct WebMenusTests {
    @Test func tauriAcceleratorsBecomeKeyEquivalents() {
        let parsed = WebMenus.keyEquivalent("CmdOrCtrl+Shift+V")
        #expect(parsed?.0 == "v")
        #expect(parsed?.1 == [.command, .shift])
        #expect(WebMenus.keyEquivalent("") == nil)
        #expect(WebMenus.keyEquivalent("Shift") == nil)
    }

    @Test func onlyTheViewMenuIsMerged() {
        let menus = WebMenus()
        menus.setAppMenu([
            "rid": 1, "kind": "Menu", "items": [
                ["rid": 2, "kind": "Submenu", "text": "View", "items": [
                    ["rid": 3, "kind": "MenuItem", "text": "Switch to Dark"],
                    ["rid": 4, "kind": "Predefined", "predefined": "Separator"],
                    ["rid": 5, "kind": "Check", "text": "Show Word Count", "checked": true],
                ]],
                ["rid": 6, "kind": "Submenu", "text": "Mystery", "items": []],
            ],
        ])
        #expect(menus.viewMenuItems.map(\.rid) == [3, 4, 5])
        #expect(menus.viewMenuItems[1].isSeparator)
        #expect(menus.viewMenuItems[2].checked)
    }
}
