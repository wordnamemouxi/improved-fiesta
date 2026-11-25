package com.mouxi.mobile;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.*;
import java.io.*;
import java.util.Arrays;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ROOT = "https://" + HOST + "/app/";
    private static final String CHANNEL = "character_messages";
    private WebView web;
    private ValueCallback<Uri[]> picker;
    private PermissionRequest microphone;
    private int nextNotificationId = (int) (System.currentTimeMillis() & Integer.MAX_VALUE);
    private boolean pageReady;
    private String pendingChat = "";

    private boolean local(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && uri.getPort() == -1 && uri.getUserInfo() == null;
    }

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        BackgroundTest.owner = new java.lang.ref.WeakReference<>(this);
        getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel(CHANNEL, "角色新消息", NotificationManager.IMPORTANCE_HIGH));
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new NativeBridge(), "MouxiAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                if (!local(uri)) return null;
                String path = uri.getPath();
                if (path == null || !path.startsWith("/app/") || path.contains("..") || path.contains("\\")) {
                    return missing();
                }
                try {
                    String asset = path.substring(5);
                    if (asset.isEmpty()) asset = "index.html";
                    String type = URLConnectionMime.guess(asset);
                    return new WebResourceResponse(type, type.startsWith("text/") || type.contains("json")
                        ? "UTF-8" : null, getAssets().open("web/" + asset));
                } catch (IOException error) {
                    return missing();
                }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                if (local(uri)) return false;
                if (req.isForMainFrame() && req.hasGesture() && "https".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (ActivityNotFoundException ignored) {}
                }
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (local(Uri.parse(url))) {
                    pageReady = true;
                    deliverChat();
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    String audio = PermissionRequest.RESOURCE_AUDIO_CAPTURE;
                    if (!local(request.getOrigin()) || !Arrays.asList(request.getResources()).contains(audio)) {
                        request.deny();
                    } else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{audio});
                    } else {
                        if (microphone != null) microphone.deny();
                        microphone = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 2);
                    }
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (microphone == request) microphone = null;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> output, FileChooserParams params) {
                if (picker != null) picker.onReceiveValue(null);
                picker = output;
                try { startActivityForResult(params.createIntent(), 3); }
                catch (ActivityNotFoundException error) { picker.onReceiveValue(null); picker = null; }
                return true;
            }
        });
        setContentView(web);
        String chat = getIntent().getStringExtra("chatId");
        web.loadUrl(ROOT + "index.html" + (chat == null || chat.isEmpty() ? "" : "?openChat=" + Uri.encode(chat)));
    }

    private WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    @Override protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req == 3 && picker != null) {
            picker.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            picker = null;
        }
    }

    @Override public void onRequestPermissionsResult(int req, String[] p, int[] result) {
        super.onRequestPermissionsResult(req, p, result);
        if (req == 2 && microphone != null) {
            if (result.length > 0 && result[0] == PackageManager.PERMISSION_GRANTED) {
                microphone.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else microphone.deny();
            microphone = null;
        }
        if (req == 4) web.evaluateJavascript("window.finishMouxiNotificationPermission?.()", null);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String chat = intent.getStringExtra("chatId");
        if (chat != null) pendingChat = chat;
        deliverChat();
    }

    private void deliverChat() {
        if (!pageReady || pendingChat.isEmpty()) return;
        String script = "window.OsNotifyPlugin?.navigateToChatSafe(" + JSONObject.quote(pendingChat) + ", 'private')";
        pendingChat = "";
        web.evaluateJavascript(script, null);
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("(function(){if(typeof switchScreen==='function'&&!document.getElementById('home-screen')?.classList.contains('active')){switchScreen('home-screen');return true;}return false;})()",
            handled -> { if (!"true".equals(handled)) finish(); });
    }

    private String permission() {
        if (getSystemService(NotificationManager.class).areNotificationsEnabled()) return "granted";
        if (Build.VERSION.SDK_INT >= 33 && !getPreferences(MODE_PRIVATE).getBoolean("notificationAsked", false)) return "default";
        return "denied";
    }

    private final class NativeBridge {
        @JavascriptInterface public String permission() { return MainActivity.this.permission(); }
        @JavascriptInterface public void askPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && "default".equals(permission())) {
                    getPreferences(MODE_PRIVATE).edit().putBoolean("notificationAsked", true).apply();
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4);
                } else web.evaluateJavascript("window.finishMouxiNotificationPermission?.()", null);
            });
        }
        @JavascriptInterface public boolean startBackgroundTest(String chatId, String token) {
            if (!"granted".equals(permission()) || chatId == null || chatId.length() > 512
                    || token == null || !token.matches("[0-9]{1,20}")
                    || !BackgroundTest.active.compareAndSet(null, token)) return false;
            try {
                startForegroundService(new Intent(MainActivity.this, BackgroundTest.class)
                    .putExtra("chat", chatId).putExtra("token", token));
                return true;
            } catch (RuntimeException e) {
                BackgroundTest.active.compareAndSet(token, null);
                return false;
            }
        }

        @JavascriptInterface public void finishBackgroundTest(String token, String status) {
            if (token == null) return;
            runOnUiThread(() -> {
                BackgroundTest service = BackgroundTest.current;
                if (service != null && token.equals(service.token)) {
                    service.finish("ok".equals(status) ? "生成成功，请查看角色聊天"
                        : "failed".equals(status) ? "已触发，但接口没有生成有效回复" : null);
                } else if (token.equals(BackgroundTest.active.get())) BackgroundTest.active.set(null);
            });
        }

        @JavascriptInterface public void show(String title, String body, String chatId) {
            runOnUiThread(() -> {
                if (!"granted".equals(permission())) return;
                int id = ++nextNotificationId;
                Intent open = new Intent(MainActivity.this, MainActivity.class).putExtra("chatId", chatId);
                open.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent tap = PendingIntent.getActivity(MainActivity.this, id, open,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                Notification notice = new Notification.Builder(MainActivity.this, CHANNEL)
                    .setSmallIcon(android.R.drawable.ic_dialog_email).setContentTitle(title)
                    .setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body))
                    .setContentIntent(tap).setAutoCancel(true).build();
                getSystemService(NotificationManager.class).notify(id, notice);
            });
        }
    }

    private static final class URLConnectionMime {
        static String guess(String path) {
            if (path.endsWith(".js")) return "text/javascript";
            if (path.endsWith(".json")) return "application/json";
            String guessed = java.net.URLConnection.guessContentTypeFromName(path);
            return guessed == null ? "application/octet-stream" : guessed;
        }
    }

    public static final class BackgroundTest extends Service {
        private static final String CHANNEL = "background_test";
        private static final int RUNNING_ID = 28102;
        private static final int RESULT_ID = 28103;
        static final java.util.concurrent.atomic.AtomicReference<String> active =
            new java.util.concurrent.atomic.AtomicReference<>();
        static java.lang.ref.WeakReference<MainActivity> owner = new java.lang.ref.WeakReference<>(null);
        static BackgroundTest current;
        private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
        private android.os.PowerManager.WakeLock cpu;
        private String token;
        private String chat;
        private NotificationManager notifications;

        private Notification note(String message, boolean running) {
            Intent tap = new Intent(this, MainActivity.class).putExtra("chatId", chat)
                .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("某昔专线 · 后台生成测试")
                .setContentText(message).setStyle(new Notification.BigTextStyle().bigText(message))
                .setOnlyAlertOnce(true).setOngoing(running).setAutoCancel(!running)
                .setContentIntent(PendingIntent.getActivity(this, RESULT_ID, tap,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)).build();
        }

        @Override public int onStartCommand(Intent intent, int flags, int startId) {
            if (intent == null) { stopSelf(); return START_NOT_STICKY; }
            token = intent.getStringExtra("token");
            chat = intent.getStringExtra("chat");
            notifications = getSystemService(NotificationManager.class);
            notifications.createNotificationChannel(new NotificationChannel(CHANNEL,
                "后台生成测试", NotificationManager.IMPORTANCE_DEFAULT));
            Notification waiting = note("已预约，30 秒后发起一次生成", true);
            if (Build.VERSION.SDK_INT >= 34) startForeground(RUNNING_ID, waiting,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
            else startForeground(RUNNING_ID, waiting);
            current = this;
            if (token == null || !token.equals(active.get())) { finish(null); return START_NOT_STICKY; }
            cpu = getSystemService(android.os.PowerManager.class).newWakeLock(
                android.os.PowerManager.PARTIAL_WAKE_LOCK, "mouxi:test");
            cpu.acquire(125000);
            handler.postDelayed(() -> {
                MainActivity page = owner.get();
                if (page == null || page.isFinishing() || page.isDestroyed()) {
                    finish("App 页面已关闭，测试结束");
                    return;
                }
                notifications.notify(RUNNING_ID, note("已到点，正在等待模型生成结果", true));
                page.web.evaluateJavascript("window.runMouxiBackgroundTest?.("
                    + JSONObject.quote(chat) + "," + JSONObject.quote(token) + ")", null);
            }, 30000);
            handler.postDelayed(() -> {
                MainActivity page = owner.get();
                if (page != null && !page.isDestroyed()) page.web.evaluateJavascript(
                    "window.expireMouxiBackgroundTest?.(" + JSONObject.quote(chat) + "," + JSONObject.quote(token) + ")", null);
                finish("已到点，但未收到生成结果。页面可能暂停，或模型接口请求超时");
            }, 120000);
            return START_NOT_STICKY;
        }

        private void cleanUp() {
            handler.removeCallbacksAndMessages(null);
            if (cpu != null && cpu.isHeld()) cpu.release();
            if (token != null && token.equals(active.get())) active.set(null);
            if (current == this) current = null;
        }

        void finish(String message) {
            cleanUp();
            stopForeground(STOP_FOREGROUND_REMOVE);
            if (message != null) notifications.notify(RESULT_ID, note(message, false));
            stopSelf();
        }

        @Override public void onDestroy() { cleanUp(); super.onDestroy(); }
        @Override public android.os.IBinder onBind(Intent intent) { return null; }
    }
}
