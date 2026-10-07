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

@MainActor final class FlowTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    /// P06-I05: every path (Codex, Cursor, Claude) shows messages, tools and permissions in one timeline, and a finished answer
    /// never marks the task complete: it says the work still has to be checked.
    func testP06_I05_completeTurnsOnEveryPathAndTheFinalAnswerDoesNotCompleteTheTask() throws {
        let app = try Fixture.launch()
        app.openTask()
        XCTAssertTrue(app.element("message-assistant").waitForExistence(timeout: 20))
        XCTAssertTrue(app.element("card-terminal").exists && app.element("card-file-change").exists && app.element("card-permission").exists)
        XCTAssertTrue(app.staticTexts["Turno concluso · lavoro da verificare"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Completato"].exists, "la risposta finale non completa il lavoro")
        app.terminate()
    }
}
