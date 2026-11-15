import SwiftUI
import UIKit
import XCTest
@testable import StockwiseStaff

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

/// Renders the staff screens with sample data so they can be reviewed without an iPhone.
@MainActor
final class ScreensTests: XCTestCase {
    static let outDir = "/tmp/stockwise-screens"
    private var window: UIWindow?

    private func state() -> AppState {
        let s = AppState(api: Api(base: "https://invalid.invalid"), store: Store(UserDefaults(suiteName: "screens-\(UUID().uuidString)")!), mic: FakeMic())
        s.booting = false
        s.lang = "en"
        s.me = Me(id: "u1", displayName: "Staff 101", employeeCode: "S101", language: "en",
                  hotels: [Hotel(id: "h1", name: "Demo Hotel 1", allowStoreToRoom: true)], activeHotel: "h1", config: nil)
        func p(_ id: String, _ sku: String, _ name: String, _ gu: String) -> Product {
            Product(id: id, sku: sku, name: name, icon: nil, active: true, aliases: [Alias(locale: "gu", alias: gu)])
        }
        s.products = [p("p1", "SOAP", "Soap", "સાબુ"), p("p2", "SHAMPOO", "Shampoo", "શેમ્પૂ"), p("p3", "COMB", "Comb", "કાંસકો"),
                      p("p4", "DENTAL_KIT", "Dental kit", "ડેન્ટલ કિટ"), p("p5", "TOOTHBRUSH", "Toothbrush", "બ્રશ"), p("p6", "TOOTHPASTE", "Toothpaste", "પેસ્ટ")]
        s.rooms = (Array(201...210) + Array(101...105)).map { Room(id: "r\($0)", roomNumber: "\($0)", active: true) }
        s.bag = ["p1": 8, "p2": 4]
        s.storeQty = ["p1": 180, "p2": 110, "p3": 80, "p4": 70, "p5": 70, "p6": 60]
        s.history = [
            ActivityEvent(eventId: "e1", action: "PLACE_IN_ROOM", createdAt: "2026-11-14T10:05:00.000Z", viaVoice: true,
                          lines: [EventLine(name: "Soap", quantity: 2, roomNumber: "203"), EventLine(name: "Shampoo", quantity: 1, roomNumber: "203")]),
            ActivityEvent(eventId: "e2", action: "CHECKOUT_TO_STAFF", createdAt: "2026-11-14T09:40:00.000Z", viaVoice: false,
                          lines: [EventLine(name: "Soap", quantity: 10, roomNumber: nil)]),
        ]
        return s
    }
    private func lines() -> [Line] {
        [Line(productId: "p1", quantity: 2, roomId: "r203", roomNumber: "203", source: "MY_STOCK"),
         Line(productId: "p2", quantity: 1, roomId: "r203", roomNumber: "203", source: "MY_STOCK")]
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
        let image = UIGraphicsImageRenderer(bounds: w.bounds).image { _ in
            w.drawHierarchy(in: w.bounds, afterScreenUpdates: true)
        }
        try FileManager.default.createDirectory(atPath: Self.outDir, withIntermediateDirectories: true)
        let data = try XCTUnwrap(image.pngData())
        try data.write(to: URL(fileURLWithPath: "\(Self.outDir)/\(name).png"))
    }

    func test01SignIn() throws { let s = state(); s.me = nil; try shot("01-sign-in", s) }
    func test02Home() throws { try shot("02-home", state()) }
    func test03Menu() throws { let s = state(); s.menuOpen = true; try shot("03-menu", s) }
    func test04Holding() throws {
        let s = state()
        s.voiceLive = true; s.voiceStartedAt = Date().addingTimeInterval(-2); s.voiceInterim = "Room 203, two soap and one shampoo"
        try shot("04-holding-mic", s)
    }
    func test05Room() throws { let s = state(); s.flow = Flow(kind: .placeInRoom, step: .room); try shot("05-which-room", s) }
    func test06Items() throws {
        let s = state()
        s.flow = Flow(kind: .placeInRoom, step: .items, roomId: "r203", roomNumber: "203", cart: ["p1": 2, "p2": 1])
        try shot("06-items", s)
    }
    func test07Check() throws {
        let s = state()
        s.flow = Flow(kind: .placeInRoom, step: .check, roomId: "r203", roomNumber: "203", lines: lines(), proposalId: "x", transcript: "Room 203, two soap and one shampoo")
        try shot("07-check", s)
    }
    func test08Saved() throws {
        let s = state()
        s.flow = Flow(kind: .placeInRoom, step: .done, roomId: "r203", roomNumber: "203", lines: lines(), ref: "DEFB28")
        try shot("08-saved", s)
    }
    func test09SavedOffline() throws {
        let s = state()
        s.flow = Flow(kind: .placeInRoom, step: .done, roomId: "r203", roomNumber: "203", lines: [lines()[0]], offline: true)
        try shot("09-saved-offline", s)
    }
    func test10Bag() throws { let s = state(); s.tab = .bag; try shot("10-my-bag", s) }
    func test11History() throws { let s = state(); s.tab = .history; try shot("11-history", s) }
    func test12Gujarati() throws { let s = state(); s.lang = "gu"; try shot("12-home-gujarati", s) }

