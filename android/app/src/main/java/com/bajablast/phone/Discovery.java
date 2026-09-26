package com.bajablast.phone;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * Finding the kitchen on the Wi-Fi, so nobody has to type an IP address.
 *
 * The calendar answers GET /health on port 8787 without a sign-in, so the app
 * asks every address on the phone's own /24 (192.168.1.1 to .254) at once and
 * takes the first one that answers like Baja Blast. On a home network nearly
 * every address is empty and refuses or times out immediately, so the whole
 * sweep takes two or three seconds.
 *
 * Only the phone's own subnet, only port 8787, only /health — it's looking
 * for one thing, not surveying the network.
 *
 * Plain Java; the Activity supplies the phone's address and runs this off
 * the main thread.
 */
public final class Discovery {
    private static final int CONNECT_TIMEOUT_MS = 700;
    private static final int READ_TIMEOUT_MS = 1500;
    private static final int THREADS = 48;

    private Discovery() {}

    /** True if something at this base answers /health like Baja Blast. */
    public static boolean probe(String base) {
        return probe(base, CONNECT_TIMEOUT_MS * 4, READ_TIMEOUT_MS * 2);
    }

    static boolean probe(String base, int connectMs, int readMs) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(Address.healthUrl(base)).openConnection();
            c.setConnectTimeout(connectMs);
            c.setReadTimeout(readMs);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("Accept", "application/json");
            if (c.getResponseCode() != 200) return false;
            return Address.looksLikeBajaBlast(readSmall(c.getInputStream()));
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /**
     * Sweep "a.b.c.1" to ".254" and return the base address of the first
     * kitchen found, or null. `self` is skipped: the phone isn't the kitchen.
     */
    public static String scan(String prefix, String self) {
        return scan(prefix, self, Address.DEFAULT_PORT);
    }

    static String scan(String prefix, String self, int port) {
        if (prefix == null) return null;
        ExecutorService pool = Executors.newFixedThreadPool(THREADS);
        CompletionService<String> done = new ExecutorCompletionService<>(pool);
        List<Future<String>> futures = new ArrayList<>();
        try {
            for (int i = 1; i <= 254; i++) {
                final String ip = prefix + i;
                if (ip.equals(self)) continue;
                final String base = "http://" + ip + ":" + port;
                futures.add(done.submit(() -> probe(base, CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS) ? base : null));
            }
            for (int n = 0; n < futures.size(); n++) {
                Future<String> f = done.poll(15, TimeUnit.SECONDS);
                if (f == null) break; // something is hanging; give up rather than spin forever
                String found = f.get();
                if (found != null) return found;
            }
            return null;
        } catch (Exception e) {
            return null;
        } finally {
            for (Future<String> f : futures) f.cancel(true);
            pool.shutdownNow();
        }
    }

    private static String readSmall(InputStream in) throws java.io.IOException {
        try (InputStream is = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[1024];
            int n;
            // /health is a few dozen bytes; anything past 8KB isn't ours.
            while ((n = is.read(buf)) != -1 && out.size() < 8192) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
