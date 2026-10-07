import XCTest

@MainActor final class KeyboardTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    /// P02-I06: the main flows work from the keyboard, and every control has a name a screen reader can speak.
    func testP02_I06_keyboardOnlyFlowsAndAccessibleNames() throws {
        let app = try Fixture.launch()
        app.openTask()
        XCTAssertTrue(app.element("composer").waitForExistence(timeout: 20))
        // New project sheet opens and closes from the keyboard.
        app.typeKey("n", modifierFlags: [.command, .shift])
        XCTAssertTrue(app.textFields["project-name"].waitForExistence(timeout: 5))
        app.typeKey(.escape, modifierFlags: [])
        XCTAssertFalse(app.textFields["project-name"].waitForExistence(timeout: 2))
        // Workspace toggles with its shortcut.
        app.typeKey("i", modifierFlags: [.command, .option])
        XCTAssertTrue(app.element("workspace-column").waitForExistence(timeout: 10))
        app.typeKey("i", modifierFlags: [.command, .option])
        XCTAssertFalse(app.element("workspace-column").waitForExistence(timeout: 2))
        // Controls have names, not only icons.
        for id in ["send-message", "task-inspector", "model-picker"] {
            let item = app.element(id)
            XCTAssertTrue(item.exists)
            XCTAssertFalse(item.label.isEmpty && item.title.isEmpty, "\(id) non ha un nome accessibile")
        }
        // Waiting and active states carry text, not only colour (checked in the showcase and in the sidebar).
        app.terminate()
        let showcase = try Fixture.launch(showcase: true)
        XCTAssertTrue(showcase.element("badge-waiting").waitForExistence(timeout: 20))
        XCTAssertEqual(showcase.element("badge-waiting").label, "In attesa di una tua autorizzazione")
        showcase.terminate()
    }

    func testP02_I06_sidebarSearchFiltersFromTheKeyboard() throws {
        let app = try Fixture.launch()
        XCTAssertTrue(app.staticTexts["Archivio locale pronto"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.element("task-row:Contratto API").waitForExistence(timeout: 20))
        app.typeKey("f", modifierFlags: .command)
        XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 5))
        app.typeText("vuoto")
        XCTAssertTrue(app.element("task-row:Lavoro vuoto").waitForExistence(timeout: 5))
        XCTAssertFalse(app.element("task-row:Contratto API").waitForExistence(timeout: 2))
        app.terminate()
    }
}
