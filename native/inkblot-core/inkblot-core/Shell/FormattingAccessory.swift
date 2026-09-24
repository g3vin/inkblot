#if !os(macOS)
import SwiftUI
import UIKit

/// The formatting bar that rides above the software keyboard on iPadOS and iOS.
///
/// What the Mac's Format menu is, for a device with no menu bar and an on-screen
/// keyboard: marks and alignment, lit from `toolbarState` and applied by the same
/// commands (`AppModel.toggle`, `.align`). It shows only while the keyboard does — a
/// hardware keyboard raises none, and then the page's own toolbar and ⌘B are right
/// there. It is not WebKit's input accessory: that belongs to a private view inside
/// `WKWebView`, and setting it means swizzling a class Apple can rename in any release.
struct FormattingAccessory: View {
    @Environment(AppModel.self) private var model
    @State private var keyboardUp = false

    var body: some View {
        Group {
            if keyboardUp, model.target != nil {
                bar.transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.25), value: keyboardUp)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { note in
            // A hardware keyboard reports a sliver of an on-screen one; ignore it.
            let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect ?? .zero
            keyboardUp = frame.height > 120
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardUp = false
        }
    }

    private var bar: some View {
        let marks = model.bridge.toolbar?.activeMarks
        let alignment = model.bridge.toolbar?.alignment
        return HStack(spacing: 2) {
            mark("bold", .bold, marks?.bold)
            mark("italic", .italic, marks?.italic)
            mark("underline", .underline, marks?.underline)
            mark("strikethrough", .strike, marks?.strike)
            Divider().frame(height: 22).padding(.horizontal, 6)
            align("text.alignleft", .left, alignment)
            align("text.aligncenter", .center, alignment)
            align("text.alignright", .right, alignment)
            Spacer(minLength: 8)
            Button {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            } label: {
                Image(systemName: "keyboard.chevron.compact.down")
            }
            .accessibilityLabel("Hide Keyboard")
        }
        .buttonStyle(.plain)
        .font(.system(size: 17))
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .glassEffect(.regular, in: .capsule)
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
    }

    private func mark(_ symbol: String, _ kind: MarkKind, _ isOn: Bool?) -> some View {
        Button { model.toggle(kind) } label: {
            Image(systemName: symbol)
                .frame(width: 36, height: 32)
                .background(RoundedRectangle(cornerRadius: 8).fill(isOn == true ? Color.accentColor.opacity(0.22) : .clear))
        }
        .accessibilityLabel(symbol.capitalized)
        .accessibilityAddTraits(isOn == true ? .isSelected : [])
    }

    private func align(_ symbol: String, _ value: Alignment, _ current: Alignment?) -> some View {
        Button { model.align(value) } label: {
            Image(systemName: symbol)
                .frame(width: 36, height: 32)
                .background(RoundedRectangle(cornerRadius: 8).fill(current == value ? Color.accentColor.opacity(0.22) : .clear))
        }
        .accessibilityAddTraits(current == value ? .isSelected : [])
    }
}
#endif
