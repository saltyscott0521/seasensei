import Foundation

/// Live wind from NOAA CO-OPS (Tides & Currents) stations. No key required.
struct NOAAClient {
    var session: URLSession = .shared

    func latestWind(station: String) async throws -> Observation {
        var components = URLComponents(string: "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter")!
        components.queryItems = [
            .init(name: "station", value: station),
            .init(name: "product", value: "wind"),
            .init(name: "date", value: "latest"),
            .init(name: "units", value: "english"),
            .init(name: "time_zone", value: "gmt"),
            .init(name: "format", value: "json"),
            .init(name: "application", value: "SeaSensei"),
        ]
        let (data, response) = try await session.data(from: components.url!)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(COOPSWindResponse.self, from: data).observation()
    }
}
