import Foundation

struct ApiError: Error { let status: Int; let code: String; let message: String }
struct OfflineError: Error {}

/// Talks to the same Stockwise server as the website. The sign-in cookie is kept by the system cookie store.
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
    func rooms(_ hotelId: String) async throws -> [Room] { try await get("/hotels/\(hotelId)/rooms") }
    func bag(_ hotelId: String) async throws -> BagResponse { try await get("/me/stock?hotelId=\(hotelId)") }
    func store(_ hotelId: String) async throws -> StoreResponse { try await get("/hotels/\(hotelId)/stock") }
    func activity(_ hotelId: String) async throws -> ActivityPage { try await get("/transactions?hotelId=\(hotelId)&limit=20") }
    func setLanguage(_ lang: String) async { _ = try? await raw("PATCH", "/me", body: json(["language": lang])) }
    func logout() async { _ = try? await raw("POST", "/auth/logout"); clearSession() }

    /// Staff sign in with their code and passcode only.
    func staffLogin(code: String, pin: String) async throws {
        _ = try await raw("POST", "/auth/staff-login", body: json(["employeeCode": code, "pin": pin]))
    }
    func postTransaction(_ body: Data, key: String) async throws -> TxResult {
        try decoder.decode(TxResult.self, from: try await raw("POST", "/transactions", body: body, idem: key))
    }

    /// Speech is turned into text on the phone; the server reads it the same way as typed text.
    func interpret(hotelId: String, text: String, lang: String, durationMs: Int) async throws -> Proposal {
        let boundary = "sw-\(UUID().uuidString)"
        var d = Data()
        func field(_ name: String, _ value: String) {
            d.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
        }
        field("hotelId", hotelId)
        field("preferredLanguage", localeTag(lang))
        field("durationMs", String(max(0, durationMs)))
        d.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"speech.txt\"\r\nContent-Type: text/plain\r\n\r\n".utf8))
        d.append(Data(text.utf8))
        d.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let out = try await raw("POST", "/voice/interpret", body: d, contentType: "multipart/form-data; boundary=\(boundary)")
        return try decoder.decode(Proposal.self, from: out)
    }
}

func localeTag(_ lang: String) -> String { lang == "hi" ? "hi-IN" : lang == "gu" ? "gu-IN" : "en-IN" }
