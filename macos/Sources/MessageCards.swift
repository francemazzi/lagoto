import SwiftUI

/// Everything the transcript can show. Cards read only fields the runtime put in the journal; nothing is executed or rendered as HTML.
struct MessageCard: View {
    let block: TranscriptBlock
    let runs: [RunRecord]
    let activeRunID: String?
    var answer: (TranscriptBlock, _ optionID: String?, _ allow: Bool?) -> Void
    var body: some View {
        switch block.kind {
        case "user":
            VStack(alignment: .leading, spacing: 8) { Text("Tu").font(.caption).foregroundStyle(.secondary); MarkdownView(text: block.text) }
                .padding(16).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12)).accessibilityIdentifier("message-user")
        case "text":
            VStack(alignment: .leading, spacing: 8) { Text(runs.first { $0.id == block.run_id }?.profile_name ?? "Modello").font(.caption).foregroundStyle(.secondary); MarkdownView(text: block.text) }
                .accessibilityIdentifier("message-assistant")
        case "reasoning": DisclosureGroup("Riepilogo esposto dal modello") { MarkdownView(text: block.text) }.font(.callout)
        case "tool": toolCard
        case "permission": PermissionCard(block: block, active: activeRunID == block.run_id, answer: answer)
        case "child": ChildRow(block: block)
        case "error": Label(block.text.isEmpty ? block.detail.pretty : block.text, systemImage: "exclamationmark.triangle").foregroundStyle(.red).textSelection(.enabled).accessibilityIdentifier("message-error")
        case "run_state":
            let state = block.detail["state"].string ?? ""
            if ["finished", "failed", "interrupted", "unknown"].contains(state) {
                Text(state == "finished" ? "Turno concluso · lavoro da verificare" : state == "interrupted" ? "Esecuzione interrotta" : block.detail["message"].string ?? "Esecuzione da verificare").font(.caption).foregroundStyle(.secondary)
            }
        case "checkpoint": Label("Checkpoint salvato", systemImage: "checkmark.circle").font(.caption).foregroundStyle(.secondary)
        default: EmptyView()
        }
    }
    @ViewBuilder private var toolCard: some View {
        switch block.detail["category"].string {
        case "terminal": TerminalCard(detail: block.detail, title: block.text)
        case "file_change": FileChangeCard(detail: block.detail, title: block.text)
        default: ToolLine(block: block)
        }
    }
}

struct ToolLine: View {
    let block: TranscriptBlock
    var body: some View {
        DisclosureGroup(block.text) { Text(block.detail.pretty).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
            .font(.callout).foregroundStyle(.secondary)
    }
}

/// Several plain tool calls in a row fold into one line; one tap opens the list.
struct ToolGroup: View {
    let blocks: [TranscriptBlock]
    var body: some View {
        DisclosureGroup("\(blocks.count) operazioni degli strumenti") {
            VStack(alignment: .leading, spacing: 6) { ForEach(blocks) { ToolLine(block: $0) } }
        }.font(.callout).foregroundStyle(.secondary).accessibilityIdentifier("tool-group")
    }
}

struct RunSeparator: View {
    let title: String
    var body: some View {
        HStack(spacing: 10) { line; Text(title).font(.caption).foregroundStyle(.secondary).lineLimit(1); line }
            .padding(.vertical, 6).accessibilityElement(children: .combine).accessibilityLabel("Nuova esecuzione: \(title)").accessibilityIdentifier("run-separator")
    }
    private var line: some View { Rectangle().fill(.quaternary).frame(height: 1) }
}

struct TerminalCard: View {
    let detail: JSONValue; let title: String
    private var command: String { detail["command"].string ?? detail["rawInput"]["command"].string ?? title }
    private var output: String {
        if let text = detail["aggregatedOutput"].string { return text }
        return detail["content"].array.compactMap { $0["content"]["text"].string ?? $0["text"].string }.joined(separator: "\n")
    }
    private var status: String {
        if let code = detail["exitCode"].number { return code == 0 ? "Concluso" : "Uscita \(Int(code))" }
        switch detail["status"].string { case "completed": return "Concluso"; case "failed": return "Fallito"; case "in_progress", "pending": return "In corso"; default: return "" }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "terminal").foregroundStyle(.secondary)
                Text(command).font(.system(.callout, design: .monospaced)).lineLimit(2).textSelection(.enabled)
                Spacer(minLength: 8)
                if !status.isEmpty { Text(status).font(.caption).foregroundStyle(.secondary) }
            }
            if !output.isEmpty {
                DisclosureGroup("Output") { ScrollView { Text(output).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }.frame(maxHeight: 220) }.font(.caption)
            }
        }.padding(12).background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10)).accessibilityIdentifier("card-terminal")
    }
}

