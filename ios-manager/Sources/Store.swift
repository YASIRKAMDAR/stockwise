import Foundation

/// On-device storage: language, chosen hotel, last code, whether the walkthrough was seen.
final class Store {
    private let d: UserDefaults
    init(_ defaults: UserDefaults = .standard) { d = defaults }
    var lang: String { get { d.string(forKey: "lang") ?? "en" } set { d.set(newValue, forKey: "lang") } }
    var hotelId: String? { get { d.string(forKey: "hotelId") } set { d.set(newValue, forKey: "hotelId") } }
    var introSeen: Bool { get { d.bool(forKey: "introSeen") } set { d.set(newValue, forKey: "introSeen") } }
    var lastCode: String { get { d.string(forKey: "lastCode") ?? "" } set { d.set(newValue, forKey: "lastCode") } }
}
