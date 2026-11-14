import SwiftUI
import UIKit

struct FlowScreen: View {
    let f: Flow
    var body: some View {
        switch f.step {
        case .room: RoomStep(f: f)
        case .items: ItemsStep(f: f)
        case .check: CheckStep(f: f)
        case .done: DoneStep(f: f)
        }
    }
}

struct StepHead: View {
    let f: Flow
    let title: String
    let onBack: () -> Void
    var body: some View {
        let steps: [Step] = f.kind.needsRoom ? [.room, .items, .check] : [.items, .check]
        let at = steps.firstIndex(of: f.step) ?? 0
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Button(action: onBack) {
                    Image(systemName: "arrow.left").font(.system(size: 18, weight: .semibold)).foregroundColor(C.ink)
                        .frame(width: 46, height: 46)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(C.line, lineWidth: 1.5))
                }
                .accessibilityLabel("Back")
                HStack(spacing: 6) {
                    ForEach(0..<steps.count, id: \.self) { i in
                        Capsule().fill(i < at ? C.indigo : (i == at ? C.marigold : C.line)).frame(height: 6)
                    }
                }
            }
            Text(title).font(.system(size: 24, weight: .bold)).foregroundColor(C.ink)
        }
    }
}

struct RoomStep: View {
    @EnvironmentObject var s: AppState
    let f: Flow
    @State private var entry = ""
    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"]

    private func pick(_ number: String) {
        guard let r = s.activeRooms.first(where: { $0.roomNumber == number }) else { return }
        var n = f; n.step = .items; n.roomId = r.id; n.roomNumber = r.roomNumber
        s.flow = n
    }
    private func press(_ k: String) {
        if k == "C" { entry = "" }
        else if k == "⌫" { entry = String(entry.dropLast()) }
        else if entry.count < 5 { entry += k }
    }
    var body: some View {
        let t = s.t
        let numbers = s.activeRooms.map { $0.roomNumber }
        let exact = numbers.contains(entry)
        let recent = (s.me.map { s.store.recentRooms($0.id) } ?? []).filter { numbers.contains($0) }
        let matches = entry.isEmpty ? recent : numbers.filter { $0.hasPrefix(entry) }
        VStack(alignment: .leading, spacing: 12) {
            StepHead(f: f, title: t.whichRoom) { s.flow = nil }
            Text(entry.isEmpty ? "—" : entry)
                .font(.system(size: 44, weight: .heavy)).foregroundColor(entry.isEmpty ? C.line : C.ink)
                .frame(maxWidth: .infinity)
            Rectangle().fill(C.marigold).frame(height: 3)
            if !matches.isEmpty {
                HStack(spacing: 8) {
                    ForEach(Array(matches.prefix(4)), id: \.self) { n in
                        Button(action: { pick(n) }) {
                            Text("🚪 \(n)").font(.system(size: 16, weight: .bold)).foregroundColor(n == entry ? .white : C.ink)
                                .padding(.horizontal, 14).padding(.vertical, 8)
                                .background(n == entry ? C.indigo : C.paper)
                                .clipShape(Capsule())
                                .overlay(Capsule().stroke(C.line, lineWidth: 1.5))
                        }
                    }
                }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(keys, id: \.self) { k in
                    Button(action: { press(k) }) {
                        Group {
                            if k == "⌫" { Image(systemName: "delete.left").font(.system(size: 22)) }
                            else { Text(k).font(.system(size: 26, weight: .bold)) }
                        }
                        .foregroundColor(C.ink)
                        .frame(maxWidth: .infinity).frame(height: 60)
                        .background(C.paper)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(C.line, lineWidth: 1))
                    }
                    .accessibilityLabel(k == "⌫" ? "Delete" : k)
                }
            }
            Spacer(minLength: 0)
            BigButton(title: exact ? "\(t.next) · \(t.room) \(entry)" : t.next, enabled: exact) { pick(entry) }
        }
        .padding(16)
        .onAppear { if entry.isEmpty { entry = f.roomNumber ?? "" } }
    }
}

