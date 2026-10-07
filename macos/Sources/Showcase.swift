#if DEBUG
import SwiftUI

/// Debug-only stage for states a seeded archive cannot hold, such as a run that waits for a permission
/// (the runtime reconciles such runs at startup). It is compiled out of Release and never reachable by users.
struct ShowcaseView: View {
    @State private var answer = "nessuna"
    private let choices: JSONValue = .array([
        .object(["id": .string("allow-once"), "label": .string("Consenti una volta"), "kind": .string("allow")]),
        .object(["id": .string("allow-always"), "label": .string("Consenti sempre"), "kind": .string("allow")]),
        .object(["id": .string("reject-once"), "label": .string("Rifiuta"), "kind": .string("reject")]),
    ])
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Vetrina").font(.title).accessibilityIdentifier("showcase-title")
            PermissionCard(block: block(choices: choices), active: true) { _, optionID, allow in answer = optionID ?? (allow == true ? "allow" : "reject") }
            Text("Risposta: \(answer)").accessibilityIdentifier("showcase-answer")
            List { TaskRowLabel(task: WorkTask(id: "w", project_id: "p", title: "Lavoro in attesa", objective: "", status: "active", waiting: 1, active: 1, uncertain: 0)) }.frame(height: 80)
        }.padding(24).frame(maxWidth: .infinity, alignment: .topLeading)
    }
    private func block(choices: JSONValue) -> TranscriptBlock {
        TranscriptBlock(id: "b", run_id: "r", kind: "permission", text: "Esegui comando", detail: .object(["id": .string("perm"), "input": .object(["command": .string("rm -rf build")]), "choices": choices]), first_seq: 1, last_seq: 1)
    }
}
#endif
