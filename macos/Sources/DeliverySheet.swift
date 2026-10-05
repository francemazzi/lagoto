import SwiftUI

struct DeliverySheet: View {
    let bridge: RuntimeBridge
    let taskID: String
    @Environment(\.dismiss) private var dismiss
    @State private var repos: JSONValue = .null
    @State private var selected: Set<String> = []
    @State private var remotes: [String: String] = [:]
    @State private var message = ""
    @State private var preview: JSONValue?
    @State private var history: JSONValue = .null
    @State private var error: String?
    @State private var busy = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Revisiona e consegna").font(.title2).bold()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let preview {
                        Text(preview["message"].string ?? "").font(.headline)
                        Text("Stato: \(preview["state"].string ?? "")").font(.caption)
                        ForEach(preview["items"].array, id: \.pretty) { item in
                            VStack(alignment: .leading, spacing: 8) {
                                Text("\(item["name"].string ?? "Repository") · \(item["branch"].string ?? "")").font(.headline)
                                Text(item["remoteURL"].string ?? "Commit solo sul Mac").font(.caption).textSelection(.enabled)
                                Text(item["paths"].array.compactMap(\.string).joined(separator: "\n")).font(.caption)
                                Text("\(item["state"].string ?? "") \(item["commit"].string ?? "")").font(.caption).textSelection(.enabled)
                                if let problem = item["error"].string { Text(problem).foregroundStyle(.red).textSelection(.enabled) }
                                DisclosureGroup("Diff selezionato") { Text(item["diff"].string ?? "").font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
                            }.padding(12).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
                        }
                    } else {
                        TextField("Messaggio del commit", text: $message).textFieldStyle(.roundedBorder)
                        Text("Seleziona i file. Il push viene eseguito solo se scegli un remote.").font(.callout).foregroundStyle(.secondary)
                        ForEach(repos.array, id: \.pretty) { repo in
                            let id = repo["repository_id"].string ?? ""
                            VStack(alignment: .leading, spacing: 8) {
                                Text(repo["name"].string ?? "Repository").font(.headline)
                                Text(repo["path"].string ?? "").font(.caption).textSelection(.enabled)
                                ForEach(repo["paths"].array.compactMap(\.string), id: \.self) { path in
                                    Toggle(path, isOn: Binding(get: { selected.contains(id + ":" + path) }, set: { if $0 { selected.insert(id + ":" + path) } else { selected.remove(id + ":" + path) } })).accessibilityIdentifier("delivery-file:\(id):\(path)")
                                }
                                Picker("Destinazione", selection: Binding(get: { remotes[id] ?? "" }, set: { remotes[id] = $0 })) {
                                    Text("Commit solo sul Mac").tag("")
                                    ForEach(repo["remotes"].array, id: \.pretty) { remote in Text("\(remote["name"].string ?? "") · \(remote["url"].string ?? "")").tag(remote["name"].string ?? "") }
                                }
                            }
                        }
                        if !history.array.isEmpty {
                            DisclosureGroup("Consegne precedenti") {
                                ForEach(history.array, id: \.pretty) { item in Button("\(item["message"].string ?? "") · \(item["state"].string ?? "")") { preview = item } }
                            }
                        }
                    }
                }
            }
            if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            HStack {
                Button("Chiudi") { dismiss() }.disabled(busy)
                Spacer()
                if let preview {
                    if preview["state"].string != "delivered" { Button(preview["state"].string == "preview" ? "Conferma consegna" : "Riprendi consegna") { Task { await confirm() } }.buttonStyle(.borderedProminent).disabled(busy) }
                } else { Button("Rivedi anteprima") { Task { await prepare() } }.buttonStyle(.borderedProminent).disabled(busy || selected.isEmpty || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
            }
        }.padding(24).frame(width: 700, height: 640).interactiveDismissDisabled(busy)
        .task { do { repos = try await bridge.call("task/diff", ["taskId": .string(taskID)]); history = try await bridge.call("delivery/list", ["taskId": .string(taskID)]) } catch { self.error = error.localizedDescription } }
    }
    private func prepare() async {
        busy = true; defer { busy = false }
        let choices = repos.array.compactMap { repo -> JSONValue? in
            let id = repo["repository_id"].string ?? ""
            let paths = repo["paths"].array.filter { selected.contains(id + ":" + ($0.string ?? "")) }
            guard !paths.isEmpty else { return nil }
            var value: [String: JSONValue] = ["repositoryId": .string(id), "paths": .array(paths)]
            if let remote = remotes[id], !remote.isEmpty { value["remote"] = .string(remote) }
            return .object(value)
        }
        do { preview = try await bridge.call("delivery/preview", ["taskId": .string(taskID), "id": .string(UUID().uuidString), "message": .string(message), "selections": .array(choices)]); error = nil } catch { self.error = error.localizedDescription }
    }
    private func confirm() async {
        guard let preview else { return }; busy = true; defer { busy = false }
        do { self.preview = try await bridge.call("delivery/confirm", ["id": preview["id"], "hash": preview["hash"]]); error = nil } catch { self.error = error.localizedDescription }
    }
}
