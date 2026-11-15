import SwiftUI

/// Home: a welcome screen until the first message, then a conversation.
struct HomeScreen: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        if s.chat.isEmpty && !s.voiceLive && !s.busy { WelcomeHome() }
        else {
            VStack(spacing: 0) {
                ChatFeed()
                QuickActions()
            }
        }
    }
}

struct WelcomeHome: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        let t = s.t
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                OutboxPanels()
                Panel {
                    HStack(spacing: 14) {
                        Image(systemName: "mic.fill").font(.system(size: 22)).foregroundColor(C.ink)
                            .frame(width: 52, height: 52).background(C.marigold).clipShape(Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t.holdToTalk).font(.system(size: 17, weight: .semibold)).foregroundColor(C.ink)
                            Text(t.example).font(.system(size: 15)).foregroundColor(C.ink2)
                        }
                    }
                    Text("\(t.youCanSay) · \(t.tapToTry)").font(.system(size: 13, weight: .bold)).foregroundColor(C.ink2).padding(.top, 4)
                    SuggestionChips()
                }
                if let n = s.notice { Banner(text: n.text, warn: n.warn) }
                BigButton(title: t.tapInstead, color: C.ink, outline: !s.nudgeTap) { s.tapInstead() }
                Text(t.orTap).font(.system(size: 15)).foregroundColor(C.ink2)
                JobTile(kind: .placeInRoom, primary: true)
                HStack(spacing: 10) { JobTile(kind: .checkoutToStaff); JobTile(kind: .returnToStore) }
                JobTile(kind: .supplierReceipt)
            }
            .padding(16)
        }
    }
}

/// The example sentences, as buttons that send themselves.
struct SuggestionChips: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        let groups = s.t.examples.dropFirst().map { $0.components(separatedBy: " · ") }
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
                HStack(spacing: 8) {
                    ForEach(group, id: \.self) { e in
                        Button(action: { s.interpret(e.trimmingCharacters(in: CharacterSet(charactersIn: "“”\" ")), durationMs: 0) }) {
                            Text(e).font(.system(size: 15)).foregroundColor(C.indigo).lineLimit(1).minimumScaleFactor(0.75)
                                .padding(.horizontal, 12).frame(height: 38).background(C.indigoWash).clipShape(Capsule())
                        }
                    }
                }
            }
        }
    }
}

struct OutboxPanels: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        let t = s.t
        let waiting = s.outbox.filter { $0.error == nil }
        let failed = s.outbox.filter { $0.error != nil }
        Group {
            if !waiting.isEmpty {
                Panel(border: C.marigold, bg: C.marigoldWash) {
                    Text("\(t.pending): \(waiting.count)").font(.system(size: 16, weight: .bold)).foregroundColor(C.amber)
                    ForEach(waiting.prefix(3)) { p in Text(p.label).font(.system(size: 15)).foregroundColor(C.amber) }
                    BigButton(title: t.sendNow, color: C.ink) { s.flushOutbox() }
                }
            }
            ForEach(failed) { p in
                Panel(border: C.brick) {
                    Text(p.label).font(.system(size: 16, weight: .bold)).foregroundColor(C.ink)
                    Text(p.error ?? "").font(.system(size: 15)).foregroundColor(C.brick)
                    Button("OK") { s.discardPending(p.key) }.font(.system(size: 16, weight: .bold))
                }
            }
        }
    }
}

struct ChatFeed: View {
    @EnvironmentObject var s: AppState
    private var scrollKey: String { "\(s.chat.count)-\(s.voiceLive)-\(s.voiceInterim.count)-\(s.busy)-\(s.waitingLong)-\(s.notice?.text ?? "")" }
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    OutboxPanels()
                    ForEach(s.chat) { m in ChatRow(m: m) }
                    if s.voiceLive { LiveBubble() }
                    if s.busy && s.flow == nil {
                        AppBubble { HStack(spacing: 10) { ProgressView(); Text(s.waitingLong ? s.t.stillAsking : s.t.understanding).foregroundColor(C.ink2) } }
                    }
                    if let n = s.notice { Banner(text: n.text, warn: n.warn) }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
            }
            .onAppear { proxy.scrollTo("end", anchor: .bottom) }
            .onChange(of: scrollKey) { _ in withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("end", anchor: .bottom) } }
        }
    }
}

