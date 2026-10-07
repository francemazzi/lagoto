import AppKit
import SwiftUI

/// One tab of the preview: a file read from a task worktree or the diff of one changed file.
struct PreviewItem: Identifiable, Equatable {
    enum Source: Equatable { case file, diff }
    let id: String; let repositoryID: String; let path: String; let source: Source
    var file: WorkspaceFileContent?; var diff: FileDiffContent?; var error: String?
    var title: String { (source == .diff ? "± " : "") + (path.split(separator: "/").last.map(String.init) ?? path) }
    static func == (lhs: PreviewItem, rhs: PreviewItem) -> Bool { lhs.id == rhs.id && lhs.error == rhs.error && lhs.file?.path == rhs.file?.path && lhs.diff?.diff == rhs.diff?.diff }
}

/// Right-hand column of the task: explorer, multi-tab preview, changes per repository and the work details (P02.7).
/// The column is closed at launch; the selected tab and the width are remembered.
struct WorkspaceColumn<WorkTab: View>: View {
    let bridge: RuntimeBridge
    let taskID: String
    let repositories: [JSONValue]
    @Binding var tab: String
    @Binding var width: Double
    @Environment(EventStore.self) private var events
    @State private var previews: [PreviewItem] = []
    @State private var selectedPreview: String?
    @State private var changes: [RepositoryChanges] = []
    @State private var changesError: String?
    @State private var explorerRepository = ""
    @ViewBuilder var workTab: () -> WorkTab

    private let tabs: [(id: String, title: String)] = [("files", "File"), ("preview", "Anteprima"), ("changes", "Modifiche"), ("work", "Lavoro")]
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 2) {
                ForEach(tabs, id: \.id) { item in
                    Button(item.title) { tab = item.id }
                        .buttonStyle(.plain).font(.callout.weight(tab == item.id ? .semibold : .regular))
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(tab == item.id ? Color.accentColor.opacity(0.18) : .clear, in: Capsule())
                        .accessibilityIdentifier("workspace-tab-\(item.id)")
                        .accessibilityAddTraits(tab == item.id ? .isSelected : [])
                }
                Spacer()
            }.padding(8)
            Divider()
            Group {
                switch tab {
                case "preview": PreviewTabs(items: $previews, selected: $selectedPreview)
                case "changes": changesView
                case "work": workTab()
                default: ExplorerView(bridge: bridge, taskID: taskID, repositories: repositories, repositoryID: $explorerRepository) { repository, path in Task { await open(repository: repository, path: path, source: .file) } }
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { value in if value > 200 { width = Double(value) } }
        .task(id: taskID) { await reloadChanges() }
        .task(id: taskID) { for await _ in events.updates(.task(taskID)) { if Task.isCancelled { break }; if tab == "changes" { await reloadChanges() }; try? await Task.sleep(for: .milliseconds(400)) } }
        .onChange(of: tab) { _, value in if value == "changes" { Task { await reloadChanges() } } }
        .accessibilityElement(children: .contain).accessibilityIdentifier("workspace-column")
    }

    private var changesView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let changesError { Text(changesError).foregroundStyle(.red) }
                if changes.isEmpty && changesError == nil { ContentUnavailableView("Nessuna modifica", systemImage: "checkmark.circle", description: Text("I worktree del lavoro sono uguali all’ultimo commit.")) }
                ForEach(changes) { repository in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack { Text(repository.name).font(.headline); Spacer(); Text(repository.testLabel).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("changes-test:\(repository.name)") }
                        if repository.diffTruncated { Text("Il diff è troppo grande: mostrato solo l’inizio").font(.caption).foregroundStyle(.orange) }
                        if repository.files.isEmpty { Text("Nessun file modificato").font(.caption).foregroundStyle(.secondary) }
                        ForEach(repository.files) { file in
                            Button { Task { await open(repository: repository.repository_id, path: file.path, source: .diff) } } label: {
                                HStack(spacing: 8) {
                                    Text(file.status).font(.system(.caption, design: .monospaced)).frame(width: 14)
                                    Text(file.path).lineLimit(1).truncationMode(.middle)
                                    Spacer(minLength: 4)
                                    if file.binary { Text("binario").font(.caption2).foregroundStyle(.secondary) }
                                    Text(file.areaLabel).font(.caption2).foregroundStyle(.secondary)
                                }.contentShape(Rectangle())
                            }.buttonStyle(.plain).accessibilityIdentifier("change-row:\(file.path)")
                        }
                    }
                }
            }.padding(12)
        }.accessibilityElement(children: .contain).accessibilityIdentifier("changes-list")
    }

    private func reloadChanges() async {
        do { changes = try await bridge.decode([RepositoryChanges].self, method: "task/diff", params: ["taskId": .string(taskID)]); changesError = nil }
        catch { changesError = error.localizedDescription }
    }

    private func open(repository: String, path: String, source: PreviewItem.Source) async {
        let id = "\(source == .diff ? "diff" : "file"):\(repository):\(path)"
        if !previews.contains(where: { $0.id == id }) { previews.append(PreviewItem(id: id, repositoryID: repository, path: path, source: source)) }
        selectedPreview = id; tab = "preview"
        guard let index = previews.firstIndex(where: { $0.id == id }) else { return }
        do {
            if source == .diff { previews[index].diff = try await bridge.decode(FileDiffContent.self, method: "task/file/diff", params: ["taskId": .string(taskID), "repositoryId": .string(repository), "path": .string(path)]) }
            else { previews[index].file = try await bridge.decode(WorkspaceFileContent.self, method: "task/file", params: ["taskId": .string(taskID), "repositoryId": .string(repository), "path": .string(path)]) }
            previews[index].error = nil
        } catch { if let again = previews.firstIndex(where: { $0.id == id }) { previews[again].error = error.localizedDescription } }
    }
}

