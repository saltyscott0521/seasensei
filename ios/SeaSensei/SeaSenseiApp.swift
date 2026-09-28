import SwiftUI

@main
struct SeaSenseiApp: App {
    @State private var store = SpotStore()

    var body: some Scene {
        WindowGroup {
            SpotListView()
                .environment(store)
        }
    }
}
