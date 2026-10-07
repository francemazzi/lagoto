import XCTest

/// P12-I03: switching between tasks of a large archive (50 projects, 1,000 tasks, 100,000 events). The app measures the time from
/// selection to the first complete snapshot of the task (inference excluded); this test drives the selection from the keyboard and records the samples.
@MainActor final class PerformanceTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testP12_I03_taskSwitchP95OnTheLargeFixture() throws {
        guard let load = ProcessInfo.processInfo.environment["LAGOTO_UI_LOAD_FIXTURE"], FileManager.default.fileExists(atPath: load + "/lagoto.sqlite") else {
            XCTFail("Archivio di carico assente: pnpm test:ui lo genera con pnpm seed:ui --load"); return
        }
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("LagotoLoad-\(UUID().uuidString)")
        try FileManager.default.copyItem(atPath: load, toPath: copy.path)
        executionTimeAllowance = 540
        let app = try Fixture.launch(data: copy.path)
        defer { app.terminate() }
        XCTAssertTrue(app.staticTexts["Archivio locale pronto"].waitForExistence(timeout: 90))
        let sidebar = app.outlines["Sidebar"]
        XCTAssertTrue(sidebar.waitForExistence(timeout: 30))
        // Start on the first task row and walk down the sidebar; every task row selected is one switch.
        let first = app.element("task-row:Contratto API")
        XCTAssertTrue(first.waitForExistence(timeout: 60)); first.click()
        var samples: [Int] = []
        var last = ""
        let timing = app.element("transcript")
        XCTAssertTrue(timing.waitForExistence(timeout: 30), "la trascrizione non è comparsa")
        for _ in 0..<70 where samples.count < 40 {
            app.typeKey(.downArrow, modifierFlags: [])
            guard timing.exists else { continue }
            let value = (timing.value as? String).flatMap { $0.isEmpty ? nil : $0 } ?? timing.label
            if value != last || samples.isEmpty { samples.append(Int(value) ?? -1); last = value }
            if samples.count > 0 && samples.last! < 0 { samples.removeLast() }
        }
        XCTAssertGreaterThanOrEqual(samples.count, 15, "troppo pochi cambi di lavoro misurati")
        let warm = Array(samples.dropFirst(5)).sorted()
        let p95 = warm[min(warm.count - 1, Int((Double(warm.count) * 0.95).rounded(.up)) - 1)]
        let limit = Int(ProcessInfo.processInfo.environment["LAGOTO_PERF_LIMIT_MS"] ?? "300") ?? 300
        if let out = ProcessInfo.processInfo.environment["LAGOTO_PERF_OUT"] {
            let report: [String: Any] = ["samples": warm, "p95Ms": p95, "maximumMs": warm.last ?? 0, "count": warm.count, "limitMs": limit]
            try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]).write(to: URL(fileURLWithPath: out))
        }
        XCTAssertLessThan(p95, limit, "p95 del cambio task \(p95) ms su \(warm.count) cambi")
    }
}
