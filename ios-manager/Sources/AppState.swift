import Foundation
import Network
import SwiftUI

/// Everything the manager app knows: who's signed in, which hotel, the screens' data, and the voice conversation.
@MainActor
final class AppState: ObservableObject {
    let api: Api
    let store: Store
    let mic: Mic

    @Published var me: Me?
    @Published var lang: String
    @Published var hotelId: String?
    @Published var tab: AppTab = .today
    @Published var menuOpen = false
    @Published var notice: Notice?
    @Published var busy = false
    @Published var online = true

    // Screen data
    @Published var products: [Product] = []
    @Published var stock: [StockRow] = []
    @Published var alerts: [Alert] = []
    @Published var corrections: [CorrectionRequest] = []
    @Published var countStatus: CountStatus?
    @Published var sheet: CountSheet?
    @Published var pastCounts: [CountSummary] = []
    @Published var transfers: [Transfer] = []
    @Published var recentTransfers: [Transfer] = []
    @Published var events: [ActivityEvent] = []
    @Published var attempts: [VoiceAttempt] = []
    @Published var countSaving = false
    @Published var lastSaved: Date?

    // Voice / conversation
    @Published var chat: [ChatMessage] = []
    @Published var voiceLive = false
    @Published var voiceInterim = ""
    @Published var voiceLevel: Float = 0
    @Published var voiceStartedAt = Date()
    @Published var waitingLong = false
    @Published var draft = ""
    @Published var showIntro = false
    @Published var practicing = false
    private var toldNoGuVoice = false
    private var capTimer: Task<Void, Never>?
    private let monitor = NWPathMonitor()

    var t: T { T(lang: lang) }
    var hotel: Hotel? { me?.hotels.first { $0.id == hotelId } }
    var hotels: [Hotel] { me?.hotels ?? [] }
    var useCloudVoice: Bool { me?.config?.voiceProvider == "gemini" }
    var productById: [String: Product] { Dictionary(products.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) }

    init(api: Api = Api(), store: Store = Store(), mic: Mic = SpeechMic()) {
        self.api = api; self.store = store; self.mic = mic
        lang = store.lang
        hotelId = store.hotelId
        monitor.pathUpdateHandler = { [weak self] path in
            let up = path.status == .satisfied
            Task { @MainActor in self?.online = up }
        }
        monitor.start(queue: DispatchQueue(label: "net"))
    }

    // ---------- session ----------
    func boot() {
        Task {
            if api.hasSession {
                do { try await loadMe(); await loadAll() } catch { handle(error) }
                if me != nil && !store.introSeen { showIntro = true }
            }
        }
    }
    func login(code: String, password: String) async -> String? {
        do {
            try await api.login(code: code, password: password)
            try await loadMe()
            guard let m = me, m.role == "MANAGER" || m.role == "OWNER" else { await api.logout(); me = nil; return t.notManager }
            store.lastCode = code
            await loadAll()
            if !store.introSeen { showIntro = true }
            return nil
        } catch let e as ApiError { return e.message } catch { return t.offlineLogin }
    }
    private func loadMe() async throws {
        let m = try await api.me()
        me = m
        if let l = m.language, ["en", "hi", "gu"].contains(l) { lang = l; store.lang = l }
        if hotelId == nil || !m.hotels.contains(where: { $0.id == hotelId }) { hotelId = m.hotels.first?.id; store.hotelId = hotelId }
    }
    func signOut() { Task { await api.logout(); me = nil; chat = []; menuOpen = false; stock = []; alerts = []; sheet = nil } }
    func setLanguage(_ l: String) { lang = l; store.lang = l; Task { await api.setLanguage(l) } }
    func setHotel(_ id: String) { hotelId = id; store.hotelId = id; menuOpen = false; chat = []; sheet = nil; Task { await loadAll() } }

