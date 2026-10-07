import SwiftUI

struct GitInitializeSheet: View {
    let bridge: RuntimeBridge
    let project: Project
    let repository: Repository
    @Environment(\.dismiss) private var dismiss
    @State private var op: JSONValue?
    @State private var selected: Set<String> = []
    @State private var authorName = ""
    @State private var authorEmail = ""
    @State private var branch = "main"
    @State private var message = "Primo commit"
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Prepara Git · \(repository.name)").font(.title2).bold()
            if let op {
                if op["state"].string == "selection" {
                    Text("Seleziona i file da includere nel primo commit locale.").foregroundStyle(.secondary)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(op["files"].array.compactMap { $0["path"].string }, id: \.self) { path in
                                Toggle(path, isOn: Binding(get: { selected.contains(path) }, set: { if $0 { selected.insert(path) } else { selected.remove(path) } })).toggleStyle(.checkbox).accessibilityIdentifier("init-file:\(path)")
                            }
                            if !op["ignored"].array.isEmpty { DisclosureGroup("Ignorati (\(op["ignored"].array.count))") { Text(op["ignored"].array.compactMap(\.string).joined(separator: "\n")).font(.caption) } }
                            if !op["excluded"].array.isEmpty {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Esclusi dalla selezione").font(.caption).bold()
                                    ForEach(op["excluded"].array.indices, id: \.self) { i in Text("\(op["excluded"].array[i]["path"].string ?? "") · \(op["excluded"].array[i]["reason"].string ?? "")").font(.caption).foregroundStyle(.secondary) }
                                }.accessibilityElement(children: .contain).accessibilityIdentifier("init-excluded")
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }.frame(height: 180)
                    HStack { TextField("Nome autore", text: $authorName).accessibilityIdentifier("init-author-name"); TextField("Email autore", text: $authorEmail).accessibilityIdentifier("init-author-email") }.textFieldStyle(.roundedBorder)
                    HStack { TextField("Branch", text: $branch); TextField("Messaggio del commit", text: $message) }.textFieldStyle(.roundedBorder)
                    Text("L’identità autore viene impostata soltanto in questo repository. GitHub richiede una pubblicazione separata dopo la preparazione locale.").font(.caption).foregroundStyle(.secondary)
                    HStack { Button("Annulla") { dismiss() }; Spacer(); Button("Anteprima del commit") { Task { await preview(op) } }.disabled(selected.isEmpty || authorName.isEmpty || authorEmail.isEmpty || branch.isEmpty || message.isEmpty).accessibilityIdentifier("init-preview") }
                } else {
                    Text("Branch \(op["branch"].string ?? "") · \(op["authorName"].string ?? "") <\(op["authorEmail"].string ?? "")>")
                    Text(op["message"].string ?? "").bold()
                    ScrollView { Text(op["diff"].string ?? "").font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }.frame(height: 280)
                    if let failure = op["error"].string { Text(failure).foregroundStyle(.red) }
                    if op["state"].string == "completed" { Label("Git pronto · primo commit verificato", systemImage: "checkmark.circle.fill").foregroundStyle(.green).accessibilityIdentifier("init-done") }
                    HStack {
                        Button("Chiudi") { dismiss() }; Spacer()
                        if op["state"].string != "completed" { Button(op["state"].string == "preview" ? "Inizializza solo sul Mac" : "Riprendi inizializzazione") { Task { await confirm(op) } }.buttonStyle(.borderedProminent).accessibilityIdentifier("init-confirm") }
                    }
                }
            } else { ProgressView("Controllo file e regole Git…") }
            if let error { Text(error).foregroundStyle(.red).textSelection(.enabled); Button("Ripeti scansione") { Task { await scan() } } }
        }.padding(24).frame(width: 690).disabled(busy).task { await scan() }
    }
    private func scan() async {
        busy = true; error = nil; defer { busy = false }
        do {
            let params: [String: JSONValue] = ["projectId": .string(project.id), "repositoryId": .string(repository.id)]
            let existing = try await bridge.call("repository/initialize/list", params)
            if let unfinished = existing.array.first(where: { ["installing", "unknown"].contains($0["state"].string ?? "") }) { op = unfinished; return }
            op = try await bridge.call("repository/initialize/scan", params.merging(["id": .string(UUID().uuidString)]) { _, v in v }); selected = []
        } catch { self.error = error.localizedDescription }
    }
    private func preview(_ op: JSONValue) async {
        guard let id = op["id"].string else { return }; busy = true; error = nil; defer { busy = false }
        do { self.op = try await bridge.call("repository/initialize/preview", ["id": .string(id), "paths": .array(selected.sorted().map(JSONValue.string)), "message": .string(message), "authorName": .string(authorName), "authorEmail": .string(authorEmail), "branch": .string(branch)]) }
        catch { self.error = error.localizedDescription }
    }
    private func confirm(_ op: JSONValue) async {
        guard let id = op["id"].string, let hash = op["hash"].string else { return }; busy = true; error = nil; defer { busy = false }
        do { self.op = try await bridge.call("repository/initialize/confirm", ["id": .string(id), "hash": .string(hash)]) }
        catch { self.error = error.localizedDescription }
    }
}
