import XCTest

@MainActor final class FolderTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    /// Repositories created by the seed script live next to the archive.
    private func folder(_ name: String) -> URL {
        URL(fileURLWithPath: ProcessInfo.processInfo.environment["LAGOTO_UI_FIXTURE"] ?? "").deletingLastPathComponent().appendingPathComponent("repos").appendingPathComponent(name)
    }
    private func openProject(_ app: XCUIApplication, _ name: String = "Progetto cartelle") {
        XCTAssertTrue(app.staticTexts["Archivio locale pronto"].waitForExistence(timeout: 30))
        let row = app.element("project-row:\(name)")
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        row.click()
        XCTAssertTrue(app.staticTexts["Un progetto, tutti i suoi repository."].waitForExistence(timeout: 10))
    }
    private func openDetails(_ app: XCUIApplication, _ repo: String) {
        let button = app.element("repo-details:\(repo)")
        XCTAssertTrue(button.waitForExistence(timeout: 15), "repository \(repo) assente")
        button.click()
    }
    private func git(_ arguments: [String], in directory: URL) -> String {
        let process = Process(), pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git"); process.arguments = ["-C", directory.path] + arguments; process.standardOutput = pipe; process.standardError = pipe
        do { try process.run() } catch { return "errore: \(error)" }
        process.waitUntilExit()
        return String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    }

    /// P03-I01: a project survives a restart, and archiving it never deletes the files on disk.
    func testP03_I01_archivingKeepsFilesAndTheProjectSurvivesARestart() throws {
        let data = try Fixture.archive()
        let app = try Fixture.launch(data: data)
        openProject(app)
        XCTAssertTrue(app.element("repo-row:senza-git").waitForExistence(timeout: 10))
        let row = app.element("project-row:Progetto cartelle")
        row.rightClick()
        app.menuItems["Archivia progetto"].click()
        XCTAssertFalse(app.element("project-row:Progetto cartelle").waitForExistence(timeout: 3), "il progetto archiviato esce dalla sidebar")
        XCTAssertTrue(FileManager.default.fileExists(atPath: folder("senza-git").appendingPathComponent("README.md").path), "archiviare non cancella file")
        app.terminate()
        let again = try Fixture.launch(data: data)
        XCTAssertTrue(again.staticTexts["Archivio locale pronto"].waitForExistence(timeout: 30))
        XCTAssertTrue(again.element("project-row:Progetto demo").waitForExistence(timeout: 20), "gli altri progetti restano dopo il riavvio")
        XCTAssertFalse(again.element("project-row:Progetto cartelle").exists, "l’archiviazione resta dopo il riavvio")
        again.element("archive-menu").click()
        again.menuItems["Ripristina progetto"].click()
        again.menuItems["Progetto cartelle"].click()
        XCTAssertTrue(again.element("project-row:Progetto cartelle").waitForExistence(timeout: 10))
        again.terminate()
    }

    /// P03-I02: a folder without Git is accepted as a candidate; a Git folder shows its branch.
    func testP03_I02_aFolderWithoutGitIsACandidateAndAGitFolderShowsItsBranch() throws {
        let app = try Fixture.launch()
        openProject(app)
        XCTAssertTrue(app.staticTexts["Cartella senza Git"].firstMatch.waitForExistence(timeout: 10))
        openDetails(app, "senza-git")
        XCTAssertTrue(app.element("prepare-git").waitForExistence(timeout: 10), "una cartella non Git propone di prepararla")
        app.buttons["Chiudi"].firstMatch.click()
        openDetails(app, "piu-remote")
        XCTAssertTrue(app.element("repo-branch").waitForExistence(timeout: 10))
        app.terminate()
    }

    /// P03-I05: a moved folder is reported as unavailable with a way to relink it, and nothing is created at the old path.
    func testP03_I05_aMovedFolderIsBlockedAndNoEmptyDirectoryIsCreated() throws {
        let app = try Fixture.launch()
        openProject(app)
        openDetails(app, "spostata")
        XCTAssertTrue(app.element("repo-unavailable").waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Ricollega cartella spostata…"].exists)
        XCTAssertFalse(FileManager.default.fileExists(atPath: folder("spostata").path), "nessuna cartella vuota creata in silenzio")
        app.terminate()
    }

    /// P03-I07: two GitHub remotes are never linked automatically; the user gets a concrete choice and no push happens.
    func testP03_I07_twoRemotesGiveAChoiceInsteadOfAnAutomaticLink() throws {
        let app = try Fixture.launch()
        openProject(app)
        openDetails(app, "piu-remote")
        XCTAssertTrue(app.element("link-remote:origin").waitForExistence(timeout: 10))
        XCTAssertTrue(app.element("link-remote:upstream").exists)
        XCTAssertTrue(app.text(containing: "nessun push").exists)
        app.terminate()
    }

    /// P03-I08 (local part): a folder without Git is prepared with a selective first commit; secrets stay out and the index is what the user chose.
    func testP03_I08_prepareGitExcludesSecretsAndCommitsOnlyTheSelection() throws {
        let app = try Fixture.launch()
        openProject(app)
        openDetails(app, "da-preparare")
        app.element("prepare-git").click()
        XCTAssertTrue(app.element("init-file:README.md").waitForExistence(timeout: 15))
        XCTAssertFalse(app.element("init-file:.env").exists, "un file con segreti non è selezionabile")
        XCTAssertTrue(app.text(containing: ".env").waitForExistence(timeout: 5), "il file escluso è elencato con il motivo")
        app.element("init-file:README.md").click()
        let name = app.element("init-author-name"), email = app.element("init-author-email")
        name.click(); name.typeText("Fixture"); email.click(); email.typeText("fixture@example.invalid")
        app.element("init-preview").click()
        XCTAssertTrue(app.element("init-confirm").waitForExistence(timeout: 15))
        app.element("init-confirm").click()
        XCTAssertTrue(app.element("init-done").waitForExistence(timeout: 30))
        let tracked = git(["ls-tree", "-r", "--name-only", "HEAD"], in: folder("da-preparare"))
        XCTAssertTrue(tracked.contains("README.md"), "file nel primo commit: «\(tracked)»"); XCTAssertFalse(tracked.contains(".env"), "il file con segreti non è nel commit")
        app.terminate()
    }

    /// P03-I03: a URL with credentials is refused without echoing them, a clone to an existing folder never overwrites it, and a failed clone says so.
    func testP03_I03_cloneNeverOverwritesAndRedactsCredentials() throws {
        let parent = FileManager.default.temporaryDirectory.appendingPathComponent("LagotoClone-\(UUID().uuidString)")
        let existing = parent.appendingPathComponent("esistente")
        try FileManager.default.createDirectory(at: existing, withIntermediateDirectories: true)
        try "non toccare".write(to: existing.appendingPathComponent("marker.txt"), atomically: true, encoding: .utf8)
        let app = try Fixture.launch(arguments: ["-LagotoCloneParent", parent.path])
        openProject(app, "Progetto demo")
        app.element("add-repository-menu").click()
        app.menuItems["Clona da URL…"].click()
        let source = app.element("clone-source"), name = app.element("clone-folder")
        XCTAssertTrue(source.waitForExistence(timeout: 10))
        func fill(_ field: XCUIElement, _ text: String) { field.click(); app.typeKey("a", modifierFlags: .command); field.typeText(text) }
        let secret = NSPredicate(format: "label CONTAINS 'SegretoSintetico99' OR value CONTAINS 'SegretoSintetico99'")
        // 1. Credentials in the URL are refused before any destination exists, and are not shown back.
        fill(source, "https://utente:SegretoSintetico99@127.0.0.1:1/nessuno.git"); fill(name, "nuova")
        app.element("clone-submit").click()
        XCTAssertTrue(app.element("clone-error").waitForExistence(timeout: 15))
        XCTAssertEqual(app.staticTexts.matching(secret).count, 0, "la credenziale non compare")
        XCTAssertFalse(FileManager.default.fileExists(atPath: parent.appendingPathComponent("nuova").path))
        // 2. An existing destination is refused and its content is untouched.
        fill(source, "https://127.0.0.1:1/nessuno.git"); fill(name, "esistente")
        app.element("clone-submit").click()
        XCTAssertTrue(app.element("clone-error").waitForExistence(timeout: 15))
        XCTAssertEqual(try String(contentsOf: existing.appendingPathComponent("marker.txt"), encoding: .utf8), "non toccare")
        // 3. A new destination that cannot be reached fails visibly.
        fill(name, "nuova")
        app.element("clone-submit").click()
        XCTAssertTrue(app.staticTexts["Clonazione fallita"].waitForExistence(timeout: 60))
        XCTAssertEqual(app.staticTexts.matching(secret).count, 0)
        app.terminate()
    }

    /// P03-I06: the history is searchable from the sidebar with no network, beyond titles.
    func testP03_I06_searchFindsDecisionsAndMessagesInTheLocalArchive() throws {
        let app = try Fixture.launch()
        XCTAssertTrue(app.staticTexts["Archivio locale pronto"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.element("task-row:Contratto API").waitForExistence(timeout: 20))
        app.typeKey("f", modifierFlags: .command)
        app.typeText("identificativi")
        let hit = app.element("search-hit:Contratto API")
        XCTAssertTrue(hit.waitForExistence(timeout: 10), "la decisione è trovata nella cronologia")
        hit.click()
        XCTAssertTrue(app.element("composer").waitForExistence(timeout: 15), "il risultato apre il lavoro")
        app.terminate()
    }
}