struct ChatRow: View {
    let m: ChatMessage
    var body: some View {
        switch m.body {
        case .said(let text, let spoken, let lang): MeBubble(text: text, spoken: spoken, lang: lang)
        case .retry(let heard): AppBubble(warn: true) { RetryCard(heard: heard) }
        case .text(let text, let warn):
            AppBubble(warn: warn) { Text(text).font(.system(size: 17, weight: .semibold)).foregroundColor(warn ? C.amber : C.ink) }
        case .proposal(let f, let state): AppBubble { ProposalCard(id: m.id, f: f, state: state) }
        case .stock(let rows): AppBubble { StockAnswer(rows: rows) }
        case .bag(let lines): AppBubble { BagAnswer(lines: lines) }
        }
    }
}

/// Speech-bubble outline with a small "tail" corner: bottom-right for the staff member, top-left for the app.
struct BubbleShape: Shape {
    let mine: Bool
    func path(in r: CGRect) -> Path {
        let big: CGFloat = 18, small: CGFloat = 5
        let tl = mine ? big : small, tr = big, br = mine ? small : big, bl = big
        var p = Path()
        p.move(to: CGPoint(x: r.minX + tl, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX - tr, y: r.minY))
        p.addArc(center: CGPoint(x: r.maxX - tr, y: r.minY + tr), radius: tr, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - br))
        p.addArc(center: CGPoint(x: r.maxX - br, y: r.maxY - br), radius: br, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        p.addLine(to: CGPoint(x: r.minX + bl, y: r.maxY))
        p.addArc(center: CGPoint(x: r.minX + bl, y: r.maxY - bl), radius: bl, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
        p.addLine(to: CGPoint(x: r.minX, y: r.minY + tl))
        p.addArc(center: CGPoint(x: r.minX + tl, y: r.minY + tl), radius: tl, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        p.closeSubpath()
        return p
    }
}

struct MeBubble: View {
    @EnvironmentObject var s: AppState
    let text: String
    let spoken: Bool
    var lang: String? = nil
    var body: some View {
        HStack {
            Spacer(minLength: 56)
            Button(action: { s.editSaid(text) }) {
                VStack(alignment: .trailing, spacing: 4) {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: spoken ? "mic.fill" : "keyboard").font(.system(size: 13)).foregroundColor(Color.white.opacity(0.75)).padding(.top, 4)
                        Text(text).font(.system(size: 17)).foregroundColor(.white).multilineTextAlignment(.leading)
                    }
                    HStack(spacing: 6) {
                        if let tag = s.t.langTag(lang) {
                            Text(tag).font(.system(size: 11, weight: .semibold)).foregroundColor(C.indigo)
                                .padding(.horizontal, 7).padding(.vertical, 2).background(Color.white.opacity(0.9)).clipShape(Capsule())
                        }
                        Image(systemName: "pencil").font(.system(size: 10, weight: .bold)).foregroundColor(Color.white.opacity(0.7))
                        Text(s.t.tapToFix).font(.system(size: 11)).foregroundColor(Color.white.opacity(0.7))
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(BubbleShape(mine: true).fill(C.indigo))
            }
            .buttonStyle(.plain)
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint(s.t.tapToFix)
    }
}

/// Google didn't answer: two big ways forward instead of a dead end.
struct RetryCard: View {
    @EnvironmentObject var s: AppState
    let heard: String
    var body: some View {
        let t = s.t
        VStack(alignment: .leading, spacing: 10) {
            Text(t.googleSlow).font(.system(size: 17, weight: .semibold)).foregroundColor(C.amber)
            if !heard.isEmpty {
                Text(heard).font(.system(size: 15)).foregroundColor(C.ink2).lineLimit(2)
            }
            HStack(spacing: 10) {
                Button(action: { s.voiceHint() }) {
                    Label(t.sayAgain, systemImage: "mic.fill").font(.system(size: 16, weight: .semibold)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).frame(height: 44).background(C.brick).clipShape(Capsule())
                }
                Button(action: { s.editSaid(heard) }) {
                    Label(t.typeIt, systemImage: "keyboard").font(.system(size: 16, weight: .semibold)).foregroundColor(C.ink)
                        .frame(maxWidth: .infinity).frame(height: 44).background(C.paper).clipShape(Capsule())
                        .overlay(Capsule().stroke(C.line, lineWidth: 1.5))
                }
            }
        }
    }
}

/// While the mic is held: the words appear in a dashed bubble as they are heard.
struct LiveBubble: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        HStack {
            Spacer(minLength: 56)
            HStack(spacing: 8) {
                LevelMeter(level: s.voiceLevel)
                Text(s.voiceInterim.isEmpty ? s.t.listening : s.voiceInterim).font(.system(size: 17)).foregroundColor(C.indigo)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(BubbleShape(mine: true).fill(C.indigoWash))
            .overlay(BubbleShape(mine: true).stroke(C.indigo, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
        }
    }
}

struct AppBubble<Content: View>: View {
    var warn: Bool = false
    @ViewBuilder var content: () -> Content
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                .frame(width: 30, height: 30).background(C.indigo).clipShape(Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 10) { content() }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(BubbleShape(mine: false).fill(warn ? C.marigoldWash : C.paper))
                .overlay(BubbleShape(mine: false).stroke(warn ? C.marigold : C.line, lineWidth: 1))
            Spacer(minLength: 20)
        }
    }
}

/// The app's reply to a job: what it understood, with ✕ / Edit / ✓.
struct ProposalCard: View {
    @EnvironmentObject var s: AppState
    let id: UUID
    let f: Flow
    let state: ChatState
    var body: some View {
        let t = s.t
        let room = f.lines.first { $0.roomNumber != nil }?.roomNumber
        let blocked = s.blocked(f)
        if case .ready = state {
            Text(t.isThisRight).font(.system(size: 15, weight: .semibold)).foregroundColor(C.ink2)
        }
        HStack(spacing: 8) {
            Text(t.act(f.kind).0).font(.system(size: 14, weight: .bold)).foregroundColor(C.indigo)
                .padding(.horizontal, 10).padding(.vertical, 5).background(C.indigoWash).clipShape(Capsule())
            Spacer(minLength: 0)
            if f.kind == .placeInRoom, let room = room {
                Text("🚪 \(room)").font(.system(size: 26, weight: .heavy)).foregroundColor(C.ink)
            }
        }
        ForEach(Array(f.lines.enumerated()), id: \.offset) { _, l in
            let p = s.product(l.productId)
            HStack(spacing: 10) {
                Text(p?.emoji ?? "❓").font(.system(size: 26))
                VStack(alignment: .leading, spacing: 1) {
                    Text(p?.name ?? "“\(l.spoken)”").font(.system(size: 16, weight: .semibold)).foregroundColor(p == nil ? C.amber : C.ink)
                    if let n = p?.native(s.lang) { Text(n).font(.system(size: 13)).foregroundColor(C.ink2) }
                    if f.kind == .placeInRoom, let src = l.source {
                        Text(src == "STORE" ? "🏬 \(t.fromStore)" : "👜 \(t.fromBag)").font(.system(size: 12)).foregroundColor(C.ink3)
                    }
                }
                Spacer(minLength: 0)
                Text("× \(l.quantity)").font(.system(size: 22, weight: .bold)).foregroundColor(C.ink)
            }
        }
        switch state {
        case .ready:
            if blocked { Text(t.needsFix).font(.system(size: 14, weight: .semibold)).foregroundColor(C.amber) }
            HStack(spacing: 8) {
                Button(action: { s.cancelChat(id) }) {
                    Image(systemName: "xmark").font(.system(size: 17, weight: .semibold)).foregroundColor(C.ink)
                        .frame(width: 48, height: 46).overlay(RoundedRectangle(cornerRadius: 12).stroke(C.line, lineWidth: 1.5))
                }
                .accessibilityLabel("Cancel")
                Button(action: { s.editChat(id) }) {
                    Text(t.edit).font(.system(size: 16, weight: .bold)).foregroundColor(C.ink)
                        .padding(.horizontal, 14).frame(height: 46).overlay(RoundedRectangle(cornerRadius: 12).stroke(C.line, lineWidth: 1.5))
                }
                Button(action: { s.confirmChat(id) }) {
                    HStack(spacing: 6) { Image(systemName: "checkmark"); Text(t.confirm) }
                        .font(.system(size: 16, weight: .bold)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).frame(height: 46)
                        .background(blocked ? C.line : C.mint).clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(blocked)
            }
            if !blocked { Text(t.sayYes).font(.system(size: 12)).foregroundColor(C.ink3) }
        case .saving:
            HStack(spacing: 8) { ProgressView(); Text("…").foregroundColor(C.ink2) }
        case .saved(let ref):
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill").foregroundColor(C.mint)
                Text("\(t.saved) · Ref \(ref)").font(.system(size: 15, weight: .bold)).foregroundColor(Color(hex: 0x0F5C3C))
            }
        case .offline:
            Text("⏳ \(t.pending)").font(.system(size: 15, weight: .bold)).foregroundColor(C.amber)
            Text(t.savedOnPhone).font(.system(size: 13)).foregroundColor(C.amber)
        case .cancelled:
            Text(t.cancelledText).font(.system(size: 15, weight: .semibold)).foregroundColor(C.ink3)
        }
    }
}

struct StockAnswer: View {
    @EnvironmentObject var s: AppState
    let rows: [QueryRow]
    var body: some View {
        let t = s.t
        if rows.isEmpty { Text(t.noMatch).font(.system(size: 16)).foregroundColor(C.ink) }
        ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
            HStack(spacing: 10) {
                Text(s.product(r.productId)?.emoji ?? "📦").font(.system(size: 24))
                Text(r.name).font(.system(size: 16, weight: .semibold)).foregroundColor(C.ink)
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(t.store) \(r.store ?? 0)").font(.system(size: 17, weight: .bold)).foregroundColor(C.ink)
                    Text("👜 \(s.bag[r.productId] ?? 0)").font(.system(size: 13)).foregroundColor(C.ink2)
                }
            }
        }
    }
}

