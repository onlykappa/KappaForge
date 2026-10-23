import AVFoundation
import WebKit

// Records the owner's voice for talk-to-chat. The web layer decides when to stop (it listens to the levels sent
// here); the finished clip goes back to it as base64 AAC, and it uploads it to the backend for transcription.
final class VoiceRecorder: NSObject, AVAudioRecorderDelegate {
    private weak var webView: WKWebView?
    private var recorder: AVAudioRecorder?
    private var meter: Timer?
    private var cancelled = false
    private let url = FileManager.default.temporaryDirectory.appendingPathComponent("kappa-voice.m4a")

    func start(in webView: WKWebView) {
        self.webView = webView
        AVAudioApplication.requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else {
                    self.send(["type": "error", "message": "Microphone access is off. Turn it on in Settings → KappaForge."])
                    return
                }
                self.begin()
            }
        }
    }

    private func begin() {
        finish()
        cancelled = false
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 16_000,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue
            ]
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.delegate = self
            recorder.isMeteringEnabled = true
            guard recorder.record(forDuration: 65) else { throw NSError(domain: "KappaVoice", code: 1) }
            self.recorder = recorder
            send(["type": "started"])
            meter = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                guard let recorder = self?.recorder else { return }
                recorder.updateMeters()
                self?.send(["type": "level", "db": Double(recorder.averagePower(forChannel: 0))])
            }
        } catch {
            restorePlayback()
            send(["type": "error", "message": "The microphone could not start."])
        }
    }

    func stop() { recorder?.stop() }

    func cancel() {
        cancelled = true
        recorder?.stop()
    }

    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        finish()
        restorePlayback()
        defer { try? FileManager.default.removeItem(at: url) }
        if cancelled { return }
        guard flag, let data = try? Data(contentsOf: url) else {
            send(["type": "error", "message": "The recording could not be saved."])
            return
        }
        send(["type": "done", "mime": "audio/mp4", "data": data.base64EncodedString()])
    }

    private func finish() {
        meter?.invalidate()
        meter = nil
        recorder = nil
    }

    // Replies are played by the web view; without this they would come out of the earpiece after recording.
    private func restorePlayback() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
    }

    private func send(_ event: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.KappaVoiceNative?.(\(json));", completionHandler: nil)
    }
}
