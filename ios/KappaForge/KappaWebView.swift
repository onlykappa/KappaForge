import SwiftUI
import WebKit
import UniformTypeIdentifiers

// KappaForge's interface is packaged with the application.
// It never navigates to the GitHub Pages website.
// A public UIKit text editor owns chat input. WebKit's private content responder
// and its navigation accessory are never used for the composer.
final class KappaChatWebView: WKWebView, UITextViewDelegate {
    let composerEditor = UITextView()
    weak var composerHost: UIView?
    private var keyboardObservers: [NSObjectProtocol] = []
    private var editorRevision = 0
    private var composerFrame: CGRect?

    func configureComposer() {
        composerEditor.delegate = self
        composerEditor.backgroundColor = .clear
        composerEditor.font = .systemFont(ofSize: 16)
        composerEditor.textColor = .label
        composerEditor.tintColor = UIColor(red: 0.65, green: 0.49, blue: 0.94, alpha: 1)
        composerEditor.textContainerInset = UIEdgeInsets(top: 2, left: 5, bottom: 4, right: 5)
        composerEditor.textContainer.lineFragmentPadding = 0
        composerEditor.accessibilityLabel = "Message"
        composerEditor.accessibilityIdentifier = "native-composer"
        composerEditor.inputAccessoryView = nil
        composerEditor.inputAssistantItem.leadingBarButtonGroups = []
        composerEditor.inputAssistantItem.trailingBarButtonGroups = []
        composerEditor.isHidden = true
        // The text editor belongs to the sibling UIKit overlay, not WKWebView's
        // managed subview tree. WebKit scroll/focus layout must not move it.
        for name in [UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardWillHideNotification] {
            keyboardObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                guard let self else { return }
                let screenFrame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .zero
                let localFrame = self.convert(screenFrame, from: nil)
                let overlap = note.name == UIResponder.keyboardWillHideNotification ? 0 : max(0, self.bounds.maxY - localFrame.minY)
                let keyboardTop = note.name == UIResponder.keyboardWillHideNotification ? "null" : String(Double(localFrame.minY))
                self.evaluateJavaScript("window.KappaNativeKeyboardInset = \(overlap); window.KappaNativeKeyboardTop = \(keyboardTop); window.updateKeyboard?.(); window.syncNativeComposer?.();", completionHandler: nil)
            })
        }
    }
    // WKWebView has no CSS media query for Reduce Transparency; html.rt makes every glass surface solid.
    func observeReduceTransparency() {
        keyboardObservers.append(NotificationCenter.default.addObserver(forName: UIAccessibility.reduceTransparencyStatusDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.evaluateJavaScript(KappaWebView.reduceTransparencySource(), completionHandler: nil)
        })
    }
    deinit { keyboardObservers.forEach { NotificationCenter.default.removeObserver($0) } }

    func updateComposer(_ body: [String: String]) {
        let dark = body["dark"] == "true"
        let systemAppearance = body["appearance"] == "system"
        composerEditor.keyboardAppearance = systemAppearance ? .default : (dark ? .dark : .light)
        window?.rootViewController?.overrideUserInterfaceStyle = systemAppearance ? .unspecified : (dark ? .dark : .light)
        composerEditor.isHidden = body["hidden"] == "true"
        if composerEditor.isHidden { composerEditor.resignFirstResponder(); return }
        guard let raw = body["frame"], let data = raw.data(using: .utf8),
              let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Double],
              let x = frame["x"], let y = frame["y"], let width = frame["width"], let height = frame["height"],
              [x,y,width,height].allSatisfy({ $0.isFinite }), width > 0, height > 0 else { return }
        composerFrame = CGRect(x: x, y: y, width: width, height: height)
        positionComposer()
        if let hex = body["color"]?.replacingOccurrences(of: "#", with: ""), hex.count == 6, let rgb = UInt32(hex, radix: 16) {
            composerEditor.textColor = UIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: 1)
        }
        if let fontSize = Double(body["fontSize"] ?? ""), (12...40).contains(fontSize) {
            composerEditor.font = .systemFont(ofSize: fontSize)
        }
        // Ignore stale JS geometry packets containing text from before a UIKit keystroke.
        if Int(body["revision"] ?? "0") == editorRevision, let text = body["text"], composerEditor.text != text {
            composerEditor.text = text
        }
        composerEditor.accessibilityValue = composerEditor.text.isEmpty ? "Message KappaForge…" : composerEditor.text
    }
    func positionComposer() {
        guard let host = composerHost, let frame = composerFrame else { return }
        composerEditor.frame = convert(frame, to: host)
    }
    func textViewDidChange(_ textView: UITextView) {
        editorRevision += 1
        guard let data = try? JSONSerialization.data(withJSONObject: ["text":textView.text ?? "", "revision":editorRevision]),
              let json = String(data: data, encoding: .utf8) else { return }
        evaluateJavaScript("window.receiveNativeComposer?.(\(json));", completionHandler: nil)
    }
    func textViewDidBeginEditing(_ textView: UITextView) {
        evaluateJavaScript("window.KappaNativeComposerFocused = true; window.updateKeyboard?.();", completionHandler: nil)
    }
    func textViewDidEndEditing(_ textView: UITextView) {
        evaluateJavaScript("window.KappaNativeComposerFocused = false; window.updateKeyboard?.();", completionHandler: nil)
    }
}

