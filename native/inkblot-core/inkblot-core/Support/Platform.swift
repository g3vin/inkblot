import SwiftUI

#if os(macOS)
import AppKit
typealias PlatformWindow = NSWindow
typealias PlatformImage = NSImage
#else
import UIKit
typealias PlatformWindow = UIWindow
typealias PlatformImage = UIImage
#endif

/// The few things the shell asks of the OS that AppKit and UIKit spell differently.
///
/// The same SwiftUI shell runs on macOS, iPadOS and iOS. Where a platform has
/// no equivalent at all (a menu bar, revealing a file in Finder, a window's titlebar),
/// the caller is `#if os(macOS)` instead of going through here — this is only for the
/// calls that mean the same thing everywhere.
@MainActor
enum Platform {
    static func copy(_ text: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
    }

    static var pastedText: String? {
        #if os(macOS)
        NSPasteboard.general.string(forType: .string)
        #else
        UIPasteboard.general.string
        #endif
    }

    /// The "that did nothing" signal.
    static func beep() {
        #if os(macOS)
        NSSound.beep()
        #else
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
        #endif
    }

    static func open(_ url: URL) {
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        #endif
    }

    /// The trackpad's tick on a Mac, the Taptic Engine's on a phone or tablet.
    static func haptic(_ pattern: String?) {
        #if os(macOS)
        let feedback: NSHapticFeedbackManager.FeedbackPattern = switch pattern {
        case "alignment": .alignment
        case "levelChange", "level_change", "level": .levelChange
        default: .generic
        }
        NSHapticFeedbackManager.defaultPerformer.perform(feedback, performanceTime: .now)
        #else
        switch pattern {
        case "alignment": UISelectionFeedbackGenerator().selectionChanged()
        case "levelChange", "level_change", "level": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
        #endif
    }
}

extension PlatformImage {
    /// A `data:` URI's image. Note images and images pasted into a document are stored
    /// as base64 data URIs inside the document's JSON; canvas images and voice memos are
    /// files in the project's `.assets/`, addressed by content hash.
    static func fromDataURI(_ uri: String) -> PlatformImage? {
        guard let comma = uri.firstIndex(of: ","), uri.hasPrefix("data:") else { return nil }
        guard let data = Data(base64Encoded: String(uri[uri.index(after: comma)...])) else { return nil }
        return PlatformImage(data: data)
    }
}

extension Image {
    init(platformImage: PlatformImage) {
        #if os(macOS)
        self.init(nsImage: platformImage)
        #else
        self.init(uiImage: platformImage)
        #endif
    }
}

extension View {
    /// Escape closes it: `onExitCommand` on a Mac, which iOS lacks — there, the key
    /// press itself, from a hardware keyboard.
    func onEscape(_ action: @escaping () -> Void) -> some View {
        #if os(macOS)
        onExitCommand(perform: action)
        #else
        onKeyPress(.escape) {
            action()
            return .handled
        }
        #endif
    }
}
