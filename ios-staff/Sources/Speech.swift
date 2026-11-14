import AVFoundation
import Foundation
import Speech

/// Microphone, speech-to-text and read-aloud. The real one uses the iPhone's own speech recognition; tests use a fake.
protocol Mic: AnyObject {
    func available(lang: String) -> Bool
    func hasPermission() -> Bool
    func requestPermission(_ done: @escaping (Bool) -> Void)
    /// onDone: nil = cancelled, "" = nothing heard, otherwise the words. Always called on the main thread.
    func start(lang: String, onInterim: @escaping (String) -> Void, onDone: @escaping (String?) -> Void)
    func release()
    func cancel()
    func say(_ text: String, lang: String)
}

/// Hold-to-talk with Apple's speech recognizer: listens for as long as the mic is held.
final class SpeechMic: NSObject, Mic {
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var onDone: ((String?) -> Void)?
    private var latest = ""
    private var cancelled = false
    private var finished = true
    private var generation = 0
    private let synth = AVSpeechSynthesizer()

    func available(lang: String) -> Bool {
        SFSpeechRecognizer(locale: Locale(identifier: localeTag(lang)))?.isAvailable ?? false
    }
    func hasPermission() -> Bool {
        SFSpeechRecognizer.authorizationStatus() == .authorized && AVAudioSession.sharedInstance().recordPermission == .granted
    }
    func requestPermission(_ done: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async { done(status == .authorized && granted) }
            }
        }
    }

    func start(lang: String, onInterim: @escaping (String) -> Void, onDone: @escaping (String?) -> Void) {
        stopAudio()
        task?.cancel(); task = nil
        synth.stopSpeaking(at: .immediate)
        generation += 1
        let gen = generation
        self.onDone = onDone
        latest = ""; cancelled = false; finished = false
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeTag(lang))), recognizer.isAvailable else { finish(gen); return }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        request = req
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .duckOthers])
            try audio.setActive(true, options: .notifyOthersOnDeactivation)
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            if format.sampleRate == 0 || format.channelCount == 0 { finish(gen); return }
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in req.append(buffer) }
            engine.prepare()
            try engine.start()
        } catch { finish(gen); return }
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let failed = error != nil
            DispatchQueue.main.async {
                guard let self = self, self.generation == gen, !self.finished else { return }
                if let text = text { self.latest = text; onInterim(text) }
                if isFinal || failed { self.finish(gen) }
            }
        }
    }

    /// Mic released: stop listening and hand over what was heard.
    func release() {
        guard !finished else { return }
        let gen = generation
        stopAudio()
        request?.endAudio()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.finish(gen) }
    }

    func cancel() {
        guard !finished else { return }
        cancelled = true
        task?.cancel()
        finish(generation)
    }

    private func finish(_ gen: Int) {
        guard gen == generation, !finished else { return }
        finished = true
        stopAudio()
        task = nil; request = nil
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
