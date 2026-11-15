import Foundation

struct ApiError: Error { let status: Int; let code: String; let message: String }
struct OfflineError: Error {}

/// Talks to the same Stockwise server as the website (manager sign-in: code + password). The sign-in cookie is kept by the system cookie store.
final class Api {
    let base: String
    private let session: URLSession
    private let decoder = JSONDecoder()

    init(base: String = "https://stockwise-ten-ivory.vercel.app/api/v1") {
        self.base = base
        let cfg = URLSessionConfiguration.default
        cfg.httpCookieStorage = HTTPCookieStorage.shared
        cfg.httpShouldSetCookies = true
        cfg.timeoutIntervalForRequest = 40
        session = URLSession(configuration: cfg)
    }

    var hasSession: Bool {
        guard let url = URL(string: base) else { return false }
        return (HTTPCookieStorage.shared.cookies(for: url) ?? []).contains { $0.name == "sw_session" }
    }
    func clearSession() {
        guard let url = URL(string: base) else { return }
        for c in HTTPCookieStorage.shared.cookies(for: url) ?? [] { HTTPCookieStorage.shared.deleteCookie(c) }
    }

    func raw(_ method: String, _ path: String, body: Data? = nil, contentType: String = "application/json", idem: String? = nil) async throws -> Data {
        guard let url = URL(string: base + path) else { throw ApiError(status: 0, code: "BAD_URL", message: "Something went wrong") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("stockwise", forHTTPHeaderField: "x-requested-with")
        req.setValue("application/json", forHTTPHeaderField: "accept")
        if let idem = idem { req.setValue(idem, forHTTPHeaderField: "idempotency-key") }
        if method != "GET" {
            req.setValue(contentType, forHTTPHeaderField: "content-type")
            req.httpBody = body ?? Data("{}".utf8)
        }
        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: req) } catch { throw OfflineError() }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if !(200..<300).contains(status) {
            let e = (try? decoder.decode(ApiErrorBody.self, from: data))?.error
            let msg = (e?.message?.isEmpty == false) ? e!.message! : "Something went wrong (\(status))"
            throw ApiError(status: status, code: e?.code ?? "HTTP_\(status)", message: msg)
        }
        return data
    }
    private func get<T: Decodable>(_ path: String) async throws -> T { try decoder.decode(T.self, from: try await raw("GET", path)) }
    private func json(_ obj: [String: Any]) -> Data { (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8) }

    func me() async throws -> Me { try await get("/me") }
    func products() async throws -> [Product] { try await get("/products") }
    func stock(_ hotelId: String) async throws -> StockResponse { try await get("/hotels/\(hotelId)/stock") }
    func alerts(_ hotelId: String) async throws -> AlertsResponse { try await get("/dashboard/alerts?hotelId=\(hotelId)") }
    func activity(_ hotelId: String, limit: Int = 40) async throws -> ActivityPage { try await get("/transactions?hotelId=\(hotelId)&limit=\(limit)") }
    func corrections(_ hotelId: String) async throws -> [CorrectionRequest] { try await get("/correction-requests?hotelId=\(hotelId)") }
    func voiceAttempts() async throws -> VoiceAttemptsPage { try await get("/me/voice-attempts?limit=10") }
    func setLanguage(_ lang: String) async { _ = try? await raw("PATCH", "/me", body: json(["language": lang])) }
    func logout() async { _ = try? await raw("POST", "/auth/logout"); clearSession() }

    /// Managers sign in with their employee code and password, as on the website.
    func login(code: String, password: String) async throws {
        _ = try await raw("POST", "/auth/login", body: json(["employeeCode": code, "password": password]))
    }

    // Weekly count
    func countStatus(_ hotelId: String) async throws -> [CountStatus] { try await get("/counts/status?hotelId=\(hotelId)") }
    func startCount(_ hotelId: String) async throws -> CountSheet { try decoder.decode(CountSheet.self, from: try await raw("POST", "/counts", body: json(["hotelId": hotelId]))) }
    func count(_ id: String) async throws -> CountSheet { try await get("/counts/\(id)") }
    func counts(_ hotelId: String) async throws -> [CountSummary] { try await get("/counts?hotelId=\(hotelId)") }
    func patchCount(_ id: String, lines: [[String: Any]]) async throws -> CountSheet {
        try decoder.decode(CountSheet.self, from: try await raw("PATCH", "/counts/\(id)/lines", body: json(["lines": lines])))
    }
    func submitCount(_ id: String, note: String?, key: String) async throws { _ = try await raw("POST", "/counts/\(id)/submit", body: json(note.map { ["note": $0] } ?? [:]), idem: key) }
    func cancelCount(_ id: String) async throws { _ = try await raw("POST", "/counts/\(id)/cancel") }
    func refreshCount(_ id: String) async throws { _ = try await raw("POST", "/counts/\(id)/refresh") }

    // Deliveries between hotels
    func transfers(_ hotelId: String, status: String? = nil) async throws -> [Transfer] { try await get("/transfers?hotelId=\(hotelId)" + (status.map { "&status=\($0)" } ?? "")) }
    func receive(_ id: String, lines: [[String: Any]], final: Bool, key: String) async throws {
        _ = try await raw("POST", "/transfers/\(id)/receipts", body: json(["lines": lines, "final": final]), idem: key)
    }
    func resolve(_ id: String, reason: String, note: String?, key: String) async throws {
        var b: [String: Any] = ["reason": reason]; if let n = note, !n.isEmpty { b["note"] = n }
        _ = try await raw("POST", "/transfers/\(id)/resolve", body: json(b), idem: key)
    }
    func dispatch(from: String, to: String, lines: [[String: Any]], key: String) async throws {
        _ = try await raw("POST", "/transfers", body: json(["fromHotelId": from, "toHotelId": to, "lines": lines]), idem: key)
    }

    // Activity
    func reverse(_ eventId: String, reason: String, key: String) async throws {
        _ = try await raw("POST", "/transactions/\(eventId)/reversal", body: json(["reason": reason]), idem: key)
    }
    func dismissCorrection(_ id: String) async throws { _ = try await raw("POST", "/correction-requests/\(id)/dismiss") }

    /// Text typed (or heard by the phone) — the server reads it the same way as speech.
    func interpret(hotelId: String, text: String, lang: String, durationMs: Int, mode: String? = nil) async throws -> Proposal {
        try await upload(hotelId: hotelId, lang: lang, durationMs: durationMs, mode: mode, file: ("speech.txt", "text/plain", Data(text.utf8)))
    }
    /// The recording itself, so Google's model can hear Gujarati, Hindi and English mixed in one sentence.
    func interpretAudio(hotelId: String, audio: Data, lang: String, durationMs: Int, heard: String, mode: String? = nil) async throws -> Proposal {
        try await upload(hotelId: hotelId, lang: lang, durationMs: durationMs, heard: heard, mode: mode, file: ("speech.m4a", "audio/mp4", audio))
    }
    private func upload(hotelId: String, lang: String, durationMs: Int, heard: String = "", mode: String? = nil, file: (name: String, type: String, data: Data)) async throws -> Proposal {
        let boundary = "sw-\(UUID().uuidString)"
        var d = Data()
        func field(_ name: String, _ value: String) {
            d.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
        }
        field("hotelId", hotelId)
        field("preferredLanguage", localeTag(lang))
        field("durationMs", String(max(0, durationMs)))
        field("client", "ios-manager")
        field("scope", "all")                               // a manager may ask about another hotel they can see
        if let m = mode { field("mode", m) }                // "count": numbers are physical counts, not movements
        if !heard.isEmpty { field("heard", heard) }        // what the phone heard, so the server can still answer if Google is slow
        d.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"\(file.name)\"\r\nContent-Type: \(file.type)\r\n\r\n".utf8))
        d.append(file.data)
        d.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let out = try await raw("POST", "/voice/interpret", body: d, contentType: "multipart/form-data; boundary=\(boundary)")
        return try decoder.decode(Proposal.self, from: out)
    }
}

func localeTag(_ lang: String) -> String { lang == "hi" ? "hi-IN" : lang == "gu" ? "gu-IN" : "en-IN" }
