import UIKit
import WebKit
import Capacitor

private let vinnaNavy = UIColor(red: 10 / 255, green: 18 / 255, blue: 34 / 255, alpha: 1) // #0A1222

/// Root view controller. Holds the Capacitor bridge below the status bar so
/// the site's fixed header (and the sportsbook pane pinned under it) never
/// slides under the notch or Dynamic Island. The bottom edge stays full
/// height: the bottom nav already pads itself with env(safe-area-inset-bottom).
class MainViewController: UIViewController {
    let bridgeController = VinnaBridgeViewController()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = vinnaNavy

        addChild(bridgeController)
        let child: UIView = bridgeController.view
        child.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(child)
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            child.topAnchor.constraint(equalTo: guide.topAnchor),
            child.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            child.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
            child.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        bridgeController.didMove(toParent: self)
    }

    // Status bar style/visibility are set by Capacitor on the bridge controller.
    override var childForStatusBarStyle: UIViewController? { bridgeController }
    override var childForStatusBarHidden: UIViewController? { bridgeController }
    override var childForHomeIndicatorAutoHidden: UIViewController? { bridgeController }
}

/// The Capacitor bridge, plus the app's own native plugins.
class VinnaBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(VinnaAppPlugin())
    }
}

/// The app's own native helpers for the web app (src/lib/native.ts).
@objc(VinnaAppPlugin)
public class VinnaAppPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VinnaAppPlugin"
    public let jsName = "VinnaApp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushAvailable", returnType: CAPPluginReturnPromise),
    ]

    /// APNs needs no bundled config file, so push is always available on iOS.
    @objc func pushAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    /// window.print() does nothing in WKWebView. This prints the page with its
    /// print stylesheet, so a ticket still prints as the receipt alone.

    @objc func print(_ call: CAPPluginCall) {
        let jobName = call.getString("name") ?? "VinnaBet"
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                call.reject("Web view unavailable")
                return
            }
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = jobName

            let controller = UIPrintInteractionController.shared
            controller.printInfo = info
            controller.printFormatter = webView.viewPrintFormatter()

            let done: UIPrintInteractionController.CompletionHandler = { _, completed, error in
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["completed": completed])
                }
            }
            if UIDevice.current.userInterfaceIdiom == .pad {
                let rect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
                _ = controller.present(from: rect, in: webView, animated: true, completionHandler: done)
            } else {
                _ = controller.present(animated: true, completionHandler: done)
            }
        }
    }
}
