import SwiftUI

struct GitHubLinkSheet: View {
    let bridge: RuntimeBridge
    let project: Project
    let repository: Repository
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var remoteName = "github"
    @State private var operation: JSONValue?
    @State private var error: String?
    @State private var busy = false
    @State private var requestID = UUID().uuidString
    @State private var loaded = false
    private var running: Bool { operation?["state"].string == "running" }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Crea e collega su GitHub").font(.title2).bold()
            if let op = operation {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Repository privato", systemImage: "lock")
                        Text("\(op["owner"].string ?? "") / \(op["name"].string ?? "")").font(.headline)
                        Text("Cartella: \(repository.path)").font(.caption).textSelection(.enabled)
                        Text("Branch: \(op["branch"].string ?? "") · nuovo remote: \(op["remoteName"].string ?? "")")
                        Text("Verranno pubblicati \(Int(op["commits"].number ?? 0)) commit della cronologia, fino a \(String((op["head"].string ?? "").prefix(12))).")
                        DisclosureGroup("File nell’ultimo commit (\(op["files"].array.count))") {
                            ForEach(op["files"].array.compactMap(\.string), id: \.self) { Text($0).font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
                        }
                        DisclosureGroup("Cronologia · ultimi 30 commit") { Text(op["history"].string ?? "").font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
                        if let unpublished = op["unpublished"].string, !unpublished.isEmpty {
                            Text("Le seguenti modifiche locali restano sul Mac e non verranno pubblicate:").foregroundStyle(.secondary)
                            Text(unpublished).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                        }
                        Text("La scansione ha controllato i formati di segreti riconosciuti e i nomi sensibili nella cronologia. Controlla i contenuti prima della pubblicazione.").font(.caption).foregroundStyle(.secondary)
                        if op["state"].string == "completed" { Label("Repository collegato · commit remoto verificato", systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
                        if running { ProgressView("Collegamento in corso…") }
                        if let detail = op["error"].string { Text(detail).foregroundStyle(.red).textSelection(.enabled) }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.frame(maxHeight: 410)
                HStack {
                    Button("Chiudi") { dismiss() }
                    if !running && op["state"].string != "completed" { Button("Nuova anteprima") { operation = nil; requestID = UUID().uuidString } }
                    Spacer()
                    if op["state"].string != "completed" {
                        Button(op["state"].string == "preview" ? "Crea privato e pubblica" : "Riconcilia e riprendi") { Task { await confirm(op) } }.buttonStyle(.borderedProminent).disabled(busy || running)
                    }
                }
            } else {
                TextField("Nome del nuovo repository GitHub", text: $name).textFieldStyle(.roundedBorder)
                TextField("Nome del nuovo remote locale", text: $remoteName).textFieldStyle(.roundedBorder)
                Text("Pubblica il branch già committato con l’account attivo di GitHub CLI. L’anteprima mostra account, cronologia e file prima di creare il repository privato.").foregroundStyle(.secondary)
                HStack { Button("Annulla") { dismiss() }; Spacer(); Button("Prepara anteprima") { Task { await preview() } }.disabled(busy || name.isEmpty || remoteName.isEmpty).keyboardShortcut(.defaultAction) }
            }
            if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
        }.padding(24).frame(width: 660).task {
            name = repository.name
            while !Task.isCancelled { await refresh(); try? await Task.sleep(for: .seconds(2)) }
        }
    }
    private var params: [String: JSONValue] { ["projectId": .string(project.id), "repositoryId": .string(repository.id)] }
    private func refresh() async {
        do {
            let rows = try await bridge.call("github/list", params)
            if let id = operation?["id"].string { operation = rows.array.first { $0["id"].string == id } ?? operation }
            else if !loaded, let incomplete = rows.array.first(where: { !["preview", "completed"].contains($0["state"].string ?? "") }) { operation = incomplete }
            loaded = true
        } catch { self.error = error.localizedDescription }
    }
    private func preview() async {
        busy = true; error = nil; defer { busy = false }
        do { operation = try await bridge.call("github/preview", params.merging(["id": .string(requestID), "name": .string(name), "remoteName": .string(remoteName)]) { _, v in v }) }
        catch { self.error = error.localizedDescription }
    }
    private func confirm(_ op: JSONValue) async {
        guard let id = op["id"].string, let hash = op["hash"].string else { return }
        busy = true; error = nil; defer { busy = false }
        do { operation = try await bridge.call("github/confirm", ["id": .string(id), "hash": .string(hash)]) }
        catch { self.error = error.localizedDescription }
    }
}