    // ---------- data ----------
    func loadAll() async {
        guard let h = hotelId else { return }
        do {
            async let p = api.products()
            async let s = api.stock(h)
            async let a = api.alerts(h)
            async let c = api.corrections(h)
            async let cs = api.countStatus(h)
            products = (try await p).filter { $0.active ?? true }
            stock = try await s.items
            alerts = try await a.items
            corrections = (try? await c) ?? []
            countStatus = (try? await cs)?.first
        } catch { handle(error) }
    }
    func refresh() { Task { await loadAll(); await loadTab(tab) } }
    func loadTab(_ to: AppTab) async {
        guard let h = hotelId else { return }
        do {
            switch to {
            case .today: await loadAll()
            case .stock: stock = try await api.stock(h).items
            case .count:
                countStatus = try await api.countStatus(h).first
                if let id = countStatus?.draftCountId { sheet = try await api.count(id) } else { sheet = nil }
                pastCounts = (try? await api.counts(h)) ?? []
            case .deliveries:
                let all = try await api.transfers(h)
                transfers = all.filter { ["OPEN", "DISCREPANCY", "PARTIAL"].contains($0.status) }
                recentTransfers = all.filter { !["OPEN", "DISCREPANCY", "PARTIAL"].contains($0.status) }.prefix(10).map { $0 }
            case .activity:
                events = try await api.activity(h).items
                corrections = (try? await api.corrections(h)) ?? []
            case .attempts: attempts = (try? await api.voiceAttempts().attempts) ?? []
            }
        } catch { handle(error) }
    }
    func go(_ to: AppTab) { tab = to; menuOpen = false; Task { await loadTab(to) } }
    func handle(_ error: Error) {
        if let e = error as? ApiError {
            if e.status == 401 { api.clearSession(); me = nil; return }
            notice = Notice(text: e.message)
        } else { notice = Notice(text: t.offlineLogin) }
    }

    // ---------- today ----------
    var attentionCount: Int { alerts.count + corrections.count }
    func alertAction(_ a: Alert) -> (String, AppTab)? {
        switch a.category {
        case "LOW_STOCK": return (t.seeStock, .stock)
        case "COUNT_OVERDUE": return (t.startCount, .count)
        case "LARGE_VARIANCE": return (t.review, .count)
        case "CORRECTION_REQUEST": return (t.review, .activity)
        default: return a.category.hasPrefix("TRANSFER") ? (t.open, .deliveries) : nil
        }
    }

