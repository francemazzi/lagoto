import XCTest
@testable import Lagoto

@MainActor private final class Counter { var value = 0 }

@MainActor final class EventStoreTests: XCTestCase {
    private func event(_ kind: String, task: String? = nil, payload: JSONValue = .null, ephemeral: Bool = false) -> JSONValue {
        var object: [String: JSONValue] = ["kind": .string(kind), "payload": payload]
        if let task { object["task_id"] = .string(task) }
        if ephemeral { object["ephemeral"] = .bool(true) }
        return .object(object)
    }
    /// Counts the signals a view would receive; `handlerDelay` simulates a view that is busy reloading.
    private func listen(_ stream: AsyncStream<Void>, _ counter: Counter, handlerDelay: Duration = .zero) -> Task<Void, Never> {
        Task { @MainActor in
            for await _ in stream { counter.value += 1; if handlerDelay > .zero { try? await Task.sleep(for: handlerDelay) } }
        }
    }
    private func settle(_ milliseconds: Int = 120) async { try? await Task.sleep(for: .milliseconds(milliseconds)) }

    func testP02_I08_taskEventsReachOnlyTheirTaskAndRawFramesAreIgnored() async {
        let store = EventStore()
        let mine = Counter(), other = Counter()
        let a = listen(store.updates(.task("a")), mine), b = listen(store.updates(.task("b")), other)
        await settle(20)
        store.ingest(event("text", task: "a"))
        store.ingest(event("raw", task: "b"))
        store.ingest(event("raw", task: "a"))
        await settle()
        XCTAssertEqual(mine.value, 1)
        XCTAssertEqual(other.value, 0, "events of another task and raw provider frames must not wake the view")
        a.cancel(); b.cancel()
    }

    func testP02_I08_burstsAreCoalescedWhileTheViewIsBusy() async {
        let store = EventStore()
        let counter = Counter()
        let task = listen(store.updates(.task("a")), counter, handlerDelay: .milliseconds(300))
        await settle(20)
        for _ in 0..<50 { store.ingest(event("text", task: "a")) }
        await settle(700)
        XCTAssertEqual(counter.value, 2, "fifty events while the view reloads collapse into the first signal plus one pending reload")
        task.cancel()
    }

    func testP02_I08_signalsForBudgetProfilesAndAttention() async {
        let store = EventStore()
        let budget = Counter(), profiles = Counter(), tasks = Counter()
        let listeners = [listen(store.updates(.budget), budget), listen(store.updates(.profiles), profiles), listen(store.updates(.tasks), tasks)]
        var delivered: [(String, String)] = []
        store.deliver = { delivered.append(($0, $1)) }
        store.taskTitles = ["a": "Contratto API"]
        await settle(20)
        store.ingest(event("budget_changed", ephemeral: true))
        store.ingest(.object(["kind": .string("profile_check"), "profileId": .string("p")]))
        store.ingest(event("attention_changed", payload: .object(["taskId": .string("a"), "waiting": .bool(true)]), ephemeral: true))
        store.ingest(event("run_state", task: "a", payload: .object(["state": .string("finished")])))
        await settle()
        XCTAssertEqual(budget.value, 1); XCTAssertEqual(profiles.value, 1); XCTAssertGreaterThanOrEqual(tasks.value, 1)
        XCTAssertEqual(delivered.map(\.0), ["Contratto API", "Contratto API"])
        XCTAssertEqual(delivered.map(\.1), ["attende la tua autorizzazione", "turno concluso"])
        XCTAssertEqual(store.turnEnds, 1)
        listeners.forEach { $0.cancel() }
    }

    func testP02_I08_aWaitingFlagThatClearsDoesNotNotify() {
        let store = EventStore()
        var delivered = 0
        store.deliver = { _, _ in delivered += 1 }
        store.ingest(event("attention_changed", payload: .object(["taskId": .string("a"), "waiting": .bool(false)]), ephemeral: true))
        store.ingest(event("run_state", task: "a", payload: .object(["state": .string("running")])))
        XCTAssertEqual(delivered, 0)
    }
}