struct FileChangeCard: View {
    let detail: JSONValue; let title: String
    private var paths: [String] {
        let fromChanges = detail["changes"].array.compactMap { $0["path"].string }
        if !fromChanges.isEmpty { return fromChanges }
        let fromLocations = detail["locations"].array.compactMap { $0["path"].string }
        if !fromLocations.isEmpty { return fromLocations }
        return [detail["rawInput"]["path"].string, detail["rawInput"]["file_path"].string].compactMap { $0 }
    }
    private var diffText: String { detail["changes"].array.compactMap { $0["diff"].string }.joined(separator: "\n") }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "doc.badge.gearshape").foregroundStyle(.secondary)
                Text(paths.isEmpty ? title : paths.count == 1 ? paths[0] : "\(paths.count) file modificati").font(.callout).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 8)
            }
            if paths.count > 1 { ForEach(paths, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle) } }
            if !diffText.isEmpty { DisclosureGroup("Differenze") { ScrollView { Text(diffText).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }.frame(maxHeight: 220) }.font(.caption) }
            else if paths.isEmpty { DisclosureGroup("Dettagli") { Text(detail.pretty).font(.system(.caption, design: .monospaced)).textSelection(.enabled) }.font(.caption) }
        }.padding(12).background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10)).accessibilityIdentifier("card-file-change")
    }
}

/// A permission card offers the choices the backend really gave; without them it offers allow once and reject.
struct PermissionCard: View {
    let block: TranscriptBlock; let active: Bool
    var answer: (TranscriptBlock, String?, Bool?) -> Void
    private var choices: [JSONValue] { block.detail["choices"].array }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(block.text).font(.headline)
            DisclosureGroup("Dettagli dell’operazione") { Text(block.detail["input"].pretty).font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
            if block.detail["answered"].bool != true && active {
                HStack {
                    if choices.isEmpty {
                        Button("Consenti una volta") { answer(block, nil, true) }.accessibilityIdentifier("permission-allow")
                        Button("Rifiuta") { answer(block, nil, false) }.accessibilityIdentifier("permission-reject")
                    } else {
                        ForEach(choices.indices, id: \.self) { index in
                            let choice = choices[index]
                            Button(choice["label"].string ?? choice["id"].string ?? "Scegli", role: choice["kind"].string == "reject" ? .destructive : nil) { answer(block, choice["id"].string, nil) }
                                .accessibilityIdentifier("permission-choice:\(choice["id"].string ?? "")")
                        }
                    }
                }
            } else { Text(block.detail["allow"].bool == true ? "Consentita" : "Rifiutata o scaduta").font(.caption).foregroundStyle(.secondary) }
        }.padding(14).background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8)).accessibilityIdentifier("card-permission")
    }
}

/// A sub-agent the provider reported. Lagoto never invents a child: this row exists only because an event announced it.
struct ChildRow: View {
    let block: TranscriptBlock
    private var state: String {
        switch block.detail["state"].string { case "started": "in corso"; case "completed", "finished": "concluso"; case "failed": "fallito"; case "missing": "risultato non ricevuto"; default: block.detail["state"].string ?? "" }
    }
    var body: some View {
        Label { Text("Sotto-agente · \(block.text.isEmpty ? "senza titolo" : block.text) · \(state)").font(.caption).foregroundStyle(.secondary) } icon: { Image(systemName: "arrow.turn.down.right").foregroundStyle(.secondary) }
            .accessibilityIdentifier("child-row")
    }
}

/// The agent's current plan, kept above the composer so it never scrolls away.
struct PlanBar: View {
    let entries: [JSONValue]
    @State private var open = true
    private var done: Int { entries.filter { $0["status"].string == "completed" }.count }
    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(entries.indices, id: \.self) { index in
                    let status = entries[index]["status"].string ?? "pending"
                    Label(entries[index]["text"].string ?? "", systemImage: status == "completed" ? "checkmark.circle.fill" : status == "in_progress" ? "circle.dotted" : "circle")
                        .font(.caption).foregroundStyle(status == "completed" ? .secondary : .primary)
                }
            }.padding(.top, 4)
        } label: { Text("Piano · \(done) di \(entries.count) completati").font(.caption).bold() }
        .padding(10).background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8)).accessibilityIdentifier("plan-bar")
    }
}

/// Context occupancy, Context Pack estimate and last checkpoint stay separate; occupancy is shown only when measured.
struct ContextIndicator: View {
    let meter: ContextMeter?
    @State private var open = false
    var body: some View {
        if let meter {
            Button { open.toggle() } label: {
                Label(meter.label, systemImage: "gauge.with.dots.needle.33percent").font(.caption).foregroundStyle(.secondary)
            }.buttonStyle(.plain).accessibilityIdentifier("context-indicator").help("Occupazione del contesto, pacchetto di contesto e ultimo checkpoint")
            .popover(isPresented: $open) {
                VStack(alignment: .leading, spacing: 8) {
                    if let used = meter.occupancy.used { Text("Nel contesto: \(used) token\(meter.occupancy.window.map { " su \($0)" } ?? "")") }
                    else { Text("Il provider non riporta l’occupazione del contesto per richiesta.") }
                    if meter.occupancy.compacted { Text("Compattazione osservata: il contesto è sceso sensibilmente.").foregroundStyle(.secondary) }
                    Text("Pacchetto di contesto stimato: circa \(meter.package.estimatedTokens) token").foregroundStyle(.secondary)
                    Text(meter.checkpoint.savedAt.map { "Ultimo checkpoint: \($0)" } ?? "Nessun checkpoint salvato").foregroundStyle(.secondary)
                }.font(.callout).padding(14).frame(width: 340, alignment: .leading)
            }
        }
    }
}

