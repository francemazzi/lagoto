import XCTest

@MainActor final class NativeTests: XCTestCase {
    func testProjectPersistsAcrossNativeRelaunch() throws {
        continueAfterFailure = false
        let dataPath = FileManager.default.temporaryDirectory.appendingPathComponent("LagotoUI-\(UUID().uuidString)").path
        let app = XCUIApplication()
        app.launchEnvironment["LAGOTO_DATA_DIR"] = dataPath
        app.launch()
        XCTAssertTrue(app.staticTexts["Archivio locale pronto"].waitForExistence(timeout: 20))
        app.buttons["new-project"].click()
        app.textFields["project-name"].typeText("Progetto integrazione")
        app.buttons["create-project"].click()
        XCTAssertTrue(app.staticTexts["Un progetto, tutti i suoi repository."].waitForExistence(timeout: 5))
        app.terminate()
        app.launch()
        XCTAssertTrue(app.staticTexts["Archivio locale pronto"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Progetto integrazione"].firstMatch.waitForExistence(timeout: 5))
        app.terminate()
    }
}
