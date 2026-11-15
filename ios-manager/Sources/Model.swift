import Foundation

// Server shapes (same API as the website). Only the fields the app reads.

struct Hotel: Codable, Identifiable { let id: String; let name: String; var code: String?; var timezone: String?; var roles: [String]? }
struct MeConfig: Codable { var voiceProvider: String?; var voiceMaxSeconds: Int? }
struct Me: Codable {
    let id: String; let displayName: String
    var employeeCode: String?; var role: String?; var language: String?; var hotels: [Hotel]; var config: MeConfig?
}
struct Alias: Codable { var locale: String?; let alias: String }
struct Product: Codable, Identifiable { let id: String; let sku: String; let name: String; var icon: String?; var unit: String?; var active: Bool?; var aliases: [Alias]? }

/// One product at one hotel: store level, what staff carry, and the reorder line.
struct StockRow: Codable, Identifiable {
    let productId: String; let name: String; var icon: String?; var unit: String?
    let store: Int; var staffHeld: Int?; var inTransitIn: Int?; var inTransitOut: Int?; var reorderThreshold: Int?; var low: Bool?; var out: Bool?
    var id: String { productId }
}
struct StockResponse: Codable { let items: [StockRow] }

struct Alert: Codable, Identifiable {
    let id: String; let severity: String; let category: String; let hotelId: String; let title: String; var detail: String?; var createdAt: String?
}
struct AlertsResponse: Codable { let items: [Alert] }

struct CountStatus: Codable { let hotelId: String; let state: String; var lastSubmittedAt: String?; var draftCountId: String? }
struct CountLine: Codable, Identifiable {
    let productId: String; let name: String; var icon: String?; var unit: String?
    let expectedQty: Int; var physicalQty: Int?; var reason: String?; var variance: Int?; var changedSinceSnapshot: Bool?
    var id: String { productId }
}
struct CountSheet: Codable { let id: String; let status: String; var startedAt: String?; var lines: [CountLine]; var changedCount: Int? }
struct CountSummary: Codable, Identifiable { let id: String; var status: String?; var submittedAt: String?; var startedAt: String?; var absVariance: Int?; var expected: Int? }

struct TransferLine: Codable { let productId: String; let name: String; var unit: String?; let sent: Int; let received: Int; let resolvedShort: Int }
struct NamedRef: Codable { let id: String; let name: String }
struct Transfer: Codable, Identifiable {
    let id: String; let refCode: String; let status: String; var dispatchedAt: String?; var note: String?
    let fromHotel: NamedRef; let toHotel: NamedRef; var dispatchedBy: NamedRef?
    var lines: [TransferLine]; var outstandingUnits: Int?; var ageHours: Double?; var aged: Bool?
}

struct EventLine: Codable { let productId: String; let name: String; let quantity: Int; var roomNumber: String?; var fromType: String?; var toType: String? }
struct Who: Codable { var name: String?; var code: String? }
struct ActivityEvent: Codable, Identifiable {
    let eventId: String; let action: String; let createdAt: String; var note: String?; var reason: String?
    var hotelName: String?; var actor: Who?; var reversalOf: String?; var reversedBy: String?; var viaVoice: Bool?; var lines: [EventLine]
    var id: String { eventId }
}
struct ActivityPage: Codable { let items: [ActivityEvent]; var nextCursor: String? }

struct CorrectionRequest: Codable, Identifiable {
    let id: String; let eventId: String; var note: String?; var createdAt: String?; var requestedByName: String?; var displayName: String?; var status: String?
}

/// What the server proposes from speech or typed text. Never written without a tap.
struct ProposalLine: Codable {
    var productId: String?; var productName: String?; var spokenProduct: String?; var quantity: Int?; var roomNumber: String?; var issues: [String]?
}
struct QueryRow: Codable { let hotelName: String?; let name: String; var unit: String?; let store: Int; var staffHeld: Int?; var inTransit: Int?; var low: Bool? }
struct Proposal: Codable {
    let proposalId: String?; let status: String; var action: String?; var transcript: String?; var targetHotelId: String?
    var lines: [ProposalLine]; var warnings: [String]?; var clarificationQuestion: String?; var queryResult: [QueryRow]?
    var detectedLanguage: String?
}

struct VoiceAttempt: Codable, Identifiable {
    let createdAt: String; let status: String; var errorCode: String?; var language: String?; var client: String?
    var inputKind: String?; var fallback: String?; var latencyMs: Int?; var transcript: String?; var action: String?; var confirmed: Bool?
    var id: String { createdAt + (transcript ?? "") }
}
struct VoiceAttemptsPage: Codable { let attempts: [VoiceAttempt] }

// App state shapes

enum AppTab { case today, count, stock, deliveries, activity, attempts }

struct Notice: Equatable { let text: String; var warn: Bool = true }

enum ChatRole { case me, app }
enum ChatBody {
    case said(String, spoken: Bool, lang: String? = nil)
    case text(String, warn: Bool)
    case stock([QueryRow])
    case counted([(name: String, qty: Int?)])
    case retry(heard: String)
}
struct ChatMessage: Identifiable { let id = UUID(); let role: ChatRole; var body: ChatBody }

extension Product {
    func native(_ lang: String) -> String? {
        aliases?.first { $0.locale?.hasPrefix(lang) == true }?.alias
    }
    var emoji: String { icon ?? "📦" }
}

extension String {
    /// "2026-11-15T10:03:46.123Z" -> Date
    var isoDate: Date? {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: self) { return d }
        f.formatOptions = [.withInternetDateTime]; return f.date(from: self)
    }
}

struct ApiErrorInner: Codable { var code: String?; var message: String? }
struct ApiErrorBody: Codable { var error: ApiErrorInner? }
