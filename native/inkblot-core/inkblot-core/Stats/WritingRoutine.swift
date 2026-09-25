import Foundation

/// A sequence of writing and break segments the writing timer runs through — a
/// Pomodoro, a ladder, a single sprint.
///
/// The built-in routines are fixed; a writer who wants one changed duplicates it. The
/// writer's own are kept in `StatsConfig.routines`.
struct WritingRoutine: Codable, Equatable, Hashable, Identifiable {
    var id: UUID
    var name: String
    var segments: [TimerSegment]
    /// How many times to run the segments. `0` is until stopped.
    var repeats: Int = 1
    /// Go straight on to the next segment when one ends, or wait for the writer to say.
    var autoAdvance = true
    /// Time in a break is not time at the document, so open time stops during one.
    /// Edits still count: a writer who types through a break wrote those words.
    var pauseTrackingOnBreaks = true

    var isBuiltIn: Bool { Self.builtIns.contains { $0.id == id } }

    /// Total planned time, when every segment has one and the routine ends.
    var plannedDuration: TimeInterval? {
        guard repeats > 0 else { return nil }
        var total: TimeInterval = 0
        for segment in segments {
            guard let duration = segment.duration else { return nil }
            total += duration
        }
        return total * Double(repeats)
    }

    /// "25 · 5 · 25 · 5 …", for a menu or a list.
    var summary: String {
        let parts = segments.map { segment -> String in
            if let minutes = segment.minutes { return "\(minutes)" }
            if let goal = segment.wordGoal { return "\(goal.formatted())w" }
            return "∞"
        }
        let joined = parts.joined(separator: " · ")
        switch repeats {
        case 0: return "\(joined), repeating"
        case 1: return joined
        default: return "\(joined) ×\(repeats)"
        }
    }

    /// A copy the writer can edit.
    func duplicate(named name: String? = nil) -> WritingRoutine {
        var copy = self
        copy.id = UUID()
        copy.name = name ?? "\(self.name) Copy"
        copy.segments = segments.map { segment in
            var fresh = segment
            fresh.id = UUID()
            return fresh
        }
        return copy
    }
}

struct TimerSegment: Codable, Equatable, Hashable, Identifiable {
    enum Kind: String, Codable, CaseIterable, Identifiable {
        case write, rest
        var id: String { rawValue }
        var title: String { self == .write ? "Write" : "Break" }
        var symbol: String { self == .write ? "pencil" : "cup.and.saucer" }
    }

    var id = UUID()
    var kind: Kind
    /// `nil`: the segment has no clock — it runs to its word goal, or until the writer
    /// moves on.
    var minutes: Int?
    /// Words to write in the segment. With no clock it is when the segment ends; with
    /// one it is a target to show against.
    var wordGoal: Int?
    var label = ""
    /// Played when the segment begins.
    var sound: TimerSound = .glass

    var title: String { label.isEmpty ? kind.title : label }
    var duration: TimeInterval? { minutes.map { TimeInterval($0) * 60 } }

    static func write(_ minutes: Int?, goal: Int? = nil, label: String = "") -> TimerSegment {
        TimerSegment(kind: .write, minutes: minutes, wordGoal: goal, label: label, sound: .glass)
    }

    static func rest(_ minutes: Int, label: String = "") -> TimerSegment {
        TimerSegment(kind: .rest, minutes: minutes, label: label, sound: .purr)
    }
}

/// The system sounds a segment can begin with.
enum TimerSound: String, Codable, CaseIterable, Identifiable {
    case none, glass, ping, hero, submarine, purr, tink, blow, bottle, funk, pop
    var id: String { rawValue }
    var title: String { self == .none ? "None" : rawValue.capitalized }
    /// The name `NSSound(named:)` knows it by.
    var soundName: String? { self == .none ? nil : rawValue.capitalized }
}

extension WritingRoutine {
    /// Fixed ids, so a routine chosen last time is found again after a relaunch.
    private static func builtIn(_ id: String, _ name: String, _ segments: [TimerSegment], repeats: Int = 1) -> WritingRoutine {
        WritingRoutine(id: UUID(uuidString: id)!, name: name, segments: segments.enumerated().map { index, segment in
            // Stable segment ids too: a view keyed on them does not churn.
            // Its own namespace, tagged with the routine's last byte and the segment's
            // place, so no two built-in segments share one.
            var fixed = segment
            fixed.id = UUID(uuidString: "5C0F1E6B-7A0D-4B8E-8A11-00000000" + id.suffix(2) + String(format: "%02X", index))!
            return fixed
        }, repeats: repeats)
    }

    static let sprint = builtIn("5C0F1E6B-7A0D-4B8E-9E57-2A1C3D4E5F00", "Sprint", [.write(25)])

    static let pomodoro = builtIn("5C0F1E6B-7A0D-4B8E-9E57-2A1C3D4E5F10", "Pomodoro", [
        .write(25), .rest(5), .write(25), .rest(5), .write(25), .rest(5), .write(25), .rest(15, label: "Long Break"),
    ])

    /// Long to short: an hour, half, twenty, and done.
    static let ladder = builtIn("5C0F1E6B-7A0D-4B8E-9E57-2A1C3D4E5F20", "Ladder", [
        .write(60), .rest(10), .write(30), .rest(10), .write(20),
    ])

    static let wordSprint = builtIn("5C0F1E6B-7A0D-4B8E-9E57-2A1C3D4E5F30", "500 Words", [.write(nil, goal: 500)])

    static let stopwatch = builtIn("5C0F1E6B-7A0D-4B8E-9E57-2A1C3D4E5F40", "Stopwatch", [.write(nil)])

    static let builtIns: [WritingRoutine] = [sprint, pomodoro, ladder, wordSprint, stopwatch]
}
