import Foundation

enum JSONValue: Codable, Sendable, Equatable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    subscript(_ key: String) -> JSONValue { if case .object(let o) = self { return o[key] ?? .null }; return .null }
    var string: String? { if case .string(let s) = self { return s }; return nil }
    var array: [JSONValue] { if case .array(let a) = self { return a }; return [] }
    var number: Double? { if case .number(let n) = self { return n }; return nil }
    var bool: Bool? { if case .bool(let b) = self { return b }; return nil }
    var pretty: String { guard let data = try? JSONEncoder.pretty.encode(self) else { return "" }; return String(decoding: data, as: UTF8.self) }
}
extension JSONEncoder {
    static var pretty: JSONEncoder { let e = JSONEncoder(); e.outputFormatting = [.prettyPrinted, .sortedKeys]; return e }
}
struct Project: Decodable, Identifiable, Sendable { let id: String; let name: String }
struct WorkTask: Decodable, Identifiable, Sendable {
    let id: String; let project_id: String; let title: String; let objective: String; let status: String
    let waiting: Int?; let active: Int?; let uncertain: Int?
    var isWaiting: Bool { (waiting ?? 0) != 0 }
    var isActive: Bool { (active ?? 0) != 0 }
    /// A run whose process the runtime could not account for after a restart; never shown as running.
    var isUncertain: Bool { (uncertain ?? 0) != 0 }
}
struct Repository: Decodable, Identifiable, Sendable { let id: String; let name: String; let path: String; let git_root: String?; let remote: String? }
struct RepositoryRemote: Decodable, Identifiable { let name: String; let url: String; let github: String?; var id: String { name } }
struct RepositoryDetail: Decodable { let availability: String; let branch: String?; let status: String?; let candidates: [RepositoryRemote]; let error: String? }
struct CloneOperation: Decodable, Identifiable {
    let id: String; let source: String; let destination: String; let state: String; let progress: String; let error: String?
    var active: Bool { ["starting", "running", "stopping"].contains(state) }
    var label: String { switch state { case "completed": "Clonato"; case "cancelled": "Annullato · cartella conservata"; case "failed": "Clonazione fallita"; case "unknown": "Da riconciliare dopo il riavvio"; case "restored": "Operazione storica · percorso da ricollegare"; default: "Clonazione in corso" } }
}
struct RPCEnvelope: Decodable, Sendable { let id: String?; let result: JSONValue?; let error: RPCError?; let method: String?; let params: JSONValue? }
struct RPCError: Decodable, Error, LocalizedError, Sendable { let code: Int; let message: String; var errorDescription: String? { message } }
struct ModelProfile: Decodable, Identifiable, Sendable {
    let id: String; let name: String; let provider: String; let model: String; let endpoint: String?; let capabilities: JSONValue; let enabled: Int?
    var modes: [String] { capabilities["modes"].array.compactMap(\.string) }
    var efforts: [String] { capabilities["efforts"].array.compactMap(\.string) }
    var verified: Bool { capabilities["verification"].string == "passed" && !modes.isEmpty }
}
struct TranscriptBlock: Decodable, Identifiable, Sendable {
    let id: String; let run_id: String?; let kind: String; let text: String; let detail: JSONValue; let first_seq: Int; let last_seq: Int
}
struct RunRecord: Decodable, Identifiable, Sendable {
    let id: String; let profile_id: String; let model: String; let state: String; let profile_name: String; let provider: String
    var active: Bool { ["starting", "running", "waiting_permission", "stopping"].contains(state) }
}
struct TaskSnapshot: Decodable, Sendable {
    let blocks: [TranscriptBlock]; let runs: [RunRecord]; let repositories: [JSONValue]; let queued: [JSONValue]; let hasEarlier: Bool; let cursor: Int
}
struct WorkspaceEntry: Decodable, Identifiable, Sendable { let name: String; let kind: String; let bytes: Int?; var id: String { name }; var isDirectory: Bool { kind == "dir" } }
struct WorkspaceListing: Decodable, Sendable { let path: String; let entries: [WorkspaceEntry]; let truncated: Bool }
struct WorkspaceFileContent: Decodable, Sendable {
    let path: String; let bytes: Int; let kind: String; let language: String?; let mime: String?; let text: String?; let base64: String?; let truncated: Bool
}
struct FileDiffContent: Decodable, Sendable { let path: String; let tracked: Bool; let binary: Bool; let diff: String; let truncated: Bool }
struct ChangedFile: Decodable, Identifiable, Sendable {
    let path: String; let area: String; let status: String; let binary: Bool
    var id: String { "\(area):\(path)" }
    var areaLabel: String { switch area { case "staged": "In staging"; case "unstaged": "Modificato"; default: "Nuovo" } }
}
struct RepositoryChanges: Decodable, Identifiable, Sendable {
    let repository_id: String; let name: String; let files: [ChangedFile]; let test: String; let diffTruncated: Bool
    var id: String { repository_id }
    var testLabel: String { switch test { case "passed": "Test superati"; case "failed": "Test falliti"; case "stale": "Test obsoleti"; case "environment": "Ambiente non pronto"; case "none": "Nessun test"; default: test } }
}

