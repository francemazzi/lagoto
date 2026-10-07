import XCTest
@testable import Lagoto

final class MarkdownTests: XCTestCase {
    func testP01_I06_codeTablesAndStreamingCodeArePreserved() {
        let source = "Testo 🐕\n\n```swift\nlet x = 1\n```\n\n| Repo | Stato |\n|---|---|\n| backend | OK |"
        XCTAssertEqual(SafeMarkdown.blocks(source), [.paragraph("Testo 🐕"), .code("swift", "let x = 1"), .table([["Repo", "Stato"], ["backend", "OK"]])])
        XCTAssertEqual(SafeMarkdown.blocks("```js\nconst pending ="), [.code("js", "const pending =")])
    }
    func testP01_I06_untrustedURLsCannotInvokeLocalAppsOrReadFiles() {
        for value in ["javascript:alert(1)", "file:///etc/passwd", "codex://settings", "data:text/html,<script>"] { XCTAssertFalse(SafeMarkdown.allowed(URL(string: value)!)) }
        XCTAssertTrue(SafeMarkdown.allowed(URL(string: "https://github.com/francemazzi/lagoto")!))
    }
}
