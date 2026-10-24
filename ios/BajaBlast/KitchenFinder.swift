import Foundation
import Darwin

/// Finds the kitchen calendar without anyone typing an address.
///
/// In order, stopping at the first that answers:
///   1. the address that worked last time;
///   2. the Pi's own name on the home network (raspberrypi.local);
///   3. every address on this phone's Wi-Fi, asked at once — about two
///      seconds on a home network;
///   4. the away-from-home address (Tailscale), if the kitchen has one.
///
/// "Answers" means its /health says it's Baja Blast, not just that something
/// is listening on the port.
actor KitchenFinder {
    static let port = 8787
    private let defaults = UserDefaults.standard
    private let lastKey = "kitchen.last"
    private let remoteKey = "kitchen.remote"

    var remembered: URL? {
        defaults.string(forKey: lastKey).flatMap(URL.init(string:))
    }

    func remember(_ url: URL) {
        defaults.set(url.absoluteString, forKey: lastKey)
    }

    func forget() {
        defaults.removeObject(forKey: lastKey)
    }

    func find() async -> URL? {
        if let last = remembered, await isKitchen(last) { return last }
        for name in ["raspberrypi.local", "baja-blast.local"] {
            if let url = URL(string: "http://\(name):\(Self.port)"), await isKitchen(url) {
                remember(url)
                return url
            }
        }
        if let found = await sweep() {
            remember(found)
            return found
        }
        if let remote = defaults.string(forKey: remoteKey).flatMap(URL.init(string:)), await isKitchen(remote) {
            return remote
        }
        return nil
    }

    /// Someone typed it: tidy it up ("192.168.1.40" → http://192.168.1.40:8787).
    func tryTyped(_ text: String) async -> URL? {
        var t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return nil }
        if !t.contains("://") { t = "http://" + t }
        guard var parts = URLComponents(string: t) else { return nil }
        if parts.port == nil && parts.scheme == "http" { parts.port = Self.port }
        parts.path = ""
        guard let url = parts.url, await isKitchen(url) else { return nil }
        remember(url)
        return url
    }

    /// The kitchen's away-from-home address, kept for when we're not on its Wi-Fi.
    func learnRemote(from base: URL) async {
        guard let version = try? await json(base.appendingPathComponent("api/version")),
              let remote = version["remoteUrl"] as? String, !remote.isEmpty
        else { return }
        defaults.set(remote, forKey: remoteKey)
    }

    // MARK: - Asking

    func isKitchen(_ base: URL, timeout: TimeInterval = 2.5) async -> Bool {
        guard let health = try? await json(base.appendingPathComponent("health"), timeout: timeout) else { return false }
        return (health["ok"] as? Bool) == true && health["build"] != nil
    }

    private func json(_ url: URL, timeout: TimeInterval = 4) async throws -> [String: Any] {
        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw URLError(.badServerResponse) }
        return object
    }

    /// Every address on this /24, all at once; the first that's the kitchen wins.
    private func sweep() async -> URL? {
        guard let own = Self.wifiAddress() else { return nil }
        let parts = own.split(separator: ".")
        guard parts.count == 4 else { return nil }
        let prefix = parts.prefix(3).joined(separator: ".")
        return await withTaskGroup(of: URL?.self) { group in
            for host in 1...254 where "\(prefix).\(host)" != own {
                group.addTask {
                    guard let url = URL(string: "http://\(prefix).\(host):\(Self.port)") else { return nil }
                    return await self.isKitchen(url, timeout: 1.5) ? url : nil
                }
            }
            for await result in group {
                if let url = result {
                    group.cancelAll()
                    return url
                }
            }
            return nil
        }
    }

    /// This phone's address on Wi-Fi (en0), e.g. "192.168.1.23".
    static func wifiAddress() -> String? {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return nil }
        defer { freeifaddrs(list) }
        for node in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let ifa = node.pointee
            guard let addr = ifa.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET),
                  String(cString: ifa.ifa_name) == "en0"
            else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                return String(cString: host)
            }
        }
        return nil
    }
}
