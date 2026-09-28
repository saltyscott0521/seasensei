import SwiftUI

struct SpotListView: View {
    @Environment(SpotStore.self) private var store
    @State private var showingAdd = false

    var body: some View {
        NavigationStack {
            List {
                ForEach(store.spots) { spot in
                    NavigationLink(value: spot) {
                        VStack(alignment: .leading) {
                            Text(spot.name).font(.headline)
                            Text("\(Int(spot.minKnots))–\(Int(spot.maxKnots)) kn")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .onDelete { store.delete(at: $0) }
            }
            .overlay {
                if store.spots.isEmpty {
                    ContentUnavailableView("No spots yet", systemImage: "wind",
                                           description: Text("Tap + to add your first kite spot."))
                }
            }
            .navigationTitle("SeaSensei")
            .navigationDestination(for: Spot.self) { SpotDetailView(spot: $0) }
            .toolbar {
                Button { showingAdd = true } label: { Image(systemName: "plus") }
            }
            .sheet(isPresented: $showingAdd) {
                AddSpotView().environment(store)
            }
        }
    }
}
