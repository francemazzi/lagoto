import SwiftUI

struct TaskMemoryView: View {
    let bridge: RuntimeBridge
    let taskID: String
    @State private var progress: JSONValue = .null
    @State private var tests: JSONValue = .null
    @State private var criterion = ""
    @State private var decision = ""
    @State private var supersedes = ""
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Criteri: \(Int(progress["completed"].number ?? 0))/\(Int(progress["total"].number ?? 0))").font(.headline)
            ForEach(progress["criteria"].array, id: \.pretty) { item in
                VStack(alignment: .leading) {
                    Text(item["content"].string ?? "")
                    Text("Revisione \(Int(item["revision"].number ?? 1)) · \(item["state"].string ?? "")").font(.caption).foregroundStyle(.secondary)
                    if let reason = item["override_reason"].string { Text("Deroga: \(reason)").font(.caption) }
                    Menu("Collega una verifica") {
                        ForEach(tests.array.filter { $0["state"].string == "passed" }, id: \.pretty) { test in
                            Button("\(test["repositoryName"].string ?? "Repository") · \(test["command"]["command"].string ?? "Verifica")") { Task { await link(item, test) } }
                        }
                    }.disabled(tests.array.allSatisfy { $0["state"].string != "passed" })
                }
            }
            TextField("Nuovo criterio di completamento", text: $criterion, axis: .vertical)
            Button("Aggiungi criterio") { Task { await addCriterion() } }.disabled(criterion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Button("Segna lavoro completato") { Task { do { _ = try await bridge.call("task/complete", ["taskId": .string(taskID)]); await reload() } catch { self.error = error.localizedDescription } } }.disabled((progress["total"].number ?? 0) == 0 || progress["total"] != progress["completed"])
            if progress["status"].string == "completed" { Label("Lavoro completato", systemImage: "checkmark.circle") }
            Divider()
            Text("Decisioni confermate").font(.headline)
            ForEach(progress["decisions"].array.filter { $0["state"].string == "active" }, id: \.pretty) { item in
                VStack(alignment: .leading) { Text(item["content"].string ?? ""); Button("Sostituisci") { supersedes = item["id"].string ?? ""; decision = item["content"].string ?? "" }.font(.caption) }
            }
            TextField(supersedes.isEmpty ? "Nuova decisione" : "Decisione sostitutiva", text: $decision, axis: .vertical)
            Button("Conferma decisione") { Task { await saveDecision() } }.disabled(decision.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if let error { Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled) }
        }.task { await reload() }
    }
    private func reload() async {
        do { progress = try await bridge.call("task/progress", ["taskId": .string(taskID)]); tests = try await bridge.call("verification/list", ["taskId": .string(taskID)]) } catch { self.error = error.localizedDescription }
    }
    private func addCriterion() async {
        do { _ = try await bridge.call("criterion/edit", ["taskId": .string(taskID), "content": .string(criterion), "reason": .string("Criterio aggiunto dall’utente")]); criterion = ""; error = nil; await reload() } catch { self.error = error.localizedDescription }
    }
    private func link(_ criterion: JSONValue, _ test: JSONValue) async {
        do { _ = try await bridge.call("criterion/accept", ["taskId": .string(taskID), "id": criterion["id"], "revision": criterion["revision"], "verificationId": test["id"]]); error = nil; await reload() } catch { self.error = error.localizedDescription }
    }
    private func saveDecision() async {
        var input: [String: JSONValue] = ["taskId": .string(taskID), "content": .string(decision)]
        if !supersedes.isEmpty { input["supersedes"] = .string(supersedes) }
        do { _ = try await bridge.call("decision/save", input); decision = ""; supersedes = ""; error = nil; await reload() } catch { self.error = error.localizedDescription }
    }
}
