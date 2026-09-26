#if os(macOS)
import AppKit
#endif
import Foundation
import UserNotifications

/// Everything the writing stats say out loud: the timer's segments, a goal met, and
/// the reminders to write.
///
/// **The timer** is heard as the segment's sound and a notification — so the end of a
/// break reaches a writer who is in another app.
///
/// **Reminders** are scheduled ahead with the notification center, because they have
/// to fire when Inkblot is not running. `schedule` takes the whole set
/// `ReminderPlanner` wants pending and replaces what is there, only when it differs.
///
/// Notifications are silent; the sound is played here, because the system sounds a
/// writer picks from are not ones a notification may name. Permission is asked the
/// first time a timer starts with notifications on, not at launch: a writer who never
/// uses the timer is never asked.
///
/// A notification for a routine that waits between segments carries a Start action;
/// clicking any of them brings Inkblot forward on the Stats tab.
@MainActor
final class TimerAnnouncer: NSObject, UNUserNotificationCenterDelegate {
    static let categoryWaiting = "inkblot.timer.waiting"
    static let categoryReminder = "inkblot.reminder"
    static let actionProceed = "inkblot.timer.proceed"
    static let actionStartSprint = "inkblot.reminder.sprint"
    private static let requestID = "inkblot.timer"
    private static let celebrationID = "inkblot.goal"

    /// The writer chose Start on a waiting notification.
    var onProceed: () -> Void = {}
    /// The writer chose Start Sprint on a reminder.
    var onStartSprint: () -> Void = {}
    /// What was last handed to the notification center, so an unchanged plan is not
    /// handed over again every half minute.
    private var scheduled: [PlannedReminder]?
    /// The writer clicked a notification.
    var onOpen: () -> Void = {}

    private var center: UNUserNotificationCenter? {
        // A test host has no bundle to post from, and asking crashes.
        Bundle.main.bundleIdentifier == nil ? nil : .current()
    }

    func install() {
        guard let center else { return }
        center.delegate = self
        let proceed = UNNotificationAction(identifier: Self.actionProceed, title: "Start", options: [.foreground])
        let sprint = UNNotificationAction(identifier: Self.actionStartSprint, title: "Start Sprint", options: [.foreground])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.categoryWaiting, actions: [proceed], intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.categoryReminder, actions: [sprint], intentIdentifiers: []),
        ])
    }

    func requestPermission() {
        center?.requestAuthorization(options: [.alert]) { _, _ in }
    }

    func announce(_ announcement: WritingTimer.Announcement, notify: Bool, sound: Bool) {
        #if os(macOS)
        if sound, let name = announcement.sound.soundName {
            NSSound(named: NSSound.Name(name))?.play()
        }
        #endif
        guard notify, let center else { return }
        let content = UNMutableNotificationContent()
        content.title = announcement.title
        content.body = announcement.body
        if announcement.kind == .waiting { content.categoryIdentifier = Self.categoryWaiting }
        // One at a time: the next segment's replaces the last one's.
        center.removeDeliveredNotifications(withIdentifiers: [Self.requestID])
        center.add(UNNotificationRequest(identifier: Self.requestID, content: content, trigger: nil))
    }

    /// Today's goal is met.
    func celebrate(goal: DayGoal, streak: Int, sound: Bool) {
        #if os(macOS)
        if sound { NSSound(named: NSSound.Name("Hero"))?.play() }
        #endif
        guard let center else { return }
        let content = UNMutableNotificationContent()
        content.title = "Today’s goal is met"
        content.body = streak > 1 ? "\(goal.summary). That’s \(streak) days in a row." : "\(goal.summary). Well written."
        center.add(UNNotificationRequest(identifier: Self.celebrationID, content: content, trigger: nil))
    }

    /// Make the pending reminders exactly `planned`.
    func schedule(_ planned: [PlannedReminder]) {
        guard planned != scheduled, let center else { return }
        scheduled = planned
        if !planned.isEmpty { requestPermission() }
        let requests = planned.map { reminder in
            let content = UNMutableNotificationContent()
            content.title = reminder.title
            content.body = reminder.body
            content.categoryIdentifier = Self.categoryReminder
            let trigger = UNCalendarNotificationTrigger(dateMatching: reminder.components, repeats: reminder.repeats)
            return UNNotificationRequest(identifier: reminder.id, content: content, trigger: trigger)
        }
        Task {
            let stale = await center.pendingNotificationRequests()
                .map(\.identifier)
                .filter { $0.hasPrefix(ReminderPlanner.prefix) }
            center.removePendingNotificationRequests(withIdentifiers: stale)
            for request in requests { try? await center.add(request) }
        }
    }

    /* ---------------- UNUserNotificationCenterDelegate ---------------- */

    /// Shown in front of Inkblot too: a writer mid-sentence still wants to know the
    /// break has begun.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
    ) async {
        let action = response.actionIdentifier
        await MainActor.run {
            if action == Self.actionProceed { onProceed() }
            if action == Self.actionStartSprint { onStartSprint() }
            onOpen()
        }
    }
}
