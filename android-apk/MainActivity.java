package com.mouxi.mobile;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.media.MediaRecorder;
import android.util.Base64;
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
    private static final int VOICE_PERMISSION = 5;
    private static final int MAX_VOICE_BYTES = 2 * 1024 * 1024;
    private PermissionRequest microphone;
    private MediaRecorder voiceRecorder;
    private File voiceFile;
    private boolean requestingVoicePermission;
    private int nextNotificationId = (int) (System.currentTimeMillis() & Integer.MAX_VALUE);
    private boolean pageReady;
    private volatile boolean foreground;
    private String pendingChat = "";

    private static boolean local(Uri uri) {
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
                return readLocalAsset(MainActivity.this, req.getUrl());
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
        if (!BackgroundTest.workerRequired) loadVisiblePage();
    }

    private void loadVisiblePage() {
        if (isFinishing() || isDestroyed()) return;
        String chat = pendingChat.isEmpty() ? getIntent().getStringExtra("chatId") : pendingChat;
        pendingChat = "";
        web.loadUrl(ROOT + "index.html" + (chat == null || chat.isEmpty() ? "" : "?openChat=" + Uri.encode(chat)));
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        if (pageReady) web.evaluateJavascript("window.syncMouxiCharacterAlarms?.()", null);
    }

    @Override protected void onPause() {
        foreground = false;
        finishVoiceCapture(false);
        super.onPause();
    }

    private static WebResourceResponse readLocalAsset(Context context, Uri uri) {
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
                ? "UTF-8" : null, context.getAssets().open("web/" + asset));
        } catch (IOException error) {
            return missing();
        }
    }

    private static WebResourceResponse missing() {
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
        if (req == VOICE_PERMISSION) {
            requestingVoicePermission = false;
            boolean granted = result.length > 0 && result[0] == PackageManager.PERMISSION_GRANTED;
            web.evaluateJavascript("window.VoiceInputPlugin?.finishAndroidPermission(" + granted + ")", null);
        }
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

    private synchronized String startVoiceCapture() {
        if (!foreground) return "background";
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            runOnUiThread(() -> {
                if (!foreground || requestingVoicePermission) return;
                requestingVoicePermission = true;
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, VOICE_PERMISSION);
            });
            return "permission";
        }
        if (voiceRecorder != null) return "busy";
        try {
            voiceFile = File.createTempFile("voice-", ".m4a", getCacheDir());
            voiceRecorder = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
            voiceRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            voiceRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            voiceRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            voiceRecorder.setAudioChannels(1);
            voiceRecorder.setAudioEncodingBitRate(64000);
            voiceRecorder.setMaxDuration(125000);
            voiceRecorder.setOutputFile(voiceFile.getAbsolutePath());
            voiceRecorder.prepare();
            voiceRecorder.start();
            return "recording";
        } catch (IOException | RuntimeException error) {
            android.util.Log.w("Mouxi", "Could not start native voice recording", error);
            finishVoiceCapture(false);
            return "failed";
        }
    }

    private synchronized String finishVoiceCapture(boolean keepAudio) {
        MediaRecorder recorder = voiceRecorder;
        File file = voiceFile;
        voiceRecorder = null;
        voiceFile = null;
        try {
            if (recorder == null) return "";
            try {
                if (keepAudio) recorder.stop();
            } finally {
                recorder.release();
            }
            if (!keepAudio || file == null) return "";
            long length = file.length();
            if (length <= 0 || length > MAX_VOICE_BYTES) return "";
            byte[] audio = new byte[(int) length];
            try (DataInputStream input = new DataInputStream(new FileInputStream(file))) {
                input.readFully(audio);
            }
            return Base64.encodeToString(audio, Base64.NO_WRAP);
        } catch (IOException | RuntimeException error) {
            android.util.Log.w("Mouxi", "Could not finish native voice recording", error);
            return "";
        } finally {
            if (file != null) file.delete();
        }
    }

    private final class NativeBridge {
        @JavascriptInterface public String startVoiceRecording() { return startVoiceCapture(); }
        @JavascriptInterface public String finishVoiceRecording(boolean save) {
            return finishVoiceCapture(save && foreground);
        }

        @JavascriptInterface public boolean isAppInForeground() { return foreground; }

        @JavascriptInterface public boolean beginManualGeneration(String token) {
            return foreground && ManualGeneration.begin(MainActivity.this, token);
        }

        @JavascriptInterface public void endManualGeneration(String token) {
            ManualGeneration.complete(token);
        }

        @JavascriptInterface public String permission() { return MainActivity.this.permission(); }
        @JavascriptInterface public void askPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && "default".equals(permission())) {
                    getPreferences(MODE_PRIVATE).edit().putBoolean("notificationAsked", true).apply();
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4);
                } else web.evaluateJavascript("window.finishMouxiNotificationPermission?.()", null);
            });
        }
        @JavascriptInterface public boolean scheduleCharacterAlarm(String chatId, String timestamp) {
            return CharacterAlarm.scheduleFromPage(MainActivity.this, chatId, timestamp);
        }

        @JavascriptInterface public void cancelCharacterAlarm(String chatId) {
            CharacterAlarm.cancel(MainActivity.this, chatId);
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


    public static final class CharacterAlarm extends BroadcastReceiver {
        static PendingIntent intent(Context context, String chat, String token, int mode) {
            Intent alarm = new Intent(context, CharacterAlarm.class)
                .setData(new Uri.Builder().scheme("mouxi").authority("character-alarm").appendPath(chat).build())
                .putExtra("chat", chat).putExtra("token", token);
            return PendingIntent.getBroadcast(context, 0, alarm, mode | PendingIntent.FLAG_IMMUTABLE);
        }

        static void schedule(Context context, String chat, String token, long at) {
            context.getSystemService(AlarmManager.class).setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP, at, intent(context, chat, token, PendingIntent.FLAG_UPDATE_CURRENT));
        }

        static boolean scheduleFromPage(Context context, String chat, String token) {
            if (chat == null || chat.isEmpty() || chat.length() > 512) return false;
            try {
                long due = Long.parseLong(token);
                long now = System.currentTimeMillis();
                if (due <= 0 || due > now + 172800000L + 60000) return false;
                schedule(context, chat, token, Math.max(due, now + 1000));
                return true;
            } catch (RuntimeException error) {
                return false;
            }
        }

        static void cancel(Context context, String chat) {
            if (chat == null || chat.isEmpty() || chat.length() > 512) return;
            PendingIntent alarm = intent(context, chat, "", PendingIntent.FLAG_NO_CREATE);
            if (alarm != null) {
                context.getSystemService(AlarmManager.class).cancel(alarm);
                alarm.cancel();
            }
        }

        @Override public void onReceive(Context context, Intent message) {
            MainActivity page = BackgroundTest.owner.get();
            String chat = message.getStringExtra("chat");
            String token = message.getStringExtra("token");
            if (chat == null || token == null) return;
            if (!BackgroundTest.active.compareAndSet(null, token)) {
                long now = System.currentTimeMillis();
                try {
                    if (now - Long.parseLong(token) < 180000L) schedule(context, chat, token, now + 45000L);
                } catch (RuntimeException ignored) {}
                return;
            }
            BackgroundTest.workerRequired = page == null || page.isDestroyed() || page.isFinishing();
            try {
                context.startForegroundService(new Intent(context, BackgroundTest.class)
                    .putExtra("chat", chat).putExtra("token", token).putExtra("scheduled", true));
            } catch (RuntimeException error) {
                BackgroundTest.workerRequired = false;
                BackgroundTest.active.compareAndSet(token, null);
                android.util.Log.w("Mouxi", "Android blocked scheduled generation", error);
            }
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
        static boolean workerRequired;
        private WebView worker;
        private int noticeSequence;
        private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
        private android.os.PowerManager.WakeLock cpu;
        private String token;
        private String chat;
        private boolean scheduled;
        private NotificationManager notifications;

        private Notification note(String message, boolean running) {
            Intent tap = new Intent(this, MainActivity.class).putExtra("chatId", chat)
                .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(scheduled ? "某昔专线 · 主动消息" : "某昔专线 · 后台生成测试")
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
            scheduled = intent.getBooleanExtra("scheduled", false);
            Notification waiting = note(scheduled ? "正在生成角色约好的消息" : "已预约，30 秒后发起一次生成", true);
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
                if (scheduled && (workerRequired || page == null || page.isFinishing() || page.isDestroyed())) {
                    workerRequired = true;
                    openWorker();
                    return;
                }
                if (page == null || page.isFinishing() || page.isDestroyed()) {
                    finish("App 页面已关闭，测试结束");
                    return;
                }
                notifications.notify(RUNNING_ID, note("已到点，正在等待模型生成结果", true));
                String callback = scheduled ? "window.runMouxiScheduledReply" : "window.runMouxiBackgroundTest";
                page.web.evaluateJavascript(callback + "?.("
                    + JSONObject.quote(chat) + "," + JSONObject.quote(token) + ")", null);
            }, scheduled ? 0 : 30000);
            handler.postDelayed(() -> {
                MainActivity page = owner.get();
                if (!scheduled && page != null && !page.isDestroyed()) page.web.evaluateJavascript(
                    "window.expireMouxiBackgroundTest?.(" + JSONObject.quote(chat) + "," + JSONObject.quote(token) + ")", null);
                finish(scheduled ? null : "已到点，但未收到生成结果。页面可能暂停，或模型接口请求超时");
            }, 120000);
            return START_NOT_STICKY;
        }

        public final class WorkerBridge {
            @JavascriptInterface public boolean isAlarmWorker() { return true; }
            @JavascriptInterface public boolean isAppInForeground() { return false; }
            @JavascriptInterface public String getAlarmChat() { return chat; }
            @JavascriptInterface public String getAlarmToken() { return token; }
            @JavascriptInterface public boolean scheduleCharacterAlarm(String chatId, String timestamp) {
                return chatId != null && chatId.equals(chat)
                    && CharacterAlarm.scheduleFromPage(BackgroundTest.this, chatId, timestamp);
            }
            @JavascriptInterface public void cancelCharacterAlarm(String chatId) {
                if (chatId != null && chatId.equals(chat)) CharacterAlarm.cancel(BackgroundTest.this, chatId);
            }
            @JavascriptInterface public String permission() {
                return notifications.areNotificationsEnabled() ? "granted" : "denied";
            }
            @JavascriptInterface public void show(String title, String body, String chatId) {
                handler.post(() -> {
                    if (current != BackgroundTest.this || !chat.equals(chatId)
                            || !notifications.areNotificationsEnabled()) return;
                    int notificationId = (int) ((System.currentTimeMillis() + ++noticeSequence) & Integer.MAX_VALUE);
                    Intent open = new Intent(BackgroundTest.this, MainActivity.class).putExtra("chatId", chat);
                    PendingIntent tap = PendingIntent.getActivity(BackgroundTest.this, notificationId, open,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                    notifications.notify(notificationId, new Notification.Builder(BackgroundTest.this, MainActivity.CHANNEL)
                        .setContentTitle(title).setContentText(body).setSmallIcon(android.R.drawable.ic_dialog_email)
                        .setStyle(new Notification.BigTextStyle().bigText(body))
                        .setContentIntent(tap).setAutoCancel(true).build());
                });
            }
            @JavascriptInterface public void finishBackgroundTest(String id, String status) {
                if (token != null && token.equals(id)) handler.post(() -> {
                    if (current == BackgroundTest.this) finish(null);
                });
            }
        }

        private void openWorker() {
            notifications.createNotificationChannel(new NotificationChannel(MainActivity.CHANNEL,
                "角色新消息", NotificationManager.IMPORTANCE_HIGH));
            worker = new WebView(this);
            worker.getSettings().setJavaScriptEnabled(true);
            worker.getSettings().setDomStorageEnabled(true);
            worker.getSettings().setAllowFileAccess(false);
            worker.getSettings().setAllowContentAccess(false);
            worker.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            worker.addJavascriptInterface(new WorkerBridge(), "MouxiAndroid");
            worker.setWebViewClient(new WebViewClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                    if (!local(req.getUrl()) && req.isForMainFrame()) return missing();
                    WebResourceResponse response = readLocalAsset(BackgroundTest.this, req.getUrl());
                    if (req.isForMainFrame() && response != null) response.setResponseHeaders(
                        java.util.Collections.singletonMap("Content-Security-Policy", "frame-src 'none'; object-src 'none'"));
                    return response;
                }
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                    return true;
                }
            });
            worker.loadUrl(ROOT + "index.html");
        }

        private void cleanUp() {
            handler.removeCallbacksAndMessages(null);
            if (cpu != null && cpu.isHeld()) cpu.release();
            if (token != null && token.equals(active.get())) active.set(null);
            if (worker != null) {
                worker.destroy();
                worker = null;
            }
            if (current == this) {
                current = null;
                if (workerRequired) {
                    workerRequired = false;
                    MainActivity page = owner.get();
                    if (page != null && !page.pageReady) page.loadVisiblePage();
                }
            }
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

    public static final class ManualGeneration extends Service {
        private static final String CHANNEL = "manual_generation";
        private static final int NOTICE = 28110;
        private static final long TIME_LIMIT = 150000;
        private static final java.util.Set<String> jobs = new java.util.HashSet<>();
        private static final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
        private static ManualGeneration active;
        private android.os.PowerManager.WakeLock cpu;
        private final Runnable timeout = () -> {
            synchronized (jobs) {
                jobs.clear();
                stopRunning();
            }
        };

        static boolean begin(Context context, String token) {
            if (token == null || token.length() > 80) return false;
            synchronized (jobs) {
                if (!jobs.add(token)) return false;
                if (jobs.size() > 1) return true;
                try {
                    context.startForegroundService(new Intent(context, ManualGeneration.class));
                    return true;
                } catch (RuntimeException error) {
                    jobs.remove(token);
                    return false;
                }
            }
        }

        static void complete(String token) {
            main.post(() -> {
                synchronized (jobs) {
                    if (jobs.remove(token) && jobs.isEmpty() && active != null) {
                        active.stopRunning();
                    }
                }
            });
        }

        @Override public int onStartCommand(Intent intent, int flags, int startId) {
            synchronized (jobs) {
                NotificationManager manager = getSystemService(NotificationManager.class);
                manager.createNotificationChannel(new NotificationChannel(CHANNEL, "正在生成回复",
                    NotificationManager.IMPORTANCE_LOW));
                Intent open = new Intent(this, MainActivity.class)
                    .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                Notification notice = new Notification.Builder(this, CHANNEL)
                    .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("某昔专线")
                    .setContentText("正在生成你刚请求的回复").setOngoing(true).setOnlyAlertOnce(true)
                    .setContentIntent(PendingIntent.getActivity(this, NOTICE, open,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)).build();
                if (Build.VERSION.SDK_INT >= 34) startForeground(NOTICE, notice,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
                else startForeground(NOTICE, notice);
                active = this;
                if (jobs.isEmpty()) { stopRunning(); return START_NOT_STICKY; }
                if (cpu == null) {
                    cpu = getSystemService(android.os.PowerManager.class).newWakeLock(
                        android.os.PowerManager.PARTIAL_WAKE_LOCK, "mouxi:manual-generation");
                    cpu.setReferenceCounted(false);
                }
                cpu.acquire(TIME_LIMIT + 5000);
                main.removeCallbacks(timeout);
                main.postDelayed(timeout, TIME_LIMIT);
                return START_NOT_STICKY;
            }
        }

        private void release() {
            main.removeCallbacks(timeout);
            if (cpu != null && cpu.isHeld()) cpu.release();
            if (active == this) active = null;
        }

        private void stopRunning() {
            release();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }

        @Override public void onDestroy() {
            synchronized (jobs) {
                if (active == this) jobs.clear();
                release();
            }
            super.onDestroy();
        }

        @Override public android.os.IBinder onBind(Intent intent) { return null; }
    }
}
