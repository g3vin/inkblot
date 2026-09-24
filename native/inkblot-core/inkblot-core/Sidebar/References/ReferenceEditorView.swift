import SwiftUI

/// A source's details, edited in place under its entry.
///
/// The form is the kind's (`ReferenceKindSpec`, published by the page), so a court case
/// asks for the court and a podcast for the episode. Required fields that are empty are
/// marked, and the entry above re-formats as they are filled — a pause after the last
/// keystroke, not per character, as the notes are committed.
///
/// Two texts are the writer's own: the **annotation**, which prints under the entry in
/// an annotated bibliography, and the **note**, which is private and never printed.
struct ReferenceEditorView: View {
    @Environment(AppModel.self) private var model
    let view: ReferenceView

    @State private var fields: [String: String] = [:]
    @State private var contributors: [Contributor] = []
    @State private var annotation = ""
    @State private var note = ""
    @State private var loadedFor: String?
    @State private var commitTask: Task<Void, Never>?
    @FocusState private var focused: Bool

    private var reference: Reference { view.reference }
    private var schema: ReferenceSchema? { model.sidebar.referenceSchema }
    private var kind: ReferenceKindSpec? { schema?.kinds.first { $0.id == reference.kind } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let error = reference.error {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
            if !reference.candidates.isEmpty { candidates }
            kindPicker
            contributorsSection
            fieldsSection
            writersText
        }
        .font(.callout)
        .focused($focused)
        .onAppear { load() }
        .onChange(of: reference) { _, _ in if !focused { load() } }
        .onChange(of: focused) { _, isFocused in if !isFocused { commit() } }
        .onDisappear { commit() }
    }

    /* ---------------- choosing a match ---------------- */

    private var candidates: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Which one did you mean?").font(.caption).foregroundStyle(.secondary)
            ForEach(Array(reference.candidates.enumerated()), id: \.offset) { index, candidate in
                Button { model.sidebar.chooseCandidate(reference.id, index: index) } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(candidate.title).lineLimit(2)
                        Text(candidate.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
                    .background(RoundedRectangle(cornerRadius: 6).fill(.background.tertiary))
                }
                .buttonStyle(.plain)
            }
            Text("None of these? Fill the details in below.").font(.caption).foregroundStyle(.secondary)
        }
    }

    /* ---------------- the kind ---------------- */

    private var kindPicker: some View {
        let kinds = schema?.kinds ?? []
        let groups = kinds.reduce(into: [String]()) { if !$0.contains($1.group) { $0.append($1.group) } }
        return Picker("Type", selection: Binding(
            get: { reference.kind },
            set: { value in model.sidebar.updateReference(reference.id, .with(kind: value)) })) {
            ForEach(groups, id: \.self) { group in
                Section(group) {
                    ForEach(kinds.filter { $0.group == group }, id: \.id) { kind in
                        Label(kind.label, systemImage: kind.symbol).tag(kind.id)
                    }
                }
            }
        }
        .pickerStyle(.menu)
        .controlSize(.small)
    }

    /* ---------------- people ---------------- */

    private var contributorsSection: some View {
        let roles = kind?.roles ?? ["author"]
        let labels = Dictionary(uniqueKeysWithValues: (schema?.roles ?? []).map { ($0.id, $0.label) })
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Contributors").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Menu {
                    ForEach(roles, id: \.self) { role in
                        Button(labels[role] ?? role.capitalized) { addContributor(role: role, organization: false) }
                    }
                    Divider()
                    Button("Organization") { addContributor(role: roles.first ?? "author", organization: true) }
                } label: {
                    Image(systemName: "plus")
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .help("Add an author, editor or other contributor")
            }
            ForEach(contributors.indices, id: \.self) { index in
                ContributorRow(
                    contributor: $contributors[index],
                    roles: roles,
                    labels: labels,
                    onChange: scheduleCommit,
                    onRemove: {
                        contributors.remove(at: index)
                        scheduleCommit()
                    },
                    onMoveUp: index > 0 ? {
                        contributors.swapAt(index, index - 1)
                        scheduleCommit()
                    } : nil)
            }
        }
    }

    private func addContributor(role: String, organization: Bool) {
        contributors.append(organization
            ? Contributor(role: role, family: nil, given: nil, literal: "")
            : Contributor(role: role, family: "", given: "", literal: nil))
    }

    /* ---------------- the details ---------------- */

    private var fieldsSection: some View {
        let specs = kind?.fields ?? []
        let known = Set(specs.map(\.key))
        let extra = fields.keys.filter { !known.contains($0) && !Self.hidden.contains($0) }.sorted()
        return VStack(alignment: .leading, spacing: 6) {
            ForEach(specs, id: \.key) { spec in
                FieldRow(
                    label: spec.label,
                    placeholder: spec.placeholder,
                    multiline: spec.input == .multiline,
                    missing: spec.required && (fields[spec.key] ?? "").trimmingCharacters(in: .whitespaces).isEmpty,
                    text: binding(spec.key),
                    trailing: spec.input == .date && (spec.key == "accessed") ? AnyView(todayButton(spec.key)) : nil)
            }
            if !extra.isEmpty {
                DisclosureGroup("Other details (\(extra.count))") {
                    ForEach(extra, id: \.self) { key in
                        FieldRow(label: key, placeholder: "", multiline: false, missing: false, text: binding(key), trailing: nil)
                    }
                }
                .font(.caption)
            }
        }
    }

    /// Kept by lookups for the record, not asked for in any form.
    private static let hidden: Set<String> = ["abstract", "language", "ISSN", "citation-number"]

    private func todayButton(_ key: String) -> some View {
        Button("Today") {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            fields[key] = formatter.string(from: .now)
            scheduleCommit()
        }
        .buttonStyle(.borderless)
        .font(.caption)
    }

    private func binding(_ key: String) -> Binding<String> {
        Binding(
            get: { fields[key] ?? "" },
            set: { value in
                fields[key] = value
                scheduleCommit()
            })
    }

    /* ---------------- the writer's own ---------------- */

    private var writersText: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Label("Annotation", systemImage: "text.append").font(.caption).foregroundStyle(.secondary)
                TextField("A summary or evaluation of the source", text: $annotation, axis: .vertical)
                    .lineLimit(2...8)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: annotation) { _, _ in scheduleCommit() }
                Text("Printed under the entry when the bibliography is annotated.")
                    .font(.caption2).foregroundStyle(.tertiary)
            }
            VStack(alignment: .leading, spacing: 3) {
                Label("Note", systemImage: "lock").font(.caption).foregroundStyle(.secondary)
                TextField("Why it matters, what to check, where the good quote is", text: $note, axis: .vertical)
                    .lineLimit(2...8)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: note) { _, _ in scheduleCommit() }
                Text("Private — never printed.")
                    .font(.caption2).foregroundStyle(.tertiary)
            }
        }
    }

    /* ---------------- committing ---------------- */

    private func load() {
        fields = reference.fields
        contributors = reference.contributors
        annotation = reference.annotation
        note = reference.note
        loadedFor = reference.id
    }

    private func scheduleCommit() {
        commitTask?.cancel()
        commitTask = Task {
            try? await Task.sleep(for: .milliseconds(450))
            guard !Task.isCancelled else { return }
            commit()
        }
    }

    private func commit() {
        commitTask?.cancel()
        guard loadedFor == reference.id else { return }
        var changedFields: [String: String] = [:]
        for key in Set(fields.keys).union(reference.fields.keys) {
            let value = (fields[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if value != (reference.fields[key] ?? "") { changedFields[key] = value }
        }
        let people = contributors.filter { !$0.displayName.trimmingCharacters(in: .whitespaces).isEmpty }
        let patch = ReferencePatch.with(
            contributors: people == reference.contributors ? nil : people,
            fields: changedFields.isEmpty ? nil : changedFields,
            annotation: annotation == reference.annotation ? nil : annotation,
            note: note == reference.note ? nil : note)
        guard patch.contributors != nil || patch.fields != nil || patch.annotation != nil || patch.note != nil else { return }
        model.sidebar.updateReference(reference.id, patch)
    }
}

/* ---------------- rows ---------------- */

private struct FieldRow: View {
    let label: String
    let placeholder: String
    let multiline: Bool
    let missing: Bool
    @Binding var text: String
    let trailing: AnyView?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(label).font(.caption).foregroundStyle(missing ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                if missing { Image(systemName: "exclamationmark.circle.fill").font(.caption2).foregroundStyle(.orange) }
                Spacer()
                if let trailing { trailing }
            }
            TextField(placeholder, text: $text, axis: multiline ? .vertical : .horizontal)
                .lineLimit(multiline ? 2...8 : 1...3)
                .textFieldStyle(.roundedBorder)
        }
    }
}

