import XCTest

/// Launches the app on a private copy of the seeded archive (`pnpm seed:ui`), so tests never touch real data and never depend on each other.
@MainActor enum Fixture {
    static func archive() throws -> String {
        guard let source = ProcessInfo.processInfo.environment["LAGOTO_UI_FIXTURE"], FileManager.default.fileExists(atPath: source + "/lagoto.sqlite") else {
            throw NSError(domain: "Lagoto.UITests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Archivio di prova assente: esegui pnpm test:ui, che lo genera con pnpm seed:ui"])
        }
        let copy = FileManager.default.temporaryDirectory.appendingPathComponent("LagotoUI-\(UUID().uuidString)")
        try FileManager.default.copyItem(atPath: source, toPath: copy.path)
        return copy.path
    }
    @discardableResult static func launch(data: String? = nil, size: String? = "1280x800", arguments: [String] = [], showcase: Bool = false) throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["LAGOTO_DATA_DIR"] = try data ?? archive()
        // Window and workspace layout are reset on every launch unless a test says otherwise.
        var args = ["-workspace.tab", "files", "-workspace.width", "380"]
        if let size { args += ["-LagotoWindowSize", size] }
        if showcase { args += ["-LagotoShowcase", "YES"] }
        app.launchArguments = args + arguments
        app.launch()
        return app
    }
}

extension XCUIApplication {
    /// Any element with this accessibility identifier, whatever its role.
    func element(_ id: String) -> XCUIElement { descendants(matching: .any).matching(identifier: id).firstMatch }
    /// The transcript is lazy: a card far above the viewport does not exist until it is scrolled into view.
    func reveal(_ id: String, timeout: TimeInterval = 10) -> XCUIElement {
        let target = element(id)
        if target.waitForExistence(timeout: timeout) { return target }
        let transcript = scrollViews.firstMatch
        for _ in 0..<12 {
            transcript.scroll(byDeltaX: 0, deltaY: 800)
            if target.exists { return target }
        }
        for _ in 0..<24 {
            transcript.scroll(byDeltaX: 0, deltaY: -800)
            if target.exists { return target }
        }
        return target
    }
    func openTask(_ title: String = "Contratto API", file: StaticString = #filePath, line: UInt = #line) {
        let ready = staticTexts["Archivio locale pronto"]
        XCTAssertTrue(ready.waitForExistence(timeout: 30), "il runtime non è partito", file: file, line: line)
        let row = element("task-row:\(title)")
        XCTAssertTrue(row.waitForExistence(timeout: 20), "riga del lavoro \(title) assente", file: file, line: line)
        row.click()
    }
}
