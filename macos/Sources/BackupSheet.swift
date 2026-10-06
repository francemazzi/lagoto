import SwiftUI

struct BackupSheet: View {
    let bridge: RuntimeBridge
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var result: String?
    @State private var restored: URL?
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Backup e ripristino").font(.title2).bold()
            Text("Il backup include conversazioni, database e checkpoint Git. Le credenziali restano nel Portachiavi. Il ripristino crea una nuova cartella, senza sovrascrivere l’archivio aperto.")
            HStack { Button("Crea backup…") { chooseBackup() }; Button("Ripristina in una nuova cartella…") { chooseRestore() } }.disabled(busy || !bridge.ready)
            Button("Apri un archivio esistente…") { chooseArchive() }.disabled(busy)
            if let restored { Button("Apri l’archivio ripristinato") { activate(restored) }.disabled(busy) }
            if busy { ProgressView("Verifico e copio gli artefatti…") }
            if let result { Text(result).font(.callout).textSelection(.enabled) }
            HStack { Spacer(); Button("Chiudi") { dismiss() }.disabled(busy) }
        }.padding(24).frame(width: 580).interactiveDismissDisabled(busy)
    }
    private func destination(_ name: String) -> URL? {
        let panel = NSSavePanel(); panel.title = "Nuova cartella"; panel.nameFieldStringValue = name; panel.canCreateDirectories = true
        return panel.runModal() == .OK ? panel.url : nil
    }
    private func chooseBackup() {
        guard let url = destination("Lagoto-backup-\(Date.now.formatted(.iso8601.year().month().day()))") else { return }
        busy = true
        Task { defer { busy = false }; do { let value = try await bridge.call("backup/create", ["destination": .string(url.path)]); result = "Backup verificato: \(value["destination"].string ?? url.path)" } catch { result = error.localizedDescription } }
    }
    private func chooseRestore() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.title = "Scegli il backup"
        guard panel.runModal() == .OK, let source = panel.url, let target = destination("Lagoto-ripristinato") else { return }
        busy = true
        Task { defer { busy = false }; do { let value = try await bridge.call("backup/restore", ["source": .string(source.path), "destination": .string(target.path)]); restored = target; result = "Ripristinati \(Int(value["tasks"].number ?? 0)) task in \(target.path). I worktree Git sono recuperati; i profili vanno verificati nel nuovo ambiente." } catch { result = error.localizedDescription } }
    }
    private func chooseArchive() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.title = "Apri archivio Lagoto"
        if panel.runModal() == .OK, let url = panel.url { activate(url) }
    }
    private func activate(_ url: URL) {
        busy = true
        Task { defer { busy = false }; do { try await bridge.openArchive(url); dismiss() } catch { result = error.localizedDescription } }
    }
}
