import com.bajablast.phone.Address;
import com.bajablast.phone.Discovery;

import com.sun.net.httpserver.HttpServer;

import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

/**
 * The two parts of the Android app that aren't Android: reading what someone
 * typed as an address, and finding the kitchen on the Wi-Fi.
 *
 *   javac -d /tmp/bb android/app/src/main/java/com/bajablast/phone/{Address,Discovery}.java android/test/AddressTest.java
 *   java -cp /tmp/bb AddressTest
 *
 * Run by .github/workflows/android.yml before the APK is built. The sweep is
 * tested for real, against a fake kitchen on 127.0.0.x — Linux answers the
 * whole 127/8 block on loopback, which makes a stand-in /24 for free.
 */
public class AddressTest {
    static int pass = 0, fail = 0;

    static void check(String name, boolean ok, String detail) {
        if (ok) { pass++; System.out.println("  ok   " + name); }
        else { fail++; System.out.println("  FAIL " + name + (detail == null ? "" : " — " + detail)); }
    }

    static void norm(String typed, String expected) {
        String got = Address.normalize(typed);
        check("\"" + typed + "\" -> " + expected, expected == null ? got == null : expected.equals(got), "got " + got);
    }

    public static void main(String[] args) throws Exception {
        System.out.println("\nWhat people type");
        norm("192.168.1.20", "http://192.168.1.20:8787");
        norm("  192.168.1.20  ", "http://192.168.1.20:8787");
        norm("192.168.1.20:8787", "http://192.168.1.20:8787");
        norm("192.168.1.20:8787/mobile", "http://192.168.1.20:8787");
        norm("http://192.168.1.20:8787/mobile", "http://192.168.1.20:8787");
        norm("HTTP://192.168.1.20:8787/mobile#grocery", "http://192.168.1.20:8787");
        norm("http://192.168.1.20", "http://192.168.1.20");
        norm("192.168.1.20.", "http://192.168.1.20:8787");
        norm("kitchen.tail1234.ts.net", "https://kitchen.tail1234.ts.net");
        norm("https://kitchen.tail1234.ts.net/mobile", "https://kitchen.tail1234.ts.net");
        norm("https://kitchen.tail1234.ts.net:443", "https://kitchen.tail1234.ts.net");
        norm("Kitchen.Local", "http://kitchen.local:8787");
        norm("baja-pi", "http://baja-pi:8787");
        norm("", null);
        norm("   ", null);
        norm(null, null);
        norm("192.168.1", null);
        norm("192.168.1.300", null);
        norm("ftp://192.168.1.20", null);
        norm("javascript:alert(1)", null);
        norm("192.168.1.20:99999", null);
        norm("not an address at all", null);

        System.out.println("\nWhat stays in the app");
        String base = "http://192.168.1.20:8787";
        check("the phone page", Address.sameOrigin(base, "http://192.168.1.20:8787/mobile#chores"), null);
        check("an API call", Address.sameOrigin(base, "http://192.168.1.20:8787/api/events"), null);
        check("a recipe site goes to the browser", !Address.sameOrigin(base, "https://www.allrecipes.com/"), null);
        check("same machine, other port goes to the browser", !Address.sameOrigin(base, "http://192.168.1.20:8080/"), null);
        check("https version of the same host goes to the browser", !Address.sameOrigin(base, "https://192.168.1.20:8787/"), null);
        check("default ports compare equal", Address.sameOrigin("https://k.ts.net", "https://k.ts.net:443/mobile"), null);
        check("a malformed link is not ours", !Address.sameOrigin(base, "http://[bad"), null);
        check("no address saved yet, nothing is ours", !Address.sameOrigin(null, "http://192.168.1.20:8787/"), null);

        System.out.println("\nRecognising the kitchen");
        check("its /health", Address.looksLikeBajaBlast("{\"ok\":true,\"build\":\"2026-09-26-41\"}"), null);
        check("pretty-printed", Address.looksLikeBajaBlast("{\n  \"ok\": true,\n  \"build\": \"x\"\n}"), null);
        check("a router's page is not", !Address.looksLikeBajaBlast("<html>Login</html>"), null);
        check("some other app's health check is not", !Address.looksLikeBajaBlast("{\"ok\":true}"), null);
        check("subnet of 192.168.1.37", "192.168.1.".equals(Address.subnetPrefix("192.168.1.37")), null);
        check("no subnet from nonsense", Address.subnetPrefix("fe80::1") == null && Address.subnetPrefix(null) == null, null);

        System.out.println("\nLooking on the Wi-Fi");
        HttpServer fake = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        int port = fake.getAddress().getPort();
        fake.createContext("/health", ex -> {
            byte[] b = "{\"ok\":true,\"build\":\"test\"}".getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, b.length);
            ex.getResponseBody().write(b);
            ex.close();
        });
        fake.start();
        try {
            String fakeBase = "http://127.0.0.1:" + port;
            check("probe finds a kitchen that's there", Discovery.probe(fakeBase), null);
            check("probe says no to a port with nothing on it", !Discovery.probe("http://127.0.0.1:1"), null);

            Method scan = Discovery.class.getDeclaredMethod("scan", String.class, String.class, int.class);
            scan.setAccessible(true);
            long t0 = System.nanoTime();
            String found = (String) scan.invoke(null, "127.0.0.", "127.0.0.9", port);
            long ms = (System.nanoTime() - t0) / 1_000_000;
            check("the sweep finds it", fakeBase.equals(found), "found " + found);
            check("in a few seconds, not minutes (" + ms + "ms)", ms < 10_000, null);
            String none = (String) scan.invoke(null, "127.0.0.", null, 1);
            check("an empty network comes back empty", none == null, "found " + none);
            check("no subnet, no sweep", Discovery.scan(null, null) == null, null);
        } finally {
            fake.stop(0);
        }

        System.out.println("\n" + pass + " passed, " + fail + " failed");
        System.exit(fail == 0 ? 0 : 1);
    }
}