    // ---------- weekly count ----------
    func startCount() {
        guard let h = hotelId else { return }
        Task { do { sheet = try await api.startCount(h); countStatus = try await api.countStatus(h).first } catch { handle(error) } }
    }
    func setCount(_ productId: String, qty: Int?, reason: String? = nil) {
        guard var s = sheet, let i = s.lines.firstIndex(where: { $0.productId == productId }) else { return }
        s.lines[i].physicalQty = qty
        s.lines[i].variance = qty.map { $0 - s.lines[i].expectedQty }
        if let r = reason { s.lines[i].reason = r } else if qty == s.lines[i].expectedQty { s.lines[i].reason = nil }
        sheet = s
        saveCountLines([["productId": productId, "physicalQty": qty.map { $0 as Any } ?? NSNull(), "reason": s.lines[i].reason.map { $0 as Any } ?? NSNull()]])
    }
    private func saveCountLines(_ lines: [[String: Any]]) {
        guard let id = sheet?.id else { return }
        countSaving = true
        Task {
            do { _ = try await api.patchCount(id, lines: lines); lastSaved = Date() } catch { handle(error) }
            countSaving = false
        }
    }
    /// Counts read out by voice: fill the matching boxes; "same" means equals the book.
    func applyCounted(_ p: Proposal) {
        var got: [(name: String, qty: Int?)] = []
        var patch: [[String: Any]] = []
        for l in p.lines {
            guard let pid = l.productId, var s = sheet, let i = s.lines.firstIndex(where: { $0.productId == pid }) else { continue }
            let qty = l.quantity ?? s.lines[i].expectedQty
            s.lines[i].physicalQty = qty; s.lines[i].variance = qty - s.lines[i].expectedQty
            if qty == s.lines[i].expectedQty { s.lines[i].reason = nil }
            sheet = s
            got.append((s.lines[i].name, qty))
            patch.append(["productId": pid, "physicalQty": qty, "reason": s.lines[i].reason.map { $0 as Any } ?? NSNull()])
        }
        if !patch.isEmpty { saveCountLines(patch) }
        post(.counted(got))
        let spoken = got.map { "\($0.name) \($0.qty ?? 0)" }.joined(separator: ", ")
        say(spoken)
    }
    var countReady: (ok: Bool, why: String?) {
        guard let s = sheet else { return (false, nil) }
        if s.lines.contains(where: { $0.physicalQty == nil }) { return (false, t.countNeedsAll) }
        if s.lines.contains(where: { ($0.variance ?? 0) != 0 && ($0.reason ?? "").isEmpty }) { return (false, t.countNeedsReasons) }
        return (true, nil)
    }
    func submitCount() {
        guard let s = sheet, countReady.ok else { notice = Notice(text: countReady.why ?? ""); return }
        Task {
            do {
                try await api.submitCount(s.id, note: nil, key: UUID().uuidString)
                sheet = nil; notice = Notice(text: t.countSubmitted, warn: false); say(t.countSubmitted)
                await loadAll(); await loadTab(.count)
            } catch let e as ApiError where e.code == "COUNT_STALE" || e.status == 409 {
                try? await api.refreshCount(s.id); sheet = try? await api.count(s.id); notice = Notice(text: t.stockMoved)
            } catch { handle(error) }
        }
    }
    func cancelCount() { guard let s = sheet else { return }; Task { try? await api.cancelCount(s.id); sheet = nil; await loadTab(.count) } }

    // ---------- deliveries ----------
    func receiveAll(_ tr: Transfer) {
        let lines = tr.lines.map { ["productId": $0.productId, "receivedQuantity": $0.sent - $0.received - $0.resolvedShort] as [String: Any] }
        Task { do { try await api.receive(tr.id, lines: lines, final: true, key: UUID().uuidString); notice = Notice(text: t.saved, warn: false); await loadTab(.deliveries); await loadAll() } catch { handle(error) } }
    }
    func receiveSome(_ tr: Transfer, quantities: [String: Int], final: Bool) {
        let lines = quantities.map { ["productId": $0.key, "receivedQuantity": $0.value] as [String: Any] }
        Task { do { try await api.receive(tr.id, lines: lines, final: final, key: UUID().uuidString); notice = Notice(text: t.saved, warn: false); await loadTab(.deliveries); await loadAll() } catch { handle(error) } }
    }
    func settle(_ tr: Transfer, reason: String) {
        Task { do { try await api.resolve(tr.id, reason: reason, note: nil, key: UUID().uuidString); notice = Notice(text: t.saved, warn: false); await loadTab(.deliveries); await loadAll() } catch { handle(error) } }
    }
    func dispatch(to: String, quantities: [String: Int]) {
        guard let h = hotelId else { return }
        let lines = quantities.filter { $0.value > 0 }.map { ["productId": $0.key, "quantity": $0.value] as [String: Any] }
        guard !lines.isEmpty else { return }
        Task { do { try await api.dispatch(from: h, to: to, lines: lines, key: UUID().uuidString); notice = Notice(text: t.saved, warn: false); await loadTab(.deliveries); await loadAll() } catch { handle(error) } }
    }

