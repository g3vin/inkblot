import SwiftUI

/// The Publish tab's tools for a screenplay or a play in production: its scene numbers,
/// breakdown reports, sides for an audition or a day's shoot, and an actor's copy with
/// their speeches marked. Shown only when the document is a script.
struct ScriptProductionSection: View {
    @Environment(AppModel.self) private var model
    let script: ScriptSummary
    @State private var choosingSides = false

    var body: some View {
        @Bindable var layout = model.pageLayout
        FinishingSection("Script Production", id: FinishingSectionID.script) {
            Picker("Scene Numbers", selection: Binding(
                get: { script.sceneNumbers },
                set: { layout.setSceneNumbers($0) })) {
                Text("None").tag(SceneNumbering.off)
                Text("Numbered").tag(SceneNumbering.on)
                Text("Locked").tag(SceneNumbering.locked)
            }
            if script.sceneNumbers == .locked {
                FinishingCaution(text: "A scene added now takes a letter — 12A between 12 and 13 — so pages already sent out keep their numbers.")
            }

            Picker("Highlight", selection: $layout.printOptions.highlightCharacter) {
                Text("No One").tag("")
                if !script.characters.isEmpty { Divider() }
                ForEach(script.characters, id: \.self) { name in
                    Text(name.capitalized).tag(name)
                }
            }
            .help("Print one character's speeches marked, for an actor's copy")

            LabeledContent("Reports") {
                Menu("Report") {
                    reportItems("Characters", .characters)
                    reportItems("Scenes", .scenes)
                    reportItems("Locations", .locations)
                }
                .fixedSize()
            }

            LabeledContent("Sides") {
                Button("Print Sides…") { choosingSides = true }
                    .disabled(script.scenes.isEmpty)
                    .popover(isPresented: $choosingSides, arrowEdge: .leading) {
                        SidesPicker(scenes: script.scenes) { chosen in
                            choosingSides = false
                            layout.printSides(chosen)
                        }
                    }
            }
        } footer: {
            Text(summary)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func reportItems(_ title: String, _ kind: ScriptReportKind) -> some View {
        Menu(title) {
            Button("Print…") { model.pageLayout.scriptReport(kind, output: .print) }
            Button("Save as Spreadsheet (CSV)…") { model.pageLayout.scriptReport(kind, output: .csv) }
        }
    }

    private var summary: String {
        let scenes = script.scenes.count == 1 ? "1 scene" : "\(script.scenes.count) scenes"
        let cast = script.characters.count == 1 ? "1 speaking part" : "\(script.characters.count) speaking parts"
        return "\(scenes), \(cast)."
    }
}

/// The scenes to print as sides: a checklist, in script order, with where each starts.
private struct SidesPicker: View {
    let scenes: [SceneSummary]
    let print: ([UInt32]) -> Void
    @State private var chosen: Set<Int> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Print Sides").font(.headline)
            Text("The pages the chosen scenes are on, numbered as in the whole script.")
                .font(.caption)
                .foregroundStyle(.secondary)
            List(Array(scenes.enumerated()), id: \.offset) { index, scene in
                Toggle(isOn: Binding(
                    get: { chosen.contains(index) },
                    set: { on in if on { chosen.insert(index) } else { chosen.remove(index) } })) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(scene.number ?? "\(index + 1)")
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .frame(minWidth: 28, alignment: .trailing)
                        Text(scene.heading).lineLimit(1).truncationMode(.tail)
                        Spacer(minLength: 8)
                        if scene.page > 0 {
                            Text("p. \(scene.page)").monospacedDigit().foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .frame(minHeight: 180, idealHeight: 280)
            HStack {
                Button(chosen.count == scenes.count ? "Choose None" : "Choose All") {
                    chosen = chosen.count == scenes.count ? [] : Set(scenes.indices)
                }
                Spacer()
                Button("Print…") { print(chosen.sorted().map { UInt32($0) }) }
                    .keyboardShortcut(.defaultAction)
                    .disabled(chosen.isEmpty)
            }
        }
        .padding(14)
        .frame(width: 360)
    }
}