private struct ContributorRow: View {
    @Binding var contributor: Contributor
    let roles: [String]
    let labels: [String: String]
    let onChange: () -> Void
    let onRemove: () -> Void
    let onMoveUp: (() -> Void)?

    var body: some View {
        HStack(spacing: 4) {
            Menu {
                ForEach(allRoles, id: \.self) { role in
                    Button(labels[role] ?? role.capitalized) { set(role: role) }
                }
                Divider()
                Button(contributor.isOrganization ? "A Person" : "An Organization") { toggleOrganization() }
                if let onMoveUp { Button("Move Up", action: onMoveUp) }
                Button("Remove", role: .destructive, action: onRemove)
            } label: {
                Text(labels[contributor.role] ?? contributor.role.capitalized)
                    .font(.caption)
                    .frame(width: 64, alignment: .leading)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            if contributor.isOrganization {
                TextField("Organization", text: part(\.literal))
            } else {
                TextField("Given", text: part(\.given))
                TextField("Family", text: part(\.family))
            }
        }
        .textFieldStyle(.roundedBorder)
    }

    private var allRoles: [String] { roles.contains(contributor.role) ? roles : [contributor.role] + roles }

    private func part(_ key: KeyPath<Contributor, String?>) -> Binding<String> {
        Binding(
            get: { contributor[keyPath: key] ?? "" },
            set: { value in
                contributor = Contributor(
                    role: contributor.role,
                    family: key == \Contributor.family ? value : contributor.family,
                    given: key == \Contributor.given ? value : contributor.given,
                    literal: key == \Contributor.literal ? value : contributor.literal)
                onChange()
            })
    }

    private func set(role: String) {
        contributor = Contributor(role: role, family: contributor.family, given: contributor.given, literal: contributor.literal)
        onChange()
    }

    private func toggleOrganization() {
        contributor = contributor.isOrganization
            ? Contributor(role: contributor.role, family: contributor.literal ?? "", given: "", literal: nil)
            : Contributor(role: contributor.role, family: nil, given: nil, literal: contributor.displayName)
        onChange()
    }
}
