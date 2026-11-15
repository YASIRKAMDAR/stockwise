import SwiftUI

// MARK: - Root

struct RootView: View {
    @EnvironmentObject var s: AppState
    var body: some View { Group { if s.me == nil { LoginScreen() } else { Shell() } } }
}

struct LoginScreen: View {
    @EnvironmentObject var s: AppState
    @State private var code = ""
    @State private var password = ""
    @State private var error: String?
    @State private var working = false
    var body: some View {
        let t = s.t
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 10) {
                    Text("Stockwise").font(.system(size: 34, weight: .heavy)).foregroundColor(C.ink)
                    Tag(text: t.managerApp, color: .white, bg: C.indigo)
                }
                Text(t.tagline).font(.system(size: 17)).foregroundColor(C.ink2)
                LangRow().padding(.top, 8)
                Text(t.yourCode).font(.system(size: 14, weight: .semibold)).foregroundColor(C.ink2).padding(.top, 10)
                TextField("", text: $code).textInputAutocapitalization(.characters).autocorrectionDisabled().font(.system(size: 24, weight: .bold))
                    .padding(14).background(C.paper).clipShape(RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(C.line, lineWidth: 1.5))
                    .accessibilityLabel(t.yourCode)
                Text(t.password).font(.system(size: 14, weight: .semibold)).foregroundColor(C.ink2)
                SecureField("", text: $password).font(.system(size: 24, weight: .bold))
                    .padding(14).background(C.paper).clipShape(RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(C.line, lineWidth: 1.5))
                    .accessibilityLabel(t.password)
                if let e = error { Banner(text: e) }
                BigButton(title: working ? "…" : t.signIn, enabled: !working && !code.isEmpty && !password.isEmpty) {
                    working = true; error = nil
                    Task { error = await s.login(code: code.trimmingCharacters(in: .whitespaces), password: password); working = false }
                }
            }
            .padding(24)
        }
        .background(C.linen.ignoresSafeArea())
        .onAppear { code = s.store.lastCode }
    }
}

// MARK: - Shell with top bar, menu, chat and voice bar

struct Shell: View {
    @EnvironmentObject var s: AppState
    private var title: String {
        let t = s.t
        switch s.tab { case .today: return t.today; case .count: return t.count; case .stock: return t.stock; case .deliveries: return t.deliveries; case .activity: return t.activity; case .attempts: return t.voiceAttempts }
    }
    var body: some View {
        ZStack {
            C.linen.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Button(action: { withAnimation { s.menuOpen.toggle() } }) {
                        Image(systemName: "line.3.horizontal").font(.system(size: 20, weight: .bold)).foregroundColor(C.ink)
                            .frame(width: 44, height: 44).background(C.paper).clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(C.line, lineWidth: 1))
                    }.accessibilityLabel(s.t.menu)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title).font(.system(size: 18, weight: .bold)).foregroundColor(C.ink)
                        Text(s.hotel?.name ?? "").font(.system(size: 12)).foregroundColor(C.ink2)
                    }
                    Spacer()
                    if !s.online { Tag(text: "offline", color: C.brick, bg: Color(hex: 0xFBE9E5)) }
                }
                .padding(.horizontal, 14).padding(.top, 8).padding(.bottom, 6)

                ZStack(alignment: .bottom) {
                    Group {
                        switch s.tab {
                        case .today: TodayScreen()
                        case .count: CountScreen()
                        case .stock: StockScreen()
                        case .deliveries: DeliveriesScreen()
                        case .activity: ActivityScreen()
                        case .attempts: AttemptsScreen()
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    if !s.chat.isEmpty || s.voiceLive { ChatPanel() }
                }
                if let n = s.notice { Banner(text: n.text, warn: n.warn).padding(.horizontal, 12).padding(.bottom, 4).onTapGesture { s.notice = nil } }
                VoiceBar()
            }
            if s.showIntro { IntroView().transition(.opacity).zIndex(2) }
            if s.menuOpen {
                Color.black.opacity(0.35).ignoresSafeArea().onTapGesture { withAnimation { s.menuOpen = false } }
                HStack(spacing: 0) { MenuPanel().frame(width: 280); Spacer() }.transition(.move(edge: .leading)).zIndex(3)
            }
        }
    }
}

