import SwiftUI

// MARK: - Weekly count

struct CountScreen: View {
    @EnvironmentObject var s: AppState
    @State private var editing: String?          // productId whose box is being typed into
    @State private var typed = ""
    @State private var reasonFor: String?        // productId needing a reason
    @State private var confirmCancel = false
    var body: some View {
        let t = s.t
        if let sheet = s.sheet {
            let done = sheet.lines.filter { $0.physicalQty != nil }.count
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(t.progress(done, sheet.lines.count)).font(.system(size: 14, weight: .semibold)).foregroundColor(C.ink2)
                        Spacer()
                        if s.countSaving { ProgressView().scaleEffect(0.8) } else if s.lastSaved != nil { Text(t.saved).font(.system(size: 12)).foregroundColor(C.mint) }
                    }
                    if (sheet.changedCount ?? 0) > 0 { Banner(text: t.stockMoved) }
                    Panel {
                        ForEach(sheet.lines) { l in
                            let diff = (l.variance ?? 0) != 0
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 10) {
                                    Text(s.productById[l.productId]?.emoji ?? l.icon ?? "📦").font(.system(size: 24)).frame(width: 32)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(s.productById[l.productId]?.native(s.lang) ?? l.name).font(.system(size: 16, weight: .bold)).foregroundColor(C.ink)
                                        Text("\(t.book) \(l.expectedQty)").font(.system(size: 12)).foregroundColor(C.ink2)
                                    }
                                    Spacer()
                                    if editing == l.productId {
                                        TextField("", text: $typed).keyboardType(.numberPad).font(.system(size: 20, weight: .heavy)).multilineTextAlignment(.center)
                                            .frame(width: 72, height: 44).background(C.paper).clipShape(RoundedRectangle(cornerRadius: 12))
                                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(C.indigo, lineWidth: 2))
                                        Button(action: { if let n = Int(typed) { s.setCount(l.productId, qty: n); if n != l.expectedQty { reasonFor = l.productId } }; editing = nil }) {
                                            Image(systemName: "checkmark").font(.system(size: 16, weight: .bold)).foregroundColor(.white).frame(width: 40, height: 40).background(C.mint).clipShape(Circle())
                                        }
                                    } else {
                                        Button(action: { editing = l.productId; typed = l.physicalQty.map(String.init) ?? "" }) {
                                            QtyBox(value: l.physicalQty,
                                                   tone: l.physicalQty == nil ? C.line : diff ? C.marigold : C.mint,
                                                   bg: l.physicalQty == nil ? C.paper : diff ? C.marigoldWash : C.mintWash,
                                                   fg: l.physicalQty == nil ? C.ink3 : diff ? C.amber : C.mint)
                                        }
                                    }
                                }
                                if diff && l.physicalQty != nil {
                                    HStack(spacing: 6) {
                                        Text(l.reason.map { t.reason($0) } ?? t.reasonAsk).font(.system(size: 13, weight: .semibold)).foregroundColor(C.amber)
                                        Spacer()
                                        Button(action: { reasonFor = l.productId }) { Tag(text: l.reason == nil ? "?" : "✎", color: C.amber, bg: C.marigoldWash) }
                                    }.padding(.leading, 42)
                                }
                            }
                            .padding(.vertical, 6)
                            if l.id != sheet.lines.last?.id { Rectangle().fill(C.line).frame(height: 1) }
                        }
                    }
                    if done < sheet.lines.count { Text(t.left(sheet.lines.count - done)).font(.system(size: 13)).foregroundColor(C.ink2).frame(maxWidth: .infinity) }
                    BigButton(title: t.submitCount, color: C.mint, enabled: s.countReady.ok) { s.submitCount() }
                    Button(t.cancelCount) { confirmCancel = true }.font(.system(size: 15)).foregroundColor(C.brick).frame(maxWidth: .infinity)
                    Color.clear.frame(height: 40)
                }
                .padding(14)
            }
            .confirmationDialog(t.cancelCount, isPresented: $confirmCancel) { Button(t.cancelCount, role: .destructive) { s.cancelCount() } }
            .sheet(item: Binding(get: { reasonFor.map { ReasonPick(productId: $0) } }, set: { reasonFor = $0?.productId })) { r in
                ReasonSheet(productId: r.productId) { reasonFor = nil }
            }
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    let st = s.countStatus?.state ?? "DUE"
                    Panel(border: st == "OVERDUE" ? C.brick : st == "COMPLETED" ? C.mint : C.marigold) {
                        Text(st == "COMPLETED" ? t.countDone : st == "OVERDUE" ? t.countOverdue : t.countDue).font(.system(size: 18, weight: .bold)).foregroundColor(C.ink)
                        if let last = s.countStatus?.lastSubmittedAt?.isoDate { Text(last.formatted(date: .abbreviated, time: .shortened)).font(.system(size: 13)).foregroundColor(C.ink2) }
                        BigButton(title: t.startCount, color: C.indigo) { s.startCount() }.padding(.top, 6)
                    }
                    if !s.pastCounts.isEmpty {
                        Text(t.lastCounts).font(.system(size: 13, weight: .semibold)).foregroundColor(C.ink2)
                        Panel {
                            ForEach(s.pastCounts.prefix(8)) { c in
                                HStack {
                                    Text((c.submittedAt ?? c.startedAt)?.isoDate?.formatted(date: .abbreviated, time: .omitted) ?? "").font(.system(size: 15))
                                    Spacer()
                                    if let v = c.absVariance { Text("±\(v)").font(.system(size: 14, weight: .bold)).foregroundColor(v == 0 ? C.mint : C.amber) }
                                    Tag(text: c.status ?? "", color: C.ink2, bg: C.linen)
                                }.padding(.vertical, 4)
                            }
                        }
                    }
                }
                .padding(14)
            }
            .refreshable { await s.loadTab(.count) }
        }
    }
}

