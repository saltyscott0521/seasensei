import Foundation

/// A kite spot plus the wind range you ride it in (knots).
struct Spot: Codable, Identifiable, Hashable {
    var id = UUID()
    var name: String
    var latitude: Double
    var longitude: Double
    var minKnots: Double = 15
    var maxKnots: Double = 30
}
