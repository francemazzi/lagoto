import XCTest

@MainActor final class WorkspaceTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    /// P02-I07: closed at launch, opens with the keyboard, lists real worktree files and previews them safely.
    func testP02_I07_workspaceOpensOnDemandAndPreviewsFiles() throws {
        let app = try Fixture.launch()
        app.openTask()
        XCTAssertTrue(app.element("composer").waitForExistence(timeout: 20))
        XCTAssertFalse(app.element("workspace-column").exists, "il pannello è chiuso all’avvio")
        app.typeKey("i", modifierFlags: [.command, .option])
        XCTAssertTrue(app.element("workspace-column").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("workspace-tab-files").exists && app.element("workspace-tab-preview").exists && app.element("workspace-tab-changes").exists)
        let readme = app.element("explorer-row:README.md")
        XCTAssertTrue(readme.waitForExistence(timeout: 20), "l’esploratore elenca i file del worktree")
        readme.click()
        XCTAssertTrue(app.element("preview-tab:README.md").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("preview-markdown").waitForExistence(timeout: 10), "il Markdown è mostrato formattato")
        // A page with a script is shown as source and never executed.
        app.element("workspace-tab-files").click()
        app.element("explorer-row:page.html").click()
        XCTAssertTrue(app.element("preview-html-inert").waitForExistence(timeout: 10))
        // The preview tab can be closed.
        app.element("close-preview-tab:page.html").click()
        XCTAssertFalse(app.element("preview-tab:page.html").exists)
        app.terminate()
    }

    func testP02_I07_changesListStagedUnstagedAndUntrackedFiles() throws {
        let app = try Fixture.launch()
        app.openTask()
        XCTAssertTrue(app.element("composer").waitForExistence(timeout: 20))
        app.typeKey("i", modifierFlags: [.command, .option])
        app.element("workspace-tab-changes").click()
        XCTAssertTrue(app.element("changes-list").waitForExistence(timeout: 10))
        for path in ["contract.json", "src/app.ts", "notes.md"] { XCTAssertTrue(app.element("change-row:\(path)").waitForExistence(timeout: 10), "\(path) non compare tra le modifiche") }
        app.element("change-row:contract.json").click()
        XCTAssertTrue(app.element("preview-diff").waitForExistence(timeout: 10), "una modifica si apre come diff")
        app.terminate()
    }

    /// The panel remembers the last tab across launches, but not whether it was open.
    func testP02_I07_lastTabIsRememberedButThePanelStartsClosed() throws {
        let data = try Fixture.archive()
        let first = try Fixture.launch(data: data)
        first.openTask()
        XCTAssertTrue(first.element("composer").waitForExistence(timeout: 20))
        first.typeKey("i", modifierFlags: [.command, .option])
        first.element("workspace-tab-changes").click()
        first.terminate()
        // Relaunch without resetting the stored tab: the argument list below deliberately leaves `workspace.tab` alone.
        let second = XCUIApplication()
        second.launchEnvironment["LAGOTO_TEST_DATA_DIR"] = data
        second.launchArguments = ["-LagotoWindowSize", "1280x800"]
        second.launch()
        second.openTask()
        XCTAssertFalse(second.element("workspace-column").exists)
        second.typeKey("i", modifierFlags: [.command, .option])
        XCTAssertTrue(second.element("changes-list").waitForExistence(timeout: 10), "la scheda Modifiche è ricordata")
        second.terminate()
    }
}
