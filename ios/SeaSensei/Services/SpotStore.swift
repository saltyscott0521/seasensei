import Foundation
import Observation

/// The user's spots, persisted as JSON in UserDefaults.
@Observable
final class SpotStore {
    private static let key = "spots"
    private let defaults: UserDefaults

    var spots: [Spot] {
        didSet { save() }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let data = defaults.data(forKey: Self.key),
           let saved = try? JSONDecoder().decode([Spot].self, from: data) {
            spots = saved
        } else {
            spots = Spot.tampaBay
        }
    }

    func add(_ spot: Spot) { spots.append(spot) }

    func delete(at offsets: IndexSet) { spots.remove(atOffsets: offsets) }

    private func save() {
        if let data = try? JSONEncoder().encode(spots) {
            defaults.set(data, forKey: Self.key)
        }
    }
}
