import SwiftUI

struct IntegrationsView: View {
    let bridge: RuntimeBridge
    var modelsOnly = false
    @State private var inventory: [JSONValue] = []
    @State private var profiles: [ModelProfile] = []
    @State private var adding = false
    @State private var error: String?
    @State private var budgetProfile: ModelProfile?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(modelsOnly ? "I tuoi modelli" : "Integrazioni").font(.largeTitle).bold()
                Text("Ogni profilo mantiene il proprio modello, account e percorso di accesso.").foregroundStyle(.secondary)
                if !modelsOnly {
                    ForEach(inventory, id: \.pretty) { item in
                        HStack { Text(item["id"].string ?? "").fontWeight(.medium); Spacer(); Text(item["version"].string ?? "Non installato").foregroundStyle(.secondary) }
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
                            Text(profile.verified ? "Verificato" : profile.capabilities["verification"].string == "checking" ? "Verifica in corso…" : "Da verificare").font(.caption)
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
                            Menu("Opzioni") { Button("Budget personale…") { budgetProfile = profile } }
                        }
                        if let message = profile.capabilities["proof"]["message"].string { Text(message).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                        if let endpoint = profile.endpoint { Text(endpoint).font(.caption).foregroundStyle(.secondary) }
                    }.padding(16).background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 10))
                }
                Text("Verifica esegue una richiesta reale su file sintetici e può consumare la quota del profilo selezionato. Non cambia modello né account.").font(.caption).foregroundStyle(.secondary)
                if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            }.padding(32).frame(maxWidth: 840, alignment: .leading).frame(maxWidth: .infinity, alignment: .leading)
        }.sheet(isPresented: $adding) { ProfileSheet(bridge: bridge) { adding = false; Task { await reload() } } }
        .sheet(item: $budgetProfile) { profile in BudgetSheet(bridge: bridge, profile: profile) }
        .task { inventory = (try? await bridge.call("integration/list"))?.array ?? []; await reload() }
        .task { while !Task.isCancelled { try? await Task.sleep(for: .seconds(2)); if bridge.ready { await reload() } } }
    }
    private func reload() async { do { profiles = try await bridge.decode([ModelProfile].self, method: "profile/list") } catch { self.error = error.localizedDescription } }
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
                    Menu("Scegli dal catalogo") { ForEach(catalog, id: \.pretty) { item in Button(item["name"].string ?? item["id"].string ?? "") { model = item["model"].string ?? item["id"].string ?? "" } } }
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
            if ["codex", "ollama"].contains(provider) { catalog = (try? await bridge.call("model/\(provider)"))?.array ?? [] }
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
