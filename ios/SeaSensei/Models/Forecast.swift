import Foundation

struct HourlyWind: Identifiable, Hashable {
    let time: Date
    let speed: Double      // knots, 10 m
    let gust: Double       // knots
    let direction: Double  // degrees the wind comes FROM

    var id: Date { time }
}

struct Forecast {
    let timeZone: TimeZone
    let hours: [HourlyWind]
    let fetchedAt: Date
}

/// Open-Meteo response with `timeformat=unixtime`. Values are null past the model's horizon.
struct OpenMeteoResponse: Decodable {
    let timezone: String
    let hourly: Hourly

    struct Hourly: Decodable {
        let time: [TimeInterval]
        let speed: [Double?]
        let gust: [Double?]
        let direction: [Double?]

        enum CodingKeys: String, CodingKey {
            case time
            case speed = "wind_speed_10m"
            case gust = "wind_gusts_10m"
            case direction = "wind_direction_10m"
        }
    }

    func forecast(fetchedAt: Date = .now) -> Forecast {
        let h = hourly
        let count = min(h.time.count, h.speed.count, h.gust.count, h.direction.count)
        let hours: [HourlyWind] = (0..<count).compactMap { i in
            guard let s = h.speed[i], let g = h.gust[i], let d = h.direction[i] else { return nil }
            return HourlyWind(time: Date(timeIntervalSince1970: h.time[i]), speed: s, gust: g, direction: d)
        }
        return Forecast(timeZone: TimeZone(identifier: timezone) ?? .current, hours: hours, fetchedAt: fetchedAt)
    }
}

struct ForecastDay {
    let start: Date
    let hours: [HourlyWind]
}

extension Forecast {
    /// Hours grouped by local day at the spot.
    var days: [ForecastDay] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let groups = Dictionary(grouping: hours) { calendar.startOfDay(for: $0.time) }
        return groups.keys.sorted().map { ForecastDay(start: $0, hours: groups[$0]!) }
    }

    /// Runs of consecutive hours whose sustained wind is inside `min...max`.
    /// Each range spans the start of the first hour to the start of the last.
    func rideableWindows(min: Double, max: Double) -> [ClosedRange<Date>] {
        var windows: [ClosedRange<Date>] = []
        var start: Date?
        var last: Date?
        for hour in hours {
            if (min...max).contains(hour.speed) {
                if start == nil { start = hour.time }
                last = hour.time
            } else if let s = start, let l = last {
                windows.append(s...l)
                start = nil
            }
        }
        if let s = start, let l = last { windows.append(s...l) }
        return windows
    }
}

enum Compass {
    private static let points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                                 "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

    static func point(_ degrees: Double) -> String {
        let normalized = (degrees.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
        return points[Int(normalized / 22.5 + 0.5) % 16]
    }
}

extension Forecast {
    /// The forecast hour closest to `date`, e.g. to compare against a live reading.
    func hour(nearest date: Date) -> HourlyWind? {
        hours.min { abs($0.time.timeIntervalSince(date)) < abs($1.time.timeIntervalSince(date)) }
    }
}