struct MenuPanel: View {
    @EnvironmentObject var s: AppState
    @State private var pickHotel = false
    private func item(_ label: String, _ icon: String, _ tab: AppTab) -> some View {
        let on = s.tab == tab
        return Button(action: { s.go(tab) }) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 18)).frame(width: 26)
                Text(label).font(.system(size: 17, weight: .semibold))
                Spacer()
            }
            .foregroundColor(on ? C.indigo : C.ink).padding(.horizontal, 12).frame(height: 50)
            .background(on ? C.indigoWash : Color.clear).clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }
    var body: some View {
        let t = s.t
        VStack(alignment: .leading, spacing: 2) {
            Text(s.me?.displayName ?? "").font(.system(size: 18, weight: .bold)).foregroundColor(C.ink).padding(.horizontal, 12).padding(.top, 14)
            Text(s.me?.role == "OWNER" ? "Owner" : t.managerApp).font(.system(size: 13)).foregroundColor(C.ink2).padding(.horizontal, 12).padding(.bottom, 12)
            item(t.today, "sun.max.fill", .today)
            item(t.count, "list.clipboard.fill", .count)
            item(t.stock, "shippingbox.fill", .stock)
            item(t.deliveries, "truck.box.fill", .deliveries)
            item(t.activity, "clock.arrow.circlepath", .activity)
            Rectangle().fill(C.line).frame(height: 1).padding(.vertical, 6)
            if s.hotels.count > 1 {
                Button(action: { withAnimation { pickHotel.toggle() } }) {
                    HStack(spacing: 12) { Image(systemName: "building.2.fill").font(.system(size: 18)).frame(width: 26); Text("\(t.hotel): \(s.hotel?.name ?? "")").font(.system(size: 16, weight: .semibold)).lineLimit(1); Spacer(); Image(systemName: pickHotel ? "chevron.up" : "chevron.down") }
                        .foregroundColor(C.ink).padding(.horizontal, 12).frame(height: 50)
                }
                if pickHotel {
                    ForEach(s.hotels) { h in
                        Button(action: { s.setHotel(h.id) }) {
                            HStack { Text(h.name).font(.system(size: 15, weight: h.id == s.hotelId ? .bold : .regular)); Spacer(); if h.id == s.hotelId { Image(systemName: "checkmark") } }
                                .foregroundColor(C.ink).padding(.leading, 50).padding(.trailing, 12).frame(height: 40)
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 6) { Text(t.language).font(.system(size: 13, weight: .semibold)).foregroundColor(C.ink2); LangRow() }.padding(12)
            Rectangle().fill(C.line).frame(height: 1).padding(.vertical, 2)
            Button(action: { s.openIntro() }) {
                HStack(spacing: 12) { Image(systemName: "questionmark.circle").font(.system(size: 18)).frame(width: 26); Text(t.howToUse).font(.system(size: 16, weight: .semibold)); Spacer() }
                    .foregroundColor(C.ink).padding(.horizontal, 12).frame(height: 46)
            }
            item(t.voiceAttempts, "waveform.badge.magnifyingglass", .attempts)
            Spacer()
            Button(action: { s.signOut() }) {
                HStack(spacing: 12) { Image(systemName: "rectangle.portrait.and.arrow.right").font(.system(size: 18)).frame(width: 26); Text(t.signOut).font(.system(size: 17, weight: .semibold)); Spacer() }
                    .foregroundColor(C.brick).padding(.horizontal, 12).frame(height: 50)
            }
            .padding(.bottom, 20)
        }
        .padding(.horizontal, 10)
        .frame(maxHeight: .infinity)
        .background(C.paper.ignoresSafeArea())
    }
}

// MARK: - Chat panel (voice answers float above the bar on any screen)

struct ChatPanel: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button(action: { s.clearChat() }) {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .bold)).foregroundColor(C.ink2).frame(width: 32, height: 32).background(C.paper).clipShape(Circle())
                        .overlay(Circle().stroke(C.line, lineWidth: 1))
                }.accessibilityLabel(s.t.close)
            }.padding(.horizontal, 12).padding(.bottom, 4)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(s.chat) { m in ChatRow(m: m).id(m.id) }
                        if s.voiceLive {
                            HStack { Spacer(minLength: 56)
                                HStack(spacing: 8) { LevelMeter(level: s.voiceLevel); Text(s.voiceInterim.isEmpty ? s.t.listening : s.voiceInterim).font(.system(size: 16)).foregroundColor(C.indigo) }
                                    .padding(.horizontal, 14).padding(.vertical, 10).background(BubbleShape(mine: true).fill(C.indigoWash))
                                    .overlay(BubbleShape(mine: true).stroke(C.indigo, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
                            }.id("live")
                        }
                        Color.clear.frame(height: 1).id("end")
                    }
                    .padding(.horizontal, 12).padding(.bottom, 6)
                }
                .frame(maxHeight: 300)
                .onChange(of: s.chat.count) { _ in withAnimation { proxy.scrollTo("end", anchor: .bottom) } }
                .onChange(of: s.voiceInterim) { _ in proxy.scrollTo("end", anchor: .bottom) }
            }
        }
        .padding(.top, 6)
        .background(LinearGradient(colors: [C.linen.opacity(0), C.linen, C.linen], startPoint: .top, endPoint: .bottom))
    }
}