/// One honest label per profile with the action to take, computed by the runtime (`profile/states`).
struct ProfileState: Decodable, Identifiable, Sendable {
    let profileId: String; let key: String; let label: String; let action: String?; let ready: Bool; let percent: Double?; let tone: String
    var id: String { profileId }
    var symbol: String { switch tone { case "ok": "checkmark.circle.fill"; case "info": "clock.fill"; case "warning": "exclamationmark.triangle.fill"; default: "xmark.octagon.fill" } }
}
struct BatteryEntry: Decodable, Identifiable, Sendable { let profileId: String; let name: String; let provider: String; let percent: Double; var id: String { profileId } }
struct BatteryExcluded: Decodable, Identifiable, Sendable {
    let profileId: String; let name: String; let reason: String
    var id: String { profileId }
    var reasonLabel: String { switch reason { case "local": "modello locale"; case "expired": "ciclo da rinnovare"; default: "nessun budget" } }
}
/// Average of today's personal batteries across enabled profiles with a numeric budget (`budget/summary`).
struct BatterySummary: Decodable, Sendable {
    let average: Double?; let count: Int; let lowest: BatteryEntry?; let profiles: [BatteryEntry]; let excluded: [BatteryExcluded]
    var label: String { guard let average else { return "Nessun budget" }; return average > 0 && average < 1 ? "<1%" : "\(Int(average))%" }
}
struct SearchHit: Decodable, Identifiable, Sendable {
    let kind: String; let taskId: String; let taskTitle: String; let ref: String; let snippet: String
    var id: String { "\(kind):\(ref)" }
    var kindLabel: String { switch kind { case "message": "Messaggio"; case "decision": "Decisione"; case "criterion": "Criterio"; case "checkpoint": "Checkpoint"; default: "Lavoro" } }
}
struct SearchResult: Decodable, Sendable { let hits: [SearchHit]; let limited: Bool }
struct ContextMeter: Decodable, Sendable {
    struct Occupancy: Decodable, Sendable { let used: Int?; let window: Int?; let source: String; let fraction: Double?; let compacted: Bool }
    struct Package: Decodable, Sendable { let estimatedTokens: Int }
    struct Checkpoint: Decodable, Sendable { let savedAt: String? }
    let occupancy: Occupancy; let package: Package; let checkpoint: Checkpoint
    /// Occupancy is shown only when the provider reports it per request; the Context Pack size is a separate estimate.
    var label: String { occupancy.fraction.map { "Contesto \(Int($0 * 100))%" } ?? "Contesto non misurato" }
}

/// What the transcript shows, in order: messages, grouped tool calls and one separator where a different run begins.
enum TranscriptRow: Identifiable {
    case block(TranscriptBlock)
    case tools([TranscriptBlock])
    case runStart(id: String, title: String)
    var id: String {
        switch self {
        case .block(let block): block.id
        case .tools(let blocks): "tools:" + (blocks.first?.id ?? "")
        case .runStart(let id, _): "run:" + id
        }
    }
    /// Plans live in the bar above the composer; terminal and file-change cards stay on their own; plain tool calls fold together.
    static func build(blocks: [TranscriptBlock], runs: [RunRecord]) -> [TranscriptRow] {
        var rows: [TranscriptRow] = [], group: [TranscriptBlock] = [], lastRun: String?
        func flush() { if group.count == 1 { rows.append(.block(group[0])) } else if group.count > 1 { rows.append(.tools(group)) }; group = [] }
        for block in blocks {
            if block.kind == "plan" || block.kind == "queue" { continue }
            if let run = block.run_id, run != lastRun {
                flush()
                // The first run of a task needs no divider; every later run starts with one, before its own prompt.
                if lastRun != nil, let record = runs.first(where: { $0.id == run }) { rows.append(.runStart(id: run, title: "\(record.profile_name) · \(record.model)")) }
                lastRun = run
            }
            let category = block.detail["category"].string
            if block.kind == "tool", category == nil || category == "tool" { group.append(block); continue }
            flush(); rows.append(.block(block))
        }
        flush(); return rows
    }
}
