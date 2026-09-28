import SwiftUI

struct SpotDetailView: View {
    let spot: Spot

    @State private var forecast: Forecast?
    @State private var errorMessage: String?
    @State private var observation: Result<Observation, Error>?
    private let client = OpenMeteoClient()
    private let noaa = NOAAClient()

    var body: some View {
        List {
            if spot.stationID != nil {
                Section("Now") { nowRow }
            }
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

    @ViewBuilder
    private var nowRow: some View {
        switch observation {
        case .success(let obs):
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Image(systemName: "arrow.down")
                        .rotationEffect(.degrees(obs.direction))
                    Text("\(Int(obs.speed.rounded())) kn")
                        .font(.title2.bold())
                        .monospacedDigit()
                    Text("g\(Int(obs.gust.rounded())) · \(Compass.point(obs.direction))")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                Text("\(obs.stationName) · \(obs.time.formatted(.relative(presentation: .named)))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let predicted = forecast?.hour(nearest: obs.time) {
                    Text("HRRR for this hour: \(Int(predicted.speed.rounded())) kn \(Compass.point(predicted.direction))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        case .failure(let error):
            Text("Station unavailable: \(error.localizedDescription)").foregroundStyle(.secondary)
        case nil:
            ProgressView()
        }
    }

    private func load() async {
        async let forecastLoad: Void = loadForecast()
        async let observationLoad: Void = loadObservation()
        _ = await (forecastLoad, observationLoad)
    }

    private func loadObservation() async {
        guard let station = spot.stationID else { return }
        do {
            observation = .success(try await noaa.latestWind(station: station))
        } catch {
            observation = .failure(error)
        }
    }

    private func loadForecast() async {
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
