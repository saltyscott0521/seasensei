import MapKit
import SwiftUI

struct AddSpotView: View {
    @Environment(SpotStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var coordinate: CLLocationCoordinate2D?
    @State private var minKnots = 15.0
    @State private var maxKnots = 30.0
    @State private var stationID = ""
    @State private var position = MapCameraPosition.region(MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 27.72, longitude: -82.62),
        span: MKCoordinateSpan(latitudeDelta: 0.6, longitudeDelta: 0.6)))

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("e.g. Skyway North", text: $name)
                }
                Section {
                    MapReader { proxy in
                        Map(position: $position) {
                            if let coordinate {
                                Marker(name.isEmpty ? "Spot" : name, coordinate: coordinate)
                            }
                        }
                        .mapStyle(.hybrid)
                        .onTapGesture { point in
                            coordinate = proxy.convert(point, from: .local)
                        }
                    }
                    .frame(height: 300)
                    .listRowInsets(EdgeInsets())
                } header: {
                    Text("Location")
                } footer: {
                    Text(coordinate.map { String(format: "%.4f, %.4f", $0.latitude, $0.longitude) }
                         ?? "Zoom in and tap the water where you ride.")
                }
                Section("Rideable wind") {
                    Stepper("Min \(Int(minKnots)) kn", value: $minKnots, in: 5...maxKnots)
                    Stepper("Max \(Int(maxKnots)) kn", value: $maxKnots, in: minKnots...50)
                }
                Section {
                    TextField("e.g. 8726607", text: $stationID)
                        .keyboardType(.numberPad)
                } header: {
                    Text("NOAA station (optional)")
                } footer: {
                    Text("A Tides & Currents station ID with a wind sensor, shown as live wind next to the forecast.")
                }
            }
            .navigationTitle("New Spot")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || coordinate == nil)
                }
            }
        }
    }

    private func save() {
        guard let coordinate else { return }
        store.add(Spot(name: name.trimmingCharacters(in: .whitespaces),
                       latitude: coordinate.latitude, longitude: coordinate.longitude,
                       minKnots: minKnots, maxKnots: maxKnots,
                       stationID: stationID.isEmpty ? nil : stationID))
        dismiss()
    }
}
