import Foundation

struct Hotel: Codable { let id: String; let name: String; var allowStoreToRoom: Bool? }
struct MeConfig: Codable { var voiceProvider: String?; var voiceMaxSeconds: Int? }
struct Me: Codable {
    let id: String; let displayName: String
    var employeeCode: String?; var language: String?; var hotels: [Hotel]; var activeHotel: String?; var config: MeConfig?
}
struct Alias: Codable { var locale: String?; let alias: String }
struct Product: Codable, Identifiable {
    let id: String; let sku: String; let name: String
    var icon: String?; var active: Bool?; var aliases: [Alias]?
}
struct Room: Codable, Identifiable { let id: String; let roomNumber: String; var active: Bool? }
struct BagItem: Codable { let productId: String; let quantity: Int }
struct BagResponse: Codable { let items: [BagItem] }
struct StoreRow: Codable { let productId: String; let store: Int }
struct StoreResponse: Codable { let items: [StoreRow] }
struct ProposalLine: Codable {
    var productId: String?; var spokenProduct: String?; var quantity: Int?
    var roomId: String?; var roomNumber: String?; var source: String?; var issues: [String]?
}
struct QueryRow: Codable { let productId: String; let name: String; var store: Int? }
struct Proposal: Codable {
    let proposalId: String; let status: String; let action: String
    var transcript: String?; var lines: [ProposalLine]?; var queryResult: [QueryRow]?
    var detectedLanguage: String?; var warnings: [String]?
}
struct EventLine: Codable { var name: String?; var quantity: Int?; var roomNumber: String? }
struct ActivityEvent: Codable, Identifiable {
    let eventId: String; let action: String; let createdAt: String
    var viaVoice: Bool?; var lines: [EventLine]?
    var id: String { eventId }
}
struct ActivityPage: Codable { let items: [ActivityEvent] }
/// One of the staff member's own recent voice attempts, as the server logged it (never audio).
struct VoiceAttempt: Codable, Identifiable {
    let createdAt: String; let status: String; var errorCode: String?; var language: String?; var client: String?
    var inputKind: String?; var fallback: String?; var latencyMs: Int?; var transcript: String?; var action: String?; var confirmed: Bool?
    var id: String { createdAt + (transcript ?? "") }
}
struct VoiceAttemptsPage: Codable { let attempts: [VoiceAttempt] }
struct TxResult: Codable { let eventId: String }
struct ApiErrorInner: Codable { var code: String?; var message: String? }
struct ApiErrorBody: Codable { var error: ApiErrorInner? }

/// The jobs a housekeeping phone records.
enum Kind: String {
    case placeInRoom = "PLACE_IN_ROOM", checkoutToStaff = "CHECKOUT_TO_STAFF", returnToStore = "RETURN_TO_STORE", supplierReceipt = "SUPPLIER_RECEIPT"
    var needsRoom: Bool { self == .placeInRoom }
}

/// One line on the check screen. source: STORE | MY_STOCK (only when putting items in a room).
struct Line: Identifiable {
    let id = UUID()
    var productId: String?; var quantity: Int
    var roomId: String? = nil; var roomNumber: String? = nil; var source: String? = nil
    var spoken: String = ""; var issues: [String] = []
}

enum AppTab { case home, bag, history, attempts }
enum Step { case room, items, check, done }
struct Flow {
    var kind: Kind; var step: Step
    var roomId: String? = nil; var roomNumber: String? = nil
    var cart: [String: Int] = [:]; var lines: [Line] = []
    var proposalId: String? = nil; var transcript: String? = nil; var ref: String? = nil; var offline: Bool = false
}
struct Notice { let text: String; var warn: Bool = true }

/// A job saved on the phone while offline; sent later with the same key so it can't be recorded twice.
struct Pending: Codable, Identifiable {
    let key: String; let body: String; let label: String; let createdAt: Double; var error: String?
    var id: String { key }
}

private let emojiBySku: [String: String] = ["SOAP": "🧼", "SHAMPOO": "🧴", "COMB": "🪮", "DENTAL_KIT": "🦷", "TOOTHBRUSH": "🪥", "TOOTHPASTE": "🦷"]
extension Product {
    var emoji: String { if let i = icon, !i.isEmpty { return i }; return emojiBySku[sku] ?? "📦" }
    /// The item's name in the staff member's own script, when the catalog has one.
    func native(_ lang: String) -> String? {
        if lang == "en" { return nil }
        let range: ClosedRange<UInt32> = lang == "gu" ? 0x0A80...0x0AFF : 0x0900...0x097F
        return (aliases ?? []).first { a in a.alias.unicodeScalars.contains { range.contains($0.value) } }?.alias
    }
}

// ---------- conversation ----------
enum ChatRole { case me, app }
enum ChatState { case ready, saving, saved(String), offline, cancelled }
struct BagLine: Hashable { let name: String; let native: String?; let emoji: String; let qty: Int }
enum ChatBody {
    case said(String, spoken: Bool, lang: String? = nil)
    /// Google didn't answer in time: offer to say it again or type it.
    case retry(heard: String)
    case text(String, warn: Bool)
    case proposal(Flow, ChatState)
    case stock([QueryRow])
    case bag([BagLine])
}
struct ChatMessage: Identifiable {
    let id = UUID()
    let role: ChatRole
    var body: ChatBody
}
