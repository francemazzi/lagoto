import SwiftUI

struct ContentView: View {
    @Bindable var bridge: RuntimeBridge
    @State private var projects: [Project] = []
    @State private var archived: [Project] = []
    @State private var renaming: Project?
    @State private var renamed = ""
    @State private var tasks: [String: [WorkTask]] = [:]
    @State private var selection: String?
    @State private var search = ""
    @State private var newProject = false
    @State private var backup = false
    @State private var name = ""
    @State private var error: String?
    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section("Progetti") {
                    ForEach(projects.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || (tasks[$0.id] ?? []).contains { $0.title.localizedCaseInsensitiveContains(search) || $0.objective.localizedCaseInsensitiveContains(search) } }) { project in
                        DisclosureGroup {
                            ForEach((tasks[project.id] ?? []).filter { search.isEmpty || project.name.localizedCaseInsensitiveContains(search) || $0.title.localizedCaseInsensitiveContains(search) || $0.objective.localizedCaseInsensitiveContains(search) }) { task in Label(task.title, systemImage: "bubble.left").tag("task:\(task.id)") }
                            Button("Nuovo lavoro", systemImage: "plus") { selection = "project:\(project.id)" }.buttonStyle(.plain)
                        } label: { Label(project.name, systemImage: "folder").tag("project:\(project.id)") }
                        .contextMenu {
                            Button("Rinomina…") { renamed = project.name; renaming = project }
                            Button("Sposta in cima") { Task { await moveFirst(project) } }
                            Button("Archivia progetto") { Task { await changeProject("project/archive", ["projectId": .string(project.id)]) } }
                        }
                    }
                }
                Section {
                    Label("Integrazioni", systemImage: "link").tag("integrations")
                    Label("Modelli disponibili", systemImage: "sparkles").tag("models")
                }
            }
            .navigationSplitViewColumnWidth(min: 210, ideal: 244, max: 330)
            .searchable(text: $search, placement: .sidebar, prompt: "Cerca progetti e lavori")
            .toolbar {
                Button("Nuovo progetto", systemImage: "folder.badge.plus") { newProject = true }.keyboardShortcut("n", modifiers: [.command, .shift]).accessibilityIdentifier("new-project")
                Menu("Archivio", systemImage: "ellipsis.circle") {
                    Button("Backup e ripristino…") { backup = true }
                    if !archived.isEmpty {
                        Menu("Ripristina progetto") {
                            ForEach(archived) { project in
                                Button(project.name) {
                                    Task { await changeProject("project/restore", ["projectId": .string(project.id)]) }
                                }
                            }
                        }
                    }
                }
            }
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
        .onChange(of: bridge.ready) { _, ready in if ready { Task { await reload() } } }
        .task { if bridge.ready { await reload() } }
        .sheet(isPresented: $backup) { BackupSheet(bridge: bridge) }
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
    private func reload() async {
        do {
            projects = try await bridge.decode([Project].self, method: "project/list")
            archived = try await bridge.decode([Project].self, method: "project/archived")
            tasks = [:]; selection = nil
            for project in projects { tasks[project.id] = try await bridge.decode([WorkTask].self, method: "task/list", params: ["projectId": .string(project.id)]) }
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
                HStack { Image(systemName: "folder"); VStack(alignment: .leading) { Text(repo.name); Text(repo.path).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }; Spacer(); Button("Dettagli", systemImage: "ellipsis") { selectedRepository = repo }.labelStyle(.iconOnly).accessibilityLabel("Dettagli \(repo.name)") }
            }
            Menu("Aggiungi repository", systemImage: "folder.badge.plus") {
                Button("Cartella esistente…") { addFolder() }
                Button("Clona da URL…") { cloning = true }
            }
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
