import SwiftUI

struct IntegrationsView: View {
    let bridge: RuntimeBridge
    var modelsOnly = false
    @Environment(EventStore.self) private var events
    @State private var inventory: [JSONValue] = []
    @State private var profiles: [ModelProfile] = []
    @State private var states: [String: ProfileState] = [:]
    @State private var adding = false
    @State private var error: String?
    @State private var budgetProfile: ModelProfile?
    @State private var auth: [String: JSONValue] = [:]
    @State private var logoutProfile: ModelProfile?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(modelsOnly ? "I tuoi modelli" : "Integrazioni").font(.largeTitle).bold()
                Text("Ogni profilo mantiene il proprio modello, account e percorso di accesso.").foregroundStyle(.secondary)
                if !modelsOnly {
                    ForEach(inventory, id: \.pretty) { item in
                        let id = item["id"].string ?? ""
                        VStack(alignment: .leading, spacing: 2) {
                            HStack { Text(id).fontWeight(.medium); Spacer(); Text(item["version"].string ?? "Non installato").foregroundStyle(.secondary) }
                            if let status = auth[id] {
                                Text("Accesso: \(authLabel(status["state"].string)) · fonte: comando di stato del CLI ufficiale").font(.caption).foregroundStyle(status["state"].string == "ok" ? Color.secondary : Color.orange)
                                    .accessibilityIdentifier("auth-status:\(id)")
                            }
                        }
                    }
                    Text("Codex, Claude e Cursor usano il login dei rispettivi CLI ufficiali. Le chiavi API restano nel Portachiavi di questo Mac.").font(.callout).foregroundStyle(.secondary)
                    Divider()
                }
                HStack { Text("Profili").font(.title2); Spacer(); Button("Aggiungi profilo", systemImage: "plus") { adding = true }.accessibilityIdentifier("add-profile") }
                ForEach(profiles) { profile in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            VStack(alignment: .leading) { Text(profile.name).bold(); Text("\(profile.provider) · \(profile.model)").font(.caption).foregroundStyle(.secondary) }
                            Spacer()
                            if let state = states[profile.id] {
                                Label(state.label, systemImage: state.symbol).font(.caption).foregroundStyle(state.tone == "blocked" ? Color.red : state.tone == "warning" ? Color.orange : Color.secondary)
                                    .accessibilityElement(children: .combine).accessibilityLabel(state.label).accessibilityIdentifier("profile-state:\(profile.name)")
                            }
                            Button("Verifica") { Task { await verify(profile) } }.disabled(profile.capabilities["verification"].string == "checking")
                            if profile.capabilities["verification"].string == "checking" {
                                Button("Interrompi") {
                                    Task {
                                        do {
                                            _ = try await bridge.call("profile/cancel", ["profileId": .string(profile.id)])
                                            await reload()
                                        } catch { self.error = error.localizedDescription }
                                    }
                                }
                            }
                            Menu("Opzioni") {
                                Button("Budget personale…") { budgetProfile = profile }
                                Button("Scollega e rimuovi la chiave…", role: .destructive) { logoutProfile = profile }
                            }
                        }
                        if let action = states[profile.id]?.action { Text(action).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("profile-action:\(profile.name)") }
                        if let message = profile.capabilities["proof"]["message"].string { Text(message).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                        if let endpoint = profile.endpoint { Text(endpoint).font(.caption).foregroundStyle(.secondary) }
                    }.padding(16).background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 10))
                }
                Text("Verifica esegue una richiesta reale su file sintetici e può consumare la quota del profilo selezionato. Non cambia modello né account.").font(.caption).foregroundStyle(.secondary)
                if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            }.padding(32).frame(maxWidth: 840, alignment: .leading).frame(maxWidth: .infinity, alignment: .leading)
        }.sheet(isPresented: $adding) { ProfileSheet(bridge: bridge) { adding = false; Task { await reload() } } }
        .sheet(item: $budgetProfile) { profile in BudgetSheet(bridge: bridge, profile: profile) }
        .confirmationDialog("Scollegare questo profilo?", isPresented: Binding(get: { logoutProfile != nil }, set: { if !$0 { logoutProfile = nil } }), presenting: logoutProfile) { profile in
            Button("Scollega \(profile.name)", role: .destructive) { Task { await logout(profile) } }
        } message: { profile in Text("Le run attive di \(profile.name) vengono interrotte, la chiave salvata nel Portachiavi viene eliminata e il profilo torna da verificare. Il login del CLI ufficiale non viene toccato.") }
        .task {
            inventory = (try? await bridge.call("integration/list"))?.array ?? []
            await reload()
            for provider in ["codex", "claude", "cursor"] where inventory.contains(where: { $0["id"].string == provider && $0["version"].string != nil }) {
                auth[provider] = try? await bridge.call("integration/auth-status", ["provider": .string(provider)])
            }
        }
        .task { for await _ in events.updates(.profiles) { if Task.isCancelled { break }; if bridge.ready { await reload() } } }
        .task { for await _ in events.updates(.budget) { if Task.isCancelled { break }; if bridge.ready { await reload() } } }
    }
    private func reload() async {
        do {
            profiles = try await bridge.decode([ModelProfile].self, method: "profile/list")
            states = Dictionary(uniqueKeysWithValues: try await bridge.decode([ProfileState].self, method: "profile/states").map { ($0.profileId, $0) })
        } catch { self.error = error.localizedDescription }
    }
    private func authLabel(_ state: String?) -> String {
        switch state { case "ok": "attivo"; case "absent": "assente"; case "expired": "scaduto"; case "cancelled": "annullato"; default: "non riconosciuto" }
    }
    /// The runtime stops the runs and resets the proof; the key lives in the Keychain, so the app deletes it.
    private func logout(_ profile: ModelProfile) async {
        do {
            _ = try await bridge.call("profile/logout", ["profileId": .string(profile.id)])
            try CredentialStore.remove(profileID: profile.id)
            await reload()
        } catch { self.error = error.localizedDescription }
    }
    private func verify(_ profile: ModelProfile) async {
        do {
            var params: [String: JSONValue] = ["profileId": .string(profile.id)]
            if let secret = try CredentialStore.read(profileID: profile.id) { params["secret"] = .string(secret) }
            _ = try await bridge.call("profile/verify", params); await reload()
        } catch { self.error = error.localizedDescription }
    }
}

