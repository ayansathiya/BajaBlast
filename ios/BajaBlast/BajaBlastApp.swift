import SwiftUI

/// Baja Blast on an iPhone.
///
/// The app finds the kitchen by itself, then shows the household's phone
/// page — the first time it asks "Who are you?", and after that it opens on
/// that person's own welcome: their day, their chores, dinner, groceries,
/// reminders, timers, the weather, and every other tab the phone page has.
/// Those screens come from the kitchen itself, so they update with it: no
/// new app needed when the calendar gets a new feature.
@main
struct BajaBlastApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
        }
    }
}

enum Stage: Equatable {
    case finding
    case found(URL)
    case lost
}

struct RootView: View {
    @State private var stage: Stage = .finding
    @Environment(\.scenePhase) private var phase
    private let finder = KitchenFinder()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            switch stage {
            case .finding:
                FindingView()
            case .found(let base):
                KitchenWebView(url: base.appendingPathComponent("mobile"), onLost: { Task { await look() } })
                    .ignoresSafeArea(edges: .bottom)
            case .lost:
                LostView(finder: finder, onFound: { stage = .found($0) }, onRetry: { Task { await look() } })
            }
        }
        .task { await look() }
        // Back from the background on another network (left the house, came
        // home): make sure the address still answers.
        .onChange(of: phase) { now in
            if now == .active, case .found(let base) = stage {
                Task {
                    if await !finder.isKitchen(base) { await look() }
                }
            }
        }
    }

    private func look() async {
        stage = .finding
        if let base = await finder.find() {
            stage = .found(base)
            await finder.learnRemote(from: base)
        } else {
            stage = .lost
        }
    }
}

struct FindingView: View {
    var body: some View {
        VStack(spacing: 18) {
            Image("Mark").resizable().frame(width: 84, height: 84).clipShape(RoundedRectangle(cornerRadius: 20))
            ProgressView().tint(.white)
            Text("Finding the kitchen…")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(.secondary)
        }
    }
}

/// Couldn't find it: say why that usually is, try again, or type it once.
struct LostView: View {
    let finder: KitchenFinder
    let onFound: (URL) -> Void
    let onRetry: () -> Void
    @State private var typed = ""
    @State private var trying = false
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Can't find the kitchen")
                .font(.system(size: 30, weight: .bold, design: .serif))
            Text("Is this phone on the home Wi-Fi? If it asked to find devices on your network, it needs that — Settings → Baja Blast → Local Network.")
                .foregroundStyle(.secondary)
            Button(action: onRetry) {
                Text("Try again").frame(maxWidth: .infinity).padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 0.85, green: 0.76, blue: 0.63))
            .foregroundStyle(.black)

            Text("Or type the address the wall shows under Settings → System:")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.top, 12)
            HStack {
                TextField("192.168.1.40", text: $typed)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                Button(trying ? "…" : "Go") {
                    trying = true
                    Task {
                        let url = await finder.tryTyped(typed)
                        trying = false
                        if let url { onFound(url) } else { failed = true }
                    }
                }
                .disabled(typed.isEmpty || trying)
            }
            if failed {
                Text("Nothing answered there.").font(.footnote).foregroundStyle(.red)
            }
        }
        .padding(28)
    }
}
