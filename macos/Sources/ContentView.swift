import SwiftUI

/// Sidebar row of a task: the title and, when it matters, a badge with a text alternative.
struct TaskRowLabel: View {
    let task: WorkTask
    var body: some View {
        Label {
            HStack(spacing: 6) {
                Text(task.title).lineLimit(1).accessibilityIdentifier("task-row:\(task.title)"); Spacer(minLength: 0)
                if task.isWaiting { Image(systemName: "hand.raised.fill").foregroundStyle(.orange).accessibilityLabel("In attesa di una tua autorizzazione").accessibilityIdentifier("badge-waiting") }
                else if task.isActive { ProgressView().controlSize(.mini).accessibilityLabel("In esecuzione").accessibilityIdentifier("badge-active") }
                else if task.isUncertain { Image(systemName: "exclamationmark.arrow.triangle.2.circlepath").foregroundStyle(.secondary).accessibilityLabel("Esecuzione da riconciliare").accessibilityIdentifier("badge-uncertain") }
            }
        } icon: { Image(systemName: "bubble.left") }
    }
}

struct ContentView: View {
    @Bindable var bridge: RuntimeBridge
    @Environment(EventStore.self) private var events
    @State private var projects: [Project] = []
    @State private var archived: [Project] = []
    @State private var renaming: Project?
    @State private var renamed = ""
    @State private var tasks: [String: [WorkTask]] = [:]
    @State private var selection: String?
    @State private var expanded: Set<String> = []
    @FocusState private var searchFocused: Bool
    @State private var hits: [SearchHit] = []
    @State private var search = ""
    @State private var newProject = false
    @State private var backup = false
    @State private var storage = false
    @State private var importMessage: String?
    @State private var name = ""
    @State private var error: String?
    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section("Progetti") {
                    ForEach(projects.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || (tasks[$0.id] ?? []).contains { $0.title.localizedCaseInsensitiveContains(search) || $0.objective.localizedCaseInsensitiveContains(search) } }) { project in
                        DisclosureGroup(isExpanded: Binding(get: { expanded.contains(project.id) }, set: { if $0 { expanded.insert(project.id) } else { expanded.remove(project.id) } })) {
                            ForEach((tasks[project.id] ?? []).filter { search.isEmpty || project.name.localizedCaseInsensitiveContains(search) || $0.title.localizedCaseInsensitiveContains(search) || $0.objective.localizedCaseInsensitiveContains(search) }) { task in TaskRowLabel(task: task).tag("task:\(task.id)") }
                            Button("Nuovo lavoro", systemImage: "plus") { selection = "project:\(project.id)" }.buttonStyle(.plain)
                        } label: { Label(project.name, systemImage: "folder").accessibilityIdentifier("project-row:\(project.name)").tag("project:\(project.id)") }
                        .contextMenu {
                            Button("Rinomina…") { renamed = project.name; renaming = project }
                            Button("Sposta in cima") { Task { await moveFirst(project) } }
                            Button("Archivia progetto") { Task { await changeProject("project/archive", ["projectId": .string(project.id)]) } }
                        }
                    }
                }
                if !hits.isEmpty {
                    Section("Nella cronologia") {
                        ForEach(hits) { hit in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(hit.taskTitle).lineLimit(1)
                                Text("\(hit.kindLabel) · \(hit.snippet)").font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }.accessibilityElement(children: .combine).accessibilityIdentifier("search-hit:\(hit.taskTitle)").tag("task:\(hit.taskId)")
                        }
                    }
                }
                Section {
                    Label("Integrazioni", systemImage: "link").accessibilityIdentifier("nav-integrations").tag("integrations")
                    Label("Modelli disponibili", systemImage: "sparkles").accessibilityIdentifier("nav-models").tag("models")
                }
            }
            .navigationSplitViewColumnWidth(min: 210, ideal: 244, max: 330)
            .searchable(text: $search, placement: .sidebar, prompt: "Cerca progetti e lavori")
            .searchFocused($searchFocused)

            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 8) {
                    Circle().fill(bridge.ready ? Color.green : Color.orange).frame(width: 6, height: 6)
                    Text(bridge.status).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                    Spacer()
                    if !bridge.ready { Button("Riconnetti") { Task { await bridge.restart() } }.font(.caption) }
                }.padding(12).accessibilityIdentifier("runtime-status")
            }
        } detail: {
            if let selection, selection.hasPrefix("project:"), let project = projects.first(where: { $0.id == String(selection.dropFirst(8)) }) {
                ProjectView(bridge: bridge, project: project) { task in
                    await reload(); self.selection = "task:\(task.id)"
                }.id(project.id)
            } else if let selection, selection.hasPrefix("task:"), let task = tasks.values.flatMap({ $0 }).first(where: { $0.id == String(selection.dropFirst(5)) }) {
                TaskView(bridge: bridge, work: task).id(task.id)
            } else if selection == "integrations" || selection == "models" {
                IntegrationsView(bridge: bridge, modelsOnly: selection == "models").id(selection)
            } else {
                ContentUnavailableView {
                    Label("Il lavoro resta.", systemImage: "leaf")
                } description: { Text("Organizza repository e conversazioni per progetto.\nInizia aggiungendo il tuo primo progetto.") }
                actions: { Button("Nuovo progetto") { newProject = true }.buttonStyle(.borderedProminent).disabled(!bridge.ready) }
            }
        }
        .background { Button("Spazio e pulizia") { storage = true }.keyboardShortcut("s", modifiers: [.command, .option]).opacity(0).frame(width: 0, height: 0).accessibilityHidden(true) }
        .toolbar {
            ToolbarItem(placement: .principal) { BatteryAverageView(bridge: bridge) }
            ToolbarItemGroup(placement: .primaryAction) {
                Button("Cerca", systemImage: "magnifyingglass") { searchFocused = true }.keyboardShortcut("f", modifiers: .command).help("Cerca progetti e lavori (⌘F)").accessibilityIdentifier("focus-search")
                Button("Nuovo progetto", systemImage: "folder.badge.plus") { newProject = true }.keyboardShortcut("n", modifiers: [.command, .shift]).accessibilityIdentifier("new-project")
                Menu("Archivio", systemImage: "ellipsis.circle") {
                    Button("Backup e ripristino…") { backup = true }
                    Button("Spazio e pulizia…") { storage = true }
                    Menu("Importa un lavoro esportato") {
                        ForEach(projects) { project in Button(project.name) { importTask(into: project) } }
                    }.disabled(projects.isEmpty)
                    if !archived.isEmpty {
                        Menu("Ripristina progetto") {
                            ForEach(archived) { project in
                                Button(project.name) {
                                    Task { await changeProject("project/restore", ["projectId": .string(project.id)]) }
                                }
                            }
                        }
                    }
                }.accessibilityIdentifier("archive-menu")
            }
        }
        // Offline search over the local archive: messages, decisions, criteria and checkpoints, not only titles.
        .task(id: search) {
            let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
            guard needle.count >= 2, bridge.ready else { hits = []; return }
            try? await Task.sleep(for: .milliseconds(250))
            if Task.isCancelled { return }
            hits = (try? await bridge.decode(SearchResult.self, method: "search/query", params: ["query": .string(needle)]))?.hits ?? []
        }
        .onChange(of: bridge.ready) { _, ready in if ready { Task { await reload() } } }
        .task { if bridge.ready { await reload() } }
        .task { for await _ in events.updates(.tasks) { if Task.isCancelled { break }; if bridge.ready { await refreshTasks() } } }
        .sheet(isPresented: $backup) { BackupSheet(bridge: bridge) }
        .sheet(isPresented: $storage) { StorageSheet(bridge: bridge) }
        .alert("Importazione", isPresented: Binding(get: { importMessage != nil }, set: { if !$0 { importMessage = nil } })) { Button("OK") { importMessage = nil } } message: { Text(importMessage ?? "") }
        .sheet(item: $renaming) { project in
            VStack(alignment: .leading, spacing: 20) {
                Text("Rinomina progetto").font(.title2)
                TextField("Nome", text: $renamed).textFieldStyle(.roundedBorder)
                HStack { Button("Annulla") { renaming = nil }; Spacer(); Button("Salva") { Task { await changeProject("project/rename", ["projectId": .string(project.id), "name": .string(renamed)]); renaming = nil } }.keyboardShortcut(.defaultAction).disabled(renamed.trimmingCharacters(in: .whitespaces).isEmpty) }
            }.padding(24).frame(width: 400)
        }
        .sheet(isPresented: $newProject) {
            VStack(alignment: .leading, spacing: 20) {
                Text("Nuovo progetto").font(.title2).bold()
                TextField("Nome del progetto", text: $name).textFieldStyle(.roundedBorder).accessibilityIdentifier("project-name")
                HStack { Button("Annulla", role: .cancel) { newProject = false }; Spacer(); Button("Crea") { Task { await createProject() } }.keyboardShortcut(.defaultAction).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty).accessibilityIdentifier("create-project") }
            }.padding(24).frame(width: 400)
        }
        .alert("Operazione non completata", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK") { error = nil } } message: { Text(error ?? "") }
    }
    private func importTask(into project: Project) {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.title = "Scegli la cartella esportata"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task {
            do { let done = try await bridge.call("task/import", ["projectId": .string(project.id), "source": .string(url.path)]); importMessage = "Importati \(Int(done["criteria"].number ?? 0)) criteri e \(Int(done["decisions"].number ?? 0)) decisioni in un nuovo lavoro."; await reload() }
            catch { importMessage = error.localizedDescription }
        }
    }
    /// Refresh only the task rows (activity and waiting badges); the selection and the project list stay untouched.
    private func refreshTasks() async {
        for project in projects { if let list = try? await bridge.decode([WorkTask].self, method: "task/list", params: ["projectId": .string(project.id)]) { tasks[project.id] = list } }
        events.taskTitles = Dictionary(uniqueKeysWithValues: tasks.values.flatMap { $0 }.map { ($0.id, $0.title) })
    }
    private func reload() async {
        do {
            projects = try await bridge.decode([Project].self, method: "project/list")
            archived = try await bridge.decode([Project].self, method: "project/archived")
            tasks = [:]; selection = nil; expanded = Set(projects.map(\.id))
            for project in projects { tasks[project.id] = try await bridge.decode([WorkTask].self, method: "task/list", params: ["projectId": .string(project.id)]) }
            events.taskTitles = Dictionary(uniqueKeysWithValues: tasks.values.flatMap { $0 }.map { ($0.id, $0.title) })
        } catch { self.error = error.localizedDescription }
    }
    private func changeProject(_ method: String, _ params: [String: JSONValue]) async {
        do { _ = try await bridge.call(method, params); await reload() } catch { self.error = error.localizedDescription }
    }
    private func moveFirst(_ project: Project) async {
        let remaining = projects.filter { $0.id != project.id }.map { JSONValue.string($0.id) }
        let ids: [JSONValue] = [.string(project.id)] + remaining
        await changeProject("project/reorder", ["ids": .array(ids)])
    }
    private func createProject() async {
        do {
            let p = try await bridge.decode(Project.self, method: "project/create", params: ["name": .string(name)])
            name = ""; newProject = false; await reload(); selection = "project:\(p.id)"
        } catch { self.error = error.localizedDescription }
    }
}

