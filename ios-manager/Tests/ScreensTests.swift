import SwiftUI
import UIKit
import XCTest
@testable import StockwiseManager

final class FakeMic: Mic {
    func available(lang: String) -> Bool { true }
    func hasPermission() -> Bool { true }
    func requestPermission(_ done: @escaping (Bool) -> Void) { done(true) }
    func hasRecordPermission() -> Bool { true }
    func start(lang: String, record: Bool, onInterim: @escaping (String) -> Void, onLevel: @escaping (Float) -> Void, onDone: @escaping (String?) -> Void) {}
    func hasVoice(lang: String) -> Bool { true }
    func takeRecording() -> Data? { nil }
    func stopTalking() {}
    func cancel() {}
    func say(_ text: String, lang: String) {}
}

/// Renders the manager screens with sample data so they can be reviewed without an iPhone.
@MainActor
final class ScreensTests: XCTestCase {
    static let outDir = "/tmp/stockwise-screens"
    private var window: UIWindow?

    private func state() -> AppState {
        let s = AppState(api: Api(base: "https://invalid.invalid"), store: Store(UserDefaults(suiteName: "screens-\(UUID().uuidString)")!), mic: FakeMic())
        s.lang = "en"
        s.me = Me(id: "u1", displayName: "Priya Shah", employeeCode: "M1", role: "MANAGER", language: "en",
                  hotels: [Hotel(id: "h1", name: "Demo Hotel 1", code: "H1"), Hotel(id: "h2", name: "Demo Hotel 2", code: "H2"), Hotel(id: "h3", name: "Demo Hotel 3", code: "H3")], config: nil)
        s.hotelId = "h1"
        func p(_ id: String, _ sku: String, _ name: String, _ gu: String, _ icon: String) -> Product {
            Product(id: id, sku: sku, name: name, icon: icon, unit: "pcs", active: true, aliases: [Alias(locale: "gu", alias: gu)])
        }
        s.products = [p("p1", "SOAP", "Soap", "સાબુ", "🧼"), p("p2", "SHAMPOO", "Shampoo", "શેમ્પૂ", "🧴"), p("p3", "COMB", "Comb", "કાંસકો", "🪮"),
                      p("p4", "TOOTHBRUSH", "Toothbrush", "બ્રશ", "🪥"), p("p5", "TISSUE", "Tissue box", "ટિશ્યૂ", "🧻"), p("p6", "COFFEE", "Coffee sachet", "કૉફી", "☕")]
        func r(_ id: String, _ name: String, _ store: Int, _ th: Int, _ staff: Int) -> StockRow {
            StockRow(productId: id, name: name, icon: nil, unit: "pcs", store: store, staffHeld: staff, inTransitIn: 0, inTransitOut: 0, reorderThreshold: th, low: th > 0 && store < th, out: store == 0)
        }
        s.stock = [r("p1", "Soap", 0, 24, 14), r("p2", "Shampoo", 86, 30, 6), r("p3", "Comb", 18, 20, 4), r("p4", "Toothbrush", 142, 40, 0), r("p5", "Tissue box", 60, 20, 2), r("p6", "Coffee sachet", 310, 100, 0)]
        s.alerts = [
            Alert(id: "a1", severity: "HIGH", category: "LOW_STOCK", hotelId: "h1", title: "Soap out of stock at Demo Hotel 1", detail: "Store 0 pcs, reorder at 24"),
            Alert(id: "a2", severity: "MEDIUM", category: "TRANSFER_DISCREPANCY", hotelId: "h1", title: "Transfer T-118 Demo Hotel 2 → Demo Hotel 1", detail: "12 units not received after 26h"),
            Alert(id: "a3", severity: "MEDIUM", category: "COUNT_OVERDUE", hotelId: "h1", title: "Weekly count overdue at Demo Hotel 1", detail: "Last count 9 days ago"),
        ]
        s.corrections = [CorrectionRequest(id: "c1", eventId: "e1", note: "Room 204 was 2 soap, not 12", createdAt: "2026-11-15T11:50:00Z", requestedByName: "Staff 103")]
        s.countStatus = CountStatus(hotelId: "h1", state: "OVERDUE", lastSubmittedAt: "2026-11-06T09:00:00Z", draftCountId: nil)
        s.transfers = [
            Transfer(id: "t1", refCode: "T-118", status: "DISCREPANCY", dispatchedAt: "2026-11-13T14:20:00Z", fromHotel: NamedRef(id: "h2", name: "Demo Hotel 2"), toHotel: NamedRef(id: "h1", name: "Demo Hotel 1"),
                     lines: [TransferLine(productId: "p2", name: "Shampoo", sent: 40, received: 28, resolvedShort: 0)], outstandingUnits: 12, ageHours: 26, aged: true),
            Transfer(id: "t2", refCode: "T-121", status: "OPEN", dispatchedAt: "2026-11-14T09:05:00Z", fromHotel: NamedRef(id: "h1", name: "Demo Hotel 1"), toHotel: NamedRef(id: "h3", name: "Demo Hotel 3"),
                     lines: [TransferLine(productId: "p1", name: "Soap", sent: 50, received: 0, resolvedShort: 0)], outstandingUnits: 50, ageHours: 31, aged: true),
        ]
        s.recentTransfers = [Transfer(id: "t3", refCode: "T-116", status: "RECEIVED", dispatchedAt: "2026-11-11T10:00:00Z", fromHotel: NamedRef(id: "h3", name: "Demo Hotel 3"), toHotel: NamedRef(id: "h1", name: "Demo Hotel 1"), lines: [TransferLine(productId: "p3", name: "Comb", sent: 30, received: 30, resolvedShort: 0)])]
        let today = ISO8601DateFormatter().string(from: Date())
        s.events = [
            ActivityEvent(eventId: "e1", action: "PLACE_IN_ROOM", createdAt: today, actor: Who(name: "Staff 103", code: "S103"), viaVoice: true, lines: [EventLine(productId: "p1", name: "Soap", quantity: 12, roomNumber: "204")]),
            ActivityEvent(eventId: "e2", action: "CHECKOUT_TO_STAFF", createdAt: today, actor: Who(name: "Staff 101", code: "S101"), viaVoice: true, lines: [EventLine(productId: "p3", name: "Comb", quantity: 10)]),
            ActivityEvent(eventId: "e3", action: "RETURN_TO_STORE", createdAt: today, actor: Who(name: "Staff 101", code: "S101"), viaVoice: false, lines: [EventLine(productId: "p3", name: "Comb", quantity: 5)]),
            ActivityEvent(eventId: "e4", action: "TRANSFER_RECEIPT", createdAt: today, actor: Who(name: "Priya Shah", code: "M1"), viaVoice: false, lines: [EventLine(productId: "p2", name: "Shampoo", quantity: 28)]),
        ]
        return s
    }
    private func sheet() -> CountSheet {
        func l(_ id: String, _ name: String, _ icon: String, _ exp: Int, _ got: Int?, _ reason: String? = nil) -> CountLine {
            CountLine(productId: id, name: name, icon: icon, unit: "pcs", expectedQty: exp, physicalQty: got, reason: reason, variance: got.map { $0 - exp })
        }
        return CountSheet(id: "c1", status: "DRAFT", startedAt: "2026-11-15T10:04:00Z",
                          lines: [l("p1", "Soap", "🧼", 0, 0), l("p2", "Shampoo", "🧴", 86, 80), l("p3", "Comb", "🪮", 18, 18), l("p4", "Toothbrush", "🪥", 142, 142), l("p5", "Tissue box", "🧻", 60, nil), l("p6", "Coffee sachet", "☕", 310, nil)])
    }

