import Charts
import SwiftUI

struct WindChartView: View {
    let hours: [HourlyWind]
    let spot: Spot
    let timeZone: TimeZone

    var body: some View {
        Chart {
            RuleMark(y: .value("Min", spot.minKnots))
                .foregroundStyle(.green)
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 4]))
            ForEach(hours) { hour in
                LineMark(x: .value("Time", hour.time), y: .value("Knots", hour.speed),
                         series: .value("Series", "Wind"))
                    .foregroundStyle(.blue)
                    .interpolationMethod(.catmullRom)
                LineMark(x: .value("Time", hour.time), y: .value("Knots", hour.gust),
                         series: .value("Series", "Gust"))
                    .foregroundStyle(.orange)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .interpolationMethod(.catmullRom)
            }
        }
        .chartYAxisLabel("kn")
        .environment(\.timeZone, timeZone)
    }
}