struct ReasonPick: Identifiable { let productId: String; var id: String { productId } }

struct ReasonSheet: View {
    @EnvironmentObject var s: AppState
    let productId: String
    let done: () -> Void
    private let reasons = ["COUNTING_ERROR", "UNRECORDED_ISSUE", "RECEIPT_OVERSIGHT", "DAMAGED", "EXPIRED", "OTHER"]
    var body: some View {
        let t = s.t
        let line = s.sheet?.lines.first(where: { $0.productId == productId })
        VStack(alignment: .leading, spacing: 12) {
            Text(line.map { "\($0.name): \(t.book) \($0.expectedQty) → \(t.counted) \($0.physicalQty ?? 0)" } ?? "").font(.system(size: 16, weight: .bold)).foregroundColor(C.ink)
            Text(t.reasonAsk).font(.system(size: 14)).foregroundColor(C.ink2)
            ForEach(reasons, id: \.self) { r in
                Button(action: { s.setCount(productId, qty: line?.physicalQty, reason: r); done() }) {
                    HStack { Text(t.reason(r)).font(.system(size: 17, weight: .semibold)).foregroundColor(C.ink); Spacer(); if line?.reason == r { Image(systemName: "checkmark").foregroundColor(C.mint) } }
                        .padding(14).frame(maxWidth: .infinity).background(C.paper).clipShape(RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(C.line, lineWidth: 1))
                }
            }
            Spacer()
        }
        .padding(20).background(C.linen.ignoresSafeArea())
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Deliveries

struct DeliveriesScreen: View {
    @EnvironmentObject var s: AppState
    @State private var receiving: Transfer?
    @State private var sendingTo: Hotel?
    var body: some View {
        let t = s.t
        let incoming = s.transfers.filter { $0.toHotel.id == s.hotelId }
        let outgoing = s.transfers.filter { $0.fromHotel.id == s.hotelId }
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if s.transfers.isEmpty { Text(t.noOpenDeliveries).foregroundColor(C.ink2) }
                if !incoming.isEmpty {
                    Text(t.incoming).font(.system(size: 13, weight: .semibold)).foregroundColor(C.ink2)
                    ForEach(incoming) { tr in TransferCard(tr: tr, incoming: true, onReceive: { receiving = tr }) }
                }
                if !outgoing.isEmpty {
                    Text(t.outgoing).font(.system(size: 13, weight: .semibold)).foregroundColor(C.ink2)
                    ForEach(outgoing) { tr in TransferCard(tr: tr, incoming: false, onReceive: {}) }
                }
                let others = s.hotels.filter { $0.id != s.hotelId }
                if !others.isEmpty {
                    Panel {
                        Text(t.sendStock).font(.system(size: 13, weight: .semibold)).foregroundColor(C.ink2)
                        HStack(spacing: 8) { ForEach(others) { h in PillButton(title: t.toHotel(h.name)) { sendingTo = h } } }
                    }
                }
                if !s.recentTransfers.isEmpty {
                    Text(t.lastWeek).font(.system(size: 13, weight: .semibold)).foregroundColor(C.ink2)
                    Panel {
                        ForEach(s.recentTransfers) { tr in
                            HStack(spacing: 10) {
                                Text("✅").font(.system(size: 18))
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("\(tr.refCode) · \(tr.lines.map { "\($0.sent) \($0.name)" }.joined(separator: ", "))").font(.system(size: 14, weight: .semibold)).foregroundColor(C.ink).lineLimit(1)
                                    Text("\(tr.fromHotel.name) → \(tr.toHotel.name) · \(tr.status == "RECEIVED" ? t.receivedInFull : tr.status)").font(.system(size: 12)).foregroundColor(C.ink2)
                                }
                            }.padding(.vertical, 4)
                        }
                    }
                }
                Color.clear.frame(height: 40)
            }
            .padding(14)
        }
        .refreshable { await s.loadTab(.deliveries) }
        .sheet(item: $receiving) { tr in ReceiveSheet(tr: tr) { receiving = nil } }
        .sheet(item: $sendingTo) { h in SendSheet(to: h) { sendingTo = nil } }
    }
}

