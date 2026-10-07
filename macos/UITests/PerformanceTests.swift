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
        // Click the visible task rows one after the other; the app publishes "<task id>|<milliseconds>" on the transcript of the task it just opened.
        let first = app.element("task-row:Contratto API")
        XCTAssertTrue(first.waitForExistence(timeout: 60)); first.click()
        // Rows that are not tasks (a project page, integrations) have no transcript: reading it then must not fail the test.
        func published() -> String { let element = app.element("transcript"); return element.exists ? ((element.value as? String) ?? "") : "" }
        var samples: [Int] = []
        var lastTask = published().split(separator: "|").first.map(String.init) ?? ""
        let started = Date()
        // The sidebar has the keyboard focus after the click: every Down arrow selects the next row, and every task row opened is one switch.
        let probe = app.element("task-row:Contratto API"); probe.click()
        Thread.sleep(forTimeInterval: 3)
        XCTAssertTrue(published().contains("|"), "valore esposto dalla trascrizione: «\(published())»")
        for _ in 0..<120 where samples.count < 45 && Date().timeIntervalSince(started) < 300 {
            app.typeKey(.downArrow, modifierFlags: [])
            let deadline = Date().addingTimeInterval(1.5)
            while Date() < deadline {
                let parts = published().split(separator: "|")
                if parts.count == 2, String(parts[0]) != lastTask, let ms = Int(parts[1]) { lastTask = String(parts[0]); samples.append(ms); break }
                Thread.sleep(forTimeInterval: 0.05)
            }
        }
        XCTAssertGreaterThanOrEqual(samples.count, 10, "troppo pochi cambi di lavoro misurati: \(samples)")
        let warm = Array(samples.dropFirst(3)).sorted()
        let p95 = warm[min(warm.count - 1, Int((Double(warm.count) * 0.95).rounded(.up)) - 1)]
        let limit = Int(ProcessInfo.processInfo.environment["LAGOTO_PERF_LIMIT_MS"] ?? "300") ?? 300
        // The test runner cannot write into the checkout: the report travels as an attachment of the result bundle.
        let report: [String: Any] = ["samples": warm, "p95Ms": p95, "maximumMs": warm.last ?? 0, "count": warm.count, "limitMs": limit]
        let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), uniformTypeIdentifier: "public.json")
        attachment.name = "ui-perf.json"; attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertLessThan(p95, limit, "p95 del cambio task \(p95) ms su \(warm.count) cambi")
    }
}
