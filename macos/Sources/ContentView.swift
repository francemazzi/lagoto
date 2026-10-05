import SwiftUI

struct ContentView: View {
    @Bindable var bridge: RuntimeBridge
    @State private var projects: [Project] = []
    @State private var tasks: [String: [WorkTask]] = [:]
    @State private var selection: String?
    @State private var newProject = false
    @State private var name = ""
    @State private var error: String?
    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section("Progetti") {
                    ForEach(projects) { project in
                        DisclosureGroup {
                            ForEach(tasks[project.id] ?? []) { task in Label(task.title, systemImage: "bubble.left").tag("task:\(task.id)") }
                            Button("Nuovo lavoro", systemImage: "plus") { selection = "project:\(project.id)" }.buttonStyle(.plain)
                        } label: { Label(project.name, systemImage: "folder").tag("project:\(project.id)") }
                    }
                }
                Section {
                    Label("Integrazioni", systemImage: "link").tag("integrations")
                    Label("Modelli disponibili", systemImage: "sparkles").tag("models")
                }
            }
            .navigationSplitViewColumnWidth(min: 210, ideal: 244, max: 330)
            .toolbar { Button("Nuovo progetto", systemImage: "folder.badge.plus") { newProject = true }.accessibilityIdentifier("new-project") }
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 8) {
                    Circle().fill(bridge.ready ? Color.green : Color.orange).frame(width: 6, height: 6)
                    Text(bridge.status).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                    Spacer()
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
                ContentUnavailableView(selection == "integrations" ? "Collega i tuoi strumenti" : "I tuoi modelli", systemImage: selection == "integrations" ? "link" : "sparkles", description: Text("Le integrazioni vengono abilitate dopo la verifica del relativo percorso. Nessun modello è ancora certificato in questa build di sviluppo."))
            } else {
                ContentUnavailableView {
                    Label("Il lavoro resta.", systemImage: "leaf")
                } description: { Text("Organizza repository e conversazioni per progetto.\nInizia aggiungendo il tuo primo progetto.") }
                actions: { Button("Nuovo progetto") { newProject = true }.buttonStyle(.borderedProminent).disabled(!bridge.ready) }
            }
        }
        .onChange(of: bridge.ready) { _, ready in if ready { Task { await reload() } } }
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
            for project in projects { tasks[project.id] = try await bridge.decode([WorkTask].self, method: "task/list", params: ["projectId": .string(project.id)]) }
        } catch { self.error = error.localizedDescription }
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
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text(project.name).font(.largeTitle).bold()
            Text("Un progetto, tutti i suoi repository.").foregroundStyle(.secondary)
            ForEach(repositories) { repo in
                HStack { Image(systemName: "folder"); VStack(alignment: .leading) { Text(repo.name); Text(repo.path).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }; Spacer(); Text(repo.git_root == nil ? "Da inizializzare" : "Git").font(.caption).foregroundStyle(.secondary) }
            }
            Button("Aggiungi cartella", systemImage: "folder.badge.plus") { addFolder() }
            Divider()
            Text("Su cosa lavoriamo?").font(.title2)
            TextField("Descrivi il risultato che vuoi ottenere", text: $objective, axis: .vertical).lineLimit(3...8).textFieldStyle(.roundedBorder)
            Button("Nuovo lavoro", systemImage: "plus.bubble") { Task { await newTask() } }.buttonStyle(.borderedProminent).disabled(objective.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            Spacer()
        }.padding(32).frame(maxWidth: 800, alignment: .leading).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).task { await reload() }
    }
    private func reload() async { do { repositories = try await bridge.decode([Repository].self, method: "repository/list", params: ["projectId": .string(project.id)]) } catch { self.error = error.localizedDescription } }
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

struct TaskView: View {
    let bridge: RuntimeBridge
    let work: WorkTask
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text(work.title).font(.title2).bold()
            Text(work.objective).textSelection(.enabled)
            Spacer()
            Text("Il task è salvato. L’esecuzione sarà disponibile dopo la verifica delle integrazioni.").foregroundStyle(.secondary)
        }.padding(32).frame(maxWidth: 800, alignment: .leading).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