struct ProfileSheet: View {
    let bridge: RuntimeBridge
    var saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var provider = "codex"
    @State private var model = ""
    @State private var name = ""
    @State private var endpoint = ""
    @State private var secret = ""
    @State private var catalog: [JSONValue] = []
    @State private var error: String?
    @State private var saving = false
    private var cloud: Bool { ["qwen", "kimi", "openrouter"].contains(provider) }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Nuovo profilo").font(.title2).bold()
            Form {
                Picker("Integrazione", selection: $provider) { ForEach(["codex", "claude", "qwen", "kimi", "ollama", "cursor", "openrouter"], id: \.self) { Text($0).tag($0) } }.accessibilityIdentifier("profile-provider")
                TextField("Nome del profilo", text: $name).accessibilityIdentifier("profile-name")
                TextField("Identificativo del modello", text: $model).accessibilityIdentifier("profile-model")
                if !catalog.isEmpty {
                    Menu("Scegli dal catalogo") { ForEach(catalog, id: \.pretty) { item in Button((item["name"].string ?? item["id"].string ?? "") + (item["source"].string == "declared" ? " · elenco dichiarato" : "")) { model = item["model"].string ?? item["id"].string ?? "" } } }
                }
                if cloud || provider == "ollama" { TextField("Endpoint", text: $endpoint).accessibilityIdentifier("profile-endpoint") }
                if cloud { SecureField("Chiave API", text: $secret).accessibilityIdentifier("profile-secret") }
            }
            if provider == "cursor" { Text("In modalità Agent, Cursor può modificare i worktree autorizzati. I comandi soggetti ad approvazione richiedono una scelta; macOS limita le scritture alle cartelle assegnate.").font(.caption).foregroundStyle(.secondary) }
            if let error { Text(error).foregroundStyle(.red) }
            HStack { Button("Annulla", role: .cancel) { dismiss() }; Spacer(); Button("Salva") { Task { await save() } }.keyboardShortcut(.defaultAction).disabled(saving || name.isEmpty || model.isEmpty || (cloud && secret.isEmpty)).accessibilityIdentifier("save-profile") }
        }.padding(24).frame(width: 510)
        .task(id: provider) {
            catalog = []; model = ""; secret = ""
            endpoint = provider == "ollama" ? "http://127.0.0.1:11434/v1" : provider == "openrouter" ? "https://openrouter.ai/api/v1" : ""
            if ["codex", "ollama", "claude", "cursor"].contains(provider) { catalog = (try? await bridge.call("model/\(provider)"))?.array ?? [] }
        }
    }
    private func save() async {
        saving = true; defer { saving = false }
        do {
            var params: [String: JSONValue] = ["name": .string(name), "provider": .string(provider), "model": .string(model)]
            if cloud || provider == "ollama" { params["endpoint"] = .string(endpoint) }
            let profile = try await bridge.call("profile/create", params)
            if !secret.isEmpty, let id = profile["id"].string { try CredentialStore.save(secret, profileID: id) }
            secret = ""; saved()
        } catch { self.error = error.localizedDescription }
    }
}