struct ChatRow: View {
    @EnvironmentObject var s: AppState
    let m: ChatMessage
    var body: some View {
        switch m.body {
        case .said(let text, let spoken, let lang): MeBubble(text: text, spoken: spoken, lang: lang)
        case .text(let text, let warn): AppBubble(warn: warn) { Text(text).font(.system(size: 16)).foregroundColor(warn ? C.amber : C.ink) }
        case .retry(let heard): AppBubble(warn: true) { RetryCard(heard: heard) }
        case .stock(let rows): AppBubble { StockAnswer(rows: rows) }
        case .counted(let got):
            AppBubble {
                Text(s.t.heardCount(got.count)).font(.system(size: 14, weight: .semibold)).foregroundColor(C.ink2)
                ForEach(Array(got.enumerated()), id: \.offset) { _, g in
                    HStack { Text(g.name).font(.system(size: 16)); Spacer(); Text(g.qty.map(String.init) ?? "—").font(.system(size: 17, weight: .heavy)).foregroundColor(C.mint) }
                }
            }
        }
    }
}

struct StockAnswer: View {
    @EnvironmentObject var s: AppState
    let rows: [QueryRow]
    var body: some View {
        let t = s.t
        if rows.isEmpty { Text(t.nothingLow).font(.system(size: 16)) }
        ForEach(Array(rows.prefix(8).enumerated()), id: \.offset) { _, r in
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(r.name).font(.system(size: 17, weight: .bold)).foregroundColor(C.ink)
                    if let h = r.hotelName, (s.hotel?.name ?? "") != h { Text("· \(h)").font(.system(size: 13)).foregroundColor(C.ink2) }
                    Spacer()
                    Text("\(r.store)").font(.system(size: 22, weight: .heavy)).foregroundColor(r.low == true ? C.brick : C.ink)
                }
                HStack(spacing: 8) {
                    if let sh = r.staffHeld, sh > 0 { Text("\(sh) \(t.staffCarry)").font(.system(size: 12)).foregroundColor(C.ink2) }
                    if let it = r.inTransit, it > 0 { Text("\(it) \(t.inTransit)").font(.system(size: 12)).foregroundColor(C.ink2) }
                    if r.low == true { Tag(text: r.store == 0 ? t.outOfStock : t.low, color: C.brick, bg: Color(hex: 0xFBE9E5)) }
                }
            }
        }
    }
}

// MARK: - Today

