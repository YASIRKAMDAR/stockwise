import SwiftUI

struct RootView: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        ZStack {
            C.linen.ignoresSafeArea()
            if s.booting { ProgressView() }
            else if s.me == nil { LoginScreen() }
            else { Shell() }
        }
    }
}

struct LoginScreen: View {
    @EnvironmentObject var s: AppState
    @State private var code = ""
    @State private var pin = ""
    var body: some View {
        let t = s.t
        ZStack {
            C.ink.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Image(systemName: "checkmark").font(.system(size: 22, weight: .bold)).foregroundColor(.white)
                        .frame(width: 52, height: 52).background(C.indigo).clipShape(RoundedRectangle(cornerRadius: 14))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Stockwise").font(.system(size: 24, weight: .bold)).foregroundColor(C.ink)
                        Text(t.tagline).font(.system(size: 15)).foregroundColor(C.ink2)
                    }
                }
                LangRow()
                VStack(alignment: .leading, spacing: 6) {
                    Text(t.yourCode).font(.system(size: 14, weight: .semibold)).foregroundColor(C.ink2)
                    TextField("", text: $code)
                        .textInputAutocapitalization(.characters).autocorrectionDisabled(true)
                        .font(.system(size: 20, weight: .bold)).foregroundColor(C.ink)
                        .padding(.horizontal, 14).frame(height: 54)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(C.line, lineWidth: 1.5))
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(t.passcode).font(.system(size: 14, weight: .semibold)).foregroundColor(C.ink2)
                    SecureField("", text: $pin)
                        .keyboardType(.numberPad)
                        .font(.system(size: 20, weight: .bold)).foregroundColor(C.ink)
                        .padding(.horizontal, 14).frame(height: 54)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(C.line, lineWidth: 1.5))
                }
                if let e = s.loginError { Banner(text: e) }
                BigButton(title: s.busy ? "…" : t.signIn, enabled: !s.busy && !code.isEmpty && pin.count >= 4) { s.login(code: code, pin: pin) }
            }
            .padding(22)
            .background(C.paper)
            .clipShape(RoundedRectangle(cornerRadius: 22))
            .padding(20)
        }
        .onAppear { if code.isEmpty { code = s.store.lastCode } }
    }
}

struct Shell: View {
    @EnvironmentObject var s: AppState
    private var title: String {
        let t = s.t
        if let f = s.flow { return t.act(f.kind).0 }
        switch s.tab {
        case .home: return s.hotel?.name ?? ""
        case .bag: return t.myBag
        case .history: return t.history
        case .attempts: return t.voiceAttempts
        }
    }
    var body: some View {
        ZStack(alignment: .leading) {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Button(action: { s.menuOpen = true }) {
                        Image(systemName: "line.3.horizontal").font(.system(size: 20, weight: .semibold)).foregroundColor(C.ink)
                            .frame(width: 46, height: 46)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(C.line, lineWidth: 1.5))
                    }
                    .accessibilityLabel("Menu")
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title).font(.system(size: 17, weight: .semibold)).foregroundColor(C.ink).lineLimit(1)
                        Text("\(s.me?.displayName ?? "") · \(s.hotel?.name ?? "")").font(.system(size: 13)).foregroundColor(C.ink2).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(C.paper)
                Rectangle().fill(C.line).frame(height: 1)

                Group {
                    if let f = s.flow { FlowScreen(f: f) }
                    else if s.tab == .home { HomeScreen() }
                    else if s.tab == .bag { BagScreen() }
                    else if s.tab == .attempts { AttemptsScreen() }
                    else { HistoryScreen() }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                if s.flow == nil && s.tab == .home { VoiceBar() }
            }
            .background(C.linen)

            if s.showIntro { IntroView().transition(.opacity).zIndex(2) }
            if s.menuOpen {
                Color.black.opacity(0.35).ignoresSafeArea().onTapGesture { s.menuOpen = false }
                MenuPanel().frame(width: 300).frame(maxHeight: .infinity).background(C.paper.ignoresSafeArea())
            }
        }
    }
}

