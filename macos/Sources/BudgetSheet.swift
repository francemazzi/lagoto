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
            if status["configured"].bool == true { Text("Budget di oggi: \(Int(status["percent"].number ?? 0))% · consumati \(Int(status["allowance"]["spent"].number ?? 0)) · impegnati \(Int(status["allowance"]["reserved"].number ?? 0)) token").font(.caption) }
            if let error { Text(error).foregroundStyle(.red) }
            HStack { Button("Chiudi", role: .cancel) { dismiss() }; Spacer(); Button("Salva budget") { Task { await save() } }.disabled(Int(reservation) == nil || (selected.isEmpty && Int(residual) == nil)) }
        }.padding(24).frame(width: 570)
        .task { pools = (try? await bridge.call("budget/pools"))?.array ?? []; status = (try? await bridge.call("budget/status", ["profileId": .string(profile.id)])) ?? .null }
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
