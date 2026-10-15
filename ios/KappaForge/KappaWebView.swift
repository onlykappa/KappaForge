import SwiftUI
import WebKit
import UniformTypeIdentifiers

struct KappaWebView: UIViewRepresentable {
    private let allowedHost = "onlykappa.github.io"
    private let startURL = URL(string: "https://onlykappa.github.io/KappaForge/")!

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.load(URLRequest(url: startURL, cachePolicy: .reloadIgnoringLocalCacheData))
        return view
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(allowedHost: allowedHost) }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, UIDocumentPickerDelegate {
        let allowedHost: String
        private var fileCompletion: (([URL]?) -> Void)?
        init(allowedHost: String) { self.allowedHost = allowedHost }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if url.scheme == "https", url.host == allowedHost, url.path.hasPrefix("/KappaForge/") {
                decisionHandler(.allow)
            } else if url.scheme == "https", navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.cancel)
            }
        }

        // Native document picker supports multi-file selection from Files and iCloud Drive.
        @available(iOS 18.4, *)
        func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                     initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping ([URL]?) -> Void) {
            guard frame.isMainFrame, fileCompletion == nil else { completionHandler(nil); return }
            fileCompletion = completionHandler
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
            picker.allowsMultipleSelection = parameters.allowsMultipleSelection
            picker.delegate = self
            guard let controller = webView.window?.rootViewController else {
                fileCompletion = nil
                completionHandler(nil)
                return
            }
            controller.present(picker, animated: true)
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            let callback = fileCompletion
            fileCompletion = nil
            callback?(urls)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            let callback = fileCompletion
            fileCompletion = nil
            callback?(nil)
        }
    }
}
