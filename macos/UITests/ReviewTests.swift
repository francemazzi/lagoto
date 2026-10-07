import XCTest

@MainActor final class ReviewTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func openWork(_ app: XCUIApplication) {
        app.openTask()
        XCTAssertTrue(app.element("composer").waitForExistence(timeout: 20))
        app.typeKey("i", modifierFlags: [.command, .option])
        app.element("workspace-tab-work").click()
        XCTAssertTrue(app.element("review-request").waitForExistence(timeout: 10))
    }

    /// P11-I02: asking for review is checked and never completes the task; completion stays a separate, explicit action.
    func testP11_I02_reviewIsBlockedWithoutProofAndNeverCompletesTheTask() throws {
        let app = try Fixture.launch()
        openWork(app)
        app.element("review-request").click()
        let blocked = app.element("review-blocked")
        XCTAssertTrue(blocked.waitForExistence(timeout: 10), "senza prova il runtime rifiuta la revisione e lo dice")
        XCTAssertFalse(app.element("task-in-review").exists)
        XCTAssertFalse(app.text(containing: "Lavoro completato").exists)
        XCTAssertFalse(app.element("complete-task").isEnabled, "completare resta disabilitato finché i criteri non hanno prova")
        app.terminate()
    }

    func testP11_I02_withAProofReviewIsReadyButTheTaskIsNotCompleted() throws {
        let app = try Fixture.launch()
        openWork(app)
        app.element("link-verification").click()
        app.menuItems.firstMatch.click()
        app.element("review-request").click()
        XCTAssertTrue(app.element("review-result").waitForExistence(timeout: 10), "revisione richiesta")
        XCTAssertTrue(app.element("task-in-review").waitForExistence(timeout: 10))
        XCTAssertTrue(app.text(containing: "non equivale a completato").exists)
        XCTAssertFalse(app.text(containing: "Lavoro completato").exists, "la revisione non completa il lavoro")
        app.terminate()
    }

    /// The export names every file with its size and what is left out before anything is written.
    func testP11_I04_exportShowsFilesAndExclusionsBeforeWriting() throws {
        let app = try Fixture.launch()
        openWork(app)
        app.element("open-export").click()
        XCTAssertTrue(app.element("export-files").waitForExistence(timeout: 10))
        XCTAssertTrue(app.text(containing: "task.json").exists)
        XCTAssertTrue(app.text(containing: "credenziali").exists, "le credenziali sono dichiarate escluse")
        app.terminate()
    }

    /// Storage use is listed by category and a cleanup is previewed before it is applied.
    func testP11_I06_storageShowsUsageAndPreviewsTheCleanup() throws {
        let app = try Fixture.launch()
        XCTAssertTrue(app.staticTexts["Archivio locale pronto"].waitForExistence(timeout: 30))
        app.typeKey("s", modifierFlags: [.command, .option])
        XCTAssertTrue(app.element("storage-usage").waitForExistence(timeout: 10))
        app.element("cleanup-preview").click()
        XCTAssertTrue(app.text(containing: "I worktree non vengono mai eliminati").waitForExistence(timeout: 10))
        app.terminate()
    }
}
