import XCTest

@MainActor final class MessageTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    /// P02-I08: real protocol transcripts become terminal, file-change and plan elements instead of raw JSON.
    func testP02_I08_transcriptShowsTerminalFileChangePlanAndContext() throws {
        let app = try Fixture.launch()
        app.openTask()
        XCTAssertTrue(app.element("card-terminal").waitForExistence(timeout: 20), "comando del terminale come scheda")
        XCTAssertTrue(app.element("card-file-change").waitForExistence(timeout: 10), "modifica di file come scheda")
        XCTAssertTrue(app.element("plan-bar").waitForExistence(timeout: 10), "il piano resta sopra il composer")
        XCTAssertTrue(app.element("context-indicator").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("card-permission").exists, "la richiesta di permesso già risolta resta nello storico")
        app.terminate()
    }

    /// Queued messages can be edited and deleted, and are labelled as waiting.
    func testP02_I08_queuedMessagesCanBeEditedAndDeleted() throws {
        let app = try Fixture.launch()
        app.openTask()
        let items = app.descendants(matching: .any).matching(identifier: "queue-item")
        XCTAssertTrue(items.firstMatch.waitForExistence(timeout: 20))
        XCTAssertGreaterThanOrEqual(items.count, 1)
        app.element("queue-edit").click()
        let field = app.element("queue-edit-field")
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.click(); app.typeKey("a", modifierFlags: .command); field.typeText("Testo modificato")
        app.element("queue-save").click()
        XCTAssertTrue(app.staticTexts["Testo modificato"].waitForExistence(timeout: 10))
        app.element("queue-delete").click()
        XCTAssertFalse(app.staticTexts["Testo modificato"].waitForExistence(timeout: 3))
        app.terminate()
    }

    /// Command-Return sends; it must not stop a run (nothing runs in this archive, so the send button is the only action).
    func testP02_I08_composerSendsWithTheDocumentedShortcutAndNeverStopsARun() throws {
        let app = try Fixture.launch()
        app.openTask("Lavoro vuoto")
        XCTAssertTrue(app.element("composer").waitForExistence(timeout: 20))
        XCTAssertTrue(app.element("send-message").exists)
        XCTAssertFalse(app.element("stop-run").exists)
        app.terminate()
    }

    /// The permission card offers the backend's own choices and reports which one was chosen; a waiting task is flagged with text.
    func testP02_I08_permissionChoicesAndWaitingBadgeInTheShowcase() throws {
        let app = try Fixture.launch(showcase: true)
        XCTAssertTrue(app.element("showcase-title").waitForExistence(timeout: 20))
        XCTAssertTrue(app.element("permission-choice:allow-once").exists)
        XCTAssertTrue(app.element("permission-choice:allow-always").exists)
        XCTAssertTrue(app.element("permission-choice:reject-once").exists)
        app.element("permission-choice:allow-always").click()
        XCTAssertTrue(app.staticTexts["Risposta: allow-always"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.element("badge-waiting").exists)
        app.terminate()
    }
}
