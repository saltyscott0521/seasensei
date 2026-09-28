import SwiftUI

struct HourRow: View {
    let hour: HourlyWind
    let spot: Spot
    let timeZone: TimeZone

    var body: some View {
        HStack {
            Text(hour.time.formatted(Date.FormatStyle(timeZone: timeZone).hour()))
                .monospacedDigit()
                .frame(width: 56, alignment: .leading)
            // arrow.down rotated by the "from" bearing points where the wind blows to.
            Image(systemName: "arrow.down")
                .rotationEffect(.degrees(hour.direction))
                .foregroundStyle(.secondary)
            Text(Compass.point(hour.direction))
                .frame(width: 40, alignment: .leading)
                .foregroundStyle(.secondary)
            Spacer()
            Text("\(Int(hour.speed.rounded()))")
                .font(.title3.bold())
                .monospacedDigit()
                .foregroundStyle(color)
            Text("g\(Int(hour.gust.rounded())) kn")
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
    }

    private var color: Color {
        if hour.speed < spot.minKnots { return .gray }
        if hour.speed > spot.maxKnots { return .red }
        return .green
    }
}
