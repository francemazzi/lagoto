import AppKit
import Foundation
import Observation
@preconcurrency import UserNotifications

/// What a view wants to hear about. The runtime pushes every state change, so views reload on a signal instead of polling.
enum EventTopic: Hashable, Sendable {
    case task(String)   // anything that changes one task: messages, runs, checkpoints, verifications, queue
    case tasks          // task lists: a run started, finished or started waiting for the user
    case profiles       // a profile verification changed
    case budget         // allowances, renewals, overrides or a run reservation changed
    case queueReady(String) // a turn ended well and the next queued message of this task can be sent
}

/// Fans runtime events out to interested views. Updates are coalesced: a burst of events produces one pending signal,
/// so a streaming answer reloads the view at the pace of the view, not at the pace of the model.
@MainActor @Observable final class EventStore {
    @ObservationIgnored private var subscribers: [UUID: (topic: EventTopic, continuation: AsyncStream<Void>.Continuation)] = [:]
    @ObservationIgnored var taskTitles: [String: String] = [:]
    /// Set once per unique turn end so a view can react (for example to scroll); not used for polling.
    private(set) var turnEnds = 0
    private(set) var connectionRevision = 0
    /// The queued message the runtime offered for sending, per task. Consumed by the task view that starts the run.
    @ObservationIgnored private var readyQueue: [String: (queueID: String, profileID: String?)] = [:]
    func takeQueueReady(_ taskID: String) -> (queueID: String, profileID: String?)? { readyQueue.removeValue(forKey: taskID) }

    func updates(_ topic: EventTopic) -> AsyncStream<Void> {
        let id = UUID()
        return AsyncStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            subscribers[id] = (topic, continuation)
            continuation.onTermination = { [weak self] _ in Task { @MainActor [weak self] in self?.subscribers.removeValue(forKey: id) } }
        }
    }
    var subscriberCount: Int { subscribers.count }

    private func signal(_ topic: EventTopic) {
        for subscriber in subscribers.values where subscriber.topic == topic { subscriber.continuation.yield() }
    }

    func connectionChanged() { connectionRevision += 1; for subscriber in subscribers.values { subscriber.continuation.yield() } }

    func ingest(_ event: JSONValue) {
        let kind = event["kind"].string ?? ""
        let payload = event["payload"]
        if event["ephemeral"].bool == true {
            switch kind {
            case "budget_changed": signal(.budget)
            case "profiles_changed": signal(.profiles)
            case "queue_changed": if let id = payload["taskId"].string { signal(.task(id)) }
            case "queue_ready":
                if let id = payload["taskId"].string, let queueID = payload["queueId"].string {
                    readyQueue[id] = (queueID, payload["profileId"].string); signal(.queueReady(id))
                }
            case "attention_changed":
                if let id = payload["taskId"].string {
                    signal(.task(id)); signal(.tasks)
                    if payload["waiting"].bool == true { notify(taskID: id, body: "attende la tua autorizzazione") }
                }
            default: break
            }
            return
        }
        if kind == "profile_check" { signal(.profiles); return }
        guard let taskID = event["task_id"].string, kind != "raw" else { return }
        signal(.task(taskID))
        if kind == "run_state" {
            signal(.tasks)
            let state = payload["state"].string ?? ""
            if ["finished", "failed", "interrupted", "unknown"].contains(state) {
                turnEnds += 1
                notify(taskID: taskID, body: state == "finished" ? "turno concluso" : "esecuzione terminata, da verificare")
            }
        }
    }

    /// Delivery of end-of-turn and attention notifications; replaced in tests so no permission prompt appears.
    @ObservationIgnored var deliver: (_ title: String, _ body: String) -> Void = { title, body in
        guard !NSApplication.shared.isActive else { return }
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = title; content.body = body.prefix(1).uppercased() + body.dropFirst()
            center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
        }
    }

    private func notify(taskID: String, body: String) { deliver(taskTitles[taskID] ?? "Lavoro", body) }
}