    // ---------- activity ----------
    func reverse(_ e: ActivityEvent, reason: String) {
        Task { do { try await api.reverse(e.eventId, reason: reason, key: UUID().uuidString); notice = Notice(text: t.reversed, warn: false); await loadTab(.activity); await loadAll() } catch { handle(error) } }
    }
    func dismiss(_ c: CorrectionRequest) {
        Task { try? await api.dismissCorrection(c.id); corrections.removeAll { $0.id == c.id } }
    }
    func event(for c: CorrectionRequest) -> ActivityEvent? { events.first { $0.eventId == c.eventId } }

    // ---------- walkthrough ----------
    func openIntro() { menuOpen = false; showIntro = true }
    func finishIntro(practice: Bool) {
        store.introSeen = true; showIntro = false
        if practice { practicing = true; tab = .today; notice = Notice(text: t.introPractice, warn: false); say(t.introPractice) }
    }

    // ---------- voice bar ----------
    var voiceMode: String? { tab == .count && sheet != nil ? "count" : nil }

    func voiceStart() {
        let cloud = useCloudVoice && online
        if !online && !mic.available(lang: lang) { notice = Notice(text: t.offlineVoiceGu); return }
        guard cloud || mic.available(lang: lang) else { return }
        if !online && useCloudVoice { notice = Notice(text: t.offlineVoice, warn: false) }
        guard cloud ? mic.hasRecordPermission() : mic.hasPermission() else {
            mic.requestPermission { [weak self] ok in guard let self = self else { return }; self.notice = Notice(text: ok ? self.t.holdHint : self.t.holdHint) }
            return
        }
        if online { notice = nil }
        voiceInterim = ""; voiceLevel = 0; voiceStartedAt = Date(); voiceLive = true
        let started = voiceStartedAt
        capTimer?.cancel()
        capTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            if !Task.isCancelled { self?.voiceSend() }
        }
        mic.start(lang: lang, record: cloud, onInterim: { [weak self] text in self?.voiceInterim = text }, onLevel: { [weak self] l in self?.voiceLevel = l }, onDone: { [weak self] text in
            guard let self = self else { return }
            self.capTimer?.cancel()
            self.voiceLive = false; self.voiceLevel = 0
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            if cloud, let audio = self.mic.takeRecording(), audio.count > 2000, ms >= 600 {
                self.interpretAudio(audio, heard: text ?? "", durationMs: ms)
                return
            }
            guard let text = text else { return }          // cancelled
            if text.isEmpty { self.post(.text(self.t.notUnderstood, warn: true)) } else { self.interpret(text, durationMs: ms) }
        })
    }
    func voiceSend() { if voiceLive { mic.stopTalking() } }
    func voiceCancel() { if voiceLive { mic.cancel() } }
    func voiceHint() { notice = Notice(text: t.holdHint, warn: false) }

    // ---------- conversation ----------
    func post(_ body: ChatBody, as role: ChatRole = .app) {
        chat.append(ChatMessage(role: role, body: body))
        if chat.count > 30 { chat.removeFirst(chat.count - 30) }
    }
    func clearChat() { chat = [] }
    private func index(_ id: UUID) -> Int? { chat.firstIndex { $0.id == id } }
    private func say(_ text: String, _ l: String? = nil) {
        guard !text.isEmpty else { return }
        let sl = l ?? lang
        if sl == "gu", !mic.hasVoice(lang: "gu"), !toldNoGuVoice { toldNoGuVoice = true; notice = Notice(text: t.noGuVoice, warn: false) }
        mic.say(text, lang: sl)
    }
    func editSaid(_ text: String) { draft = text == "…" ? "" : text; notice = nil }

    func interpret(_ text: String, durationMs: Int) {
        guard let h = hotelId else { return }
        notice = nil
        post(.said(text, spoken: durationMs > 0), as: .me)
        if let c = localCommand(text) { applyLocal(c); return }
        busy = true
        let l = lang, m = voiceMode
        Task {
            await run { try await self.api.interpret(hotelId: h, text: text, lang: l, durationMs: durationMs, mode: m) }
            busy = false
        }
    }
    func interpretAudio(_ audio: Data, heard: String, durationMs: Int) {
        guard let h = hotelId else { return }
        notice = nil
        let bubble = ChatMessage(role: .me, body: .said(heard.isEmpty ? "…" : heard, spoken: true))
        chat.append(bubble)
        busy = true
        let l = lang, m = voiceMode
        Task {
            await run(bubble: bubble.id, fallbackText: heard) { try await self.api.interpretAudio(hotelId: h, audio: audio, lang: l, durationMs: durationMs, heard: heard, mode: m) }
            busy = false
        }
    }
    private func applyLocal(_ c: LocalCommand) {
        switch c {
        case .go(let tab): go(tab)
        case .language(let l): setLanguage(l)
        case .signOut: signOut()
        }
    }
    private func run(bubble: UUID? = nil, fallbackText: String = "", _ call: () async throws -> Proposal) async {
        waitingLong = false
        let waitTask = Task { try? await Task.sleep(nanoseconds: 3_000_000_000); if !Task.isCancelled { self.waitingLong = true } }
        defer { waitTask.cancel(); waitingLong = false }
        do {
            let p = try await call()
            let tag = langCode(p.detectedLanguage)
            if let b = bubble, let i = index(b), let tr = p.transcript, !tr.isEmpty { chat[i].body = .said(tr, spoken: true, lang: tag) }
            else if let b = bubble, let i = index(b), case .said(let tx, let sp, _) = chat[i].body { chat[i].body = .said(tx, spoken: sp, lang: tag) }
            if bubble != nil, let tr = p.transcript, let c = localCommand(tr) { applyLocal(c); return }
            if p.warnings?.contains("FALLBACK_RULES") == true { post(.text(t.fromPhoneWords, warn: true)) }
            handleProposal(p)
        } catch let e as ApiError {
            if e.status == 401 { api.clearSession(); me = nil; return }
            if e.status >= 500, bubble != nil { post(.retry(heard: fallbackText)); say(t.googleSlow); return }
            post(.text(e.message, warn: true))
        } catch { post(.retry(heard: fallbackText)) }
    }
    private func langCode(_ detected: String?) -> String? {
        switch detected { case "gu-IN": return "gu"; case "hi-IN": return "hi"; case "en-IN": return "en"; case "mixed": return "mixed"; default: return nil }
    }
    private func handleProposal(_ p: Proposal) {
        let reply = langCode(p.detectedLanguage).flatMap { $0 == "mixed" ? nil : $0 } ?? lang
        switch p.status {
        case "QUERY_RESULT":
            let rows = p.queryResult ?? []
            post(.stock(rows))
            if practicing { practicing = false; post(.text(t.introDone, warn: false)); say(t.introDone); notice = nil }
            else { say(rows.isEmpty ? t.nothingLow : rows.prefix(4).map { T(lang: reply).stockSentence($0) }.joined(separator: ". "), reply) }
        case "COUNT_ENTRY":
            if sheet == nil { post(.text(t.countDue, warn: true)); go(.count) } else { applyCounted(p) }
        case "NAVIGATE":
            switch p.action {
            case "START_COUNT": go(.count); if sheet == nil { startCount() }
            case "SHOW_TRANSFERS": go(.deliveries)
            case "SHOW_CHANGES", "SHOW_ROOM_USE": go(.activity)
            default: go(.today)
            }
        case "NEEDS_CLARIFICATION":
            if p.action == "TRANSFER_RECEIPT" || p.warnings?.contains("USE_INCOMING_TRANSFERS") == true { go(.deliveries); post(.text(t.deliveries, warn: false)) }
            else { let q = p.clarificationQuestion ?? t.notUnderstood; post(.text(q, warn: true)); say(q, reply) }
        default:
            // READY_TO_CONFIRM: a stock movement. Managers don't record those here.
            post(.text(t.notInApp, warn: true)); say(t.notInApp)
        }
    }
}
