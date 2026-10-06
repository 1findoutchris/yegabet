package com.vinnabet.app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The app's own native helpers for the web app (src/lib/native.ts). */
@CapacitorPlugin(name = "VinnaApp")
public class VinnaAppPlugin extends Plugin {

    /**
     * window.print() does nothing in Android WebView. This hands the page to
     * the system print dialog with its print stylesheet, so a ticket still
     * prints as the receipt alone.
     */
    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "VinnaBet");
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager manager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                PrintDocumentAdapter adapter = getBridge().getWebView().createPrintDocumentAdapter(name);
                manager.print(name, adapter, new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception e) {
                call.reject("Printing is not available", e);
            }
        });
    }

    /**
     * Whether the build has Firebase configured (android/app/google-services.json).
     * Registering for push without it crashes the app, so the web app asks first.
     */
    @PluginMethod
    public void pushAvailable(PluginCall call) {
        Context ctx = getContext();
        int id = ctx.getResources().getIdentifier("google_app_id", "string", ctx.getPackageName());
        JSObject ret = new JSObject();
        ret.put("available", id != 0);
        call.resolve(ret);
    }
}
