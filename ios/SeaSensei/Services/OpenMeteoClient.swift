import Foundation

/// Fetches the HRRR (3 km, hourly-updated NOAA model) point forecast from Open-Meteo.
/// HRRR covers CONUS only and runs out ~48 h; hours past that come back null and are dropped.
struct OpenMeteoClient {
    var session: URLSession = .shared

    func hrrr(latitude: Double, longitude: Double) async throws -> Forecast {
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        components.queryItems = [
            .init(name: "latitude", value: String(latitude)),
            .init(name: "longitude", value: String(longitude)),
            .init(name: "hourly", value: "wind_speed_10m,wind_gusts_10m,wind_direction_10m"),
            .init(name: "models", value: "gfs_hrrr"),
            .init(name: "wind_speed_unit", value: "kn"),
            .init(name: "timeformat", value: "unixtime"),
            .init(name: "timezone", value: "auto"),
            .init(name: "forecast_days", value: "3"),
        ]
        let (data, response) = try await session.data(from: components.url!)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(OpenMeteoResponse.self, from: data).forecast()
    }
}
