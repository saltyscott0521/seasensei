import Foundation

/// A kite spot plus the wind range you ride it in (knots), and optionally the
/// NOAA CO-OPS station whose live wind to show beside the forecast.
struct Spot: Codable, Identifiable, Hashable {
    var id = UUID()
    var name: String
    var latitude: Double
    var longitude: Double
    var minKnots: Double = 15
    var maxKnots: Double = 30
    var stationID: String? = nil
}

extension Spot {
    /// Seeded on first launch. Coordinates are approximate launch areas.
    static let tampaBay: [Spot] = [
        Spot(name: "Fort De Soto", latitude: 27.640, longitude: -82.739),
        Spot(name: "Skyway", latitude: 27.628, longitude: -82.660),
        Spot(name: "Picnic Island", latitude: 27.853, longitude: -82.552, stationID: "8726607"),
    ]
}
