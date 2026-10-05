import SwiftUI

struct CloneSheet: View {
    let bridge: RuntimeBridge
    let project: Project
    let started: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var source = ""
    @State private var parent: URL?
    @State private var folder = ""
    @State private var busy = false
    @State private var error: String?
    @State private var requestID = UUID().uuidString
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Clona un repository").font(.title2).bold()
            TextField("URL HTTPS o SSH", text: $source).textFieldStyle(.roundedBorder).accessibilityIdentifier("clone-source")
            TextField("Nome della nuova cartella", text: $folder).textFieldStyle(.roundedBorder)
            HStack { Button("Scegli destinazione…") { let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false; if panel.runModal() == .OK { parent = panel.url } }; Text(parent?.path ?? "Nessuna cartella scelta").font(.caption).lineLimit(2) }
            Text("La destinazione deve essere nuova. Git usa il proprio accesso configurato. Un annullamento conserva la cartella parziale per il recupero.").font(.callout).foregroundStyle(.secondary)
            if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            HStack { Button("Annulla") { dismiss() }; Spacer(); Button("Clona") { Task { await clone() } }.keyboardShortcut(.defaultAction).disabled(busy || source.isEmpty || parent == nil || folder.isEmpty || folder.contains("/") || [".", ".."].contains(folder)) }
        }.padding(24).frame(width: 520).disabled(busy)
    }
    private func clone() async {
        guard let parent else { return }; busy = true
        do { _ = try await bridge.call("repository/clone", ["projectId": .string(project.id), "id": .string(requestID), "source": .string(source), "destination": .string(parent.appendingPathComponent(folder).path)]); await started(); dismiss() }
        catch { self.error = error.localizedDescription }
        busy = false
    }
}

struct RepositorySheet: View {
    let bridge: RuntimeBridge
    let project: Project
    let repository: Repository
    @Environment(\.dismiss) private var dismiss
    @State private var detail: RepositoryDetail?
    @State private var error: String?
    @State private var busy = false
    @State private var github = false
    @State private var initializing = false
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(repository.name).font(.title2).bold()
            Text(repository.path).font(.caption).textSelection(.enabled)
            if let detail {
                if detail.availability == "unavailable" {
                    Label("Cartella non disponibile", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                    Text(detail.error ?? "Volume assente o percorso spostato").font(.caption)
                    Button("Ricollega cartella spostata…") { relink() }
                } else if detail.availability == "candidate" {
                    Text("Scegli i file del primo commit per preparare questa cartella al lavoro con Git.")
                    Button("Prepara Git…") { initializing = true }
                }
                else {
                    Text("Branch: \(detail.branch?.isEmpty == false ? detail.branch! : "HEAD scollegato")")
                    if !(detail.status ?? "").isEmpty { DisclosureGroup("Modifiche locali") { Text(detail.status ?? "").font(.system(.caption, design: .monospaced)).textSelection(.enabled) } }
                    ForEach(detail.candidates) { remote in
                        HStack { VStack(alignment: .leading) { Text(remote.name).bold(); Text(remote.url).font(.caption).textSelection(.enabled) }; Spacer(); if remote.github != nil { Button("Collega") { Task { await choose(remote) } } } }
                    }
                    if !detail.candidates.isEmpty { Text("Il collegamento sceglie il repository di riferimento. Accesso GitHub non verificato; nessun push viene eseguito.").font(.caption).foregroundStyle(.secondary) }
                    Button("Crea e collega su GitHub…") { github = true }
                }
            } else { ProgressView() }
            if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            HStack { Spacer(); Button("Chiudi") { dismiss() }.keyboardShortcut(.cancelAction) }
        }.padding(24).frame(width: 580).disabled(busy).task { await refresh() }
        .sheet(isPresented: $github, onDismiss: { Task { await refresh() } }) { GitHubLinkSheet(bridge: bridge, project: project, repository: repository) }
        .sheet(isPresented: $initializing, onDismiss: { Task { await refresh() } }) { GitInitializeSheet(bridge: bridge, project: project, repository: repository) }
    }
    private var params: [String: JSONValue] { ["projectId": .string(project.id), "repositoryId": .string(repository.id)] }
    private func refresh() async { do { detail = try await bridge.decode(RepositoryDetail.self, method: "repository/inspect", params: params) } catch { self.error = error.localizedDescription } }
    private func choose(_ remote: RepositoryRemote) async { busy = true; defer { busy = false }; do { _ = try await bridge.call("repository/selectRemote", params.merging(["name": .string(remote.name)]) { _, v in v }); await refresh() } catch { self.error = error.localizedDescription } }
    private func relink() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url { Task { busy = true; defer { busy = false }; do { _ = try await bridge.call("repository/relink", params.merging(["path": .string(url.path)]) { _, v in v }); await refresh() } catch { self.error = error.localizedDescription } } }
    }
}
