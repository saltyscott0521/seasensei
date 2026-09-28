import SwiftUI

struct SpotDetailView: View {
    let spot: Spot

    @State private var forecast: Forecast?
    @State private var errorMessage: String?
    private let client = OpenMeteoClient()

    var body: some View {
        List {
            if let forecast {
                Section {
                    WindChartView(hours: forecast.hours, spot: spot, timeZone: forecast.timeZone)
                        .frame(height: 220)
                } footer: {
                    Text("HRRR 3 km · solid = wind, dashed = gusts · updated \(forecast.fetchedAt.formatted(date: .omitted, time: .shortened))")
                }
                Section("Rideable (\(Int(spot.minKnots))–\(Int(spot.maxKnots)) kn)") {
                    let windows = forecast.rideableWindows(min: spot.minKnots, max: spot.maxKnots)
                    if windows.isEmpty {
                        Text("Nothing in range in this forecast").foregroundStyle(.secondary)
                    } else {
                        ForEach(windows, id: \.lowerBound) { window in
                            Text(describe(window, in: forecast.timeZone))
                        }
                    }
                }
                ForEach(forecast.days, id: \.start) { day in
                    Section(day.start.formatted(Date.FormatStyle(timeZone: forecast.timeZone)
                        .weekday(.wide).month(.abbreviated).day())) {
                        ForEach(day.hours) { hour in
                            HourRow(hour: hour, spot: spot, timeZone: forecast.timeZone)
                        }
                    }
                }
            } else if let errorMessage {
                ContentUnavailableView("Couldn't load forecast", systemImage: "exclamationmark.triangle",
                                       description: Text(errorMessage))
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .navigationTitle(spot.name)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            forecast = try await client.hrrr(latitude: spot.latitude, longitude: spot.longitude)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func describe(_ window: ClosedRange<Date>, in timeZone: TimeZone) -> String {
        let style = Date.FormatStyle(timeZone: timeZone)
        let start = window.lowerBound.formatted(style.weekday(.abbreviated).hour())
        let end = window.upperBound.addingTimeInterval(3600).formatted(style.hour())
        return "\(start) – \(end)"
    }
}