/// ☰ menu: sections, language, and Sign out at the bottom.
struct MenuPanel: View {
    @EnvironmentObject var s: AppState
    private func item(_ label: String, _ icon: String, _ tab: AppTab) -> some View {
        let on = s.tab == tab && s.flow == nil
        return Button(action: { s.go(tab) }) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 18)).frame(width: 26)
                Text(label).font(.system(size: 17, weight: .semibold))
                Spacer()
            }
            .foregroundColor(on ? C.indigo : C.ink)
            .padding(.horizontal, 12).frame(height: 52)
            .background(on ? C.indigoWash : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }
    var body: some View {
        let t = s.t
        VStack(alignment: .leading, spacing: 4) {
            VStack(alignment: .leading, spacing: 2) {
                Text(s.me?.displayName ?? "").font(.system(size: 20, weight: .bold)).foregroundColor(C.ink)
                Text(s.hotel?.name ?? "").font(.system(size: 15)).foregroundColor(C.ink2)
            }
            .padding(.horizontal, 12).padding(.bottom, 10)
            Rectangle().fill(C.line).frame(height: 1).padding(.bottom, 6)
            item(t.home, "house.fill", .home)
            item(t.myBag, "bag.fill", .bag)
            item(t.history, "clock.arrow.circlepath", .history)
            Rectangle().fill(C.line).frame(height: 1).padding(.vertical, 6)
            Button(action: { s.openIntro() }) {
                HStack(spacing: 12) {
                    Image(systemName: "questionmark.circle").font(.system(size: 18)).frame(width: 26)
                    Text(t.howToUse).font(.system(size: 17, weight: .semibold))
                    Spacer()
                }
                .foregroundColor(C.ink).padding(.horizontal, 12).frame(height: 52)
            }
            item(t.voiceAttempts, "waveform.badge.magnifyingglass", .attempts)
            Rectangle().fill(C.line).frame(height: 1).padding(.vertical, 6)
            Text(t.language).font(.system(size: 14)).foregroundColor(C.ink2).padding(.horizontal, 12)
            LangRow().padding(.horizontal, 12)
            Spacer()
            Rectangle().fill(C.line).frame(height: 1)
            Button(action: { s.signOut() }) {
                HStack(spacing: 12) {
                    Image(systemName: "rectangle.portrait.and.arrow.right").font(.system(size: 18)).frame(width: 26)
                    Text(t.signOut).font(.system(size: 17, weight: .semibold))
                    Spacer()
                }
                .foregroundColor(C.brick).padding(.horizontal, 12).frame(height: 52)
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 16)
    }
}

struct JobTile: View {
    @EnvironmentObject var s: AppState
    let kind: Kind
    var primary: Bool = false
    private var icon: String {
        switch kind {
        case .placeInRoom: return "🚪"
        case .checkoutToStaff: return "🛍️"
        case .returnToStore: return "↩️"
        case .supplierReceipt: return "📦"
        }
    }
    var body: some View {
        let a = s.t.act(kind)
        Button(action: { s.start(kind) }) {
            HStack(spacing: 12) {
                Text(icon).font(.system(size: 26))
                VStack(alignment: .leading, spacing: 2) {
                    Text(a.0).font(.system(size: 17, weight: .bold)).foregroundColor(primary ? .white : C.ink).multilineTextAlignment(.leading)
                    Text(a.1).font(.system(size: 13)).foregroundColor(primary ? Color(hex: 0xD9DDF5) : C.ink3).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(primary ? C.indigo : C.paper)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(primary ? C.indigo : C.line, lineWidth: 1))
        }
    }
}

struct BagScreen: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        let t = s.t
        let items = s.activeProducts.filter { (s.bag[$0.id] ?? 0) > 0 }
        ScrollView {
            VStack(spacing: 10) {
                if items.isEmpty { Panel { Text(t.nothingInBag).foregroundColor(C.ink) } }
                ForEach(items) { p in
                    Panel {
                        HStack(spacing: 12) {
                            Text(p.emoji).font(.system(size: 30))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).font(.system(size: 17, weight: .semibold)).foregroundColor(C.ink)
                                if let n = p.native(s.lang) { Text(n).font(.system(size: 15)).foregroundColor(C.ink2) }
                            }
                            Spacer()
                            Text("\(s.bag[p.id] ?? 0)").font(.system(size: 30, weight: .bold)).foregroundColor(C.ink)
                        }
                    }
                }
                BigButton(title: t.act(.returnToStore).0, outline: true) { s.start(.returnToStore) }
            }
            .padding(16)
        }
    }
}

