import SwiftUI
import Testing
@testable import inkblot_core

/// The References panel's half: the page's formatted entries read as rich text, and
/// the page's "show the References tab" lands on it.
@MainActor
struct ReferencesTests {
    @Test func anEntryKeepsItsTextAndItsItalics() {
        let text = ReferenceText.attributed("Austen, J. (2003). <i>Pride and prejudice</i>. Penguin &amp; Co.")
        #expect(String(text.characters) == "Austen, J. (2003). Pride and prejudice. Penguin & Co.")
        let italic = text.runs.first { String(text[$0.range].characters) == "Pride and prejudice" }
        #expect(italic != nil)
    }

    @Test func entitiesAndNumberedCharactersDecode() {
        #expect(ReferenceText.decodeEntities("&#8220;Deep&#x201D; &lt;b&gt; &amp;amp;") == "“Deep” <b> &amp;")
        #expect(ReferenceText.plain("<sup>1</sup> <span class=\"sc\">Ibid</span>.") == "1 Ibid.")
    }

    @Test func aSuperscriptIsRaised() {
        let text = ReferenceText.attributed("word<sup>12</sup>")
        let raised = text.runs.first { String(text[$0.range].characters) == "12" }
        #expect(raised?.baselineOffset ?? 0 > 0)
    }

    @Test func theReferencesTabIsReachableFromThePage() {
        #expect(SidebarModel.Tab(.references) == .references)
        #expect(SidebarModel.Tab.references.title == "References")
    }

    @Test func aPatchCarriesOnlyWhatChanged() throws {
        let patch = ReferencePatch.with(note: "check p. 4")
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(patch)) as? [String: Any]
        #expect(json?["note"] as? String == "check p. 4")
        #expect(json?["fields"] == nil || json?["fields"] is NSNull)
    }
}
