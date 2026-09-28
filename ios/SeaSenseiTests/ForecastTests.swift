import XCTest
@testable import SeaSensei

final class ForecastTests: XCTestCase {
    func testDecodingDropsHoursPastModelHorizon() throws {
        let json = """
        {"timezone": "America/Los_Angeles",
         "hourly": {"time": [1759075200, 1759078800, 1759082400],
                    "wind_speed_10m": [12.4, 18.1, null],
                    "wind_gusts_10m": [16.0, 24.3, null],
                    "wind_direction_10m": [270, 280, null]}}
        """.data(using: .utf8)!
        let forecast = try JSONDecoder().decode(OpenMeteoResponse.self, from: json).forecast()

        XCTAssertEqual(forecast.timeZone.identifier, "America/Los_Angeles")
        XCTAssertEqual(forecast.hours.map(\.speed), [12.4, 18.1])
        XCTAssertEqual(forecast.hours.first?.time, Date(timeIntervalSince1970: 1759075200))
    }

    func testRideableWindowsSplitOnOutOfRangeHours() {
        let start = Date(timeIntervalSince1970: 1759075200)
        let speeds: [Double] = [10, 16, 18, 12, 20, 35]
        let hours = speeds.enumerated().map { i, s in
            HourlyWind(time: start.addingTimeInterval(Double(i) * 3600), speed: s, gust: s + 5, direction: 270)
        }
        let forecast = Forecast(timeZone: .gmt, hours: hours, fetchedAt: start)

        let windows = forecast.rideableWindows(min: 15, max: 30)

        XCTAssertEqual(windows, [hours[1].time...hours[2].time, hours[4].time...hours[4].time])
    }

    func testCompassPoints() {
        XCTAssertEqual(Compass.point(0), "N")
        XCTAssertEqual(Compass.point(350), "N")
        XCTAssertEqual(Compass.point(90), "E")
        XCTAssertEqual(Compass.point(225), "SW")
        XCTAssertEqual(Compass.point(-90), "W")
    }
}

final class ObservationTests: XCTestCase {
    func testDecodesLatestCOOPSWindReading() throws {
        let json = """
        {"metadata": {"id": "8726607", "name": "Old Port Tampa", "lat": "27.8578", "lon": "-82.5528"},
         "data": [{"t": "2026-09-28 22:54", "s": "12.44", "d": "235.00", "dr": "SW", "g": "15.35", "f": "0,0"}]}
        """.data(using: .utf8)!
        let obs = try JSONDecoder().decode(COOPSWindResponse.self, from: json).observation()

        XCTAssertEqual(obs.stationName, "Old Port Tampa")
        XCTAssertEqual(obs.speed, 12.44)
        XCTAssertEqual(obs.gust, 15.35)
        XCTAssertEqual(obs.direction, 235)
        // 2026-09-28 22:54 GMT
        XCTAssertEqual(obs.time, Date(timeIntervalSince1970: 1790636040))
    }

    func testStationErrorBecomesThrownMessage() throws {
        let json = #"{"error": {"message": "No data was found."}}"#.data(using: .utf8)!
        let response = try JSONDecoder().decode(COOPSWindResponse.self, from: json)

        XCTAssertThrowsError(try response.observation()) { error in
            XCTAssertEqual(error.localizedDescription, "No data was found.")
        }
    }

    func testNearestForecastHour() {
        let start = Date(timeIntervalSince1970: 1790632800)  // 22:00 GMT
        let hours = (0..<3).map {
            HourlyWind(time: start.addingTimeInterval(Double($0) * 3600), speed: Double($0), gust: 0, direction: 0)
        }
        let forecast = Forecast(timeZone: .gmt, hours: hours, fetchedAt: start)

        XCTAssertEqual(forecast.hour(nearest: start.addingTimeInterval(54 * 60))?.time, hours[1].time)
    }
}