    private func proposal(_ state: ChatState) -> ChatMessage {
        ChatMessage(role: .app, body: .proposal(Flow(kind: .placeInRoom, step: .check, roomId: "r203", roomNumber: "203", lines: lines(), proposalId: "x"), state))
    }
    private func said(_ text: String, _ spoken: Bool = true) -> ChatMessage { ChatMessage(role: .me, body: .said(text, spoken: spoken)) }
    func test13ChatCheck() throws {
        let s = state()
        s.chat = [said("Room 203, two soap and one shampoo"), proposal(.ready)]
        try shot("13-chat-check", s)
    }
    func test14ChatSavedStockBag() throws {
        let s = state()
        s.chat = [said("Room 203, two soap and one shampoo"), proposal(.saved("DEFB28")),
                  said("How many soap are left?"), ChatMessage(role: .app, body: .stock([QueryRow(productId: "p1", name: "Soap", store: 180)])),
                  said("my bag", false), ChatMessage(role: .app, body: .bag([BagLine(name: "Soap", native: nil, emoji: "🧼", qty: 8), BagLine(name: "Shampoo", native: nil, emoji: "🧴", qty: 4)]))]
        try shot("14-chat-saved-stock-bag", s)
    }
    func test15ChatListening() throws {
        let s = state()
        s.chat = [said("Room 203, two soap and one shampoo"), proposal(.saved("DEFB28"))]
        s.voiceLive = true; s.voiceStartedAt = Date().addingTimeInterval(-2); s.voiceInterim = "Take ten soap from the"; s.voiceLevel = 0.7
        try shot("15-chat-listening", s)
    }
    func test17ChatLanguageTagAndWaiting() throws {
        let s = state()
        s.chat = [ChatMessage(role: .me, body: .said("Room 203 ma do soap aur ek shampoo mukyu", spoken: true, lang: "mixed"))]
        s.busy = true; s.waitingLong = true
        try shot("17-chat-still-asking", s)
    }
    func test18ChatRetry() throws {
        let s = state()
        s.chat = [ChatMessage(role: .me, body: .said("…", spoken: true)), ChatMessage(role: .app, body: .retry(heard: ""))]
        try shot("18-chat-google-slow", s)
    }
    func test19ChatFallbackNote() throws {
        let s = state()
        s.chat = [ChatMessage(role: .me, body: .said("Return two soap to store", spoken: true, lang: "en")),
                  ChatMessage(role: .app, body: .text(T(lang: "en").fromPhoneWords, warn: true)), proposal(.ready)]
        try shot("19-chat-from-phone-words", s)
    }
    func test16ChatNotUnderstood() throws {
        let s = state()
        s.chat = [said("umm the thing"), ChatMessage(role: .app, body: .text(T(lang: "en").notUnderstood, warn: true))]
        try shot("16-chat-not-understood", s)
    }
    func testLocalCommands() {
        XCTAssertEqual(localCommand("my bag"), .go(.bag))
        XCTAssertEqual(localCommand("show history"), .go(.history))
        XCTAssertEqual(localCommand("Sign out"), .signOut)
        XCTAssertEqual(localCommand("ગુજરાતી"), .language("gu"))
        XCTAssertNil(localCommand("take two soap from my bag to room 203"))
        XCTAssertNil(localCommand("room 203 one soap from bag"))
    }
    func testYesNoWords() {
        XCTAssertEqual(yesNo("haan"), true)
        XCTAssertEqual(yesNo("ના"), false)
        XCTAssertNil(yesNo("room 203"))
    }
}