struct TodayScreen: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        let t = s.t
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(t.greeting(s.me?.displayName.split(separator: " ").first.map(String.init) ?? "")).font(.system(size: 24, weight: .heavy)).foregroundColor(C.ink)
                Text(t.needYou(s.attentionCount)).font(.system(size: 15)).foregroundColor(C.ink2)
                if s.attentionCount > 0 {
                    Panel {
                        Text(t.needsAttention).font(.system(size: 13, weight: .semibold)).foregroundColor(C.ink2)
                        ForEach(s.corrections) { c in
                            AttentionRow(sev: "LOW", title: t.asksToCorrect(c.requestedByName ?? c.displayName ?? ""), detail: c.note ?? "", action: (t.review, .activity))
                        }
                        ForEach(s.alerts) { a in
                            AttentionRow(sev: a.severity, title: a.title, detail: a.detail ?? "", action: s.alertAction(a))
                        }
                    }
                }
                Text(t.storeNow).font(.system(size: 13, weight: .semibold)).foregroundColor(C.ink2).padding(.top, 4)
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                    ForEach(s.stock.sorted { ($0.low == true ? 0 : 1, $0.name) < ($1.low == true ? 0 : 1, $1.name) }) { r in StockCard(r: r) }
                }
                Color.clear.frame(height: 40)
            }
            .padding(14)
        }
        .refreshable { s.refresh() }
    }
}

struct AttentionRow: View {
    @EnvironmentObject var s: AppState
    let sev: String
    let title: String
    let detail: String
    let action: (String, AppTab)?
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(sev == "HIGH" ? C.brick : sev == "MEDIUM" ? C.marigold : C.ink3).frame(width: 10, height: 10).padding(.top, 6)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 15, weight: .semibold)).foregroundColor(C.ink)
                if !detail.isEmpty { Text(detail).font(.system(size: 12)).foregroundColor(C.ink2) }
            }
            Spacer()
            if let a = action {
                Button(action: { s.go(a.1) }) { Tag(text: a.0) }
            }
        }
        .padding(.vertical, 6)
    }
}

struct StockCard: View {
    @EnvironmentObject var s: AppState
    let r: StockRow
    var body: some View {
        let low = r.low == true
        let th = r.reorderThreshold ?? 0
        let frac = th > 0 ? min(1, Double(r.store) / Double(max(th * 2, 1))) : 1
        VStack(alignment: .leading, spacing: 4) {
            Text(s.productById[r.productId]?.emoji ?? r.icon ?? "📦").font(.system(size: 22))
            Text("\(r.store)").font(.system(size: 24, weight: .heavy)).foregroundColor(low ? C.brick : C.ink)
            Text("\(s.productById[r.productId]?.native(s.lang) ?? r.name)" + (th > 0 ? " · \(s.t.reorderAt(th))" : "")).font(.system(size: 12)).foregroundColor(C.ink2).lineLimit(2)
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(C.line)
                    Capsule().fill(low ? C.brick : C.mint).frame(width: g.size.width * frac)
                }
            }.frame(height: 6)
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(low ? Color(hex: 0xFBE9E5) : C.paper).clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(low ? C.brick : C.line, lineWidth: 1))
    }
}

// MARK: - Stock

struct StockScreen: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        let t = s.t
        ScrollView {
            VStack(spacing: 8) {
                ForEach(s.stock) { r in
                    Panel(border: r.low == true ? C.brick : C.line) {
                        HStack(alignment: .center, spacing: 10) {
                            Text(s.productById[r.productId]?.emoji ?? "📦").font(.system(size: 26))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.productById[r.productId]?.native(s.lang) ?? r.name).font(.system(size: 17, weight: .bold)).foregroundColor(C.ink)
                                HStack(spacing: 8) {
                                    if let sh = r.staffHeld, sh > 0 { Text("\(sh) \(t.staffCarry)").font(.system(size: 12)).foregroundColor(C.ink2) }
                                    if let i = r.inTransitIn, i > 0 { Text("\(i) \(t.inTransit)").font(.system(size: 12)).foregroundColor(C.ink2) }
                                    if let th = r.reorderThreshold, th > 0 { Text(t.reorderAt(th)).font(.system(size: 12)).foregroundColor(C.ink3) }
                                }
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("\(r.store)").font(.system(size: 26, weight: .heavy)).foregroundColor(r.low == true ? C.brick : C.ink)
                                if r.low == true { Tag(text: r.store == 0 ? t.outOfStock : t.low, color: C.brick, bg: Color(hex: 0xFBE9E5)) }
                            }
                        }
                    }
                }
                Color.clear.frame(height: 40)
            }
            .padding(14)
        }
        .refreshable { s.refresh() }
    }
}

