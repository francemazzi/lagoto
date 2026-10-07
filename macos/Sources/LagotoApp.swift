import SwiftUI

@main struct LagotoApp: App {
    @State private var bridge = RuntimeBridge()
    @State private var events = EventStore()
    var body: some Scene {
        WindowGroup {
            ContentView(bridge: bridge)
                .environment(events)
                .frame(minWidth: 900, minHeight: 620)
                .task { bridge.onEvent = { events.ingest($0) }; await bridge.start() }
        }
        .defaultSize(width: 1280, height: 800)
        .commands {
            CommandGroup(replacing: .appInfo) { Button("Informazioni su Lagoto") { NSApplication.shared.orderFrontStandardAboutPanel() } }
        }
    }
}
