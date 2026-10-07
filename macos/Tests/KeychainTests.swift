import XCTest
@testable import Lagoto

final class KeychainTests: XCTestCase {
    func testP06_I03_nativeCredentialLifecycleIsScopedToProfile() throws {
        let a = "synthetic-test-\(UUID().uuidString)", b = "synthetic-test-\(UUID().uuidString)"
        defer { try? CredentialStore.remove(profileID: a); try? CredentialStore.remove(profileID: b) }
        try CredentialStore.save("synthetic-A", profileID: a)
        try CredentialStore.save("synthetic-B", profileID: b)
        XCTAssertEqual(try CredentialStore.read(profileID: a), "synthetic-A")
        try CredentialStore.save("synthetic-A2", profileID: a)
        XCTAssertEqual(try CredentialStore.read(profileID: a), "synthetic-A2")
        XCTAssertEqual(try CredentialStore.read(profileID: b), "synthetic-B")
        try CredentialStore.remove(profileID: a)
        XCTAssertNil(try CredentialStore.read(profileID: a))
    }
}
