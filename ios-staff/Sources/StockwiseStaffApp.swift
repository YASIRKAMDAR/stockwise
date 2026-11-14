import SwiftUI

@main
struct StockwiseStaffApp: App {
    @StateObject private var state = AppState()
    @Environment(\.scenePhase) private var phase
    private let testing = NSClassFromString("XCTestCase") != nil

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
                .preferredColorScheme(.light)
                .onAppear { if testing { state.booting = false } else { state.boot() } }
        }
        .onChange(of: phase) { p in
            if p == .active && !testing { state.resume() }
        }
    }
}
