package com.bajablast.phone;

import java.net.URI;
import java.util.Locale;

/**
 * Turning whatever someone typed into the kitchen's address.
 *
 * People type what the wall screen shows them, or half of it: "192.168.1.20",
 * "192.168.1.20:8787", "http://192.168.1.20:8787/mobile", or a Tailscale name
 * like "kitchen.tail1234.ts.net". All of those should work, and all of them
 * should end up as the same thing: a base address with no path, from which the
 * app opens /mobile and asks /health whether anyone is home.
 *
 * Plain Java, no Android, so it can be tested on any machine
 * (android/test/AddressTest.java).
 */
public final class Address {
    public static final int DEFAULT_PORT = 8787;

    private Address() {}

    /**
     * The base URL ("http://192.168.1.20:8787"), or null if this can't be an
     * address.
     *
     * Without a scheme: a Tailscale name (*.ts.net) is https on the standard
     * port, because that's how setup/remote-setup.sh serves it; anything else
     * is the calendar's own plain-http port on the home network.
     */
    public static String normalize(String typed) {
        if (typed == null) return null;
        String s = typed.trim();
        if (s.isEmpty()) return null;
        // An address never has a space in the middle; a sentence does.
        if (s.matches(".*\\s.*")) return null;
        // Copied out of a message with a full stop after it.
        s = s.replaceAll("[.,;]+$", "");

        boolean hadScheme = s.matches("(?i)^[a-z][a-z0-9+.-]*://.*");
        if (!hadScheme) {
            String hostPart = s.split("[/:?#]", 2)[0].toLowerCase(Locale.ROOT);
            s = (hostPart.endsWith(".ts.net") ? "https://" : "http://") + s;
        }

        URI uri;
        try {
            uri = new URI(s);
        } catch (Exception e) {
            return null;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) return null;
        String host = uri.getHost();
        if (host == null || host.isEmpty()) return null;
        host = host.toLowerCase(Locale.ROOT);
        if (!isPlausibleHost(host)) return null;

        int port = uri.getPort();
        if (port == -1 && !hadScheme && scheme.equals("http")) port = DEFAULT_PORT;
        if (port == 80 && scheme.equals("http")) port = -1;
        if (port == 443 && scheme.equals("https")) port = -1;
        if (port == 0 || port > 65535) return null;

        String hostOut = host.contains(":") && !host.startsWith("[") ? "[" + host + "]" : host;
        return scheme + "://" + hostOut + (port == -1 ? "" : ":" + port);
    }

    /** Where the phone page lives, given a base from normalize(). */
    public static String mobileUrl(String base) {
        return base + "/mobile";
    }

    /** The unauthenticated probe the server answers with {"ok":true,...}. */
    public static String healthUrl(String base) {
        return base + "/health";
    }

    /** True if the /health body is Baja Blast's, not some other web server's. */
    public static boolean looksLikeBajaBlast(String body) {
        if (body == null) return false;
        String b = body.replaceAll("\\s+", "");
        return b.contains("\"ok\":true") && b.contains("\"build\":");
    }

    /**
     * A page on the kitchen's own server stays in the app; anything else (a
     * recipe site, Spotify, Tailscale's login page) opens in the browser.
     */
    public static boolean sameOrigin(String base, String url) {
        if (base == null || url == null) return false;
        try {
            URI a = new URI(base);
            URI b = new URI(url);
            if (b.getScheme() == null || b.getHost() == null) return false;
            return a.getScheme().equalsIgnoreCase(b.getScheme())
                && a.getHost().equalsIgnoreCase(b.getHost())
                && effectivePort(a) == effectivePort(b);
        } catch (Exception e) {
            return false;
        }
    }

    /** The first three parts of an IPv4 address, "192.168.1.", or null. */
    public static String subnetPrefix(String ipv4) {
        if (ipv4 == null) return null;
        String[] p = ipv4.split("\\.");
        if (p.length != 4) return null;
        for (String x : p) {
            try {
                int n = Integer.parseInt(x);
                if (n < 0 || n > 255) return null;
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return p[0] + "." + p[1] + "." + p[2] + ".";
    }

    private static int effectivePort(URI u) {
        if (u.getPort() != -1) return u.getPort();
        return "https".equalsIgnoreCase(u.getScheme()) ? 443 : 80;
    }

    private static boolean isPlausibleHost(String host) {
        if (host.startsWith("[")) return true; // IPv6 literal
        if (host.matches("^[0-9.]+$")) return subnetPrefix(host) != null; // IPv4 must be whole
        return host.matches("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$");
    }
}
