import Foundation
import Network
import SwiftUI

/// All app state. Screens read it and call its functions; it talks to the server.
@MainActor
final class AppState: ObservableObject {
    let api: Api
    let store: Store
    let mic: Mic

    @Published var lang: String
    @Published var booting = true
    @Published var me: Me?
    @Published var tab: AppTab = .home
    @Published var flow: Flow?
    @Published var products: [Product] = []
    @Published var rooms: [Room] = []
    @Published var bag: [String: Int] = [:]
    @Published var storeQty: [String: Int] = [:]
    @Published var history: [ActivityEvent] = []
    @Published var outbox: [Pending] = []
    @Published var notice: Notice?
    @Published var answer: [QueryRow]?
    @Published var busy = false
    @Published var loginError: String?
    @Published var nudgeTap = false
    @Published var menuOpen = false
    @Published var voiceLive = false
    @Published var voiceInterim = ""
    @Published var voiceStartedAt = Date()
    @Published var hearingYesNo = false
    private var misses = 0
    private var monitor: NWPathMonitor?

    init(api: Api = Api(), store: Store = Store(), mic: Mic = SpeechMic()) {
        self.api = api; self.store = store; self.mic = mic
        lang = store.lang
        outbox = store.outbox
    }

    var t: T { T(lang: lang) }
    var hotelId: String? { me?.activeHotel ?? me?.hotels.first?.id }
    var hotel: Hotel? { me?.hotels.first { $0.id == hotelId } }
    func product(_ id: String?) -> Product? { products.first { $0.id == id } }
    var activeProducts: [Product] { products.filter { $0.active != false } }
    var activeRooms: [Room] { rooms.filter { $0.active != false } }

    // ---------- start-up, sign-in ----------
    func boot() {
        Task {
            if api.hasSession {
                do { try await loadMe(); await loadData() } catch { handle(error) }
            }
            booting = false
            flushOutbox()
        }
        let m = NWPathMonitor()
        m.pathUpdateHandler = { [weak self] path in
            if path.status == .satisfied { Task { @MainActor in self?.flushOutbox() } }
        }
        m.start(queue: DispatchQueue.global(qos: .utility))
        monitor = m
    }
    func resume() { if me != nil { refresh(); flushOutbox() } }

    private func loadMe() async throws {
        let m = try await api.me()
        me = m
        if let l = m.language, ["en", "hi", "gu"].contains(l) { lang = l; store.lang = l }
    }

    func login(code: String, pin: String) {
        let c = code.trimmingCharacters(in: .whitespaces).uppercased()
        busy = true; loginError = nil
        Task {
            do {
                try await api.staffLogin(code: c, pin: pin)
                store.lastCode = c
                try await loadMe()
                tab = .home; flow = nil
                await loadData()
                flushOutbox()
            } catch let e as ApiError { loginError = e.message }
            catch { loginError = t.offlineLogin }
            busy = false
        }
    }

    func signOut() {
        menuOpen = false
        Task { await api.logout(); me = nil; flow = nil; tab = .home; answer = nil; notice = nil }
    }

    func setLanguage(_ l: String) {
        lang = l; store.lang = l
        if me != nil { Task { await api.setLanguage(l) } }
    }

    private func handle(_ error: Error) {
        guard let e = error as? ApiError else { return }   // offline: keep what we have
        if e.status == 401 { api.clearSession(); me = nil } else { notice = Notice(text: e.message) }
    }

    private func loadData() async {
        guard let h = hotelId else { return }
        do {
            products = try await api.products()
            rooms = try await api.rooms(h)
            bag = Dictionary(try await api.bag(h).items.map { ($0.productId, $0.quantity) }, uniquingKeysWith: { a, _ in a })
            storeQty = Dictionary(try await api.store(h).items.map { ($0.productId, $0.store) }, uniquingKeysWith: { a, _ in a })
        } catch { handle(error) }
        outbox = store.outbox
    }
    func refresh() { Task { await loadData() } }
    func loadHistory() {
        guard let h = hotelId else { return }
        Task { do { history = try await api.activity(h).items } catch { handle(error) } }
    }

