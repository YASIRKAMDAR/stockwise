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
                    else { HistoryScreen() }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                if s.flow == nil && s.tab == .home { VoiceBar() }
            }
            .background(C.linen)

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

struct HomeScreen: View {
    @EnvironmentObject var s: AppState
    var body: some View {
        let t = s.t
        let waiting = s.outbox.filter { $0.error == nil }
        let failed = s.outbox.filter { $0.error != nil }
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Panel {
                    HStack(spacing: 14) {
                        Image(systemName: "mic.fill").font(.system(size: 22)).foregroundColor(C.ink)
                            .frame(width: 52, height: 52).background(C.marigold).clipShape(Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t.holdToTalk).font(.system(size: 17, weight: .semibold)).foregroundColor(C.ink)
                            Text(t.example).font(.system(size: 15)).foregroundColor(C.ink2)
                        }
                    }
                    Text(t.youCanSay).font(.system(size: 13, weight: .bold)).foregroundColor(C.ink2).padding(.top, 4)
                    ForEach(Array(t.examples.dropFirst()), id: \.self) { e in Text(e).font(.system(size: 14)).foregroundColor(C.ink2) }
                }
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
                if let n = s.notice { Banner(text: n.text, warn: n.warn) }
                if let rows = s.answer {
                    Panel {
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                            HStack {
                                Text(r.name).font(.system(size: 16, weight: .semibold)).foregroundColor(C.ink)
                                Spacer()
                                Text("\(t.store) \(r.store ?? 0)").foregroundColor(C.ink2)
                                Text("👜 \(s.bag[r.productId] ?? 0)").foregroundColor(C.ink2)
                            }
                        }
                    }
                }
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
