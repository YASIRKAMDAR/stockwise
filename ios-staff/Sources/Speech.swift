import AVFoundation
import Foundation
import Speech

/// Microphone, speech-to-text and read-aloud. The real one uses the iPhone's own speech recognition; tests use a fake.
protocol Mic: AnyObject {
    func available(lang: String) -> Bool
    func hasPermission() -> Bool
    func hasRecordPermission() -> Bool
    func requestPermission(_ done: @escaping (Bool) -> Void)
    /// record: also keep the recording (for Google's model). onDone: nil = cancelled, "" = no words heard,
    /// otherwise the words the phone heard. Always called on the main thread.
    func start(lang: String, record: Bool, onInterim: @escaping (String) -> Void, onDone: @escaping (String?) -> Void)
    func release()
    func cancel()
    /// The last recording (m4a), once; nil when cancelled or not recording.
    func takeRecording() -> Data?
    func say(_ text: String, lang: String)
}
extension Mic {
    func start(lang: String, onInterim: @escaping (String) -> Void, onDone: @escaping (String?) -> Void) {
        start(lang: lang, record: false, onInterim: onInterim, onDone: onDone)
    }
}

/// Hold-to-talk: Apple's recognizer shows the words live; when recording, the audio is also saved so
/// Google's model can understand mixed Gujarati, Hindi and English.
final class SpeechMic: NSObject, Mic {
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var onDone: ((String?) -> Void)?
    private var latest = ""
    private var cancelled = false
    private var finished = true
    private var recording = false
    private var file: AVAudioFile?
    private var fileURL: URL?
    private var recorded: Data?
    private var generation = 0
    private let synth = AVSpeechSynthesizer()

