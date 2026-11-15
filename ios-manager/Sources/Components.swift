import SwiftUI
import UIKit

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}
enum C {
    static let ink = Color(hex: 0x1D2340), ink2 = Color(hex: 0x4A5072), ink3 = Color(hex: 0x6B7194)
    static let linen = Color(hex: 0xF7F8FB), line = Color(hex: 0xE3E6EF), paper = Color.white
    static let indigo = Color(hex: 0x2F3FA8), indigoWash = Color(hex: 0xEEF0FB)
    static let marigold = Color(hex: 0xF2A93B), marigoldWash = Color(hex: 0xFFF1D6), amber = Color(hex: 0x7A4800)
    static let mint = Color(hex: 0x1E9E6A), mintWash = Color(hex: 0xE3F5EC), brick = Color(hex: 0xC2413A)
}

func fmtSecs(_ seconds: TimeInterval) -> String {
    let s = max(0, Int(seconds))
    return String(format: "%d:%02d", s / 60, s % 60)
}

/// WhatsApp-style press-and-hold: hold to record, release to send, slide left to cancel; a quick tap shows a hint.
struct HoldToTalk: ViewModifier {
    let onStart: () -> Void
    let onSend: () -> Void
    let onCancel: () -> Void
    let onTap: () -> Void
    var onArm: (Bool) -> Void = { _ in }
    @GestureState private var pressing = false
    @State private var began = Date()
    @State private var armed = false

    func body(content: Content) -> some View {
        content
            .gesture(
                DragGesture(minimumDistance: 0)
                    .updating($pressing) { _, state, _ in state = true }
                    .onChanged { value in
                        let a = value.translation.width < -70
                        if a != armed { armed = a; onArm(a) }
                    }
            )
            .onChange(of: pressing) { down in
                if down {
                    began = Date(); armed = false
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    onStart()
                } else {
                    let held = Date().timeIntervalSince(began)
                    let wasArmed = armed
                    armed = false; onArm(false)
                    if held < 0.35 { onCancel(); onTap() } else if wasArmed { onCancel() } else { onSend() }
                }
            }
    }
}

struct Panel<Content: View>: View {
    var border: Color = C.line
    var bg: Color = C.paper
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 6) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(border, lineWidth: 1))
    }
}

struct Banner: View {
    let text: String
    var warn: Bool = true
    var body: some View {
        Text(text)
            .font(.system(size: 16, weight: .semibold))
            .foregroundColor(warn ? C.amber : Color(hex: 0x0F5C3C))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(warn ? C.marigoldWash : C.mintWash)
            .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

struct BigButton: View {
    let title: String
    var color: Color = C.indigo
    var outline: Bool = false
    var enabled: Bool = true
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 17, weight: .bold))
                .foregroundColor(outline ? C.ink : .white)
                .frame(maxWidth: .infinity)
                .frame(height: 58)
                .background(outline ? C.paper : (enabled ? color : C.line))
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(outline ? C.ink : Color.clear, lineWidth: 2))
        }
        .disabled(!enabled)
    }
}

