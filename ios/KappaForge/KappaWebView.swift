import SwiftUI
import WebKit
import UniformTypeIdentifiers

// KappaForge's interface is packaged with the application.
// It never navigates to the GitHub Pages website.
struct KappaWebView: UIViewRepresentable {
    var showSecurity: () -> Void
    var showUpdates: () -> Void
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(context.coordinator, name: "kappa")
        config.userContentController.addUserScript(Self.credentialScript())
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

    static func credentialScript() -> WKUserScript {
        var boot = "window.KappaNativeVersion = \"\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown")\";"
        if let credentials = CredentialVault.load(), let data = try? JSONSerialization.data(withJSONObject: credentials), let value = String(data: data, encoding: .utf8) {
            boot += "try { const c = \(value); sessionStorage.setItem('kappaforge.backend', c.backend || ''); sessionStorage.setItem('kappaforge.access', c.access || ''); } catch (_) {}"
        }
        return WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(showSecurity: showSecurity, showUpdates: showUpdates) }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, UIDocumentPickerDelegate, WKScriptMessageHandler {
        let showSecurity: () -> Void
        let showUpdates: () -> Void
        init(showSecurity: @escaping () -> Void, showUpdates: @escaping () -> Void) {
            self.showSecurity = showSecurity
            self.showUpdates = showUpdates
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true, let body = message.body as? [String: String] else { return }
            if body["action"] == "security" { showSecurity() }
            if body["action"] == "updates" { showUpdates() }
            if body["action"] == "export", let name = body["name"], let content = body["content"], content.utf8.count < 1_000_000 {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-" + URL(fileURLWithPath: name).lastPathComponent)
                do {
                    try content.write(to: url, atomically: true, encoding: .utf8)
                    let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                    sheet.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: url) }
                    if let webView = message.webView, let controller = presenter(webView) {
                        sheet.popoverPresentationController?.sourceView = webView
                        sheet.popoverPresentationController?.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
                        controller.present(sheet, animated: true)
                    }
                } catch { /* Existing data remains untouched if export cannot be written. */ }
            }
            if body["action"] == "credentials", let backend = body["backend"], let access = body["access"] {
                guard backend.isEmpty || (URL(string: backend)?.scheme == "https" && URL(string: backend)?.host?.hasSuffix(".workers.dev") == true) else { return }
                if CredentialVault.save(["backend": backend, "access": access]) {
                    userContentController.removeAllUserScripts()
                    userContentController.addUserScript(KappaWebView.credentialScript())
                    message.webView?.evaluateJavaScript("try { localStorage.removeItem('kappaforge.backend'); localStorage.removeItem('kappaforge.access'); } catch (_) {}", completionHandler: nil)
                }
            }
        }
        private func presenter(_ view: WKWebView) -> UIViewController? {
            var controller = view.window?.rootViewController
            while let presented = controller?.presentedViewController { controller = presented }
            return controller
        }
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            guard let controller = presenter(webView) else { completionHandler(); return }
            let dialog = UIAlertController(title: "KappaForge", message: message, preferredStyle: .alert)
            dialog.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            controller.present(dialog, animated: true)
        }
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard let controller = presenter(webView) else { completionHandler(false); return }
            let dialog = UIAlertController(title: "KappaForge", message: message, preferredStyle: .alert)
            dialog.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            dialog.addAction(UIAlertAction(title: "Continue", style: .default) { _ in completionHandler(true) })
            controller.present(dialog, animated: true)
        }
        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            guard let controller = presenter(webView) else { completionHandler(nil); return }
            let dialog = UIAlertController(title: "KappaForge", message: prompt, preferredStyle: .alert)
            dialog.addTextField { field in
                field.text = defaultText
                field.isSecureTextEntry = prompt.localizedCaseInsensitiveContains("token") || prompt.localizedCaseInsensitiveContains("passphrase")
                field.autocapitalizationType = .none; field.autocorrectionType = .no
            }
            dialog.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
            dialog.addAction(UIAlertAction(title: "Save", style: .default) { _ in completionHandler(dialog.textFields?.first?.text) })
            controller.present(dialog, animated: true)
        }
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
            guard let controller = presenter(webView) else {
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