struct HistoryScreen: View {
    @EnvironmentObject var s: AppState
    private func when(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var d = f.date(from: iso)
        if d == nil { f.formatOptions = [.withInternetDateTime]; d = f.date(from: iso) }
        guard let date = d else { return "" }
        let out = DateFormatter()
        out.dateFormat = "dd MMM, HH:mm"
        return out.string(from: date)
    }
    private func detail(_ e: ActivityEvent) -> String {
        (e.lines ?? []).map { l in
            "\(l.quantity ?? 0) \(l.name ?? "")" + (l.roomNumber.map { " · \(s.t.room) \($0)" } ?? "")
        }.joined(separator: ", ")
    }
    var body: some View {
        let t = s.t
        ScrollView {
            VStack(spacing: 10) {
                if s.history.isEmpty { Panel { Text(t.noHistory).foregroundColor(C.ink) } }
                ForEach(s.history) { e in
                    Panel {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text((Kind(rawValue: e.action).map { t.act($0).0 } ?? e.action) + (e.viaVoice == true ? " · 🎙" : ""))
                                    .font(.system(size: 17, weight: .semibold)).foregroundColor(C.ink)
                                Text(detail(e)).font(.system(size: 15)).foregroundColor(C.ink2)
                            }
                            Spacer()
                            Text(when(e.createdAt)).font(.system(size: 13)).foregroundColor(C.ink3)
                        }
                    }
                }
            }
            .padding(16)
        }
    }
}


/// The staff member's own last voice attempts: what was heard, in which language, how fast, and what happened. For quick testing.
struct AttemptsScreen: View {
    @EnvironmentObject var s: AppState
    private func when(_ iso: String) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var d = f.date(from: iso); if d == nil { f.formatOptions = [.withInternetDateTime]; d = f.date(from: iso) }
        guard let date = d else { return "" }
        let out = DateFormatter(); out.dateFormat = "HH:mm:ss"; return out.string(from: date)
    }
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
                            Text(a.status == "FAILED" ? "✗ \(a.errorCode ?? "FAILED")" : a.fallback != nil ? "~ phone words" : a.confirmed == true ? "✓ saved" : a.status == "AMBIGUOUS" ? "? needed help" : "✓ \(a.action ?? "")")
                                .font(.system(size: 13, weight: .bold)).foregroundColor(a.status == "FAILED" ? C.brick : C.ink)
                        }
                        Text(a.transcript?.isEmpty == false ? "“\(a.transcript!)”" : "—").font(.system(size: 16)).foregroundColor(C.ink)
                        HStack(spacing: 8) {
                            Text(langName(a.language)).font(.system(size: 12, weight: .semibold)).foregroundColor(C.indigo)
                                .padding(.horizontal, 7).padding(.vertical, 2).background(C.indigoWash).clipShape(Capsule())
                            Text(a.inputKind == "text" ? "⌨️" : "🎤").font(.system(size: 12))
                            Text(String(format: "%.1f s", Double(a.latencyMs ?? 0) / 1000)).font(.system(size: 12)).foregroundColor(C.ink2)
                        }
                    }
                }
            }
            .padding(16)
        }
        .refreshable { s.loadAttempts() }
    }
}

/// Four short cards shown once after the first sign-in, ending with a practice command that changes nothing.
struct IntroView: View {
    @EnvironmentObject var s: AppState
    @State private var page = 0
    @State private var demoLevel: Float = 0.2
    var body: some View {
        let t = s.t
        let cards: [(String, String, String)] = [("mic.fill", t.introTitle1, t.introBody1), ("hand.point.up.left.fill", t.introTitle2, t.introBody2),
                                                 ("checkmark.circle.fill", t.introTitle3, t.introBody3), ("sparkles", t.introTitle4, t.introBody4)]
        ZStack {
            C.linen.ignoresSafeArea()
            VStack(spacing: 20) {
                HStack { Spacer(); Button(t.introSkip) { s.finishIntro(practice: false) }.font(.system(size: 16, weight: .semibold)).foregroundColor(C.ink2) }
                Spacer()
                ZStack {
                    Circle().fill(C.marigold).frame(width: 120, height: 120)
                    Image(systemName: cards[page].0).font(.system(size: 50)).foregroundColor(C.ink)
                }
                if page == 0 {
                    TimelineView(.periodic(from: Date(), by: 0.15)) { ctx in
                        LevelMeter(level: Float(0.3 + 0.7 * abs(sin(ctx.date.timeIntervalSinceReferenceDate * 3)))).scaleEffect(2)
                    }.frame(height: 44)
                }
                Text(cards[page].1).font(.system(size: 26, weight: .bold)).foregroundColor(C.ink).multilineTextAlignment(.center)
                Text(cards[page].2).font(.system(size: 18)).foregroundColor(C.ink2).multilineTextAlignment(.center).padding(.horizontal, 8)
                Spacer()
                HStack(spacing: 8) { ForEach(0..<4, id: \.self) { i in Circle().fill(i == page ? C.indigo : C.line).frame(width: 8, height: 8) } }
                if page < 3 {
                    BigButton(title: t.introNext, color: C.indigo) { withAnimation { page += 1 } }
                } else {
                    BigButton(title: t.introTry, color: C.mint) { s.finishIntro(practice: true) }
                }
            }
            .padding(24)
        }
        .accessibilityElement(children: .contain)
    }
}
