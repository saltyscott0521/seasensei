import Foundation

/// The latest wind reading from a NOAA CO-OPS station.
struct Observation {
    let stationName: String
    let time: Date
    let speed: Double      // knots
    let gust: Double       // knots
    let direction: Double  // degrees the wind comes FROM
}

/// CO-OPS datagetter response for `product=wind&units=english` (knots).
/// Values arrive as strings, times as "yyyy-MM-dd HH:mm" in the requested zone (GMT).
/// A station with no data answers 200 with an `error` object instead.
struct COOPSWindResponse: Decodable {
    let metadata: Metadata?
    let data: [Row]?
    let error: APIError?

    struct Metadata: Decodable { let name: String }
    struct Row: Decodable { let t, s, d, g: String }
    struct APIError: Decodable { let message: String }

    struct NoData: LocalizedError {
        let errorDescription: String?
    }

    private static let timeFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "GMT")
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return f
    }()

    func observation() throws -> Observation {
        if let error { throw NoData(errorDescription: error.message) }
        guard let row = data?.last,
              let time = Self.timeFormat.date(from: row.t),
              let speed = Double(row.s), let gust = Double(row.g), let direction = Double(row.d)
        else { throw NoData(errorDescription: "Station returned no wind reading") }
        return Observation(stationName: metadata?.name ?? "NOAA station", time: time,
                           speed: speed, gust: gust, direction: direction)
    }
}