struct ExplorerView: View {
    let bridge: RuntimeBridge
    let taskID: String
    let repositories: [JSONValue]
    @Binding var repositoryID: String
    var open: (_ repositoryID: String, _ path: String) -> Void
    @State private var listings: [String: WorkspaceListing] = [:]
    @State private var expanded: Set<String> = []
    @State private var error: String?
    private struct Row: Identifiable { let id: String; let path: String; let entry: WorkspaceEntry; let depth: Int }
    private var rows: [Row] {
        func walk(_ directory: String, _ depth: Int) -> [Row] {
            (listings[directory]?.entries ?? []).flatMap { entry -> [Row] in
                let path = directory.isEmpty ? entry.name : "\(directory)/\(entry.name)"
                return [Row(id: path, path: path, entry: entry, depth: depth)] + (entry.isDirectory && expanded.contains(path) ? walk(path, depth + 1) : [])
            }
        }
        return walk("", 0)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if repositories.count > 1 {
                Picker("Repository", selection: $repositoryID) { ForEach(repositories, id: \.pretty) { Text($0["name"].string ?? "").tag($0["repository_id"].string ?? "") } }
                    .labelsHidden().padding(8).accessibilityIdentifier("explorer-repository")
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red).padding(8) }
            if repositories.isEmpty {
                ContentUnavailableView("Nessun worktree", systemImage: "folder", description: Text("Avvia il lavoro per preparare i repository del task."))
            } else {
                List {
                    ForEach(rows) { row in
                        Button {
                            if row.entry.isDirectory { Task { await toggle(row.path) } } else if row.entry.kind == "file" { open(repositoryID, row.path) }
                        } label: {
                            HStack(spacing: 6) {
                                Color.clear.frame(width: CGFloat(row.depth) * 14, height: 1)
                                Image(systemName: row.entry.isDirectory ? (expanded.contains(row.path) ? "folder.fill" : "folder") : row.entry.kind == "symlink" ? "arrow.turn.up.right" : "doc.text").foregroundStyle(.secondary).frame(width: 16)
                                Text(row.entry.name).lineLimit(1)
                                Spacer(minLength: 0)
                            }.contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("explorer-row:\(row.path)")
                    }
                    if listings[""]?.truncated == true { Text("Elenco troncato a 2.000 voci").font(.caption).foregroundStyle(.secondary) }
                }.listStyle(.plain).accessibilityElement(children: .contain).accessibilityIdentifier("explorer-list")
            }
        }
        .task(id: repositories.map(\.pretty)) { if repositoryID.isEmpty || !repositories.contains(where: { $0["repository_id"].string == repositoryID }) { repositoryID = repositories.first?["repository_id"].string ?? "" } }
        .task(id: repositoryID) { listings = [:]; expanded = []; await load("") }
    }
    private func toggle(_ path: String) async {
        if expanded.contains(path) { expanded.remove(path); return }
        await load(path); expanded.insert(path)
    }
    private func load(_ path: String) async {
        guard !repositoryID.isEmpty else { return }
        do { listings[path] = try await bridge.decode(WorkspaceListing.self, method: "task/files", params: ["taskId": .string(taskID), "repositoryId": .string(repositoryID), "path": .string(path)]); error = nil }
        catch { self.error = error.localizedDescription }
    }
}

