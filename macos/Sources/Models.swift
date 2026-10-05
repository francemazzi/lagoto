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
    var pretty: String { guard let data = try? JSONEncoder.pretty.encode(self) else { return "" }; return String(decoding: data, as: UTF8.self) }
}
extension JSONEncoder {
    static var pretty: JSONEncoder { let e = JSONEncoder(); e.outputFormatting = [.prettyPrinted, .sortedKeys]; return e }
}
struct Project: Decodable, Identifiable, Sendable { let id: String; let name: String }
struct WorkTask: Decodable, Identifiable, Sendable { let id: String; let project_id: String; let title: String; let objective: String; let status: String }
struct Repository: Decodable, Identifiable, Sendable { let id: String; let name: String; let path: String; let git_root: String?; let remote: String? }
struct RPCEnvelope: Decodable, Sendable { let id: String?; let result: JSONValue?; let error: RPCError?; let method: String?; let params: JSONValue? }
struct RPCError: Decodable, Error, LocalizedError, Sendable { let code: Int; let message: String; var errorDescription: String? { message } }
