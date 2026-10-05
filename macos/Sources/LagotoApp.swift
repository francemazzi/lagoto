import SwiftUI

@main struct LagotoApp: App {
    @State private var bridge = RuntimeBridge()
    var body: some Scene {
        WindowGroup {
            ContentView(bridge: bridge)
                .frame(minWidth: 900, minHeight: 620)
                .task { await bridge.start() }
        }
        .defaultSize(width: 1280, height: 800)
        .commands {
            CommandGroup(replacing: .appInfo) { Button("Informazioni su Lagoto") { NSApplication.shared.orderFrontStandardAboutPanel() } }
        }
    }
}