struct PreviewTabs: View {
    @Binding var items: [PreviewItem]
    @Binding var selected: String?
    var body: some View {
        if items.isEmpty {
            ContentUnavailableView("Nessuna anteprima", systemImage: "doc.text.magnifyingglass", description: Text("Apri un file dalla scheda File o una modifica dalla scheda Modifiche."))
        } else {
            VStack(spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) {
                        ForEach(items) { item in
                            HStack(spacing: 4) {
                                Button(item.title) { selected = item.id }.buttonStyle(.plain).accessibilityIdentifier("preview-tab:\(item.path)")
                                Button("Chiudi \(item.title)", systemImage: "xmark") { close(item) }.labelStyle(.iconOnly).buttonStyle(.plain).font(.caption2).accessibilityIdentifier("close-preview-tab:\(item.path)")
                            }
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(selected == item.id ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
                        }
                    }.padding(8)
                }
                Divider()
                if let item = items.first(where: { $0.id == selected }) ?? items.first { PreviewContent(item: item).id(item.id) }
            }
        }
    }
    private func close(_ item: PreviewItem) {
        items.removeAll { $0.id == item.id }
        if selected == item.id { selected = items.last?.id }
    }
}

struct PreviewContent: View {
    let item: PreviewItem
    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            VStack(alignment: .leading, spacing: 10) {
                if let error = item.error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
                else if let diff = item.diff { DiffText(diff: diff) }
                else if let file = item.file { FileBody(file: file) }
                else { ProgressView().padding() }
            }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
        }.accessibilityElement(children: .contain).accessibilityIdentifier("preview-content")
    }
}

struct FileBody: View {
    let file: WorkspaceFileContent
    var body: some View {
        if file.truncated { Text("Il file è grande: mostrato solo l’inizio (\(file.bytes) byte in totale)").font(.caption).foregroundStyle(.orange) }
        switch file.kind {
        case "image":
            if let encoded = file.base64, let data = Data(base64Encoded: encoded), let image = NSImage(data: data) { Image(nsImage: image).resizable().scaledToFit().frame(maxWidth: 480).accessibilityLabel("Immagine \(file.path)") }
            else { Text("Immagine non leggibile") }
        case "binary": ContentUnavailableView("File binario", systemImage: "doc", description: Text("\(file.bytes) byte: nessuna anteprima disponibile."))
        default:
            let text = file.text ?? ""
            if file.language == "markdown" { MarkdownView(text: text).accessibilityIdentifier("preview-markdown") }
            else {
                if file.language == "html" { Label("HTML mostrato come sorgente: non viene eseguito", systemImage: "lock.shield").font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("preview-html-inert") }
                Text(text).font(.system(.callout, design: .monospaced)).textSelection(.enabled).fixedSize(horizontal: true, vertical: false).accessibilityIdentifier("preview-code")
            }
        }
    }
}

struct DiffText: View {
    let diff: FileDiffContent
    var body: some View {
        if diff.binary { ContentUnavailableView("File binario", systemImage: "doc", description: Text("Il diff di un binario non è mostrato.")) }
        else if diff.diff.isEmpty { Text("Nessuna differenza rispetto all’ultimo commit").foregroundStyle(.secondary) }
        else {
            if diff.truncated { Text("Diff troncato").font(.caption).foregroundStyle(.orange) }
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(diff.diff.split(separator: "\n", omittingEmptySubsequences: false).enumerated()), id: \.offset) { _, line in
                    Text(String(line)).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                        .foregroundStyle(line.hasPrefix("+") && !line.hasPrefix("+++") ? Color.green : line.hasPrefix("-") && !line.hasPrefix("---") ? Color.red : line.hasPrefix("@@") ? Color.blue : Color.primary)
                }
            }.accessibilityIdentifier("preview-diff")
        }
    }
}
