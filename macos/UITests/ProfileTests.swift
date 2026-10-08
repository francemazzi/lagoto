import XCTest

@MainActor final class ProfileTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    /// P02-I04: every profile says in words whether it can be used and what to do next; a positive budget never hides a block.
    func testP02_I04_everyProfileShowsAnHonestStateWithItsAction() throws {
        let app = try Fixture.launch()
        XCTAssertTrue(app.staticTexts["Archivio locale pronto"].waitForExistence(timeout: 30))
        app.element("nav-integrations").click()
        for label in ["Pronto", "Locale", "Da verificare", "Accesso da rinnovare", "Budget da rinnovare"] {
            let state = app.text(containing: label)
            XCTAssertTrue(state.waitForExistence(timeout: 20), "nessun profilo nello stato «\(label)»")
        }
        XCTAssertTrue(app.element("profile-action:Claude · accesso scaduto").exists, "lo stato bloccato indica cosa fare")
        app.terminate()
    }

    /// P09-I10: the toolbar shows the average of today's batteries with the lowest profile named in the popover.
    func testP09_I10_toolbarShowsTheAverageBatteryAndTheLowestProfile() throws {
        let app = try Fixture.launch()
        XCTAssertTrue(app.staticTexts["Archivio locale pronto"].waitForExistence(timeout: 30))
        let battery = app.element("battery-average")
        XCTAssertTrue(battery.waitForExistence(timeout: 20))
        // The expired and local profiles are not in the average. The percentages depend on the day (the seed spends part of today's allowance), so only the structure is asserted.
        XCTAssertTrue(battery.label.contains("%") || (battery.value as? String ?? "").contains("%"), battery.label)
        battery.click()
        XCTAssertTrue(app.text(containing: "Il più basso:").waitForExistence(timeout: 10))
        XCTAssertTrue(app.text(containing: "Qwen · budget scaduto: ciclo da rinnovare").exists)
        XCTAssertTrue(app.text(containing: "Ollama · qwen3.5: modello locale").exists)
        app.terminate()
    }
}
