package com.bajablast.phone;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.net.Inet4Address;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The phone page (/mobile on the kitchen's server), as an app.
 *
 * Everything the family does happens in the page, which is the same one a
 * browser gets — so there's one phone UI to maintain, and every improvement to
 * it reaches this app without a new APK. What the app adds is what a web page
 * can't do for itself:
 *
 *  - it's an icon on the home screen on a plain http:// address, which a
 *    browser refuses to install (README → The phone app explains why)
 *  - it finds the kitchen on the Wi-Fi, so nobody types an IP address
 *  - photos come from the system picker, several at once
 *  - links to anywhere else open in the browser, not inside the app
 *  - long-press shortcuts straight to the grocery list, an event, chores
 *
 * Three screens, all in this one Activity: the page itself, "find your
 * kitchen" (first run, or from the shortcut), and "can't reach the kitchen".
 * No libraries: the whole app is the framework and these three files.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "baja";
    private static final String KEY_BASE = "base";
    private static final int REQ_FILES = 1;

    private final ExecutorService background = Executors.newSingleThreadExecutor();

    private FrameLayout root;
    private WebView web;
    private View setupView;
    private View offlineView;
    private TextView offlineBody;
    private EditText addressField;
    private TextView setupStatus;
    private Button findButton;
    private Button connectButton;

    private String base;
    private String pendingSection;
    private boolean busy;
    private ValueCallback<Uri[]> fileCallback;

    // ---------------------------------------------------------------- lifecycle

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        base = prefs().getString(KEY_BASE, null);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        goEdgeToEdge();

        web = buildWebView();
        root.addView(web, match());
        setupView = buildSetupView();
        root.addView(setupView, match());
        offlineView = buildOfflineView();
        root.addView(offlineView, match());
        setContentView(root);

        boolean wantsSetup = readIntent(getIntent());
        if (base == null || wantsSetup) {
            showSetup(base == null);
        } else if (savedInstanceState != null && web.restoreState(savedInstanceState) != null) {
            show(web);
        } else {
            openPage();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (readIntent(intent)) {
            showSetup(false);
        } else if (pendingSection != null && base != null) {
            show(web);
            if (web.getUrl() == null) openPage();
            else goToSection();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // The sign-in cookie. Without a flush, killing the app from the
        // recents screen right after signing in can lose it.
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        background.shutdownNow();
        web.destroy();
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (setupView.getVisibility() == View.VISIBLE && base != null) {
            show(web);
            if (web.getUrl() == null) openPage();
        } else if (web.getVisibility() == View.VISIBLE && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /** Returns true if the intent asks for the address screen. */
    private boolean readIntent(Intent intent) {
        if (intent == null) return false;
        String section = intent.getStringExtra("section");
        if (section != null && section.matches("[a-z]+")) pendingSection = section;
        return "true".equals(intent.getStringExtra("setup"));
    }

    // ---------------------------------------------------------------- the page

    private WebView buildWebView() {
        WebView w = new WebView(this);
        w.setBackgroundColor(Color.BLACK);

        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);        // the page is an app; it needs it
        s.setDomStorageEnabled(true);        // its offline copy of the calendar
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);         // nothing on the phone's disk is its business
        s.setAllowContentAccess(true);       // photos from the picker
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        // So the page can tell it's in the app (it stops suggesting "Add to
        // Home Screen") and the server logs can tell phones apart.
        s.setUserAgentString(s.getUserAgentString() + " BajaBlastAndroid/" + versionName());

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, false);

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        w.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openOutside(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                goToSection();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // Only the page itself. A missing news thumbnail isn't "can't
                // reach the kitchen". And the page's own service worker
                // usually answers offline, so this is the case where it
                // couldn't: first run away from home, or a cleared cache.
                if (request.isForMainFrame()) showOffline();
            }
        });

        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return pickFiles(callback, params);
            }
        });
        return w;
    }

    private void openPage() {
        show(web);
        String url = Address.mobileUrl(base) + (pendingSection != null ? "#" + pendingSection : "");
        pendingSection = null;
        web.loadUrl(url);
    }

    /** A long-press shortcut arrived while the page was already open. */
    private void goToSection() {
        if (pendingSection == null) return;
        String section = pendingSection;
        pendingSection = null;
        // A hash change, not a reload: the page (app/mobile.html) switches tab
        // on hashchange and keeps whatever it has already loaded.
        web.evaluateJavascript("location.hash = '#" + section + "';", null);
    }

    /** Anything that isn't the kitchen's own server goes to the browser. */
    private boolean openOutside(Uri uri) {
        if (uri == null) return true;
        if (Address.sameOrigin(base, uri.toString())) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            // Nothing handles it (an odd scheme). Staying put beats crashing.
        }
        return true;
    }

    // ---------------------------------------------------------------- photos

    private boolean pickFiles(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        Intent intent = params.createIntent();
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        try {
            startActivityForResult(intent, REQ_FILES);
            return true;
        } catch (ActivityNotFoundException e) {
            fileCallback = null;
            Toast.makeText(this, R.string.upload_none, Toast.LENGTH_LONG).show();
            return false;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILES || fileCallback == null) return;
        Uri[] picked = null;
        if (resultCode == RESULT_OK && data != null) {
            // Several photos arrive as ClipData, one as getData(). The
            // framework's own parseResult() only understands the second,
            // which is why "Add photos" would otherwise upload one of ten.
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                picked = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) picked[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                picked = new Uri[] { data.getData() };
            }
        }
        // Always answered, even with null: an unanswered callback means the
        // page's file input never works again until the app restarts.
        fileCallback.onReceiveValue(picked);
        fileCallback = null;
    }

    // ---------------------------------------------------------------- finding the kitchen

    private View buildSetupView() {
        LinearLayout col = column();

        col.addView(text(getString(R.string.setup_title), 26, true, R.color.text));
        TextView body = text(getString(R.string.setup_body), 16, false, R.color.muted);
        body.setPadding(0, dp(10), 0, dp(24));
        col.addView(body);

        addressField = new EditText(this);
        addressField.setHint(R.string.setup_hint);
        addressField.setHintTextColor(getColor(R.color.muted));
        addressField.setTextColor(getColor(R.color.text));
        addressField.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        addressField.setSingleLine(true);
        addressField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        addressField.setImeOptions(EditorInfo.IME_ACTION_GO);
        addressField.setPadding(dp(16), dp(14), dp(16), dp(14));
        addressField.setBackground(rounded(R.color.field, 0));
        addressField.setOnEditorActionListener((v, actionId, event) -> {
            boolean enter = event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER && event.getAction() == KeyEvent.ACTION_DOWN;
            if (actionId == EditorInfo.IME_ACTION_GO || enter) {
                connect();
                return true;
            }
            return false;
        });
        col.addView(addressField, wide());

        connectButton = button(getString(R.string.setup_connect), true);
        connectButton.setOnClickListener(v -> connect());
        col.addView(connectButton, wide(dp(16)));

        findButton = button(getString(R.string.setup_find), false);
        findButton.setOnClickListener(v -> findOnWifi());
        col.addView(findButton, wide(dp(10)));

        setupStatus = text("", 15, false, R.color.muted);
        setupStatus.setPadding(0, dp(18), 0, 0);
        col.addView(setupStatus);

        return scroll(col);
    }

    private void showSetup(boolean firstRun) {
        show(setupView);
        addressField.setText(base == null ? "" : base.replaceFirst("^http://", ""));
        setupStatus.setText("");
        // First run: start looking straight away. Most of the time the
        // kitchen is found before anyone has read the screen.
        if (firstRun) findOnWifi();
    }

    private void connect() {
        if (busy) return;
        final String candidate = Address.normalize(addressField.getText().toString());
        if (candidate == null) {
            setupStatus.setText(getString(R.string.setup_unreachable, addressField.getText().toString().trim()));
            return;
        }
        setBusy(true, getString(R.string.setup_checking, candidate));
        background.execute(() -> {
            boolean ok = Discovery.probe(candidate);
            runOnUiThread(() -> {
                setBusy(false, ok ? "" : getString(R.string.setup_unreachable, candidate));
                if (ok) useAddress(candidate);
            });
        });
    }

    private void findOnWifi() {
        if (busy) return;
        final String self = wifiAddress();
        final String prefix = Address.subnetPrefix(self);
        if (prefix == null) {
            setupStatus.setText(R.string.setup_no_wifi);
            return;
        }
        setBusy(true, getString(R.string.setup_searching));
        background.execute(() -> {
            String found = Discovery.scan(prefix, self);
            runOnUiThread(() -> {
                setBusy(false, found == null ? getString(R.string.setup_found_none) : "");
                if (found != null) {
                    addressField.setText(found.replaceFirst("^http://", ""));
                    useAddress(found);
                }
            });
        });
    }

    private void useAddress(String newBase) {
        boolean changed = !newBase.equals(base);
        base = newBase;
        prefs().edit().putString(KEY_BASE, newBase).apply();
        if (changed) web.clearHistory();
        openPage();
    }

    private void setBusy(boolean on, String status) {
        busy = on;
        connectButton.setEnabled(!on);
        findButton.setEnabled(!on);
        connectButton.setAlpha(on ? 0.5f : 1f);
        findButton.setAlpha(on ? 0.5f : 1f);
        setupStatus.setText(status);
    }

    /** This phone's IPv4 address on Wi-Fi (or Ethernet), or null. */
    private String wifiAddress() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            Network net = cm.getActiveNetwork();
            if (net == null) return null;
            NetworkCapabilities caps = cm.getNetworkCapabilities(net);
            if (caps == null) return null;
            boolean local = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET);
            if (!local) return null;
            LinkProperties lp = cm.getLinkProperties(net);
            if (lp == null) return null;
            for (LinkAddress la : lp.getLinkAddresses()) {
                if (la.getAddress() instanceof Inet4Address && !la.getAddress().isLoopbackAddress()) {
                    return la.getAddress().getHostAddress();
                }
            }
        } catch (SecurityException e) {
            // ACCESS_NETWORK_STATE is in the manifest; this is belt and braces.
        }
        return null;
    }

    // ---------------------------------------------------------------- can't reach it

    private View buildOfflineView() {
        LinearLayout col = column();
        col.addView(text(getString(R.string.offline_title), 24, true, R.color.text));
        offlineBody = text("", 16, false, R.color.muted);
        offlineBody.setPadding(0, dp(10), 0, dp(24));
        col.addView(offlineBody);

        Button retry = button(getString(R.string.offline_retry), true);
        retry.setOnClickListener(v -> openPage());
        col.addView(retry, wide());

        Button change = button(getString(R.string.offline_change), false);
        change.setOnClickListener(v -> showSetup(false));
        col.addView(change, wide(dp(10)));
        return scroll(col);
    }

    private void showOffline() {
        offlineBody.setText(getString(R.string.offline_body, base));
        show(offlineView);
    }

    // ---------------------------------------------------------------- plumbing

    private void show(View which) {
        web.setVisibility(which == web ? View.VISIBLE : View.INVISIBLE);
        setupView.setVisibility(which == setupView ? View.VISIBLE : View.GONE);
        offlineView.setVisibility(which == offlineView ? View.VISIBLE : View.GONE);
    }

    /**
     * Draw under the status and navigation bars and pad by exactly their
     * size (and the keyboard's). Android 15 insists on edge-to-edge for apps
     * targeting it; doing it the same way on every version means the page's
     * top bar never hides under the clock on one phone and floats on another.
     */
    @SuppressWarnings("deprecation")
    private void goEdgeToEdge() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets i = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0";
        }
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private static FrameLayout.LayoutParams match() {
        return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    private static LinearLayout.LayoutParams wide() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private static LinearLayout.LayoutParams wide(int top) {
        LinearLayout.LayoutParams lp = wide();
        lp.topMargin = top;
        return lp;
    }

    private LinearLayout column() {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_VERTICAL);
        col.setPadding(dp(28), dp(48), dp(28), dp(48));
        return col;
    }

    private ScrollView scroll(View content) {
        ScrollView sv = new ScrollView(this);
        sv.setFillViewport(true);
        sv.setBackgroundColor(Color.BLACK);
        sv.addView(content, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return sv;
    }

    private TextView text(String s, int sp, boolean bold, int colorRes) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(getColor(colorRes));
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button button(String label, boolean primary) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        b.setMinHeight(dp(52));
        b.setTextColor(primary ? Color.BLACK : getColor(R.color.text));
        b.setBackground(rounded(primary ? R.color.accent : R.color.field, primary ? 0 : R.color.muted));
        b.setStateListAnimator(null);
        return b;
    }

    private GradientDrawable rounded(int fillRes, int strokeRes) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(getColor(fillRes));
        d.setCornerRadius(dp(14));
        if (strokeRes != 0) d.setStroke(dp(1), getColor(strokeRes));
        return d;
    }
}