struct TransferCard: View {
    @EnvironmentObject var s: AppState
    let tr: Transfer
    let incoming: Bool
    let onReceive: () -> Void
    var body: some View {
        let t = s.t
        let short = tr.status == "DISCREPANCY"
        let partial = tr.lines.contains { $0.received > 0 } && !short
        Panel(border: short ? C.brick : (tr.aged == true ? C.marigold : C.line)) {
            HStack {
                Text(incoming ? "\(tr.refCode) · \(tr.fromHotel.name) →" : "\(tr.refCode) · → \(tr.toHotel.name)").font(.system(size: 15, weight: .bold)).foregroundColor(C.ink).lineLimit(1)
                Spacer()
                if short { Tag(text: t.arrivedShort, color: C.brick, bg: Color(hex: 0xFBE9E5)) }
                else if partial { Tag(text: t.partlyReceived, color: C.amber, bg: C.marigoldWash) }
                else { Tag(text: t.notReceived(Int(tr.ageHours ?? 0)), color: tr.aged == true ? C.amber : C.ink2, bg: tr.aged == true ? C.marigoldWash : C.linen) }
            }
            ForEach(tr.lines, id: \.productId) { l in
                HStack {
                    Text(l.name).font(.system(size: 14)).foregroundColor(C.ink)
                    Spacer()
                    Text("\(l.sent) \(t.sent)").font(.system(size: 13)).foregroundColor(C.ink2)
                    if l.received > 0 { Text("· \(l.received) \(t.received)").font(.system(size: 13)).foregroundColor(C.mint) }
                    let miss = l.sent - l.received - l.resolvedShort
                    if miss > 0 && (short || l.received > 0) { Text("· \(miss) \(t.missing)").font(.system(size: 13, weight: .bold)).foregroundColor(C.brick) }
                }
            }
            if incoming {
                if short {
                    Text(t.settle).font(.system(size: 13, weight: .semibold)).foregroundColor(C.ink2).padding(.top, 4)
                    HStack(spacing: 8) {
                        PillButton(title: t.settleLost, filled: true, color: C.brick) { s.settle(tr, reason: "LOST") }
                        PillButton(title: t.settleDamaged) { s.settle(tr, reason: "DAMAGED") }
                        PillButton(title: t.settleCountingError) { s.settle(tr, reason: "COUNTING_ERROR") }
                    }
                } else {
                    HStack(spacing: 8) {
                        PillButton(title: t.receiveAll, filled: true) { s.receiveAll(tr) }
                        PillButton(title: t.receiveSome) { onReceive() }
                    }.padding(.top, 4)
                }
            }
        }
    }
}