struct ItemsStep: View {
    @EnvironmentObject var s: AppState
    let f: Flow
    private func setQty(_ id: String, _ q: Int) {
        var n = f
        if q <= 0 { n.cart[id] = nil } else { n.cart[id] = q }
        s.flow = n
    }
    private func have(_ p: Product) -> String {
        switch f.kind {
        case .placeInRoom, .returnToStore: return "👜 \(s.bag[p.id] ?? 0)"
        case .checkoutToStaff: return "\(s.t.store) \(s.storeQty[p.id] ?? 0)"
        case .supplierReceipt: return ""
        }
    }
    var body: some View {
        let t = s.t
        let total = f.cart.values.reduce(0, +)
        VStack(alignment: .leading, spacing: 12) {
            StepHead(f: f, title: f.kind == .placeInRoom ? t.whatDidYouPut : t.whichItems) {
                if f.kind.needsRoom { var n = f; n.step = .room; s.flow = n } else { s.flow = nil }
            }
            if let room = f.roomNumber {
                Text("🚪 \(t.room) \(room)").font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 12).padding(.vertical, 6).background(C.indigo).clipShape(Capsule())
            }
            Text(t.tapToAdd).font(.system(size: 15)).foregroundColor(C.ink2)
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2), spacing: 10) {
                    ForEach(s.activeProducts) { p in
                        let q = f.cart[p.id] ?? 0
                        VStack(spacing: 2) {
                            Text(p.emoji).font(.system(size: 34))
                            Text(p.name).font(.system(size: 16, weight: .bold)).foregroundColor(C.ink).lineLimit(1)
                            if let n = p.native(s.lang) { Text(n).font(.system(size: 13)).foregroundColor(C.ink2) }
                            if !have(p).isEmpty { Text(have(p)).font(.system(size: 12)).foregroundColor(C.ink3) }
                        }
                        .frame(maxWidth: .infinity).frame(height: 132)
                        .background(q > 0 ? C.indigoWash : C.paper)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(q > 0 ? C.indigo : C.line, lineWidth: 2))
                        .contentShape(Rectangle())
                        .onTapGesture { setQty(p.id, q + 1) }
                        .overlay(alignment: .topTrailing) {
                            if q > 0 {
                                Text("\(q)").font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                                    .frame(width: 32, height: 32).background(C.indigo).clipShape(Circle()).padding(8)
                            }
                        }
                        .overlay(alignment: .topLeading) {
                            if q > 0 {
                                Button(action: { setQty(p.id, q - 1) }) {
                                    Text("−").font(.system(size: 18, weight: .bold)).foregroundColor(C.ink)
                                        .frame(width: 32, height: 32).background(C.paper).clipShape(Circle())
                                        .overlay(Circle().stroke(C.line, lineWidth: 1))
                                }
                                .padding(8)
                                .accessibilityLabel("One less \(p.name)")
                            }
                        }
                        .accessibilityLabel("\(p.name), \(q)")
                    }
                }
            }
            BigButton(title: total > 0 ? "\(t.check) · \(total)" : t.check, enabled: total > 0) { s.cartToCheck() }
        }
        .padding(16)
    }
}

