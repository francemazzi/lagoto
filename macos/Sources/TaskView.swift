import SwiftUI

struct TaskView: View {
    let bridge: RuntimeBridge
    let work: WorkTask
    @Environment(EventStore.self) private var events
    @State private var snapshot: TaskSnapshot?
    @State private var profiles: [ModelProfile] = []
    @State private var selected = ""
    @State private var mode = "agent"
    @State private var effort = ""
    @State private var prompt = ""
    @State private var queuedDraft: String?
    @State private var loadedHistory = false
    @State private var busy = false
    @State private var inspector = false
    @State private var delivery = false
    @State private var diff: JSONValue = .null
    @State private var checkpoints: JSONValue = .null
    @State private var verifications: JSONValue = .null
    @State private var testRepository = ""
    @State private var testCommand = ""
    @State private var budget: JSONValue = .null
    @State private var handoff: JSONValue?
    @State private var showHandoff = false
    @State private var error: String?
    @State private var followTail = true
    @FocusState private var composerFocused: Bool
    private var profile: ModelProfile? { profiles.first { $0.id == selected } }
    private var active: RunRecord? { snapshot?.runs.last(where: \.active) }
    private var uncertain: Bool { snapshot?.runs.contains { $0.state == "unknown" } ?? false }
    private var budgetLabel: String {
        if budget["expired"].bool == true { return "Budget da rinnovare" }
        let value = budget["percent"].number ?? 0
        return value > 0 && value < 1 ? "Oggi <1%" : "Oggi \(Int(value))%"
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(work.title).font(.headline).lineLimit(1)
                    Text(active != nil ? "In esecuzione" : uncertain ? "Esecuzione da riconciliare" : "Lavoro salvato sul Mac").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if budget["configured"].bool == true { Text(budgetLabel).font(.caption).foregroundStyle(.secondary).help("Budget personale, quota provider non disponibile") }
                Button("Dettagli del lavoro", systemImage: "sidebar.right") { inspector.toggle(); if inspector { Task { await refreshInspector() } } }.labelStyle(.iconOnly).help("Repository, diff e checkpoint").accessibilityIdentifier("task-inspector")
            }.padding(20)
            Divider()
            if let error { HStack { Text(error).font(.callout).textSelection(.enabled); Spacer(); Button("Chiudi", systemImage: "xmark") { self.error = nil }.labelStyle(.iconOnly) }.padding(12).background(Color.orange.opacity(0.12)) }
            if profiles.filter(\.verified).isEmpty && snapshot?.blocks.isEmpty != false {
                ContentUnavailableView("Verifica un profilo", systemImage: "link", description: Text("Apri Integrazioni dalla sidebar, aggiungi un modello e verifica la sua connessione."))
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 20) {
                            if snapshot?.hasEarlier == true { Button("Carica messaggi precedenti") { Task { await loadEarlier() } } }
                            if snapshot?.blocks.isEmpty != false { Text(work.objective).font(.title3).textSelection(.enabled).padding(.vertical, 24) }
                            ForEach(snapshot?.blocks ?? []) { block in blockView(block).id(block.id) }
                            Color.clear.frame(height: 1).id("tail")
                        }.padding(24).frame(maxWidth: 860).frame(maxWidth: .infinity)
                    }
                    .onChange(of: snapshot?.blocks.last?.last_seq) { _, _ in if followTail { proxy.scrollTo("tail", anchor: .bottom) } }
                    .overlay(alignment: .bottomTrailing) { Button(followTail ? "Lettura libera" : "Segui la risposta") { followTail.toggle(); if followTail { proxy.scrollTo("tail", anchor: .bottom) } }.font(.caption).buttonStyle(.plain).padding(12) }
                }
            }
            Divider()
            composer
        }
        .inspector(isPresented: $inspector) { inspectorView.inspectorColumnWidth(min: 280, ideal: 340, max: 440) }
        .sheet(isPresented: $showHandoff) { handoffSheet }
        .sheet(isPresented: $delivery) { DeliverySheet(bridge: bridge, taskID: work.id) }
        .task {
            await reloadProfiles(); await refresh()
            if selected.isEmpty { selected = snapshot?.runs.last?.profile_id ?? profiles.first(where: \.verified)?.id ?? "" }
            if snapshot?.blocks.isEmpty != false { prompt = work.objective }
            await recoverHandoff()
        }
        // The runtime pushes every change: reload on a signal, at most about six times a second, never on a timer.
        .task(id: work.id) {
            for await _ in events.updates(.task(work.id)) {
                if Task.isCancelled { break }
                if bridge.ready { await refresh() }
                try? await Task.sleep(for: .milliseconds(150))
            }
        }
        .task(id: selected) {
            for await _ in events.updates(.budget) {
                if Task.isCancelled { break }
                if bridge.ready, !selected.isEmpty { budget = (try? await bridge.call("budget/status", ["profileId": .string(selected)])) ?? .null }
            }
        }
        .onChange(of: selected) { _, _ in mode = profile?.modes.first ?? "agent"; effort = ""; Task { budget = (try? await bridge.call("budget/status", ["profileId": .string(selected)])) ?? .null } }
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(snapshot?.queued ?? [], id: \.pretty) { item in
                HStack {
                    Text("In coda: \(item["text"].string ?? "")").font(.caption).lineLimit(2)
                    Spacer()
                    if active == nil { Button(queuedDraft == item["id"].string ? "Nel composer" : "Usa nel prossimo turno") { prompt = item["text"].string ?? ""; queuedDraft = item["id"].string; composerFocused = true }.font(.caption) }
                }
            }
            TextField(active == nil ? "Continua questo lavoro…" : "Scrivi un messaggio da accodare…", text: $prompt, axis: .vertical)
                .lineLimit(2...8).textFieldStyle(.plain).focused($composerFocused).accessibilityIdentifier("composer")
            HStack(spacing: 12) {
                Picker("Modello", selection: $selected) { Text("Scegli un modello").tag(""); ForEach(profiles.filter(\.verified)) { Text($0.name).tag($0.id) } }.labelsHidden().frame(maxWidth: 250).accessibilityIdentifier("model-picker")
                if (profile?.modes.count ?? 0) > 1 { Picker("Modalità", selection: $mode) { ForEach(profile?.modes ?? [], id: \.self) { Text($0 == "plan" ? "Pianifica" : "Agisci").tag($0) } }.labelsHidden().frame(width: 130) }
                if !(profile?.efforts.isEmpty ?? true) {
                    Menu("Parametri") { Picker("Effort", selection: $effort) { Text("Predefinito").tag(""); ForEach(profile?.efforts ?? [], id: \.self) { Text($0).tag($0) } } }
                }
                Spacer()
                if active != nil && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { Button("Accoda") { Task { await enqueue() } }.disabled(busy).help("Sarà disponibile per il prossimo turno") }
                Button(active == nil ? "Invia" : "Interrompi", systemImage: active == nil ? "arrow.up" : "stop.fill") { Task { if let active { await stop(active) } else { await send() } } }
                    .labelStyle(.iconOnly).buttonStyle(.borderedProminent).keyboardShortcut(.return, modifiers: .command)
                    .disabled(busy || !bridge.ready || uncertain || (active == nil && (profile == nil || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)))
                    .accessibilityIdentifier(active == nil ? "send-message" : "stop-run")
            }
        }.padding(20).background(.background)
    }
    @ViewBuilder private func blockView(_ block: TranscriptBlock) -> some View {
        switch block.kind {
        case "user": VStack(alignment: .leading, spacing: 8) { Text("Tu").font(.caption).foregroundStyle(.secondary); MarkdownView(text: block.text) }.padding(16).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
        case "text": VStack(alignment: .leading, spacing: 8) { Text(snapshot?.runs.first { $0.id == block.run_id }?.profile_name ?? "Modello").font(.caption).foregroundStyle(.secondary); MarkdownView(text: block.text) }
        case "reasoning": DisclosureGroup("Riepilogo esposto dal modello") { MarkdownView(text: block.text) }.font(.callout)
        case "tool": DisclosureGroup(block.text) { Text(block.detail.pretty).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }.font(.callout).foregroundStyle(.secondary)
        case "permission":
            VStack(alignment: .leading, spacing: 10) {
                Text(block.text).font(.headline)
                DisclosureGroup("Dettagli dell’operazione") { Text(block.detail["input"].pretty).font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
                if block.detail["answered"].bool != true && active?.id == block.run_id {
                    HStack { Button("Consenti una volta") { Task { await permission(block, allow: true) } }; Button("Rifiuta") { Task { await permission(block, allow: false) } } }
                } else { Text(block.detail["allow"].bool == true ? "Consentita" : "Rifiutata o scaduta").font(.caption).foregroundStyle(.secondary) }
            }.padding(14).background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        case "error": Label(block.text.isEmpty ? block.detail.pretty : block.text, systemImage: "exclamationmark.triangle").foregroundStyle(.red).textSelection(.enabled)
        case "run_state":
            let state = block.detail["state"].string ?? ""
            if ["finished", "failed", "interrupted", "unknown"].contains(state) {
                Text(state == "finished" ? "Turno concluso · lavoro da verificare" : state == "interrupted" ? "Esecuzione interrotta" : block.detail["message"].string ?? "Esecuzione da verificare").font(.caption).foregroundStyle(.secondary)
            }
        case "checkpoint": Label("Checkpoint salvato", systemImage: "checkmark.circle").font(.caption).foregroundStyle(.secondary)
        default: EmptyView()
        }
    }
    private var inspectorView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Il lavoro").font(.title2).bold()
                Text(work.objective).textSelection(.enabled)
                if uncertain { Button("Riconcilia processi dopo il riavvio") { Task { await reconcileRuns() } }.disabled(busy) }
                DisclosureGroup("Criteri e decisioni") { TaskMemoryView(bridge: bridge, taskID: work.id) }
                DisclosureGroup("Repository") { ForEach(snapshot?.repositories ?? [], id: \.pretty) { Text($0["name"].string ?? "").font(.headline); Text($0["path"].string ?? "").font(.caption).textSelection(.enabled) } }
                DisclosureGroup("Modifiche") { ForEach(diff.array, id: \.pretty) { Text($0["status"].string ?? "").font(.caption); Text($0["diff"].string ?? "").font(.system(.caption, design: .monospaced)).textSelection(.enabled) } }
                DisclosureGroup("Checkpoint") {
                    ForEach(checkpoints.array, id: \.pretty) { Text($0["created_at"].string ?? "").font(.caption) }
                    Button("Salva checkpoint") { Task { await checkpoint() } }.disabled(active != nil || uncertain || busy)
                }
                DisclosureGroup("Verifiche") {
                    Picker("Repository", selection: $testRepository) { Text("Scegli").tag(""); ForEach(snapshot?.repositories ?? [], id: \.pretty) { Text($0["name"].string ?? "").tag($0["repository_id"].string ?? "") } }
                    TextField("Comando, per esempio pnpm test", text: $testCommand)
                    Button("Esegui verifica") { Task { await startVerification() } }.disabled(testCommand.isEmpty || testRepository.isEmpty || active != nil || uncertain || busy)
                    ForEach(verifications.array, id: \.pretty) { item in
                        DisclosureGroup("\(item["repositoryName"].string ?? "") · \(item["state"].string ?? "") · \(item["command"]["command"].string ?? "")") { Text(item["output"].string ?? "").font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
                        if item["state"].string == "unknown" { Button("Riconcilia questa verifica") { Task { do { _ = try await bridge.call("verification/reconcile", ["id": item["id"]]); await refreshInspector() } catch { self.error = error.localizedDescription } } } }
                    }
                    Button("Aggiorna verifiche") { Task { await refreshInspector() } }
                    if verifications.array.contains(where: { $0["state"].string == "running" }) { Button("Interrompi verifica") { Task { _ = try? await bridge.call("verification/stop", ["taskId": .string(work.id)]); await refreshInspector() } } }
                }
                Button("Revisiona e consegna…") { delivery = true }.disabled(active != nil || uncertain || busy)
                Text("La fine di una risposta non certifica il completamento del lavoro.").font(.caption).foregroundStyle(.secondary)
            }.padding(20)
        }
    }
    private var handoffSheet: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Continua con \(profile?.name ?? "il modello selezionato")").font(.title2).bold()
            Text("Il task e i worktree restano gli stessi. Il modello riceverà obiettivo, decisioni, conversazione recente e checkpoint.")
            if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            if prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { TextField("Come vuoi continuare?", text: $prompt, axis: .vertical).lineLimit(2...5) }
            DisclosureGroup("Anteprima del contesto") { ScrollView { Text(handoff?["context"].string ?? "").font(.system(.caption, design: .monospaced)).textSelection(.enabled) }.frame(maxHeight: 260) }
            HStack { Button("Annulla", role: .cancel) { Task { do { if let id = handoff?["id"].string { _ = try await bridge.call("handoff/cancel", ["id": .string(id)]) }; showHandoff = false; self.handoff = nil } catch { self.error = error.localizedDescription } } }; Spacer(); Button("Continua questo lavoro") { Task { await confirmHandoff() } }.buttonStyle(.borderedProminent).disabled(busy || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
        }.padding(24).frame(width: 620).interactiveDismissDisabled()
    }
    private func refresh() async {
        do {
            let current = try await bridge.decode(TaskSnapshot.self, method: "task/snapshot", params: ["taskId": .string(work.id)])
            if loadedHistory, let old = snapshot, let first = current.blocks.first {
                snapshot = TaskSnapshot(blocks: old.blocks.filter { $0.first_seq < first.first_seq } + current.blocks, runs: current.runs, repositories: current.repositories, queued: current.queued, hasEarlier: old.hasEarlier, cursor: old.cursor)
            } else { snapshot = current }
            if !selected.isEmpty { budget = try await bridge.call("budget/status", ["profileId": .string(selected)]) }
        } catch { self.error = error.localizedDescription }
    }
    private func recoverHandoff() async {
        do {
            let rows = try await bridge.call("handoff/list", ["taskId": .string(work.id)])
            if let pending = rows.array.first(where: { ["preview", "starting", "stopping", "checkpoint", "unknown"].contains($0["state"].string ?? "") }) {
                selected = pending["profile_id"].string ?? selected
                handoff = try await bridge.call("handoff/prepare", ["taskId": .string(work.id), "profileId": pending["profile_id"], "id": pending["id"]])
                if handoff?["state"].string == "started" { handoff = nil; await refresh() } else { showHandoff = true }
            }
        } catch { self.error = error.localizedDescription }
    }
    private func reloadProfiles() async { profiles = (try? await bridge.decode([ModelProfile].self, method: "profile/list")) ?? [] }
    private func loadEarlier() async {
        guard let old = snapshot else { return }; loadedHistory = true
        do { let earlier = try await bridge.decode(TaskSnapshot.self, method: "task/snapshot", params: ["taskId": .string(work.id), "before": .number(Double(old.cursor))]); snapshot = TaskSnapshot(blocks: earlier.blocks + old.blocks, runs: old.runs, repositories: old.repositories, queued: old.queued, hasEarlier: earlier.hasEarlier, cursor: earlier.cursor); followTail = false } catch { self.error = error.localizedDescription }
    }
    private func refreshInspector() async {
        do { diff = try await bridge.call("task/diff", ["taskId": .string(work.id)]); checkpoints = try await bridge.call("checkpoint/list", ["taskId": .string(work.id)]); verifications = try await bridge.call("verification/list", ["taskId": .string(work.id)]) } catch { self.error = error.localizedDescription }
    }
    private func send() async {
        guard let profile else { return }; busy = true; defer { busy = false }
        do {
            if snapshot?.repositories.isEmpty != false {
                let repos = try await bridge.decode([Repository].self, method: "repository/list", params: ["projectId": .string(work.project_id)])
                guard !repos.isEmpty else { throw RPCError(code: 400, message: "Aggiungi almeno un repository Git al progetto prima di iniziare") }
                _ = try await bridge.call("task/prepare", ["taskId": .string(work.id), "repositoryIds": .array(repos.map { .string($0.id) })])
            }
            if let last = snapshot?.runs.last, last.profile_id != profile.id {
                handoff = try await bridge.call("handoff/prepare", ["taskId": .string(work.id), "profileId": .string(profile.id), "id": .string(UUID().uuidString)])
                showHandoff = true; return
            }
            var params = try runParameters(profile)
            params["taskId"] = .string(work.id); params["profileId"] = .string(profile.id); params["requestId"] = .string(UUID().uuidString)
            _ = try await bridge.call("run/start", params); prompt = ""; queuedDraft = nil; error = nil; await refresh()
        } catch { self.error = error.localizedDescription }
    }
    private func runParameters(_ profile: ModelProfile) throws -> [String: JSONValue] {
        var result: [String: JSONValue] = ["prompt": .string(prompt), "mode": .string(mode)]
        if let queuedDraft { result["queueId"] = .string(queuedDraft) }
        if !effort.isEmpty { result["effort"] = .string(effort) }
        if let secret = try CredentialStore.read(profileID: profile.id) { result["secret"] = .string(secret) }
        return result
    }
    private func confirmHandoff() async {
        guard let handoff, let profile else { return }; busy = true; defer { busy = false }
        do { var params = try runParameters(profile); params["id"] = handoff["id"]; params["hash"] = handoff["context_hash"]; _ = try await bridge.call("handoff/confirm", params); showHandoff = false; self.handoff = nil; prompt = ""; queuedDraft = nil; error = nil; await refresh() } catch { self.error = error.localizedDescription }
    }
    private func stop(_ run: RunRecord) async { busy = true; defer { busy = false }; do { _ = try await bridge.call("run/stop", ["runId": .string(run.id)]); await refresh() } catch { self.error = error.localizedDescription } }
    private func permission(_ block: TranscriptBlock, allow: Bool) async { do { _ = try await bridge.call("run/permission", ["runId": .string(block.run_id ?? ""), "permissionId": block.detail["id"], "allow": .bool(allow)]); await refresh() } catch { self.error = error.localizedDescription } }
    private func enqueue() async { do { _ = try await bridge.call("task/queue", ["taskId": .string(work.id), "id": .string(UUID().uuidString), "text": .string(prompt)]); prompt = ""; await refresh() } catch { self.error = error.localizedDescription } }
    private func removeQueued(_ item: JSONValue) async { do { _ = try await bridge.call("task/queue/remove", ["taskId": .string(work.id), "id": item["id"]]); await refresh() } catch { self.error = error.localizedDescription } }
    private func checkpoint() async { busy = true; defer { busy = false }; do { _ = try await bridge.call("checkpoint/create", ["taskId": .string(work.id)]); await refreshInspector(); await refresh() } catch { self.error = error.localizedDescription } }
    private func startVerification() async { do { _ = try await bridge.call("verification/start", ["taskId": .string(work.id), "repositoryId": .string(testRepository), "command": .string(testCommand)]); await refreshInspector() } catch { self.error = error.localizedDescription } }
    private func reconcileRuns() async {
        busy = true; defer { busy = false }
        do { for run in snapshot?.runs.filter({ $0.state == "unknown" }) ?? [] { _ = try await bridge.call("run/reconcile", ["runId": .string(run.id)]) }; error = nil; await refresh() } catch { self.error = error.localizedDescription }
    }
}
