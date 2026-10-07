import XCTest
@testable import Lagoto

final class ContractTests: XCTestCase {
    func testP01_I02_sharedProtocolFixture() throws {
        let file = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "protocol-v1", withExtension: "json"))
        let data = try Data(contentsOf: file)
        let envelopes = try JSONDecoder().decode([RPCEnvelope].self, from: data)
        XCTAssertEqual(envelopes.count, 3)
        XCTAssertEqual(envelopes[0].result?["text"].string, "Caffè 🐕")
        XCTAssertEqual(envelopes[1].error?.code, 409)
        XCTAssertTrue(envelopes[2].params?["payload"]["text"].string?.contains("```swift") == true)
    }
    func testP01_I02_roundTripPreservesNestedProviderBlocks() throws {
        let json = #"{"id":"request-1","jsonrpc":"2.0","result":{"text":"ciao 🐕","blocks":[{"type":"tool","done":false,"usage":null}],"sequence":3}}"#.data(using: .utf8)!
        let envelope = try JSONDecoder().decode(RPCEnvelope.self, from: json)
        XCTAssertEqual(envelope.result?["text"].string, "ciao 🐕")
        let original = try XCTUnwrap(envelope.result)
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(original)), original)
    }
    func testP01_I02_errorIsNotAnEmptySuccess() throws {
        let data = #"{"jsonrpc":"2.0","id":"a","error":{"code":409,"message":"Writer attivo"}}"#.data(using: .utf8)!
        let result = try JSONDecoder().decode(RPCEnvelope.self, from: data)
        XCTAssertNil(result.result)
        XCTAssertEqual(result.error?.code, 409)
    }
}