struct BagAnswer: View {
    @EnvironmentObject var s: AppState
    let lines: [BagLine]
    var body: some View {
        let t = s.t
        Text("👜 \(t.inYourBag)").font(.system(size: 15, weight: .semibold)).foregroundColor(C.ink2)
        if lines.isEmpty { Text(t.nothingInBag).font(.system(size: 16)).foregroundColor(C.ink) }
        ForEach(lines, id: \.self) { l in
            HStack(spacing: 10) {
                Text(l.emoji).font(.system(size: 24))
                VStack(alignment: .leading, spacing: 0) {
                    Text(l.name).font(.system(size: 16, weight: .semibold)).foregroundColor(C.ink)
                    if let n = l.native { Text(n).font(.system(size: 13)).foregroundColor(C.ink2) }
                }
                Spacer(minLength: 0)
                Text("\(l.qty)").font(.system(size: 22, weight: .bold)).foregroundColor(C.ink)
            }
        }
    }
}

/// Shortcuts under the conversation: start a job by tapping, or clear the conversation.
struct QuickActions: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        let t = s.t
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("🚪 " + t.act(.placeInRoom).0) { s.start(.placeInRoom) }
                chip("🛍️ " + t.act(.checkoutToStaff).0) { s.start(.checkoutToStaff) }
                chip("↩️ " + t.act(.returnToStore).0) { s.start(.returnToStore) }
                chip("📦 " + t.act(.supplierReceipt).0) { s.start(.supplierReceipt) }
                chip("🧹 " + t.newChat) { s.clearChat() }
            }
            .padding(.horizontal, 12).padding(.top, 8)
        }
        .background(C.linen)
    }
    private func chip(_ label: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.system(size: 15, weight: .semibold)).foregroundColor(C.ink)
                .padding(.horizontal, 14).frame(height: 40)
                .background(C.paper).clipShape(Capsule())
                .overlay(Capsule().stroke(C.line, lineWidth: 1.5))
        }
    }
}