    func available(lang: String) -> Bool {
        SFSpeechRecognizer(locale: Locale(identifier: localeTag(lang)))?.isAvailable ?? false
    }
    func hasPermission() -> Bool {
        SFSpeechRecognizer.authorizationStatus() == .authorized && hasRecordPermission()
    }
    func hasRecordPermission() -> Bool { AVAudioSession.sharedInstance().recordPermission == .granted }
    func requestPermission(_ done: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async { done(granted) }
            }
        }
    }

    func start(lang: String, record: Bool, onInterim: @escaping (String) -> Void, onDone: @escaping (String?) -> Void) {
        stopAudio()
        task?.cancel(); task = nil
        synth.stopSpeaking(at: .immediate)
        generation += 1
        let gen = generation
        self.onDone = onDone
        latest = ""; cancelled = false; finished = false
        recording = record; recorded = nil; file = nil; fileURL = nil
        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeTag(lang)))
        let canRecognize = (recognizer?.isAvailable ?? false) && SFSpeechRecognizer.authorizationStatus() == .authorized
        if !canRecognize && !record { finish(gen); return }
        let req: SFSpeechAudioBufferRecognitionRequest? = canRecognize ? SFSpeechAudioBufferRecognitionRequest() : nil
        req?.shouldReportPartialResults = true
        request = req
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .duckOthers])
            try audio.setActive(true, options: .notifyOthersOnDeactivation)
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            if format.sampleRate == 0 || format.channelCount == 0 { finish(gen); return }
            var out: AVAudioFile? = nil
            if record {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("stockwise-voice.m4a")
                try? FileManager.default.removeItem(at: url)
                let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: format.sampleRate,
                                               AVNumberOfChannelsKey: format.channelCount, AVEncoderBitRateKey: 48000]
                out = try? AVAudioFile(forWriting: url, settings: settings, commonFormat: format.commonFormat, interleaved: format.isInterleaved)
                file = out; fileURL = url
            }
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                req?.append(buffer)
                try? out?.write(from: buffer)
            }
            engine.prepare()
            try engine.start()
        } catch { finish(gen); return }
        if let recognizer = recognizer, let req = req {
            task = recognizer.recognitionTask(with: req) { [weak self] result, error in
                let text = result?.bestTranscription.formattedString
                let isFinal = result?.isFinal ?? false
                let failed = error != nil
                DispatchQueue.main.async {
                    guard let self = self, self.generation == gen, !self.finished else { return }
                    if let text = text { self.latest = text; onInterim(text) }
                    // While recording for Google, keep going until the mic is released.
                    if (isFinal || failed) && !self.recording { self.finish(gen) }
                }
            }
        }
    }

    /// Mic released: stop listening and hand over what was heard.
    func release() {
        guard !finished else { return }
        let gen = generation
        stopAudio()
        request?.endAudio()
        if task == nil { finish(gen); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + (recording ? 0.6 : 1.5)) { [weak self] in self?.finish(gen) }
    }

    func cancel() {
        guard !finished else { return }
        cancelled = true
        task?.cancel()
        finish(generation)
    }

    func takeRecording() -> Data? {
        defer { recorded = nil }
        return recorded
    }

    private func finish(_ gen: Int) {
        guard gen == generation, !finished else { return }
        finished = true
        stopAudio()
        if recording { task?.cancel() }
        task = nil; request = nil
        file = nil   // closes the recording
        if recording, !cancelled, let url = fileURL { recorded = try? Data(contentsOf: url) }
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
        fileURL = nil
        let done = onDone
        onDone = nil
        done?(cancelled ? nil : latest.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func stopAudio() {
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
    }

    func say(_ text: String, lang: String) {
        guard let voice = AVSpeechSynthesisVoice(language: localeTag(lang)) else { return }
        let u = AVSpeechUtterance(string: text)
        u.voice = voice
        synth.stopSpeaking(at: .immediate)
        synth.speak(u)
    }
}

private let yesWords: Set<String> = ["haan", "han", "ha", "haa", "yes", "yeah", "ok", "okay", "theek", "thik", "sahi", "हाँ", "हां", "हा", "ठीक", "सही", "ओके", "હા", "હાં", "બરાબર", "ઓકે", "સાચું"]
private let noWords: Set<String> = ["nahi", "nahin", "na", "no", "nope", "cancel", "नहीं", "नही", "ना", "ના", "નહીં", "નથી"]
/// true = yes, false = no, nil = neither.
func yesNo(_ text: String) -> Bool? {
    let words = text.lowercased().components(separatedBy: CharacterSet(charactersIn: " ,.!?।\n"))
    if words.contains(where: { noWords.contains($0) }) { return false }
    if words.contains(where: { yesWords.contains($0) }) { return true }
    return nil
}

/// Short spoken or typed commands the app handles itself: "my bag", "history", "home", "sign out", a language name.
enum LocalCommand: Equatable { case go(AppTab), language(String), signOut }
func localCommand(_ text: String) -> LocalCommand? {
    let cleaned = text.lowercased().components(separatedBy: CharacterSet(charactersIn: ".,!?।")).joined(separator: " ")
    let words = cleaned.split(separator: " ").map(String.init)
    let s = words.joined(separator: " ")
    if s.isEmpty || words.count > 5 || s.unicodeScalars.contains(where: { CharacterSet.decimalDigits.contains($0) }) { return nil }
    func has(_ pattern: String) -> Bool { s.range(of: pattern, options: .regularExpression) != nil }
    if has("sign ?out|log ?out|साइन आउट|लॉग ?आउट|સાઇન આઉટ|લૉગ ?આઉટ") { return .signOut }
    if has("\\benglish\\b|अंग्रेज़ी|अंग्रेजी|અંગ્રેજી") { return .language("en") }
    if has("\\bhindi\\b|हिंदी|हिन्दी|હિન્દી|હિંદી") { return .language("hi") }
    if has("\\bgujarati\\b|गुजराती|ગુજરાતી") { return .language("gu") }
    if has("\\bhistory\\b|what did i do|इतिहास|हिस्ट्री|ઇતિહાસ|હિસ્ટ્રી") { return .go(.history) }
    if has("\\bbag\\b|बैग|બેગ") { return .go(.bag) }
    if has("^(go )?(to )?(the )?home( screen)?$|होम|હોમ") { return .go(.home) }
    return nil
}