/// Messages waiting for the next turn. They can be edited or removed until they are sent.
struct QueuePanel: View {
    let items: [JSONValue]; let running: Bool
    var edit: (_ id: String, _ text: String) -> Void
    var remove: (_ id: String) -> Void
    @State private var editing: String?
    @State private var draft = ""
    var body: some View {
        ForEach(items.indices, id: \.self) { index in
            let item = items[index]; let id = item["id"].string ?? ""
            VStack(alignment: .leading, spacing: 6) {
                if editing == id {
                    TextField("Messaggio in coda", text: $draft, axis: .vertical).lineLimit(1...5).textFieldStyle(.roundedBorder).accessibilityIdentifier("queue-edit-field")
                    HStack {
                        Button("Salva") { edit(id, draft); editing = nil }.disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("queue-save")
                        Button("Annulla") { editing = nil }
                    }.font(.caption)
                } else {
                    HStack(alignment: .firstTextBaseline) {
                        Text("In coda").font(.caption).foregroundStyle(.secondary)
                        Text(item["text"].string ?? "").font(.callout).lineLimit(3)
                        Spacer(minLength: 8)
                        Button("Modifica", systemImage: "pencil") { draft = item["text"].string ?? ""; editing = id }.labelStyle(.iconOnly).buttonStyle(.plain).help("Modifica il messaggio in coda").accessibilityIdentifier("queue-edit")
                        Button("Elimina", systemImage: "trash") { remove(id) }.labelStyle(.iconOnly).buttonStyle(.plain).help("Elimina il messaggio in coda").accessibilityIdentifier("queue-delete")
                    }
                    if running { Text("Parte alla fine del turno, se si conclude senza errori.").font(.caption2).foregroundStyle(.secondary) }
                }
            }.accessibilityIdentifier("queue-item")
        }
    }
}

/// Today's average battery across enabled profiles with a numeric budget, with the lowest profile named.
struct BatteryAverageView: View {
    let bridge: RuntimeBridge
    @Environment(EventStore.self) private var events
    @State private var summary: BatterySummary?
    @State private var open = false
    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 6) {
                Image(systemName: icon(summary?.average))
                Text("Batteria media \(summary?.label ?? "…")").font(.callout.monospacedDigit())
            }
        }
        .accessibilityIdentifier("battery-average").help("Media delle percentuali di oggi dei profili con budget numerico")
        .popover(isPresented: $open) { details }
        .task { await load() }
        .task { for await _ in events.updates(.budget) { if Task.isCancelled { break }; await load() } }
        .onChange(of: bridge.ready) { _, ready in if ready { Task { await load() } } }
    }
    private func icon(_ value: Double?) -> String {
        guard let value else { return "battery.0percent" }
        return value >= 75 ? "battery.100percent" : value >= 50 ? "battery.75percent" : value >= 25 ? "battery.50percent" : value > 0 ? "battery.25percent" : "battery.0percent"
    }
    private var details: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Batteria di oggi").font(.headline)
            if let summary, !summary.profiles.isEmpty {
                ForEach(summary.profiles) { entry in
                    HStack { Text(entry.name); Spacer(); Text("\(Int(entry.percent))%").monospacedDigit() }.font(.callout)
                    ProgressView(value: min(max(entry.percent, 0), 100), total: 100)
                }
                if let lowest = summary.lowest { Text("Il più basso: \(lowest.name), \(Int(lowest.percent))%").font(.caption).foregroundStyle(.secondary) }
            } else { Text("Nessun profilo ha ancora un budget personale. Impostalo da Integrazioni, Opzioni.").font(.callout).foregroundStyle(.secondary) }
            if let excluded = summary?.excluded, !excluded.isEmpty {
                Divider()
                Text("Non nella media").font(.caption).bold()
                ForEach(excluded) { Text("\($0.name): \($0.reasonLabel)").font(.caption).foregroundStyle(.secondary) }
            }
            Text("Percentuali di budget personale, non quota del provider. Unità e pool diversi non vengono sommati.").font(.caption2).foregroundStyle(.secondary)
        }.padding(16).frame(width: 340, alignment: .leading)
    }
    private func load() async {
        guard bridge.ready else { return }
        summary = try? await bridge.decode(BatterySummary.self, method: "budget/summary")
    }
}
