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
