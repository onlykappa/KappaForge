import CoreLocation
import WebKit

// One precise location reading for one question that needs it (weather with no city, "where am I", "near me"). iOS
// shows its permission prompt the first time. There is no background or continuous tracking: each request is a single
// requestLocation(), and the coordinates go back to the web view, never to disk. With Precise Location off, iOS gives
// an approximate reading and the reply says so.
final class LocationRequester: NSObject, CLLocationManagerDelegate {
    private weak var webView: WKWebView?
    private var manager: CLLocationManager?

    func request(in webView: WKWebView) {
        self.webView = webView
        let manager = CLLocationManager()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        self.manager = manager
        // The delegate hears the current status as soon as the manager exists and carries on from there.
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard manager === self.manager else { return }
        switch manager.authorizationStatus {
        case .notDetermined: return
        case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
        default: finish(["type": "error", "code": "denied"])
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard manager === self.manager else { return }
        guard let place = locations.last else { return finish(["type": "error", "code": "unavailable"]) }
        finish(["type": "location", "latitude": place.coordinate.latitude, "longitude": place.coordinate.longitude,
                "accuracy": place.horizontalAccuracy, "reduced": manager.accuracyAuthorization == .reducedAccuracy])
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard manager === self.manager else { return }
        let denied = (error as? CLError)?.code == .denied
        finish(["type": "error", "code": denied ? "denied" : "unavailable"])
    }

    private func finish(_ event: [String: Any]) {
        manager?.delegate = nil
        manager = nil
        guard let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.KappaLocationNative?.(\(json));", completionHandler: nil)
    }
}