struct ProjectView: View {
    let bridge: RuntimeBridge
    let project: Project
    var created: (WorkTask) async -> Void
    @State private var repositories: [Repository] = []
    @State private var objective = ""
    @State private var error: String?
    @State private var cloning = false
    @State private var selectedRepository: Repository?
    @State private var clones: [CloneOperation] = []
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 24) {
            Text(project.name).font(.largeTitle).bold()
            Text("Un progetto, tutti i suoi repository.").foregroundStyle(.secondary)
            ForEach(repositories) { repo in
                HStack { Image(systemName: "folder"); VStack(alignment: .leading) { Text(repo.name); Text(repo.path).font(.caption).foregroundStyle(.secondary).textSelection(.enabled); Text(repo.git_root == nil ? "Cartella senza Git" : "Repository Git").font(.caption2).foregroundStyle(.secondary) }; Spacer(); Button("Dettagli", systemImage: "ellipsis") { selectedRepository = repo }.labelStyle(.iconOnly).accessibilityLabel("Dettagli \(repo.name)").accessibilityIdentifier("repo-details:\(repo.name)") }.accessibilityElement(children: .contain).accessibilityIdentifier("repo-row:\(repo.name)")
            }
            Menu("Aggiungi repository", systemImage: "folder.badge.plus") {
                Button("Cartella esistente…") { addFolder() }
                Button("Clona da URL…") { cloning = true }
            }.accessibilityIdentifier("add-repository-menu")
            ForEach(clones.filter { $0.state != "completed" }) { clone in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(clone.label).bold(); Spacer()
                        if clone.active || clone.state == "unknown" {
                            Button(clone.state == "unknown" ? "Riconcilia" : "Annulla") {
                                Task {
                                    do { _ = try await bridge.call("repository/cancelClone", ["id": .string(clone.id)]); await reload() }
                                    catch { self.error = error.localizedDescription }
                                }
                            }
                        }
                    }
                    Text(clone.destination).font(.caption).textSelection(.enabled)
                    if let error = clone.error { Text(error).foregroundStyle(.red) }
                    DisclosureGroup("Progresso Git") { Text(clone.progress).font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
                }.padding(12).background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
            }
            Divider()
            Text("Su cosa lavoriamo?").font(.title2)
            TextField("Descrivi il risultato che vuoi ottenere", text: $objective, axis: .vertical).lineLimit(3...8).textFieldStyle(.roundedBorder)
            Button("Nuovo lavoro", systemImage: "plus.bubble") { Task { await newTask() } }.buttonStyle(.borderedProminent).disabled(objective.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            Spacer()
        }.padding(32).frame(maxWidth: 800, alignment: .leading).frame(maxWidth: .infinity, alignment: .topLeading) }
        .task { while !Task.isCancelled { await reload(); try? await Task.sleep(for: .seconds(2)) } }
        .sheet(isPresented: $cloning) { CloneSheet(bridge: bridge, project: project) { await reload() } }
        .sheet(item: $selectedRepository, onDismiss: { Task { await reload() } }) { repo in RepositorySheet(bridge: bridge, project: project, repository: repo) }
    }
    private func reload() async { do { repositories = try await bridge.decode([Repository].self, method: "repository/list", params: ["projectId": .string(project.id)]); clones = try await bridge.decode([CloneOperation].self, method: "repository/clones", params: ["projectId": .string(project.id)]) } catch { self.error = error.localizedDescription } }
    private func addFolder() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = false; panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            Task { do { _ = try await bridge.call("repository/add", ["projectId": .string(project.id), "path": .string(url.path)]); await reload() } catch { self.error = error.localizedDescription } }
        }
    }
    private func newTask() async {
        do { let task = try await bridge.decode(WorkTask.self, method: "task/create", params: ["projectId": .string(project.id), "title": .string(String(objective.prefix(100))), "objective": .string(objective)]); await created(task) } catch { self.error = error.localizedDescription }
    }
}