struct ReceiveSheet: View {
    @EnvironmentObject var s: AppState
    let tr: Transfer
    let done: () -> Void
    @State private var qty: [String: Int] = [:]
    @State private var final = true
    var body: some View {
        let t = s.t
        VStack(alignment: .leading, spacing: 12) {
            Text("\(tr.refCode) · \(t.arrived)").font(.system(size: 20, weight: .bold)).foregroundColor(C.ink)
            ForEach(tr.lines, id: \.productId) { l in
                let outstanding = l.sent - l.received - l.resolvedShort
                HStack {
                    VStack(alignment: .leading) { Text(l.name).font(.system(size: 16, weight: .semibold)); Text("\(outstanding) \(t.sent)").font(.system(size: 12)).foregroundColor(C.ink2) }
                    Spacer()
                    Stepper(value: Binding(get: { qty[l.productId] ?? outstanding }, set: { qty[l.productId] = max(0, min(outstanding, $0)) }), in: 0...max(0, outstanding)) {
                        Text("\(qty[l.productId] ?? outstanding)").font(.system(size: 22, weight: .heavy)).frame(minWidth: 44)
                    }
                }
            }
            Toggle(t.thisIsAll, isOn: $final).font(.system(size: 15))
            BigButton(title: t.done, color: C.mint) {
                var q = qty
                for l in tr.lines where q[l.productId] == nil { q[l.productId] = l.sent - l.received - l.resolvedShort }
                s.receiveSome(tr, quantities: q, final: final); done()
            }
            Spacer()
        }
        .padding(20).background(C.linen.ignoresSafeArea()).presentationDetents([.medium, .large])
    }
}

struct SendSheet: View {
    @EnvironmentObject var s: AppState
    let to: Hotel
    let done: () -> Void
    @State private var qty: [String: Int] = [:]
    var body: some View {
        let t = s.t
        VStack(alignment: .leading, spacing: 12) {
            Text("\(t.sendStock) · \(t.toHotel(to.name))").font(.system(size: 20, weight: .bold)).foregroundColor(C.ink)
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(s.stock) { r in
                        HStack {
                            Text(s.productById[r.productId]?.emoji ?? "📦").font(.system(size: 22))
                            VStack(alignment: .leading) { Text(r.name).font(.system(size: 16, weight: .semibold)); Text("\(r.store) in store").font(.system(size: 12)).foregroundColor(C.ink2) }
                            Spacer()
                            Stepper(value: Binding(get: { qty[r.productId] ?? 0 }, set: { qty[r.productId] = max(0, min(r.store, $0)) }), in: 0...max(0, r.store), step: 1) {
                                Text("\(qty[r.productId] ?? 0)").font(.system(size: 22, weight: .heavy)).frame(minWidth: 44)
                            }
                        }
                    }
                }
            }
            BigButton(title: t.send, color: C.indigo, enabled: qty.values.contains { $0 > 0 }) { s.dispatch(to: to.id, quantities: qty); done() }
        }
        .padding(20).background(C.linen.ignoresSafeArea()).presentationDetents([.large])
    }
}

// MARK: - Activity

