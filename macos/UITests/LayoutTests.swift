import XCTest

@MainActor final class LayoutTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    /// P02-I01: the three areas and the composer fit at both reference window sizes, with nothing clipped or hidden.
    private func assertLayout(size: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let app = try Fixture.launch(size: size)
        app.openTask()
        let window = app.windows.firstMatch
        XCTAssertTrue(app.element("composer").waitForExistence(timeout: 20), file: file, line: line)
        for id in ["composer", "send-message", "model-picker", "task-inspector", "nav-integrations", "nav-models", "battery-average"] {
            let item = app.element(id)
            XCTAssertTrue(item.waitForExistence(timeout: 10), "\(id) assente a \(size)", file: file, line: line)
            XCTAssertTrue(window.frame.contains(item.frame), "\(id) esce dalla finestra a \(size): \(item.frame) fuori da \(window.frame)", file: file, line: line)
        }
        app.terminate()
    }
    func testP02_I01_layoutAt1280x800() throws { try assertLayout(size: "1280x800") }
    func testP02_I01_layoutAt1568x984() throws { try assertLayout(size: "1568x984") }

    /// P02-I02: provider, model and task are reachable from the sidebar in the documented order.
    func testP02_I02_sidebarReachesTasksIntegrationsAndModels() throws {
        let app = try Fixture.launch()
        XCTAssertTrue(app.staticTexts["Archivio locale pronto"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.element("project-row:Progetto demo").waitForExistence(timeout: 20))
        XCTAssertTrue(app.element("task-row:Contratto API").exists)
        XCTAssertTrue(app.element("task-row:Lavoro vuoto").exists)
        app.element("nav-integrations").click()
        XCTAssertTrue(app.staticTexts["Integrazioni"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("add-profile").exists)
        app.element("nav-models").click()
        XCTAssertTrue(app.staticTexts["I tuoi modelli"].waitForExistence(timeout: 10))
        app.openTask()
        XCTAssertTrue(app.element("composer").waitForExistence(timeout: 10))
        app.terminate()
    }

    /// P02-I03: model, mode and effort are separate controls; modes and efforts come from the profile that is selected.
    func testP02_I03_modelModeAndEffortFollowTheSelectedProfile() throws {
        let app = try Fixture.launch()
        app.openTask()
        let model = app.element("model-picker")
        XCTAssertTrue(model.waitForExistence(timeout: 20))
        XCTAssertFalse(app.element("effort-picker").exists, "il profilo Claude non offre effort")
        model.click()
        app.menuItems["Codex · gpt-6.1-sol"].click()
        XCTAssertTrue(app.element("mode-picker").waitForExistence(timeout: 10), "Codex offre Pianifica e Agisci")
        XCTAssertTrue(app.element("effort-picker").waitForExistence(timeout: 10), "Codex offre effort")
        app.terminate()
    }

    /// P02-I05: a task with history shows each run separately; a new task shows only its objective and an empty composer flow.
    func testP02_I05_runsAreSeparatedAndAnEmptyTaskStartsClean() throws {
        let app = try Fixture.launch()
        app.openTask()
        XCTAssertTrue(app.element("run-separator").waitForExistence(timeout: 20), "separatore tra le esecuzioni")
        XCTAssertTrue(app.element("message-user").exists)
        XCTAssertTrue(app.element("message-error").waitForExistence(timeout: 10), "la run con accesso scaduto mostra l’errore")
        app.openTask("Lavoro vuoto")
        XCTAssertTrue(app.staticTexts["Ancora da iniziare"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.element("run-separator").exists)
        app.terminate()
    }
}
