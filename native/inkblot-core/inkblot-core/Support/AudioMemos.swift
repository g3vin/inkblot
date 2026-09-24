import AVFoundation
import CryptoKit
import Foundation
import Observation

/// Voice memos on notes, with AVFoundation instead of `MediaRecorder`.
///
/// A memo is stored the way `assets.js` stores one, so either shell can play what the
/// other recorded: content-addressed in the project's `.assets/`, named by the first
/// twenty hex digits of its SHA-256, and referenced from the note by that
/// project-relative path. The page records WebM/Opus; this records AAC in an `.m4a`,
/// which WebKit's `<audio>` plays as readily — the `mimeType` on the clip says which.
@MainActor
@Observable
final class AudioMemoRecorder {
    private(set) var recordingNoteId: String?
    private(set) var elapsed: TimeInterval = 0
    private(set) var error: String?

    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var fileURL: URL?

    func isRecording(_ noteId: String) -> Bool { recordingNoteId == noteId }

    func start(for noteId: String) async {
        guard recordingNoteId == nil else { return }
        error = nil
        guard await AVAudioApplication.requestRecordPermission() else {
            error = "Inkblot doesn’t have permission to use the microphone. Allow it in System Settings ▸ Privacy & Security ▸ Microphone."
            return
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("inkblot-memo-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        do {
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            guard recorder.record() else { throw CocoaError(.fileWriteUnknown) }
            self.recorder = recorder
            fileURL = url
            recordingNoteId = noteId
            elapsed = 0
            timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.elapsed = self?.recorder?.currentTime ?? 0 }
            }
        } catch {
            self.error = "Couldn’t start recording: \(error.localizedDescription)"
        }
    }

    /// Stop, store the memo in the project, and describe it for the note.
    func stop(projectRoot: String) -> AudioClip? {
        guard let recorder, let fileURL else { return nil }
        let duration = recorder.currentTime
        recorder.stop()
        reset()
        defer { try? FileManager.default.removeItem(at: fileURL) }

        do {
            let bytes = try Data(contentsOf: fileURL)
            let src = try Self.writeAsset(bytes, ext: "m4a", projectRoot: projectRoot)
            return AudioClip(
                id: UUID().uuidString.lowercased(),
                src: src,
                mimeType: "audio/mp4",
                durationMs: (duration * 1000).rounded(),
                createdAt: Self.isoNow())
        } catch {
            self.error = "Couldn’t save the recording: \(error.localizedDescription)"
            return nil
        }
    }

    /// Stop and throw it away.
    func cancel() {
        recorder?.stop()
        recorder?.deleteRecording()
        reset()
    }

    private func reset() {
        timer?.invalidate()
        timer = nil
        recorder = nil
        recordingNoteId = nil
        elapsed = 0
    }

    /// `assets.js`' `writeAsset`: `.assets/<sha256[0..20]>.<ext>`, written only if absent.
    static func writeAsset(_ bytes: Data, ext: String, projectRoot: String) throws -> String {
        let hash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined().prefix(20)
        let relative = ".assets/\(hash).\(ext)"
        let root = URL(fileURLWithPath: projectRoot)
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent(".assets"), withIntermediateDirectories: true)
        let absolute = root.appendingPathComponent(relative)
        if !FileManager.default.fileExists(atPath: absolute.path) {
            try bytes.write(to: absolute, options: .atomic)
        }
        return relative
    }

    static func isoNow() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: .now)
    }
}

/// Plays one memo at a time, as the page's `<audio>` elements effectively do.
@MainActor
@Observable
final class AudioMemoPlayer: NSObject, AVAudioPlayerDelegate {
    private(set) var playingClipId: String?
    @ObservationIgnored private var player: AVAudioPlayer?

    func toggle(_ clip: AudioClip, projectRoot: String) {
        if playingClipId == clip.id {
            stop()
            return
        }
        stop()
        let url = URL(fileURLWithPath: projectRoot).appendingPathComponent(clip.src)
        guard let player = try? AVAudioPlayer(contentsOf: url) else { return }
        player.delegate = self
        player.play()
        self.player = player
        playingClipId = clip.id
    }

    func stop() {
        player?.stop()
        player = nil
        playingClipId = nil
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.stop() }
    }
}

/// `formatDuration` from `audioNotes.js`: m:ss.
func formatMemoDuration(_ milliseconds: Double) -> String {
    let total = Int((milliseconds / 1000).rounded(.down))
    return "\(total / 60):\(String(format: "%02d", total % 60))"
}
