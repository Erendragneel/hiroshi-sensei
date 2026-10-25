package io.github.erendragneel.hiroshi;

import static org.junit.Assert.*;

import android.view.View;
import android.view.ViewGroup;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.widget.Button;
import android.widget.TextView;
import android.webkit.WebSettings;
import android.webkit.WebView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

/** Launch the actual Activity against Android 16 framework code, without signing in. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 36)
@LooperMode(LooperMode.Mode.PAUSED)
public final class MainActivityStartupTest {
    private ActivityController<MainActivity> controller;
    private boolean launched;

    @After public void closeActivity() {
        if (launched) controller.pause().stop().destroy();
    }

    @Test public void android16LaunchesTheBundledGameWithNativeConnectionAndRestrictedWebView() throws Exception {
        controller = Robolectric.buildActivity(MainActivity.class);
        MainActivity activity = controller.setup().get();
        launched = true;

        WebView web = findWebView(activity.getWindow().getDecorView());
        assertNotNull("The game screen must be attached before configuring system bars", web);
        assertEquals("https://appassets.androidplatform.net/index.html", Shadows.shadowOf(web).getLastLoadedUrl());
        assertNotNull("The sign-in UI must have its native-only connection bridge", Shadows.shadowOf(web).getJavascriptInterface("HiroshiAndroid"));
        assertTrue(readAsset(activity, "index.html").contains("id=\"native-connect\""));
        assertTrue(readAsset(activity, "index.html").contains("Continue with ChatGPT"));
        assertTrue(web.getSettings().getJavaScriptEnabled());
        assertTrue(web.getSettings().getDomStorageEnabled());
        assertFalse(web.getSettings().getAllowFileAccess());
        assertFalse(web.getSettings().getAllowContentAccess());
        assertEquals(WebSettings.MIXED_CONTENT_NEVER_ALLOW, web.getSettings().getMixedContentMode());
        assertFalse(web.getSettings().getJavaScriptCanOpenWindowsAutomatically());
    }

    @Test public void android16ActivityRecreationKeepsTheNativeGameShell() {
        controller = Robolectric.buildActivity(MainActivity.class);
        controller.setup();
        launched = true;
        controller.recreate();
        WebView web = findWebView(controller.get().getWindow().getDecorView());
        assertNotNull(web);
        assertEquals("https://appassets.androidplatform.net/index.html", Shadows.shadowOf(web).getLastLoadedUrl());
        assertNotNull(Shadows.shadowOf(web).getJavascriptInterface("HiroshiAndroid"));
    }

    @Test public void startupFailureProvidesLocalSanitizedDiagnosticsWithoutResettingSavedData() {
        controller = Robolectric.buildActivity(MainActivity.class);
        MainActivity activity = controller.setup().get();
        launched = true;
        SharedPreferences saved = activity.getSharedPreferences("hiroshi_startup_test", Context.MODE_PRIVATE);
        assertTrue(saved.edit().putString("progress", "keep this saved value").commit());

        activity.showStartupFailure(new IllegalStateException("private-conversation-must-not-appear"));

        View decor = activity.getWindow().getDecorView();
        assertNull("Fallback must not retain a broken privileged WebView", findWebView(decor));
        TextView heading = findText(decor, "Hiroshi could not open");
        assertNotNull(heading);
        TextView copy = findText(decor, "Copy error details");
        assertTrue(copy instanceof Button);
        assertTrue(copy.performClick());
        ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
        assertNotNull(clipboard.getPrimaryClip());
        String report = clipboard.getPrimaryClip().getItemAt(0).coerceToText(activity).toString();
        assertTrue(report.contains("Android API 36"));
        assertTrue(report.contains("IllegalStateException"));
        assertFalse(report.contains("private-conversation-must-not-appear"));
        assertEquals("keep this saved value", saved.getString("progress", null));
    }

    private static TextView findText(View view, String text) {
        if (view instanceof TextView && text.contentEquals(((TextView) view).getText())) return (TextView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                TextView found = findText(group.getChildAt(i), text);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static String readAsset(MainActivity activity, String name) throws Exception {
        try (InputStream input = activity.getAssets().open(name); ByteArrayOutputStream data = new ByteArrayOutputStream()) {
            byte[] bytes = new byte[8192]; int count;
            while ((count = input.read(bytes)) != -1) data.write(bytes, 0, count);
            return new String(data.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView found = findWebView(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }
}
