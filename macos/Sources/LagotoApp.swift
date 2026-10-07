import SwiftUI

@main struct LagotoApp: App {
    @State private var bridge = RuntimeBridge()
    @State private var events = EventStore()
    var body: some Scene {
        WindowGroup {
            Group {
                #if DEBUG
                if UserDefaults.standard.bool(forKey: "LagotoShowcase") { ShowcaseView() } else { ContentView(bridge: bridge) }
                #else
                ContentView(bridge: bridge)
                #endif
            }
            .environment(events)
            .frame(minWidth: 900, minHeight: 620)
            .task {
                bridge.onEvent = { events.ingest($0) }
                #if DEBUG
                // `-LagotoWindowSize 1280x800` lets layout tests check fixed window sizes.
                if let size = UserDefaults.standard.string(forKey: "LagotoWindowSize")?.split(separator: "x").compactMap({ Double($0) }), size.count == 2 {
                    try? await Task.sleep(for: .milliseconds(300))
                    NSApp.windows.first?.setContentSize(NSSize(width: size[0], height: size[1]))
                }
                #endif
                await bridge.start()
            }
        }
        .defaultSize(width: 1280, height: 800)
        .commands {
            CommandGroup(replacing: .appInfo) { Button("Informazioni su Lagoto") { NSApplication.shared.orderFrontStandardAboutPanel() } }
        }
    }
}