struct LangRow: View {
    @EnvironmentObject var s: AppState
    private let langs: [(String, String)] = [("gu", "ગુજરાતી"), ("hi", "हिन्दी"), ("en", "English")]
    var body: some View {
        HStack(spacing: 0) {
            ForEach(langs, id: \.0) { item in
                let on = s.lang == item.0
                Button(action: { s.setLanguage(item.0) }) {
                    Text(item.1).font(.system(size: 15, weight: .semibold)).foregroundColor(on ? .white : C.ink2)
                        .frame(maxWidth: .infinity).frame(height: 48).background(on ? C.ink : C.paper)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(C.line, lineWidth: 1.5))
    }
}

/// The bar at the bottom: type and the button becomes Send; leave it empty and it's a hold-to-talk mic.
struct VoiceBar: View {
    @EnvironmentObject var s: AppState
    @State private var armed = false
    @FocusState private var focused: Bool

    private var typing: Bool { !s.draft.trimmingCharacters(in: .whitespaces).isEmpty && !s.voiceLive }
    private func submit() {
        let v = s.draft.trimmingCharacters(in: .whitespaces)
        if v.isEmpty || s.busy { return }
        s.draft = ""
        s.interpret(v, durationMs: 0)
    }
    var body: some View {
        let t = s.t
        HStack(spacing: 8) {
            Group {
                if s.voiceLive {
                    TimelineView(.periodic(from: Date(), by: 0.25)) { ctx in
                        HStack(spacing: 8) {
                            LevelMeter(level: s.voiceLevel)
                            Text(fmtSecs(ctx.date.timeIntervalSince(s.voiceStartedAt))).font(.system(size: 17, weight: .bold)).foregroundColor(C.ink)
                            Text(armed ? t.releaseToCancel : (s.voiceInterim.isEmpty ? t.slideToCancel : s.voiceInterim))
                                .font(.system(size: 16, weight: armed ? .bold : .regular)).foregroundColor(armed ? C.brick : C.ink2).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                    }
                } else if s.busy {
                    HStack(spacing: 10) { ProgressView(); Text(s.waitingLong ? t.stillAsking : t.understanding).foregroundColor(C.ink2).lineLimit(1); Spacer(minLength: 0) }
                } else {
                    TextField(s.voiceMode == "count" ? t.countHere : t.askHere, text: $s.draft)
                        .font(.system(size: 16)).foregroundColor(C.ink).submitLabel(.send).focused($focused).onSubmit(submit)
                        .onChange(of: s.draft) { v in if !v.isEmpty && !focused { focused = true } }
                }
            }
            .padding(.horizontal, 18).frame(height: 54).background(C.paper).clipShape(Capsule())
            .overlay(Capsule().stroke(s.voiceLive ? (armed ? C.ink3 : C.brick) : C.line, lineWidth: 1.5))

            if typing {
                Button(action: submit) {
                    Image(systemName: "paperplane.fill").font(.system(size: 22)).foregroundColor(.white).frame(width: 56, height: 56).background(C.mint).clipShape(Circle())
                }.accessibilityLabel("Send")
            } else if s.busy {
                ProgressView().frame(width: 56, height: 56).background(C.line).clipShape(Circle())
            } else {
                Image(systemName: "mic.fill").font(.system(size: 24)).foregroundColor(s.voiceLive ? .white : C.ink)
                    .frame(width: 56, height: 56)
                    .background(s.voiceLive ? (armed ? C.ink3 : C.brick) : C.marigold).clipShape(Circle())
                    .scaleEffect(s.voiceLive ? 1.15 : 1)
                    .modifier(HoldToTalk(onStart: { s.voiceStart() }, onSend: { s.voiceSend() }, onCancel: { s.voiceCancel() }, onTap: { s.voiceHint() }, onArm: { armed = $0 }))
                    .accessibilityLabel(t.holdToTalk)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8).background(C.linen)
    }
}

/// Five bars that rise with the staff member's voice, so they can see they're being heard.
struct LevelMeter: View {
    let level: Float
    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(0..<5, id: \.self) { i in
                let threshold = Float(i) / 5
                let on = level > threshold
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(on ? C.brick : C.brick.opacity(0.25))
                    .frame(width: 4, height: CGFloat(8 + i * 3))
                    .animation(.easeOut(duration: 0.08), value: on)
            }
        }
        .frame(width: 26, height: 22)
        .accessibilityHidden(true)
    }
}

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

/// A small capsule label: "low", a language tag, a status.
struct Tag: View {
    let text: String
    var color: Color = C.indigo
    var bg: Color = C.indigoWash
    var body: some View {
        Text(text).font(.system(size: 11, weight: .bold)).foregroundColor(color).padding(.horizontal, 8).padding(.vertical, 3).background(bg).clipShape(Capsule())
    }
}

/// A row of two or three pill buttons that share the width.
struct PillButton: View {
    let title: String
    var filled: Bool = false
    var color: Color = C.mint
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 14, weight: .bold)).foregroundColor(filled ? .white : C.ink).lineLimit(1).minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity).frame(height: 40).background(filled ? color : C.paper).clipShape(Capsule())
                .overlay(Capsule().stroke(filled ? Color.clear : C.line, lineWidth: 1.5))
        }
    }
}

/// Big number box used on the count screen; tap to type.
struct QtyBox: View {
    let value: Int?
    var tone: Color = C.line
    var bg: Color = C.paper
    var fg: Color = C.ink
    var body: some View {
        Text(value.map(String.init) ?? "—").font(.system(size: 20, weight: .heavy)).foregroundColor(fg)
            .frame(minWidth: 60).frame(height: 44).padding(.horizontal, 8).background(bg).clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(tone, lineWidth: 1.5))
    }
}