struct CheckStep: View {
    @EnvironmentObject var s: AppState
    let f: Flow
    var body: some View {
        let t = s.t
        let fromVoice = f.proposalId != nil
        let blocked = s.blocked(f)
        let canSay = fromVoice && !blocked && s.mic.available(lang: s.lang)
        let room = f.lines.first { $0.roomNumber != nil }?.roomNumber
        VStack(alignment: .leading, spacing: 12) {
            StepHead(f: f, title: t.check) {
                if fromVoice { s.flow = nil } else { var n = f; n.step = .items; s.flow = n }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if f.kind == .placeInRoom, let room = room {
                        HStack(spacing: 8) {
                            Text("🚪").font(.system(size: 34))
                            Text(room).font(.system(size: 48, weight: .heavy)).foregroundColor(C.ink)
                        }
                    }
                    Panel {
                        HStack(alignment: .top) {
                            Text(s.summary(f)).font(.system(size: 20, weight: .bold)).foregroundColor(C.ink)
                            Spacer()
                            Button(action: { s.mic.say(s.spokenSummary(f), lang: s.lang) }) {
                                Image(systemName: "speaker.wave.2.fill").font(.system(size: 20)).foregroundColor(C.indigo).frame(width: 40, height: 40)
                            }
                            .accessibilityLabel("Read aloud")
                        }
                        if let said = f.transcript { Text("\(t.heard): “\(said)”").font(.system(size: 13)).foregroundColor(C.ink2) }
                    }
                    ForEach(Array(f.lines.enumerated()), id: \.element.id) { i, l in LineCard(f: f, index: i, l: l) }
                    if let n = s.notice { Banner(text: n.text) }
                }
            }
            if canSay {
                Text((s.hearingYesNo ? "● " : "") + t.holdYesNo)
                    .font(.system(size: 13)).foregroundColor(s.hearingYesNo ? C.brick : C.ink3)
                    .frame(maxWidth: .infinity)
            }
            HStack(spacing: 10) {
                if canSay {
                    Image(systemName: "mic.fill").font(.system(size: 22)).foregroundColor(s.hearingYesNo ? .white : C.ink)
                        .frame(width: 64, height: 58).background(s.hearingYesNo ? C.brick : C.marigold)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .modifier(HoldToTalk(onStart: { s.yesNoStart() }, onSend: { s.yesNoSend() }, onCancel: { s.yesNoCancel() }, onTap: { s.notice = Notice(text: t.holdHint) }))
                        .accessibilityLabel(t.holdYesNo)
                }
                if fromVoice {
                    Button(action: { s.flow = nil }) {
                        Image(systemName: "xmark").font(.system(size: 20, weight: .semibold)).foregroundColor(C.ink)
                            .frame(width: 64, height: 58)
                            .overlay(RoundedRectangle(cornerRadius: 16).stroke(C.ink3, lineWidth: 1.5))
                    }
                    .accessibilityLabel("Cancel")
                }
                Button(action: { s.confirm() }) {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark").font(.system(size: 18, weight: .bold))
                        Text(s.busy ? "…" : t.confirm).font(.system(size: 17, weight: .bold))
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 58)
                    .background(blocked || s.busy ? C.line : C.mint)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                }
                .disabled(blocked || s.busy)
            }
        }
        .padding(16)
        .onAppear { if fromVoice && !blocked { s.mic.say(s.spokenSummary(f), lang: s.lang) } }
    }
}

struct LineCard: View {
    @EnvironmentObject var s: AppState
    let f: Flow
    let index: Int
    let l: Line