    func go(_ to: AppTab) {
        flow = nil; tab = to; menuOpen = false
        if to == .history { loadHistory() }
        if to == .bag { refresh() }
    }

    // ---------- starting jobs ----------
    func start(_ kind: Kind) {
        answer = nil; notice = nil
        flow = Flow(kind: kind, step: kind.needsRoom ? .room : .items)
    }
    func tapInstead() { start(.placeInRoom) }

    func defaultSource(_ productId: String, _ qty: Int) -> String {
        ((bag[productId] ?? 0) >= qty || hotel?.allowStoreToRoom == false) ? "MY_STOCK" : "STORE"
    }

    func cartToCheck() {
        guard var f = flow else { return }
        let place = f.kind == .placeInRoom
        f.lines = activeProducts.compactMap { p in
            guard let q = f.cart[p.id], q > 0 else { return nil }
            return Line(productId: p.id, quantity: q, roomId: f.roomId, roomNumber: f.roomNumber, source: place ? defaultSource(p.id, q) : nil)
        }
        f.step = .check
        flow = f
    }

    // ---------- voice bar ----------
    func voiceStart() {
        guard mic.available(lang: lang) else { return }
        guard mic.hasPermission() else {
            mic.requestPermission { [weak self] ok in
                guard let self = self else { return }
                self.notice = Notice(text: ok ? self.t.holdHint : self.t.micDenied)
            }
            return
        }
        notice = nil; answer = nil; voiceInterim = ""; voiceStartedAt = Date(); voiceLive = true
        let started = voiceStartedAt
        mic.start(lang: lang, onInterim: { [weak self] text in self?.voiceInterim = text }, onDone: { [weak self] text in
            guard let self = self else { return }
            self.voiceLive = false
            guard let text = text else { return }          // cancelled
            if text.isEmpty { self.missed() } else { self.interpret(text, durationMs: Int(Date().timeIntervalSince(started) * 1000)) }
        })
    }
    func voiceSend() { if voiceLive { mic.stopTalking() } }
    func voiceCancel() { if voiceLive { mic.cancel() } }
    func voiceHint() {
        notice = Notice(text: !mic.available(lang: lang) ? t.noVoiceLang : !mic.hasPermission() ? t.micDenied : t.holdHint)
        if !mic.available(lang: lang) { nudgeTap = true }
    }

    /// Text from the mic or the text box → the server works out the job → check screen.
    func interpret(_ text: String, durationMs: Int) {
        guard let h = hotelId else { return }
        notice = nil; answer = nil; busy = true
        Task {
            do {
                let p = try await api.interpret(hotelId: h, text: text, lang: lang, durationMs: durationMs)
                let kind = Kind(rawValue: p.action)
                let plines = p.lines ?? []
                if p.status == "QUERY_RESULT" {
                    answer = p.queryResult ?? []; misses = 0
                } else if let kind = kind, !plines.isEmpty {
                    misses = 0
                    let place = kind == .placeInRoom
                    let lines: [Line] = plines.map { l in
                        let q = max(1, l.quantity ?? 1)
                        var src: String? = nil
                        if place { src = l.source ?? l.productId.map { self.defaultSource($0, q) } }
                        return Line(productId: l.productId, quantity: q, roomId: l.roomId, roomNumber: l.roomNumber, source: src, spoken: l.spokenProduct ?? "", issues: l.issues ?? [])
                    }
                    let room = lines.first { $0.roomId != nil }
                    flow = Flow(kind: kind, step: .check, roomId: room?.roomId, roomNumber: room?.roomNumber, lines: lines, proposalId: p.proposalId, transcript: p.transcript)
                } else { missed() }
            } catch let e as ApiError {
                if e.status == 401 { api.clearSession(); me = nil } else { notice = Notice(text: e.message) }
            } catch { notice = Notice(text: t.offlineLogin) }
            busy = false
        }
    }
    func missed() {
        misses += 1; nudgeTap = true
        if misses >= 2 { misses = 0; start(.placeInRoom); notice = Notice(text: t.twiceFailed) } else { notice = Notice(text: t.notUnderstood) }
    }

