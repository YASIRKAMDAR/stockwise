import Foundation

/// On-device storage: language, last code, recent rooms and the offline queue.
final class Store {
    private let d: UserDefaults
    init(_ defaults: UserDefaults = .standard) { d = defaults }

    var lang: String {
        get { d.string(forKey: "lang") ?? "en" }
        set { d.set(newValue, forKey: "lang") }
    }
    var lastCode: String {
        get { d.string(forKey: "lastCode") ?? "" }
        set { d.set(newValue, forKey: "lastCode") }
    }
    func recentRooms(_ userId: String) -> [String] { d.stringArray(forKey: "rooms_\(userId)") ?? [] }
    func addRecentRooms(_ userId: String, _ rooms: [String]) {
        let next = rooms + recentRooms(userId).filter { !rooms.contains($0) }
        d.set(Array(next.prefix(6)), forKey: "rooms_\(userId)")
    }
    var outbox: [Pending] {
        get {
            guard let data = d.data(forKey: "outbox") else { return [] }
            return (try? JSONDecoder().decode([Pending].self, from: data)) ?? []
        }
        set { d.set(try? JSONEncoder().encode(newValue), forKey: "outbox") }
    }
    func enqueue(_ p: Pending) { outbox = outbox.filter { $0.key != p.key } + [p] }
    func dequeue(_ key: String) { outbox = outbox.filter { $0.key != key } }
    func markFailed(_ key: String, _ error: String) {
        outbox = outbox.map { p in var q = p; if q.key == key { q.error = error }; return q }
    }
}
