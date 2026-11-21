package io.github.yraguo.firstmove;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.*;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;

public class MainActivity extends Activity {
    private static final String PREFS = "firstmove";
    private static final String KEY_SERVER = "server";
    private static final String CHANNEL = "reminders";
    private static final int REQ_FILE = 41;
    private static final int REQ_NOTIFY = 42;
    private static final int REQ_STORAGE = 43;

    private FrameLayout root;
    private WebView webView;
    private ValueCallback<Uri[]> pendingFiles;
    private View errorView;
    private String origin = "";
    private boolean askedNotifications;
    private boolean loadFailed;

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static FrameLayout.LayoutParams match() {
        return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(252, 249, 247));
        setContentView(root);
        applyEdgeToEdge();
        origin = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_SERVER, "");
        if (origin.isEmpty()) showConnectScreen("");
        else openWorkspace();
    }

    // Android 15 起 targetSdk 35 强制全屏，页面会顶到状态栏和导航栏下面。
    // 这里把系统栏高度换成内容内边距，并让状态栏图标使用深色。
    private void applyEdgeToEdge() {
        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        window.getDecorView().setSystemUiVisibility(flags);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int top;
            int bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                top = bars.top;
                bottom = Math.max(bars.bottom, ime.bottom);
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            view.setPadding(0, top, 0, bottom);
            return insets;
        });
    }

    // ---------- 工作台 ----------

    private void openWorkspace() {
        hideError();
        root.removeAllViews();
        if (webView == null) webView = buildWebView();
        root.addView(webView, match());
        webView.loadUrl(origin + "/");
    }

    private WebView buildWebView() {
        WebView view = new WebView(this);
        view.setBackgroundColor(Color.rgb(252, 249, 247));
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " FirstMoveApp/0.2.1");
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(view, false);
        view.addJavascriptInterface(new Bridge(), "FirstMove");
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView target, WebResourceRequest request) {
                return route(request.getUrl());
            }

            @Override public void onPageStarted(WebView target, String url, android.graphics.Bitmap icon) {
                loadFailed = false;
            }

            @Override public void onPageFinished(WebView target, String url) {
                if (loadFailed) return;
                if (!askedNotifications) {
                    askedNotifications = true;
                    requestNotificationPermission();
                }
            }

            @Override public void onReceivedError(WebView target, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    loadFailed = true;
                    showError("连不上工作台。检查网络后重试，或更换服务器地址。");
                }
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView target, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                try {
                    startActivityForResult(Intent.createChooser(params.createIntent(), "选择文件"), REQ_FILE);
                    return true;
                } catch (ActivityNotFoundException error) {
                    pendingFiles = null;
                    return false;
                }
            }
        });
        return view;
    }

    private boolean route(Uri target) {
        String scheme = target.getScheme();
        if (("http".equals(scheme) || "https".equals(scheme)) && sameOrigin(target)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, target));
        } catch (ActivityNotFoundException ignored) {
            // 没有能处理该链接的应用，留在工作台内
        }
        return true;
    }

    private boolean sameOrigin(Uri target) {
        if (origin.isEmpty() || target.getScheme() == null) return false;
        try {
            URI base = URI.create(origin);
            String scheme = target.getScheme().toLowerCase();
            String host = target.getHost() == null ? "" : target.getHost().toLowerCase();
            int port = target.getPort();
            int basePort = base.getPort();
            if (basePort < 0) basePort = "https".equals(base.getScheme()) ? 443 : 80;
            if (port < 0) port = "https".equals(scheme) ? 443 : 80;
            return scheme.equals(base.getScheme()) && host.equals(String.valueOf(base.getHost()).toLowerCase()) && port == basePort;
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    // ---------- 连接页与错误页 ----------

    private void showConnectScreen(String prefill) {
        hideError();
        root.removeAllViews();
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        layout.setPadding(dp(28), dp(40), dp(28), dp(40));
        ImageView logo = new ImageView(this);
        logo.setImageResource(getApplicationInfo().icon);
        layout.addView(logo, dp(60), dp(60));
        TextView title = new TextView(this);
        title.setText("连接先行");
        title.setTextSize(28);
        title.setPadding(0, dp(14), 0, dp(18));
        layout.addView(title);
        TextView label = new TextView(this);
        label.setText("工作台地址 · Server URL");
        layout.addView(label);
        EditText server = new EditText(this);
        server.setSingleLine();
        server.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        server.setHint("https://work.example.com");
        String saved = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_SERVER, "");
        server.setText(saved.isEmpty() ? prefill : saved);
        layout.addView(server);
        Button connect = new Button(this);
        connect.setText("连接 · Connect");
        connect.setTextColor(Color.WHITE);
        connect.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xff4b0f1f));
        layout.addView(connect);
        connect.setOnClickListener(clicked -> {
            String candidate;
            try {
                candidate = normalize(server.getText().toString().trim());
            } catch (IllegalArgumentException error) {
                server.setError("请输入以 https:// 开头的工作台地址");
                return;
            }
            origin = candidate;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_SERVER, origin).apply();
            openWorkspace();
        });
        root.addView(layout, match());
    }

    private String normalize(String value) {
        URI uri = URI.create(value);
        String path = uri.getRawPath();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null ||
                uri.getUserInfo() != null || uri.getRawQuery() != null || uri.getFragment() != null ||
                !(path == null || path.isEmpty() || path.equals("/"))) {
            throw new IllegalArgumentException();
        }
        return "https://" + uri.getRawAuthority();
    }

    private void showError(String message) {
        hideError();
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(dp(28), dp(28), dp(28), dp(28));
        box.setBackgroundColor(Color.rgb(252, 249, 247));
        TextView text = new TextView(this);
        text.setText(message);
        text.setTextColor(Color.rgb(45, 35, 37));
        text.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        text.setGravity(Gravity.CENTER);
        box.addView(text);
        Button retry = new Button(this);
        retry.setText("重试");
        retry.setOnClickListener(clicked -> {
            hideError();
            if (webView != null) webView.reload();
            else openWorkspace();
        });
        box.addView(retry);
        Button change = new Button(this);
        change.setText("更换服务器地址");
        change.setOnClickListener(clicked -> showConnectScreen(origin));
        box.addView(change);
        errorView = box;
        root.addView(box, match());
    }

    private void hideError() {
        if (errorView != null) {
            root.removeView(errorView);
            errorView = null;
        }
    }

    // ---------- 系统能力 ----------

    private final class Bridge {
        private OutputStream sink;
        private String sinkName = "download";

        @JavascriptInterface public synchronized boolean beginSave(String name) {
            cancelSave();
            sinkName = cleanName(name);
            try {
                sink = new FileOutputStream(new File(getCacheDir(), "share.tmp"));
                return true;
            } catch (Exception error) {
                sink = null;
                return false;
            }
        }

        @JavascriptInterface public synchronized boolean appendChunk(String data) {
            if (sink == null) return false;
            try {
                sink.write(Base64.decode(data, Base64.DEFAULT));
                return true;
            } catch (Exception error) {
                return false;
            }
        }

        @JavascriptInterface public synchronized void cancelSave() {
            if (sink != null) {
                try { sink.close(); } catch (Exception ignored) { }
                sink = null;
            }
        }

        @JavascriptInterface public synchronized String endSave() {
            if (sink == null) return "没有可保存的内容";
            try { sink.close(); } catch (Exception ignored) { }
            sink = null;
            File temp = new File(getCacheDir(), "share.tmp");
            String result = publish(temp, sinkName);
            temp.delete();
            return result;
        }

        @JavascriptInterface public void notify(String title, String body) {
            runOnUiThread(() -> postNotification(title, body));
        }

        @JavascriptInterface public void copy(String text) {
            if (text == null) return;
            runOnUiThread(() -> {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("先行", text));
            });
        }
    }

    private String cleanName(String name) {
        String value = name == null ? "" : name.trim();
        if (value.isEmpty()) return "download";
        value = value.replace('/', '_').replace('\\', '_').replace(':', '_');
        if (value.length() > 96) value = value.substring(value.length() - 96);
        return value;
    }

    private String publish(File source, String name) {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mimeOf(name));
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (target == null) return "无法写入下载目录";
            try (InputStream in = new FileInputStream(source)) {
                OutputStream out = getContentResolver().openOutputStream(target);
                if (out == null) throw new IllegalStateException("无法打开下载文件");
                try {
                    copy(in, out);
                } finally {
                    out.close();
                }
            } catch (Exception error) {
                getContentResolver().delete(target, null, null);
                return "写入失败：" + error.getMessage();
            }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContentResolver().update(target, values, null, null);
            return "已保存到「下载」：" + name;
        }
        if (checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            runOnUiThread(() -> requestPermissions(new String[]{android.Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE));
            return "请允许存储权限后再试";
        }
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File target = available(dir, name);
        try (InputStream in = new FileInputStream(source); OutputStream out = new FileOutputStream(target)) {
            copy(in, out);
        } catch (Exception error) {
            return "写入失败：" + error.getMessage();
        }
        return "已保存到「下载」：" + name;
    }

    private File available(File dir, String name) {
        dir.mkdirs();
        File target = new File(dir, name);
        String stem = name;
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            stem = name.substring(0, dot);
            ext = name.substring(dot);
        }
        for (int i = 2; target.exists() && i < 500; i++) target = new File(dir, stem + " (" + i + ")" + ext);
        return target;
    }

    private void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buffer = new byte[64 * 1024];
        int read;
        while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
        out.flush();
    }

    private String mimeOf(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
        if (lower.endsWith(".doc")) return "application/msword";
        if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
        if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
        if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".mp4")) return "video/mp4";
        return "application/octet-stream";
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
        }
    }

    private void postNotification(String title, String body) {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestNotificationPermission();
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "提醒", NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        builder.setSmallIcon(getApplicationInfo().icon)
                .setContentTitle(title == null || title.isEmpty() ? "先行提醒" : title)
                .setContentText(body == null ? "" : body)
                .setAutoCancel(true)
                .setContentIntent(pending);
        manager.notify((int) (System.currentTimeMillis() & 0x7fffffff), builder.build());
    }

    // ---------- 生命周期 ----------

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (pendingFiles != null) {
                pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                pendingFiles = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override public void onBackPressed() {
        if (errorView != null) {
            hideError();
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        moveTaskToBack(true);
    }

    @Override protected void onDestroy() {
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
