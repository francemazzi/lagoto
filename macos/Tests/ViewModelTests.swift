import XCTest
@testable import Lagoto

final class ViewModelTests: XCTestCase {
    private func block(_ id: String, _ kind: String, run: String? = "r1", seq: Int, category: String? = nil, text: String = "") -> TranscriptBlock {
        TranscriptBlock(id: id, run_id: run, kind: kind, text: text, detail: category.map { .object(["category": .string($0)]) } ?? .object([:]), first_seq: seq, last_seq: seq)
    }
    private func run(_ id: String, _ name: String) -> RunRecord { RunRecord(id: id, profile_id: "p", model: "m", state: "finished", profile_name: name, provider: "x") }

    func testP02_I08_consecutivePlainToolsFoldIntoOneRowWhileTerminalAndFileChangeStayAlone() {
        let rows = TranscriptRow.build(blocks: [
            block("u", "user", seq: 1), block("t1", "tool", seq: 2), block("t2", "tool", seq: 3), block("t3", "tool", seq: 4),
            block("term", "tool", seq: 5, category: "terminal"), block("file", "tool", seq: 6, category: "file_change"), block("t4", "tool", seq: 7),
            block("plan", "plan", seq: 8), block("done", "text", seq: 9),
        ], runs: [run("r1", "Codex")])
        let ids = rows.map(\.id)
        XCTAssertEqual(ids, ["u", "tools:t1", "term", "file", "t4", "done"])
        if case .tools(let folded) = rows[1] { XCTAssertEqual(folded.count, 3) } else { XCTFail("tre strumenti semplici in fila si raggruppano") }
    }

    func testP02_I05_aSeparatorMarksWhereADifferentRunBegins() {
        let rows = TranscriptRow.build(blocks: [
            block("u1", "user", run: "r1", seq: 1), block("a1", "text", run: "r1", seq: 2),
            block("u2", "user", run: "r2", seq: 3), block("a2", "text", run: "r2", seq: 4),
        ], runs: [run("r1", "Codex"), run("r2", "Claude")])
        XCTAssertEqual(rows.map(\.id), ["u1", "a1", "run:r2", "u2", "a2"])
        if case .runStart(_, let title) = rows[2] { XCTAssertEqual(title, "Claude · m") } else { XCTFail("manca il separatore della seconda run") }
    }

    func testP09_I10_batterySummaryDecodesAverageLowestAndExclusions() throws {
        let json = """
        {"average":40,"count":2,"lowest":{"profileId":"b","name":"Cursor","provider":"cursor","percent":20},
         "profiles":[{"profileId":"a","name":"Codex","provider":"codex","percent":60},{"profileId":"b","name":"Cursor","provider":"cursor","percent":20}],
         "excluded":[{"profileId":"c","name":"Ollama","reason":"local"},{"profileId":"d","name":"Qwen","reason":"expired"}],"scope":"x"}
        """
        let summary = try JSONDecoder().decode(BatterySummary.self, from: Data(json.utf8))
        XCTAssertEqual(summary.label, "40%"); XCTAssertEqual(summary.lowest?.name, "Cursor")
        XCTAssertEqual(summary.excluded.map(\.reasonLabel), ["modello locale", "ciclo da rinnovare"])
        let none = try JSONDecoder().decode(BatterySummary.self, from: Data(#"{"average":null,"count":0,"lowest":null,"profiles":[],"excluded":[]}"#.utf8))
        XCTAssertEqual(none.label, "Nessun budget")
        let low = try JSONDecoder().decode(BatterySummary.self, from: Data(#"{"average":0.4,"count":1,"lowest":null,"profiles":[],"excluded":[]}"#.utf8))
        XCTAssertEqual(low.label, "<1%")
    }

    func testP09_I03_contextLabelIsMeasuredOnlyWhenTheProviderReportsOccupancy() throws {
        let measured = try JSONDecoder().decode(ContextMeter.self, from: Data(#"{"occupancy":{"used":1000,"window":4000,"source":"measured","fraction":0.25,"compacted":false},"package":{"estimatedTokens":300},"checkpoint":{"savedAt":null}}"#.utf8))
        XCTAssertEqual(measured.label, "Contesto 25%")
        let missing = try JSONDecoder().decode(ContextMeter.self, from: Data(#"{"occupancy":{"used":null,"window":null,"source":"missing","fraction":null,"compacted":false},"package":{"estimatedTokens":300},"checkpoint":{"savedAt":null}}"#.utf8))
        XCTAssertEqual(missing.label, "Contesto non misurato")
    }

    func testP02_I04_profileStateDecodesToneAndAction() throws {
        let states = try JSONDecoder().decode([ProfileState].self, from: Data(#"[{"profileId":"a","key":"auth-needed","label":"Accesso da rinnovare","action":"Rinnova","ready":false,"percent":null,"tone":"blocked"}]"#.utf8))
        XCTAssertEqual(states.first?.symbol, "xmark.octagon.fill"); XCTAssertFalse(states[0].ready)
    }
}