    private func spin(_ seconds: TimeInterval) { RunLoop.main.run(until: Date().addingTimeInterval(seconds)) }

    private func shot(_ name: String, _ s: AppState) throws {
        var scene: UIWindowScene?
        for _ in 0..<50 {
            scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            if scene != nil { break }
            spin(0.1)
        }
        let w: UIWindow
        if let scene = scene { w = UIWindow(windowScene: scene) } else { w = UIWindow(frame: UIScreen.main.bounds) }
        w.frame = UIScreen.main.bounds
        w.overrideUserInterfaceStyle = .light
        w.rootViewController = UIHostingController(rootView: RootView().environmentObject(s))
        w.makeKeyAndVisible()
        window?.isHidden = true
        window = w
        spin(1.0)
        let image = UIGraphicsImageRenderer(bounds: w.bounds).image { _ in w.drawHierarchy(in: w.bounds, afterScreenUpdates: true) }
        try FileManager.default.createDirectory(atPath: Self.outDir, withIntermediateDirectories: true)
        try XCTUnwrap(image.pngData()).write(to: URL(fileURLWithPath: "\(Self.outDir)/\(name).png"))
    }

    func test01SignIn() throws { let s = state(); s.me = nil; try shot("m01-sign-in", s) }
    func test02Today() throws { try shot("m02-today", state()) }
    func test03Ask() throws {
        let s = state()
        s.chat = [ChatMessage(role: .me, body: .said("Soap kitna bacha hai?", spoken: true, lang: "hi")),
                  ChatMessage(role: .app, body: .stock([QueryRow(hotelName: "Demo Hotel 1", name: "Soap", unit: "pcs", store: 0, staffHeld: 14, inTransit: 0, low: true)])),
                  ChatMessage(role: .me, body: .said("Aaje combs kone lidha?", spoken: true, lang: "mixed")),
                  ChatMessage(role: .app, body: .stock([QueryRow(hotelName: "Demo Hotel 1", name: "Comb", unit: "pcs", store: 18, staffHeld: 4, inTransit: 0, low: true)]))]
        try shot("m03-ask", s)
    }
    func test04Count() throws { let s = state(); s.tab = .count; s.sheet = sheet(); s.chat = [ChatMessage(role: .me, body: .said("Toothbrush ek so bayalis, comb athar", spoken: true, lang: "mixed")), ChatMessage(role: .app, body: .counted([("Toothbrush", 142), ("Comb", 18)]))]; try shot("m04-count", s) }
    func test05CountStart() throws { let s = state(); s.tab = .count; try shot("m05-count-start", s) }
    func test06Deliveries() throws { let s = state(); s.tab = .deliveries; try shot("m06-deliveries", s) }
    func test07Activity() throws { let s = state(); s.tab = .activity; try shot("m07-activity", s) }
    func test08Menu() throws { let s = state(); s.menuOpen = true; try shot("m08-menu", s) }
    func test09Stock() throws { let s = state(); s.tab = .stock; try shot("m09-stock", s) }
    func test10Gujarati() throws { let s = state(); s.lang = "gu"; try shot("m10-today-gujarati", s) }
    func test11Intro() throws { let s = state(); s.showIntro = true; try shot("m11-intro", s) }
    func test12Listening() throws { let s = state(); s.voiceLive = true; s.voiceStartedAt = Date().addingTimeInterval(-3); s.voiceInterim = "How much shampoo"; s.voiceLevel = 0.6; try shot("m12-listening", s) }

    func testLocalCommands() {
        XCTAssertEqual(localCommand("open count"), .go(.count))
        XCTAssertEqual(localCommand("show deliveries"), .go(.deliveries))
        XCTAssertEqual(localCommand("gujarati"), .language("gu"))
        XCTAssertEqual(localCommand("sign out"), .signOut)
        XCTAssertNil(localCommand("how much soap is left"))
    }
}
