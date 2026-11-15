import SwiftUI

@main
struct StockwiseManagerApp: App {
    @StateObject private var state = AppState()
    @Environment(\.scenePhase) private var phase
    private let testing = NSClassFromString("XCTestCase") != nil

    var body: some Scene {
        WindowGroup {
            Group { if state.me == nil { LoginScreen() } else { Shell() } }
                .environmentObject(state)
                .preferredColorScheme(.light)
                .onAppear { if !testing { state.boot() } }
        }
        .onChange(of: phase) { p in if p == .active && !testing && state.me != nil { state.refresh() } }
    }
}
