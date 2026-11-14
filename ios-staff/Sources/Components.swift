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
                    Text(item.1)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(on ? .white : C.ink2)
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .background(on ? C.ink : C.paper)
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
    @State private var text = ""
    @State private var armed = false

    private var typing: Bool { !text.trimmingCharacters(in: .whitespaces).isEmpty && !s.voiceLive }
    private func submit() {
        let v = text.trimmingCharacters(in: .whitespaces)
        if v.isEmpty || s.busy { return }
        text = ""
        s.interpret(v, durationMs: 0)
    }

    var body: some View {
        let t = s.t
        HStack(spacing: 8) {
            Group {
                if s.voiceLive {
                    TimelineView(.periodic(from: Date(), by: 0.25)) { ctx in
                        HStack(spacing: 8) {
                            Circle().fill(C.brick).frame(width: 10, height: 10)
                            Text(fmtSecs(ctx.date.timeIntervalSince(s.voiceStartedAt))).font(.system(size: 17, weight: .bold)).foregroundColor(C.ink)
                            Text(armed ? t.releaseToCancel : (s.voiceInterim.isEmpty ? t.slideToCancel : s.voiceInterim))
                                .font(.system(size: 16, weight: armed ? .bold : .regular))
                                .foregroundColor(armed ? C.brick : C.ink2)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                    }
                } else {
                    TextField(t.typeHere, text: $text)
                        .font(.system(size: 17))
                        .foregroundColor(C.ink)
                        .submitLabel(.send)
                        .onSubmit(submit)
                        .disabled(s.busy)
                }
            }
            .padding(.horizontal, 20)
            .frame(height: 56)
            .background(C.paper)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(s.voiceLive ? (armed ? C.ink3 : C.brick) : C.line, lineWidth: 1.5))

            if typing {
                Button(action: submit) {
                    Image(systemName: "paperplane.fill").font(.system(size: 24)).foregroundColor(.white)
                        .frame(width: 60, height: 60).background(C.mint).clipShape(Circle())
                }
                .accessibilityLabel("Send")
            } else if s.busy {
                ProgressView().frame(width: 60, height: 60).background(C.line).clipShape(Circle())
            } else {
                Image(systemName: "mic.fill").font(.system(size: 26)).foregroundColor(s.voiceLive ? .white : C.ink)
                    .frame(width: 60, height: 60)
                    .background(s.voiceLive ? (armed ? C.ink3 : C.brick) : C.marigold)
                    .clipShape(Circle())
                    .scaleEffect(s.voiceLive ? 1.15 : 1)
                    .modifier(HoldToTalk(onStart: { s.voiceStart() }, onSend: { s.voiceSend() }, onCancel: { s.voiceCancel() }, onTap: { s.voiceHint() }, onArm: { armed = $0 }))
                    .accessibilityLabel(t.holdToTalk)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(C.linen)
    }
}