// Own the WebKit view and public text editor as siblings. Keeping an independent
// UIKit first responder inside WKWebView lets WebKit's focus/scroll machinery
// treat it as web content and can leave the focused editor offscreen after a
// keyboard or app-lifecycle transition. This host has a single layout owner.
final class KappaChatContainer: UIView {
    let webView: KappaChatWebView

    init(webView: KappaChatWebView) {
        self.webView = webView
        super.init(frame: .zero)
        webView.composerHost = self
        addSubview(webView)
        addSubview(webView.composerEditor)
    }
    required init?(coder: NSCoder) { fatalError("Use init(webView:)") }

    override func layoutSubviews() {
        super.layoutSubviews()
        webView.frame = bounds
        webView.positionComposer()
    }
}

struct KappaWebView: UIViewRepresentable {
    var showSecurity: () -> Void
    var showUpdates: () -> Void
    func makeUIView(context: Context) -> KappaChatContainer {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(context.coordinator, name: "kappa")
        config.userContentController.addUserScript(Self.credentialScript())
        config.userContentController.addUserScript(WKUserScript(source: Self.reduceTransparencySource(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        #if DEBUG && targetEnvironment(simulator)
        if let fixture = ProgressFixture.script() {
            config.userContentController.addUserScript(fixture)
        }
        #endif
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        // Spoken replies start after a network wait, not inside the tap that asked for them.
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let view = KappaChatWebView(frame: .zero, configuration: config)
        view.configureComposer()
        view.observeReduceTransparency()
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = UIColor.systemBackground
        view.scrollView.contentInsetAdjustmentBehavior = .never
        let container = KappaChatContainer(webView: view)

        let htmlURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web")
            ?? Bundle.main.url(forResource: "index", withExtension: "html")
        guard let htmlURL else {
            view.loadHTMLString("""
                <html><meta name="viewport" content="width=device-width,initial-scale=1">
                <body style="font:16px -apple-system;padding:24px">
                <h2>KappaForge could not start</h2><p>The bundled interface is missing from this build.</p>
                </body></html>
                """, baseURL: nil)
            return container
        }
        view.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
        return container
    }

    static func reduceTransparencySource() -> String {
        "document.documentElement.classList.toggle('rt', \(UIAccessibility.isReduceTransparencyEnabled));"
    }

    static func isAppPage(_ url: URL?) -> Bool {
        guard let url, url.isFileURL,
              let bundled = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web")
                ?? Bundle.main.url(forResource: "index", withExtension: "html") else { return false }
        return url.standardizedFileURL.path == bundled.standardizedFileURL.path
    }

    static func credentialScript() -> WKUserScript {
        // Only public device identity crosses this boundary. Never serialize either vault.
        let record = DeviceSessionVault.load()
        let connection = ["id": record?.id ?? "", "backend": record?.backend ?? ""]
        let encoded = (try? JSONSerialization.data(withJSONObject: connection)) ?? Data("{}".utf8)
        let metadata = String(data: encoded, encoding: .utf8) ?? "{}"
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"
        let versionJSON = String(data: (try? JSONSerialization.data(withJSONObject: [version])) ?? Data("[]".utf8), encoding: .utf8) ?? "[]"
        let source = #"""
        (() => {
          window.KappaNativeComposer = true; window.KappaNativeVoice = true;
          window.KappaNativeVersion = (\#(versionJSON))[0];
          const connection = \#(metadata), pending = new Map();
          if (connection.id) {
            try { localStorage.removeItem('kappaforge.access'); sessionStorage.removeItem('kappaforge.access'); } catch (_) {}
          }
          window.KappaNativeSession = Object.freeze({id:connection.id,backend:connection.backend,renew(origin) {
            if (!connection.id || origin !== connection.backend) return Promise.reject(Error('Reconnect this device in AI connection.'));
            if (pending.size >= 8) return Promise.reject(Error('Session renewal is already busy.'));
            const requestId = crypto.randomUUID();
            return new Promise((resolve,reject) => {
              const timer = setTimeout(() => {pending.delete(requestId);reject(Error('Session renewal timed out.'));},12000);
              pending.set(requestId,{resolve,reject,timer});
              try { window.webkit.messageHandlers.kappa.postMessage({action:'session',requestId,origin}); }
              catch (_) { clearTimeout(timer);pending.delete(requestId);reject(Error('Secure session bridge unavailable.')); }
            });
          }});
          window.receiveNativeSession = result => {
            const request = result && pending.get(result.requestId); if (!request) return;
            pending.delete(result.requestId);clearTimeout(request.timer);
            if (result.error) request.reject(Error('Session renewal failed. Open AI connection to reconnect.'));
            else request.resolve({accessToken:result.accessToken,accessExpiresAt:result.accessExpiresAt});
          };
        })();
        """#
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    func updateUIView(_ container: KappaChatContainer, context: Context) {
        // DOM geometry messages keep the native composer aligned with its web controls.
    }
    func makeCoordinator() -> Coordinator { Coordinator(showSecurity: showSecurity, showUpdates: showUpdates) }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, UIDocumentPickerDelegate, WKScriptMessageHandler {
        let showSecurity: () -> Void
        let showUpdates: () -> Void
        let voice = VoiceRecorder()
        let media = MediaPicker()
        let location = LocationRequester()
        // The + sheet tile that opened the next file panel (photos, camera or files), set just before the panel opens.
        private var pendingPicker: (kind: String, at: Date)?
        init(showSecurity: @escaping () -> Void, showUpdates: @escaping () -> Void) {
            self.showSecurity = showSecurity
            self.showUpdates = showUpdates
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, KappaWebView.isAppPage(message.frameInfo.request.url), let body = message.body as? [String: String] else { return }
            if body["action"] == "composer" { (message.webView as? KappaChatWebView)?.updateComposer(body) }
            if body["action"] == "focusComposer" { (message.webView as? KappaChatWebView)?.composerEditor.becomeFirstResponder() }
            if body["action"] == "blurComposer" { (message.webView as? KappaChatWebView)?.composerEditor.resignFirstResponder() }
            if body["action"] == "voiceStart", let webView = message.webView { voice.start(in: webView) }
            if body["action"] == "voiceStop" { voice.stop() }
            if body["action"] == "voiceCancel" { voice.cancel() }
            if body["action"] == "location", let webView = message.webView { location.request(in: webView) }
            if body["action"] == "pickerKind", let kind = body["kind"] { pendingPicker = (kind, Date()) }
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
            if body["action"] == "connection", let webView = message.webView { showConnection(in: webView) }
            if body["action"] == "session", let webView = message.webView,
               let requestId = body["requestId"], UUID(uuidString: requestId) != nil, let origin = body["origin"],
               sessionRequests.count < 8, !sessionRequests.contains(requestId) {
                sessionRequests.insert(requestId)
                Task { @MainActor [weak self, weak webView] in
                    guard let self else { return }
                    defer { self.sessionRequests.remove(requestId) }
                    var result: [String: Any] = ["requestId": requestId]
                    do { result.merge(try await DeviceSessions.renew(expectedOrigin: origin)) { _, new in new } }
                    catch { result["error"] = true }
                    guard let webView, KappaWebView.isAppPage(webView.url),
                          let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) else { return }
                    webView.evaluateJavaScript("window.receiveNativeSession?.(\(json));", completionHandler: nil)
                }
            }
        }
        private var sessionRequests = Set<String>()
        private var connecting = false

        private func reloadConnection(in webView: WKWebView) {
            let controller = webView.configuration.userContentController
            controller.removeAllUserScripts()
            controller.addUserScript(KappaWebView.credentialScript())
            controller.addUserScript(WKUserScript(source: KappaWebView.reduceTransparencySource(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
            #if DEBUG && targetEnvironment(simulator)
            if let fixture = ProgressFixture.script() { controller.addUserScript(fixture) }
            #endif
            webView.reload()
        }
        private func showConnectionError(in webView: WKWebView) {
            guard let controller = presenter(webView) else { return }
            let alert = UIAlertController(title: "Connection not changed", message: "Check the backend session support, owner credential and network. Existing device and recovery credentials are retained. No legacy credential was sent to the page.", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            controller.present(alert, animated: true)
        }
        private func showConnection(in webView: WKWebView, enrollment: Bool = false) {
            guard !connecting, let controller = presenter(webView) else { return }
            let record = DeviceSessionVault.load()
            if record != nil && !enrollment {
                let alert = UIAlertController(title: "AI connection", message: "This device uses a revocable session. Disconnect revokes its access and renewal on the server; running tasks retain their separate authorization.", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
                alert.addAction(UIAlertAction(title: "Reconnect with owner credential", style: .default) { [weak self, weak webView] _ in
                    guard let self, let webView else { return }; self.showConnection(in: webView, enrollment: true)
                })
                alert.addAction(UIAlertAction(title: "Forget local connection only", style: .destructive) { [weak self, weak webView] _ in
                    guard let self, let webView, let controller = self.presenter(webView) else { return }
                    let confirm = UIAlertController(title: "Forget local connection?", message: "This does not revoke remote access. Use the owner device inventory to revoke a lost session. Chats, vault and owner recovery credentials are retained.", preferredStyle: .alert)
                    confirm.addAction(UIAlertAction(title: "Cancel", style: .cancel))
                    confirm.addAction(UIAlertAction(title: "Forget locally", style: .destructive) { _ in
                        do { try DeviceSessionVault.delete(); self.reloadConnection(in: webView) }
                        catch { self.showConnectionError(in: webView) }
                    })
                    controller.present(confirm, animated: true)
                })
                alert.addAction(UIAlertAction(title: "Disconnect device", style: .destructive) { [weak self, weak webView] _ in
                    guard let self, let webView else { return }; self.connecting = true
                    Task { @MainActor in
                        defer { self.connecting = false }
                        do { try await DeviceSessions.disconnect(); self.reloadConnection(in: webView) }
                        catch { self.showConnectionError(in: webView) }
                    }
                })
                controller.present(alert, animated: true); return
            }
            let alert = UIAlertController(title: "Secure AI connection", message: "Enter the HTTPS Worker URL and owner credential. Enrollment happens natively. Leave the credential empty to use an existing Keychain recovery credential. The page receives only short-lived access.", preferredStyle: .alert)
            alert.addTextField { field in
                field.placeholder = "https://your-worker.workers.dev"; field.keyboardType = .URL
                field.autocapitalizationType = .none; field.autocorrectionType = .no
                field.text = record?.backend ?? CredentialVault.load()?["backend"]
            }
            alert.addTextField { field in
                field.placeholder = "Owner credential"; field.isSecureTextEntry = true
                field.autocapitalizationType = .none; field.autocorrectionType = .no
            }
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
            alert.addAction(UIAlertAction(title: "Enroll device", style: .default) { [weak self, weak webView] _ in
                guard let self, let webView else { return }
                let backend = alert.textFields?[0].text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                let typed = alert.textFields?[1].text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                let owner = typed.isEmpty ? CredentialVault.load()?["access"] ?? "" : typed
                self.connecting = true
                Task { @MainActor in
                    defer { self.connecting = false }
                    do { try await DeviceSessions.enroll(backend: backend, owner: owner); self.reloadConnection(in: webView) }
                    catch { self.showConnectionError(in: webView) }
                }
            })
            controller.present(alert, animated: true)
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
            if KappaWebView.isAppPage(url) || url.absoluteString == "about:blank" {
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
            let kind = pendingPicker.flatMap { Date().timeIntervalSince($0.at) < 5 ? $0.kind : nil }
            pendingPicker = nil
            if kind == "photos" || kind == "camera", let controller = presenter(webView) {
                fileCompletion = completionHandler
                media.present(kind ?? "photos", multiple: parameters.allowsMultipleSelection, from: controller) { [weak self] urls in
                    self?.fileCompletion = nil
                    completionHandler(urls)
                }
                return
            }
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
