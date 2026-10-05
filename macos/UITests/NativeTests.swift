import XCTest

@MainActor final class NativeTests: XCTestCase {
    func testProjectPersistsAcrossNativeRelaunch() throws {
        continueAfterFailure = false
        let dataPath = FileManager.default.temporaryDirectory.appendingPathComponent("LagotoUI-\(UUID().uuidString)").path
        let app = XCUIApplication()
        app.launchEnvironment["LAGOTO_DATA_DIR"] = dataPath
        app.launch()
        XCTAssertTrue(app.staticTexts["Archivio locale pronto"].waitForExistence(timeout: 20))
        // The small CI display can move toolbar items into overflow.
        // Exercise the public keyboard command, including focus into the project sheet.
        app.typeKey("n", modifierFlags: [.command, .shift])
        XCTAssertTrue(app.textFields["project-name"].waitForExistence(timeout: 5))
        app.textFields["project-name"].typeText("Progetto integrazione")
        app.buttons["create-project"].click()
        XCTAssertTrue(app.staticTexts["Un progetto, tutti i suoi repository."].waitForExistence(timeout: 5))
        app.terminate()
        app.launch()
        XCTAssertTrue(app.staticTexts["Archivio locale pronto"].waitForExistence(timeout: 20))
        // macOS outlines expose their row contents through cells. Resolve the complete
        // scoped query (not the first-match shortcut) and prove that the row opens.
        let restoredProject = app.outlines["Sidebar"].cells.containing(.staticText, identifier: "Progetto integrazione").element
        XCTAssertTrue(restoredProject.waitForExistence(timeout: 10), app.outlines.debugDescription)
        restoredProject.click()
        XCTAssertTrue(app.staticTexts["Un progetto, tutti i suoi repository."].waitForExistence(timeout: 5))
        app.terminate()
    }
}
