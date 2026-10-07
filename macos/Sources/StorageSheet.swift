import SwiftUI

/// Disk use by category and a cleanup that is previewed before anything is removed. Worktrees are never a cleanup target.
struct StorageSheet: View {
    let bridge: RuntimeBridge
    @Environment(\.dismiss) private var dismiss
    @State private var usage: JSONValue = .null
    @State private var plan: JSONValue?
    @State private var keepCheckpoints = 3
    @State private var keepDays = 30
    @State private var result: String?
    @State private var busy = false
    private func megabytes(_ value: JSONValue) -> String { ByteCountFormatter.string(fromByteCount: Int64(value.number ?? 0), countStyle: .file) }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Spazio e pulizia").font(.title2).bold()
            if usage["database"].number != nil {
                Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 6) {
                    GridRow { Text("Database"); Text(megabytes(usage["database"])).monospacedDigit() }
                    GridRow { Text("Artefatti in uso"); Text(megabytes(usage["blobs"]["referencedBytes"])).monospacedDigit() }
                    GridRow { Text("Artefatti orfani"); Text("\(Int(usage["blobs"]["orphanCount"].number ?? 0)) · \(megabytes(usage["blobs"]["orphanBytes"]))").monospacedDigit() }
                    GridRow { Text("Worktree"); Text("\(usage["worktrees"].array.count) · \(usage["worktrees"].array.filter { $0["dirty"].bool == true }.count) con modifiche") }
                }.accessibilityElement(children: .contain).accessibilityIdentifier("storage-usage")
                Text(usage["note"].string ?? "").font(.caption).foregroundStyle(.secondary)
            }
            Divider()
            Stepper("Checkpoint da conservare per lavoro: \(keepCheckpoints)", value: $keepCheckpoints, in: 1...100)
            Stepper("Conserva ciò che ha meno di \(keepDays) giorni", value: $keepDays, in: 0...3650)
            Button("Mostra cosa verrebbe rimosso") { Task { await preview() } }.disabled(busy).accessibilityIdentifier("cleanup-preview")
            if let plan {
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(plan["prunableCheckpoints"].array.count) checkpoint da rimuovere · \(plan["orphanBlobs"].array.count) artefatti orfani · \(megabytes(plan["reclaimableBytes"])) recuperabili").font(.callout)
                    Text("Protetti: \(plan["protectedCheckpoints"].array.count) checkpoint (ultimo del lavoro, recenti, referenziati da passaggi o consegne). I worktree non vengono mai eliminati.").font(.caption).foregroundStyle(.secondary)
                    Button("Rimuovi quanto elencato", role: .destructive) { Task { await apply(plan) } }.disabled(busy || (plan["prunableCheckpoints"].array.isEmpty && plan["orphanBlobs"].array.isEmpty)).accessibilityIdentifier("cleanup-apply")
                }
            }
            if let result { Text(result).font(.callout).textSelection(.enabled) }
            HStack { Spacer(); Button("Chiudi") { dismiss() }.disabled(busy) }
        }.padding(24).frame(width: 560).task { await load() }
    }
    private func load() async { usage = (try? await bridge.call("storage/usage")) ?? .null }
    private func preview() async {
        busy = true; defer { busy = false }
        do { plan = try await bridge.call("storage/cleanup/preview", ["keepCheckpoints": .number(Double(keepCheckpoints)), "keepDays": .number(Double(keepDays))]); result = nil } catch { result = error.localizedDescription }
    }
    private func apply(_ plan: JSONValue) async {
        busy = true; defer { busy = false }
        do {
            let done = try await bridge.call("storage/cleanup", ["hash": plan["hash"], "keepCheckpoints": .number(Double(keepCheckpoints)), "keepDays": .number(Double(keepDays))])
            result = "Rimossi \(Int(done["prunedCheckpoints"].number ?? 0)) checkpoint e \(Int(done["removedBlobs"].number ?? 0)) artefatti: \(megabytes(done["freedBytes"])) liberati."
            self.plan = nil; await load()
        } catch { result = error.localizedDescription }
    }
}

/// Export of one task: the exact file list and hash are shown first, and what was left out (secrets, raw frames) is named.
struct ExportSheet: View {
    let bridge: RuntimeBridge
    let taskID: String
    @Environment(\.dismiss) private var dismiss
    @State private var preview: JSONValue = .null
    @State private var result: String?
    @State private var busy = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Esporta il lavoro").font(.title2).bold()
            Text("Obiettivo, criteri, decisioni, conversazione e verifiche, in JSON e Markdown. Le credenziali non sono mai incluse e i valori che sembrano segreti sono oscurati.").font(.callout).foregroundStyle(.secondary)
            if preview["hash"].string != nil {
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(preview["files"].array, id: \.pretty) { Text("\($0["name"].string ?? "") · \(Int($0["bytes"].number ?? 0)) byte").font(.caption.monospaced()) }
                        if !preview["excluded"].array.isEmpty {
                            Text("Escluso: \(preview["excluded"].array.compactMap(\.string).joined(separator: ", "))").font(.caption).foregroundStyle(.secondary)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.frame(maxHeight: 200).accessibilityIdentifier("export-files")
            }
            if let result { Text(result).font(.callout).textSelection(.enabled) }
            HStack { Button("Chiudi") { dismiss() }; Spacer(); Button("Esporta in una nuova cartella…") { choose() }.buttonStyle(.borderedProminent).disabled(busy || preview["hash"].string == nil).accessibilityIdentifier("export-choose") }
        }.padding(24).frame(width: 560).task { preview = (try? await bridge.call("task/export/preview", ["taskId": .string(taskID)])) ?? .null }
    }
    private func choose() {
        let panel = NSSavePanel(); panel.title = "Nuova cartella di esportazione"; panel.nameFieldStringValue = "Lagoto-lavoro-\(Date.now.formatted(.iso8601.year().month().day()))"; panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url, let hash = preview["hash"].string else { return }
        busy = true
        Task { defer { busy = false }
            do { let done = try await bridge.call("task/export", ["taskId": .string(taskID), "destination": .string(url.path), "hash": .string(hash)]); result = "Esportati \(Int(done["files"].number ?? 0)) file in \(url.path)" }
            catch { result = error.localizedDescription }
        }
    }
}