struct ActivityScreen: View {
    @EnvironmentObject var s: AppState
    @State private var reversing: ActivityEvent?
    var body: some View {
        let t = s.t
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(t.changesToday(s.events.filter { Calendar.current.isDateInToday($0.createdAt.isoDate ?? .distantPast) }.count)).font(.system(size: 13, weight: .semibold)).foregroundColor(C.ink2)
                ForEach(s.corrections) { c in
                    Panel(border: C.marigold, bg: C.marigoldWash) {
                        Text(t.asksToCorrect(c.requestedByName ?? c.displayName ?? "")).font(.system(size: 15, weight: .bold)).foregroundColor(C.ink)
                        Text("“\(c.note ?? "")”").font(.system(size: 14)).foregroundColor(C.ink2)
                        HStack(spacing: 8) {
                            if let e = s.event(for: c) { PillButton(title: t.reverse, filled: true, color: C.brick) { reversing = e } }
                            PillButton(title: t.leaveAsIs) { s.dismiss(c) }
                        }
                    }
                }
                Panel {
                    if s.events.isEmpty { Text(t.nothingYet).foregroundColor(C.ink2) }
                    ForEach(s.events) { e in
                        EventRow(e: e, onReverse: { reversing = e })
                        if e.id != s.events.last?.id { Rectangle().fill(C.line).frame(height: 1) }
                    }
                }
                Color.clear.frame(height: 40)
            }
            .padding(14)
        }
        .refreshable { await s.loadTab(.activity) }
        .sheet(item: $reversing) { e in ReverseSheet(e: e) { reversing = nil } }
    }
}

struct EventRow: View {
    @EnvironmentObject var s: AppState
    let e: ActivityEvent
    let onReverse: () -> Void
    private var icon: String {
        switch e.action { case "PLACE_IN_ROOM": return "🛏️"; case "CHECKOUT_TO_STAFF": return "📦"; case "RETURN_TO_STORE": return "↩️"; case "SUPPLIER_RECEIPT", "TRANSFER_RECEIPT": return "🚚"; case "TRANSFER_DISPATCH": return "📤"; case "REVERSAL": return "⛔"; default: return "📋" }
    }
    private var when: String { let f = DateFormatter(); f.dateFormat = "HH:mm"; return e.createdAt.isoDate.map { f.string(from: $0) } ?? "" }
    var body: some View {
        let t = s.t
        let dead = e.reversedBy != nil
        HStack(alignment: .top, spacing: 10) {
            Text(icon).font(.system(size: 20))
            VStack(alignment: .leading, spacing: 2) {
                Text(e.lines.map { "\($0.quantity) \($0.name)" }.joined(separator: ", ") + (e.lines.first?.roomNumber.map { " · \(t.actionName("PLACE_IN_ROOM")) \($0)" } ?? ""))
                    .font(.system(size: 15, weight: .semibold)).foregroundColor(C.ink).strikethrough(dead)
                Text("\(t.actionName(e.action)) · \(e.actor?.name ?? "") · \(when) · \(e.viaVoice == true ? "🎤" : "⌨️")" + (dead ? " · \(t.reversed)" : "")).font(.system(size: 12)).foregroundColor(C.ink2)
                if let n = e.note, !n.isEmpty { Text(n).font(.system(size: 12)).foregroundColor(C.ink3) }
            }
            Spacer()
            if !dead && e.action != "REVERSAL" && e.reversalOf == nil {
                Button(action: onReverse) { Tag(text: t.reverse, color: C.brick, bg: Color(hex: 0xFBE9E5)) }
            }
        }
        .padding(.vertical, 6)
    }
}

struct ReverseSheet: View {
    @EnvironmentObject var s: AppState
    let e: ActivityEvent
    let done: () -> Void
    @State private var reason = ""
    var body: some View {
        let t = s.t
        VStack(alignment: .leading, spacing: 12) {
            Text(t.reverseNow).font(.system(size: 20, weight: .bold)).foregroundColor(C.ink)
            Text(e.lines.map { "\($0.quantity) \($0.name)" }.joined(separator: ", ") + " · " + t.actionName(e.action)).font(.system(size: 15)).foregroundColor(C.ink2)
            Text(t.whyReverse).font(.system(size: 14, weight: .semibold)).foregroundColor(C.ink2)
            TextField("", text: $reason, axis: .vertical).lineLimit(2...4).font(.system(size: 17)).padding(12).background(C.paper).clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(C.line, lineWidth: 1.5))
            Text(t.reverseNote).font(.system(size: 12)).foregroundColor(C.ink3)
            BigButton(title: t.reverseNow, color: C.brick, enabled: reason.trimmingCharacters(in: .whitespaces).count >= 3) { s.reverse(e, reason: reason.trimmingCharacters(in: .whitespaces)); done() }
            Spacer()
        }
        .padding(20).background(C.linen.ignoresSafeArea()).presentationDetents([.medium])
    }
}