// MARK: - Voice attempts & walkthrough

struct AttemptsScreen: View {
    @EnvironmentObject var s: AppState
    private func when(_ iso: String) -> String { let f = DateFormatter(); f.dateFormat = "HH:mm:ss"; return iso.isoDate.map { f.string(from: $0) } ?? "" }
    private func langName(_ code: String?) -> String {
        switch code { case "gu-IN": return "ગુજરાતી"; case "hi-IN": return "हिंदी"; case "en-IN": return "English"; case "mixed": return s.t.langTag("mixed") ?? "Mixed"; default: return "–" }
    }
    var body: some View {
        let t = s.t
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if s.attempts.isEmpty { Text(t.noAttempts).foregroundColor(C.ink2).padding(.top, 8) }
                ForEach(s.attempts) { a in
                    Panel {
                        HStack {
                            Text(when(a.createdAt)).font(.system(size: 13, weight: .semibold)).foregroundColor(C.ink2)
                            Spacer()
                            Text(a.status == "FAILED" ? "✗ \(a.errorCode ?? "FAILED")" : a.fallback != nil ? "~ phone words" : a.status == "AMBIGUOUS" ? "? needed help" : "✓ \(a.action ?? "")")
                                .font(.system(size: 13, weight: .bold)).foregroundColor(a.status == "FAILED" ? C.brick : C.ink)
                        }
                        Text(a.transcript?.isEmpty == false ? "“\(a.transcript!)”" : "—").font(.system(size: 16)).foregroundColor(C.ink)
                        HStack(spacing: 8) {
                            Tag(text: langName(a.language))
                            Text(a.inputKind == "text" ? "⌨️" : "🎤").font(.system(size: 12))
                            Text(String(format: "%.1f s", Double(a.latencyMs ?? 0) / 1000)).font(.system(size: 12)).foregroundColor(C.ink2)
                        }
                    }
                }
                Color.clear.frame(height: 40)
            }
            .padding(14)
        }
        .refreshable { await s.loadTab(.attempts) }
    }
}

struct IntroView: View {
    @EnvironmentObject var s: AppState
    @State private var page = 0
    var body: some View {
        let t = s.t
        let cards: [(String, String, String)] = [("mic.fill", t.introTitle1, t.introBody1), ("list.clipboard.fill", t.introTitle2, t.introBody2),
                                                 ("hand.tap.fill", t.introTitle3, t.introBody3), ("sparkles", t.introTitle4, t.introBody4)]
        ZStack {
            C.linen.ignoresSafeArea()
            VStack(spacing: 20) {
                HStack { Spacer(); Button(t.introSkip) { s.finishIntro(practice: false) }.font(.system(size: 16, weight: .semibold)).foregroundColor(C.ink2) }
                Spacer()
                ZStack { Circle().fill(C.marigold).frame(width: 120, height: 120); Image(systemName: cards[page].0).font(.system(size: 50)).foregroundColor(C.ink) }
                if page == 0 {
                    TimelineView(.periodic(from: Date(), by: 0.15)) { ctx in
                        LevelMeter(level: Float(0.3 + 0.7 * abs(sin(ctx.date.timeIntervalSinceReferenceDate * 3)))).scaleEffect(2)
                    }.frame(height: 44)
                }
                Text(cards[page].1).font(.system(size: 26, weight: .bold)).foregroundColor(C.ink).multilineTextAlignment(.center)
                Text(cards[page].2).font(.system(size: 18)).foregroundColor(C.ink2).multilineTextAlignment(.center).padding(.horizontal, 8)
                Spacer()
                HStack(spacing: 8) { ForEach(0..<4, id: \.self) { i in Circle().fill(i == page ? C.indigo : C.line).frame(width: 8, height: 8) } }
                if page < 3 { BigButton(title: t.introNext, color: C.indigo) { withAnimation { page += 1 } } }
                else { BigButton(title: t.introTry, color: C.mint) { s.finishIntro(practice: true) } }
            }
            .padding(24)
        }
    }
}
