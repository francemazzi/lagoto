import Foundation
import Observation

@MainActor @Observable final class RuntimeBridge {
    private(set) var ready = false
    private(set) var status = "Avvio del runtime…"
    private(set) var eventRevision = 0
    private var child: Process?
    private var input: FileHandle?
    private var buffer = Data()
    private var pending: [String: CheckedContinuation<JSONValue, Error>] = [:]
    private var generation = UUID()
    var onEvent: ((JSONValue) -> Void)?

    func start() async {
        guard child == nil else { return }
        do {
            let resources = Bundle.main.resourceURL!
            let runtime = resources.appendingPathComponent("runtime")
            let process = Process()
            let currentGeneration = UUID(); generation = currentGeneration
            process.executableURL = runtime.appendingPathComponent("node")
            process.arguments = [runtime.appendingPathComponent("dist/runtime/server.js").path]
            process.currentDirectoryURL = runtime
            var environment: [String: String] = ["HOME": NSHomeDirectory(), "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8"]
            if let archive = UserDefaults.standard.string(forKey: "archivePath") {
                guard FileManager.default.fileExists(atPath: URL(fileURLWithPath: archive).appendingPathComponent("lagoto.sqlite").path) else { throw RPCError(code: 404, message: "Archivio non disponibile. Ricollega il volume oppure scegli un archivio da Backup e ripristino.") }
                environment["LAGOTO_DATA_DIR"] = archive
            }
            #if DEBUG
            if let path = ProcessInfo.processInfo.environment["LAGOTO_TEST_DATA_DIR"] { environment["LAGOTO_DATA_DIR"] = path }
            #endif
            process.environment = environment
            let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
            process.standardInput = stdin; process.standardOutput = stdout; process.standardError = stderr
            input = stdin.fileHandleForWriting
            stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty else { handle.readabilityHandler = nil; return }
                Task { @MainActor [weak self] in self?.receive(data) }
            }
            stderr.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                if data.isEmpty { handle.readabilityHandler = nil }
                // Raw child output is deliberately not copied to application logs.
            }
            process.terminationHandler = { [weak self] process in
                let code = process.terminationStatus
                Task { @MainActor [weak self] in
                    guard let self, self.generation == currentGeneration else { return }
                    self.child = nil; self.input = nil; self.buffer.removeAll()
                    self.disconnected("Runtime terminato (\(code)). Riconnetti per recuperare lo stato.")
                }
            }
            try process.run(); child = process
            let response = try await call("initialize", ["protocolVersion": .number(1)])
            guard response["protocolVersion"].number == 1 else { throw RPCError(code: -1, message: "Versione del runtime incompatibile") }
            ready = true; status = "Archivio locale pronto"
        } catch { stop(); disconnected(error.localizedDescription) }
    }

    func call(_ method: String, _ params: [String: JSONValue] = [:]) async throws -> JSONValue {
        guard let input else { throw RPCError(code: -1, message: "Runtime non disponibile") }
        let id = UUID().uuidString
        let payload: JSONValue = .object(["jsonrpc": .string("2.0"), "id": .string(id), "method": .string(method), "params": .object(params)])
        var data = try JSONEncoder().encode(payload); data.append(10)
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            do { try input.write(contentsOf: data) }
            catch { pending.removeValue(forKey: id)?.resume(throwing: error) }
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(40))
                self?.pending.removeValue(forKey: id)?.resume(throwing: RPCError(code: -2, message: "Richiesta scaduta: l’esito va verificato prima di ripetere l’azione"))
            }
        }
    }
    func decode<T: Decodable>(_ type: T.Type, method: String, params: [String: JSONValue] = [:]) async throws -> T {
        try JSONDecoder().decode(type, from: JSONEncoder().encode(try await call(method, params)))
    }
    private func receive(_ data: Data) {
        buffer.append(data)
        guard buffer.count <= 8 * 1024 * 1024 else { disconnected("Risposta del runtime troppo grande"); stop(); return }
        while let newline = buffer.firstIndex(of: 10) {
            let frame = buffer[..<newline]; buffer.removeSubrange(...newline)
            do {
                let envelope = try JSONDecoder().decode(RPCEnvelope.self, from: frame)
                if let id = envelope.id, let continuation = pending.removeValue(forKey: id) {
                    if let error = envelope.error { continuation.resume(throwing: error) }
                    else { continuation.resume(returning: envelope.result ?? .null) }
                } else if envelope.method == "event", let event = envelope.params { eventRevision += 1; onEvent?(event) }
            } catch { disconnected("Protocollo del runtime non valido"); stop(); return }
        }
    }
    private func disconnected(_ message: String) {
        ready = false; status = message
        for continuation in pending.values { continuation.resume(throwing: RPCError(code: -1, message: message)) }
        pending.removeAll()
    }
    func stop() { try? input?.close(); input = nil }
    func restart() async {
        ready = false; status = "Arresto e riconciliazione…"; stop()
        for _ in 0..<200 { if child?.isRunning != true { break }; try? await Task.sleep(for: .milliseconds(50)) }
        guard child?.isRunning != true else { status = "Arresto ancora in corso. Attendi prima di riconnettere."; return }
        child = nil; buffer.removeAll(); await start()
    }
    func openArchive(_ url: URL) async throws {
        let path = url.resolvingSymlinksInPath().standardizedFileURL
        guard FileManager.default.fileExists(atPath: path.appendingPathComponent("lagoto.sqlite").path) else { throw RPCError(code: 404, message: "La cartella non contiene un archivio Lagoto") }
        ready = false; status = "Chiusura dell’archivio…"; stop()
        for _ in 0..<200 { if child?.isRunning != true { break }; try? await Task.sleep(for: .milliseconds(50)) }
        guard child?.isRunning != true else { throw RPCError(code: 409, message: "Arresto ancora in corso: il cambio archivio non è stato applicato") }
        child = nil; buffer.removeAll(); UserDefaults.standard.set(path.path, forKey: "archivePath")
        await start()
        guard ready else { throw RPCError(code: 409, message: status) }
    }
}
