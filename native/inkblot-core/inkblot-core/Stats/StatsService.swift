import Foundation
import os

/// The core's stats store, as the shell calls it.
///
/// Structured values cross as JSON of the typeshare types (see `inkblot-ffi`), decoded
/// here so nothing else sees a string. The reads are `async` and run off the main
/// actor — a project's word counts open every document in it; `InkblotCore` is
/// `Sendable` and locks its own files. A record is a line appended to a file, so it is
/// made in place: the one made at quit has to finish before the app does.
struct StatsService {
    let core: InkblotCore

    private static let log = Logger(subsystem: "com.inkblot.app", category: "stats")

    /* ---------------- sessions ---------------- */

    func record(_ session: WritingSession) {
        do {
            let json = try String(decoding: JSONEncoder().encode(session), as: UTF8.self)
            try core.statsRecordSession(sessionJson: json)
        } catch {
            Self.log.error("A session was not recorded: \(error.localizedDescription, privacy: .public)")
        }
    }

    func daily(_ scope: StatsScope, from: String, to: String) async -> [DayStat] {
        let (core, project, doc) = (core, scope.project, scope.docPath)
        return await decode([DayStat].self, default: []) {
            try core.statsDailyJson(project: project, docPath: doc, fromDay: from, toDay: to)
        }
    }

    func totals(_ scope: StatsScope) async -> StatsTotals {
        let (core, project, doc) = (core, scope.project, scope.docPath)
        return await decode(StatsTotals.self, default: StatsTotals.empty) {
            try core.statsTotalsJson(project: project, docPath: doc)
        }
    }

    func sessions(_ scope: StatsScope, from: String? = nil, to: String? = nil) async -> [WritingSession] {
        let (core, project, doc) = (core, scope.project, scope.docPath)
        return await decode([WritingSession].self, default: []) {
            try core.statsSessionsJson(project: project, docPath: doc, fromDay: from, toDay: to)
        }
    }

    /// Every document's saved length, by tree path.
    func projectWordCounts(_ project: String) async -> [String: DocWordCount] {
        let core = core
        let counts = await decode([DocWordCount].self, default: []) {
            try core.projectWordCountsJson(projectName: project)
        }
        return Dictionary(counts.map { ($0.docPath, $0) }, uniquingKeysWith: { $1 })
    }

    /* ---------------- timer runs ---------------- */

    func record(_ run: TimerRun) {
        do {
            let json = try String(decoding: JSONEncoder().encode(run), as: UTF8.self)
            try core.statsRecordTimerRun(runJson: json)
        } catch {
            Self.log.error("A timer run was not recorded: \(error.localizedDescription, privacy: .public)")
        }
    }

    func timerRuns(project: String?, from: String? = nil, to: String? = nil) async -> [TimerRun] {
        let core = core
        return await decode([TimerRun].self, default: []) {
            try core.statsTimerRunsJson(project: project, fromDay: from, toDay: to)
        }
    }

    /* ---------------- identity ---------------- */

    /// The history follows an entry the shell is asking the page to rename, to the
    /// path the page will give it.
    func renameEntry(project: String, path: String, newName: String, isFolder: Bool) {
        try? core.statsRenameEntry(project: project, path: path, newName: newName, isFolder: isFolder)
    }

    func moveEntry(project: String, path: String, into folder: String, isFolder: Bool) {
        try? core.statsMoveEntry(project: project, path: path, targetFolder: folder, isFolder: isFolder)
    }

    func reset(_ scope: StatsScope) {
        try? core.statsReset(project: scope.project, docPath: scope.docPath)
    }

    /* ---------------- config ---------------- */

    func loadConfig() -> StatsConfig {
        guard let json = core.statsConfig(),
              let config = try? JSONDecoder().decode(StatsConfig.self, from: Data(json.utf8))
        else { return StatsConfig() }
        return config
    }

    func save(_ config: StatsConfig) {
        guard let data = try? JSONEncoder().encode(config) else { return }
        try? core.statsSetConfig(json: String(decoding: data, as: UTF8.self))
    }

    /* ---------------- decoding ---------------- */

    /// The call runs off the main actor; the decoding does not, because the generated
    /// types are the main actor's, like everything else in this module.
    private func decode<T: Decodable>(
        _ type: T.Type, default fallback: T, _ call: @Sendable @escaping () throws -> String
    ) async -> T {
        let json = await Task.detached(priority: .userInitiated) { () -> Result<String, Error> in
            Result { try call() }
        }.value
        do {
            return try JSONDecoder().decode(T.self, from: Data(json.get().utf8))
        } catch {
            Self.log.error("A stats read failed: \(error.localizedDescription, privacy: .public)")
            return fallback
        }
    }
}

extension StatsTotals {
    static let empty = StatsTotals(
        sessions: 0, openSecs: 0, activeSecs: 0, wordsAdded: 0, wordsDeleted: 0, wordsPasted: 0,
        longestSessionSecs: 0, daysWritten: 0, firstSession: nil, lastSession: nil)
}

/// A local calendar day as the store keys it: `YYYY-MM-DD`.
enum StatsDay {
    static func key(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    static func date(_ key: String, calendar: Calendar = .current) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}
