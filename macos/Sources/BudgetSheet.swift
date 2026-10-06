import SwiftUI

struct BudgetSheet: View {
    let bridge: RuntimeBridge; let profile: ModelProfile
    @Environment(\.dismiss) private var dismiss
    @State private var pools: [JSONValue] = []
    @State private var selected = ""
    @State private var residual = ""
    @State private var reservation = "4096"
    @State private var reset = Calendar.current.date(byAdding: .month, value: 1, to: Date())!
    @State private var error: String?
    @State private var status: JSONValue = .null
    @State private var adjustment = "renew"
    @State private var assigned = ""
    @State private var reason = ""
    @State private var operationID = UUID().uuidString
    @State private var busy = false
    private var percentLabel: String { let p = status["percent"].number ?? 0; return p > 0 && p < 1 ? "<1%" : "\(Int(p))%" }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Budget personale · \(profile.name)").font(.title2).bold()
            Text("Token riportati dal runtime, copertura solo Lagoto. Questa impostazione non misura la quota del provider e non garantisce un tetto di spesa remoto.").font(.callout).foregroundStyle(.secondary)
            Form {
                Picker("Pool condiviso", selection: $selected) { Text("Nuovo budget").tag(""); ForEach(pools, id: \.pretty) { Text($0["name"].string ?? "").tag($0["id"].string ?? "") } }
                if selected.isEmpty {
                    TextField("Token residui del ciclo", text: $residual)
                    DatePicker("Fine del ciclo", selection: $reset, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                    Text("Riserva iniziale protetta: 10%. Giorni in Europe/Rome.").font(.caption)
                }
                TextField("Prenotazione stimata per turno (token)", text: $reservation)
            }
            if status["configured"].bool == true {
                Text(status["expired"].bool == true ? "Ciclo scaduto: rinnova il saldo personale prima di nuovi turni." : "Budget di oggi: \(percentLabel) · consumati \(Int(status["allowance"]["spent"].number ?? 0)) · impegnati \(Int(status["allowance"]["reserved"].number ?? 0)) token").font(.caption)
                if let estimate = status["calibration"]["estimate"].number { Text("Stima: \(Int(estimate)) token per giorno attivo, mediana di 7 giorni completi in Lagoto.").font(.caption).foregroundStyle(.secondary) }
                else { Text("Calibrazione: \(Int(status["calibration"]["validDays"].number ?? 0))/7 giorni attivi completi. Giorni parziali e consumi incerti esclusi.").font(.caption).foregroundStyle(.secondary) }
                if selected == status["pool"]["id"].string {
                    DisclosureGroup("Rinnovo e deroga") {
                        VStack(alignment: .leading, spacing: 12) {
                            Picker("Operazione", selection: $adjustment) { Text("Nuovo ciclo").tag("renew"); Text("Deroga oggi").tag("override") }.pickerStyle(.segmented)
                            if adjustment == "renew" {
                                TextField("Nuovo saldo personale (token)", text: $residual)
                                DatePicker("Fine del nuovo ciclo", selection: $reset, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                                Text("Riserva 10%. Gli impegni ancora incerti restano trattenuti; nessun rinnovo o acquisto dal provider.").font(.caption)
                            } else {
                                TextField("Assegnazione totale di oggi (token)", text: $assigned)
                                Text("La deroga usa il saldo personale disponibile e conserva la riserva. I consumi già registrati restano invariati.").font(.caption)
                            }
                            TextField("Motivo della modifica", text: $reason)
                            Button(adjustment == "renew" ? "Registra nuovo ciclo" : "Applica deroga a oggi") { Task { await adjust() } }.disabled(busy || reason.trimmingCharacters(in: .whitespaces).isEmpty || Int(adjustment == "renew" ? residual : assigned) == nil)
                        }.textFieldStyle(.roundedBorder).padding(.top, 8)
                    }
                }
                if !status["changes"].array.isEmpty {
                    DisclosureGroup("Modifiche registrate") {
                        ScrollView { VStack(alignment: .leading, spacing: 8) {
                            ForEach(status["changes"].array.indices, id: \.self) { i in
                                let change = status["changes"].array[i]
                                Text("\(change["created_at"].string ?? "") · \(change["kind"].string == "renew" ? "Rinnovo" : "Deroga") · \(change["payload"]["input"]["reason"].string ?? "")").font(.caption)
                            }
                        } }.frame(maxHeight: 100)
                    }
                }
            }
            if let error { Text(error).foregroundStyle(.red) }
            HStack { Button("Chiudi", role: .cancel) { dismiss() }; Spacer(); Button("Salva budget") { Task { await save() } }.disabled(Int(reservation) == nil || (selected.isEmpty && Int(residual) == nil)) }
        }.padding(24).frame(width: 570)
        .task {
            pools = (try? await bridge.call("budget/pools"))?.array ?? []
            status = (try? await bridge.call("budget/status", ["profileId": .string(profile.id)])) ?? .null
            selected = status["pool"]["id"].string ?? ""
            if let value = status["pool"]["reservation"].number { reservation = String(Int(value)) }
        }
    }
    private func adjust() async {
        busy = true; error = nil; defer { busy = false }
        do {
            if adjustment == "renew" {
                _ = try await bridge.call("budget/renew", ["poolId": .string(selected), "id": .string(operationID), "residual": .number(Double(residual) ?? 0), "resetAt": .string(ISO8601DateFormatter().string(from: reset)), "reason": .string(reason)])
            } else {
                _ = try await bridge.call("budget/override", ["profileId": .string(profile.id), "id": .string(operationID), "assigned": .number(Double(assigned) ?? 0), "reason": .string(reason)])
            }
            operationID = UUID().uuidString; reason = ""; residual = ""; assigned = ""
            status = try await bridge.call("budget/status", ["profileId": .string(profile.id)])
        } catch { self.error = error.localizedDescription }
    }
    private func save() async {
        do {
            var pool = selected
            if pool.isEmpty {
                let created = try await bridge.call("budget/create", ["name": .string("\(profile.provider) · budget personale"), "residual": .number(Double(residual) ?? 0), "resetAt": .string(ISO8601DateFormatter().string(from: reset))])
                pool = created["id"].string ?? ""; selected = pool
            }
            _ = try await bridge.call("budget/link", ["profileId": .string(profile.id), "poolId": .string(pool), "reservation": .number(Double(reservation) ?? 0)]); dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
