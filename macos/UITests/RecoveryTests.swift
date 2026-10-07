import XCTest

@MainActor final class RecoveryTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    /// P12-I02: a run that was alive when the app died is never shown as running; it asks for reconciliation, blocks new sends, and clears once reconciled.
    func testP12_I02_aRunLeftBehindByACrashIsNotShownAsRunningAndCanBeReconciled() throws {
        let app = try Fixture.launch()
        XCTAssertTrue(app.staticTexts["Archivio locale pronto"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.element("task-row:Lavoro interrotto").waitForExistence(timeout: 20))
        XCTAssertTrue(app.images["Esecuzione da riconciliare"].firstMatch.waitForExistence(timeout: 10), "il lavoro è segnato come da riconciliare")
        XCTAssertFalse(app.element("badge-active").exists, "nessuno stato «in esecuzione» senza evidenza")
        app.openTask("Lavoro interrotto")
        XCTAssertTrue(app.staticTexts["Esecuzione da riconciliare"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["In esecuzione"].exists)
        XCTAssertFalse(app.element("send-message").isEnabled, "nessuna nuova run prima della riconciliazione")
        app.typeKey("i", modifierFlags: [.command, .option])
        app.element("workspace-tab-work").click()
        let reconcile = app.element("reconcile-runs")
        XCTAssertTrue(reconcile.waitForExistence(timeout: 10))
        reconcile.click()
        XCTAssertTrue(app.staticTexts["Lavoro salvato sul Mac"].waitForExistence(timeout: 15), "dopo la riconciliazione il lavoro è di nuovo utilizzabile")
        XCTAssertFalse(app.images["Esecuzione da riconciliare"].firstMatch.exists)
        app.terminate()
    }
}
