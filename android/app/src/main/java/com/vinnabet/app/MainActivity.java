package com.vinnabet.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** #0A1222, the site's theme colour. Shows behind the status and navigation bars. */
    private static final int NAVY = Color.rgb(10, 18, 34);

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VinnaAppPlugin.class);
        super.onCreate(savedInstanceState);

        // Same layout on every Android version: draw edge to edge with light
        // bar icons, then pad the WebView by the bars below.
        EdgeToEdge.enable(this, SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT));
        getWindow().getDecorView().setBackgroundColor(NAVY);

        WebView webView = getBridge().getWebView();

        // Game providers and the sportsbook run in iframes on their own
        // domains. Android WebView blocks their cookies unless allowed.
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        // Keep the web content clear of the status bar, navigation bar,
        // display cutout and keyboard. The site's header is fixed at top:0 and
        // the sportsbook pane is pinned under it, so the insets are applied
        // here rather than in CSS; the WebView then sees zero safe-area insets
        // (SystemBars.insetsHandling is "disable" in capacitor.config.ts).
        View container = (View) webView.getParent();
        ViewCompat.setOnApplyWindowInsetsListener(container, (v, insets) -> {
            int types = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
            Insets bars = insets.getInsets(types);
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(types, Insets.NONE)
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
                .build();
        });
    }
}
