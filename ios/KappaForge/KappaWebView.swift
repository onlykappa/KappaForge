import SwiftUI
import WebKit
import UniformTypeIdentifiers

// KappaForge's interface is packaged with the application.
// It never navigates to the GitHub Pages website.
struct KappaWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = UIColor.systemBackground
        view.scrollView.contentInsetAdjustmentBehavior = .never

        let htmlURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web")
            ?? Bundle.main.url(forResource: "index", withExtension: "html")
        guard let htmlURL else {
            view.loadHTMLString("""
                <html><meta name="viewport" content="width=device-width,initial-scale=1">
                <body style="font:16px -apple-system;padding:24px">
                <h2>KappaForge could not start</h2><p>The bundled interface is missing from this build.</p>
                </body></html>
                """, baseURL: nil)
            return view
        }
        view.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
        return view
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, UIDocumentPickerDelegate {
        private var fileCompletion: (([URL]?) -> Void)?

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if url.isFileURL || url.scheme == "about" {
                decisionHandler(.allow)
            } else if url.scheme == "https", action.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                     withError error: Error) {
            showError(in: webView, error: error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!,
                     withError error: Error) {
            showError(in: webView, error: error)
        }

        private func showError(in view: WKWebView, error: Error) {
            let message = error.localizedDescription
                .replacingOccurrences(of: "&", with: "&amp;")
                .replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;")
            view.loadHTMLString("""
                <html><meta name="viewport" content="width=device-width,initial-scale=1">
                <body style="font:16px -apple-system;padding:24px">
                <h2>KappaForge could not start</h2><p>\(message)</p>
                </body></html>
                """, baseURL: nil)
        }

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