    // ---------- check + save ----------
    func blocked(_ f: Flow) -> Bool {
        if f.lines.isEmpty { return true }
        return f.lines.contains { l in
            l.productId == nil || l.quantity < 1 || (f.kind == .placeInRoom && (l.roomId == nil || l.source == nil))
        }
    }
    func summary(_ f: Flow) -> String {
        t.summary(f.kind, f.lines.reduce(0) { $0 + $1.quantity }, f.lines.first { $0.roomNumber != nil }?.roomNumber)
    }
    func spokenSummary(_ f: Flow) -> String {
        let items = f.lines.map { l -> String in
            let p = product(l.productId)
            return "\(l.quantity) \(p?.native(lang) ?? p?.name ?? "")"
        }.joined(separator: ", ")
        return summary(f) + ". " + items
    }

    /// Hold the small mic on the check screen and say yes / no.
    func yesNoStart() {
        guard mic.available(lang: lang) else { return }
        guard mic.hasPermission() else { mic.requestPermission { _ in }; return }
        hearingYesNo = true
        mic.start(lang: lang, onInterim: { _ in }, onDone: { [weak self] text in
            guard let self = self else { return }
            self.hearingYesNo = false
            guard let text = text, let answer = yesNo(text) else { return }
            if answer { self.confirm() } else { self.flow = nil }
        })
    }
    func yesNoSend() { if hearingYesNo { mic.stopTalking() } }
    func yesNoCancel() { if hearingYesNo { mic.cancel() } }

    /// Save the job. Without signal it is kept on the phone and sent later, never twice.
    func confirm() {
        guard let f = flow, let h = hotelId, !blocked(f), !busy else { return }
        busy = true; notice = nil
        let key = UUID().uuidString.lowercased()
        let place = f.kind == .placeInRoom
        let lines: [[String: Any]] = f.lines.map { l in
            var d: [String: Any] = ["productId": l.productId ?? "", "quantity": l.quantity]
            if place, let r = l.roomId { d["roomId"] = r }
            if place, let s = l.source { d["source"] = s }
            return d
        }
        var body: [String: Any] = ["action": f.kind.rawValue, "hotelId": h, "lines": lines]
        if let p = f.proposalId { body["proposalId"] = p }
        let data = (try? JSONSerialization.data(withJSONObject: body)) ?? Data()
        let label = summary(f)
        let roomNumbers = Array(Set(f.lines.compactMap { $0.roomNumber }))
        Task {
            do {
                let r = try await api.postTransaction(data, key: key)
                if let u = me { store.addRecentRooms(u.id, roomNumbers) }
                var done = f; done.step = .done; done.ref = String(r.eventId.prefix(6)).uppercased()
                flow = done
                await loadData()
            } catch let e as ApiError {
                if e.status == 401 { api.clearSession(); me = nil } else { notice = Notice(text: e.message) }
            } catch {
                store.enqueue(Pending(key: key, body: String(data: data, encoding: .utf8) ?? "{}", label: label, createdAt: Date().timeIntervalSince1970, error: nil))
                outbox = store.outbox
                var done = f; done.step = .done; done.offline = true
                flow = done
            }
            busy = false
        }
    }

    // ---------- offline queue ----------
    private var flushing = false
    func flushOutbox() {
        guard !flushing, me != nil, store.outbox.contains(where: { $0.error == nil }) else { outbox = store.outbox; return }
        flushing = true
        Task {
            var sent = false
            for p in store.outbox where p.error == nil {
                do {
                    _ = try await api.raw("POST", "/transactions", body: Data(p.body.utf8), idem: p.key)
                    store.dequeue(p.key); sent = true
                } catch let e as ApiError {
                    if e.status == 401 { break }
                    if (400..<500).contains(e.status) { store.markFailed(p.key, e.message) } else { break }
                } catch { break }
            }
            outbox = store.outbox
            flushing = false
            if sent { await loadData() }
        }
    }
    func discardPending(_ key: String) { store.dequeue(key); outbox = store.outbox }
}