    private func edit(_ change: (inout Line) -> Void) {
        guard var n = s.flow, index < n.lines.count else { return }
        change(&n.lines[index])
        s.flow = n
    }
    private var place: Bool { f.kind == .placeInRoom }
    private var short: Bool {
        guard let id = l.productId else { return false }
        switch f.kind {
        case .placeInRoom: return l.source == "MY_STOCK" ? l.quantity > (s.bag[id] ?? 0) : (l.source == "STORE" ? l.quantity > (s.storeQty[id] ?? 0) : false)
        case .returnToStore: return l.quantity > (s.bag[id] ?? 0)
        case .checkoutToStaff: return l.quantity > (s.storeQty[id] ?? 0)
        case .supplierReceipt: return false
        }
    }
    var body: some View {
        let t = s.t
        let p = s.product(l.productId)
        let flagged = p == nil || short || (place && l.source == nil) || !l.issues.isEmpty
        let allowStore = s.hotel?.allowStoreToRoom != false
        Panel(border: flagged ? C.marigold : C.line, bg: flagged ? Color(hex: 0xFFFBF2) : C.paper) {
            HStack(spacing: 10) {
                Text(p?.emoji ?? "❓").font(.system(size: 30))
                VStack(alignment: .leading, spacing: 2) {
                    if let p = p {
                        Text(p.name).font(.system(size: 17, weight: .semibold)).foregroundColor(C.ink)
                        if let n = p.native(s.lang) { Text(n).font(.system(size: 13)).foregroundColor(C.ink2) }
                    } else {
                        Text("\(t.chooseItem) (“\(l.spoken)”)").font(.system(size: 16, weight: .bold)).foregroundColor(C.amber)
                    }
                    if let r = l.roomNumber { Text("\(t.room) \(r)").font(.system(size: 13)).foregroundColor(C.indigo) }
                }
                Spacer(minLength: 0)
                HStack(spacing: 0) {
                    Button(action: { if l.quantity > 1 { edit { $0.quantity -= 1 } } }) {
                        Text("−").font(.system(size: 22, weight: .bold)).foregroundColor(C.ink).frame(width: 46, height: 46).background(C.linen)
                    }
                    .accessibilityLabel("Less")
                    Text("\(l.quantity)").font(.system(size: 20, weight: .bold)).foregroundColor(C.ink).frame(width: 44)
                    Button(action: { edit { $0.quantity += 1 } }) {
                        Text("+").font(.system(size: 22, weight: .bold)).foregroundColor(C.ink).frame(width: 46, height: 46).background(C.linen)
                    }
                    .accessibilityLabel("More")
                }
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(C.line, lineWidth: 1.5))
            }
            if p == nil {
                HStack(spacing: 8) {
                    ForEach(Array(s.activeProducts.prefix(6))) { c in
                        Button(action: { edit { $0.productId = c.id; $0.source = place ? s.defaultSource(c.id, $0.quantity) : nil } }) {
                            Text(c.emoji).font(.system(size: 24)).padding(8)
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(C.line, lineWidth: 1.5))
                        }
                        .accessibilityLabel(c.name)
                    }
                }
            }
            if place, let p = p {
                HStack(spacing: 0) {
                    sourceButton("MY_STOCK", "\(t.fromBag) (\(s.bag[p.id] ?? 0))")
                    if allowStore { sourceButton("STORE", "\(t.fromStore) (\(s.storeQty[p.id] ?? 0))") }
                }
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(C.line, lineWidth: 1.5))
                if l.source == nil { Text(t.chooseFrom).font(.system(size: 13)).foregroundColor(C.amber) }
            }
            if short, let id = l.productId {
                Text("⚠ " + (f.kind == .checkoutToStaff || l.source == "STORE" ? "\(t.store): \(s.storeQty[id] ?? 0)" : "👜 \(s.bag[id] ?? 0)"))
                    .font(.system(size: 13)).foregroundColor(C.brick)
            }
        }
    }
    private func sourceButton(_ src: String, _ label: String) -> some View {
        let on = l.source == src
        return Button(action: { edit { $0.source = src } }) {
            Text(label).font(.system(size: 14, weight: .semibold)).foregroundColor(on ? .white : C.ink)
                .frame(maxWidth: .infinity).frame(height: 48).background(on ? C.indigo : C.paper)
        }
    }
}

struct DoneStep: View {
    @EnvironmentObject var s: AppState
    let f: Flow
    @State private var left: CGFloat = 1
    var body: some View {
        let t = s.t
        let fromVoice = f.proposalId != nil
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "checkmark").font(.system(size: 56, weight: .bold)).foregroundColor(.white)
                .frame(width: 120, height: 120).background(f.offline ? C.marigold : C.mint).clipShape(Circle())
            Text(f.offline ? t.pending : t.saved).font(.system(size: 24, weight: .bold)).foregroundColor(C.ink)
            Text(s.summary(f)).font(.system(size: 17, weight: .semibold)).foregroundColor(C.ink).multilineTextAlignment(.center)
            if f.offline { Banner(text: t.savedOnPhone) }
            else if let ref = f.ref { Text("Ref \(ref)").font(.system(size: 15)).foregroundColor(C.ink3) }
            if fromVoice {
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(C.line)
                        Capsule().fill(C.mint).frame(width: g.size.width * left)
                    }
                }
                .frame(width: 220, height: 6)
                Text(t.backSoon).font(.system(size: 15)).foregroundColor(C.ink3)
            }
            BigButton(title: t.doAnother) { s.flow = Flow(kind: f.kind, step: f.kind.needsRoom ? .room : .items) }
            BigButton(title: t.home, outline: true) { s.flow = nil }
            Spacer()
        }
        .padding(24)
        .onAppear { UINotificationFeedbackGenerator().notificationOccurred(.success) }
        .task {
            guard fromVoice else { return }
            withAnimation(.linear(duration: 3.5)) { left = 0 }
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            if !Task.isCancelled, s.flow?.step == .done { s.flow = nil }
        }
    }
}
