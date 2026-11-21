/**
 * Voice Input Plugin (plugins/voice-input.js)
 * 功能：仿微信/QQ 真实长按语音输入（按住说话、松开发送、上滑取消）
 * 1. 支持两种模式：
 *    - 浏览器内置语音识别（免额外 API、零费用，支持实时字幕预览）
 *    - Whisper / 兼容 /v1/audio/transcriptions 接口（真实录音上传，准确率最高、支持方言与中英混说）
 * 2. 长按聊天室底部麦克风（含仿QQ底栏话筒图标）弹出真实语音录制浮层：
 *    - 按住说话：动态声波 + 实时计时
 *    - 上滑取消：切为红色取消状态，松手不发送
 *    - 松开发送：自动转文字并以原生语音条形式发出，同时本地缓存原声可回听
 * 3. 在「API 设置」页提供语音识别模式与 Whisper API 配置（全宽竖排适配手机端）。
 */
(() => {
    if (window.__uwuVoiceInputLoaded) return;
    window.__uwuVoiceInputLoaded = true;

    const CFG_KEY = 'uwu_voice_input_config';
    let isRecording = false;
    let recognition = null;
    let mediaRecorder = null;
    let mediaStream = null;
    let audioChunks = [];

    // 长按交互状态
    let holdActive = false;
    let holdCancelled = false;
    let holdStartY = 0;
    let holdStartTime = 0;
    let holdTimerId = null;
    let cancelPendingRecording = false;
    let browserTranscriptFinal = '';
    let browserTranscriptInterim = '';
    let usingTouch = false;

    function loadConfig() {
        try {
            const raw = localStorage.getItem(CFG_KEY);
            return raw ? JSON.parse(raw) : { mode: 'browser', lang: 'zh-CN', autoSend: false };
        } catch (e) {
            return { mode: 'browser', lang: 'zh-CN', autoSend: false };
        }
    }

    function saveConfig(patch) {
        const next = { ...loadConfig(), ...patch };
        try { localStorage.setItem(CFG_KEY, JSON.stringify(next)); } catch (e) {}
        return next;
    }

    function updateMicBtnState(active, busy = false) {
        const btn = document.getElementById('uwu-mic-input-btn');
        if (!btn) return;
        btn.classList.toggle('uwu-mic-recording', Boolean(active));
        btn.classList.toggle('recording', Boolean(active));
        btn.classList.toggle('uwu-mic-busy', Boolean(busy));
        btn.title = active ? '松开发送，上滑取消' : (busy ? '正在识别语音…' : '按住说话');
    }

    // 仿微信/QQ 长按录音全屏浮层
    function ensureHoldOverlay() {
        let ov = document.getElementById('uwu-voice-hold-overlay');
        if (ov) return ov;
        if (!document.getElementById('uwu-voice-hold-style')) {
            const st = document.createElement('style');
            st.id = 'uwu-voice-hold-style';
            st.textContent = `
                #uwu-mic-input-btn {
                    touch-action: none;
                    user-select: none;
                    -webkit-user-select: none;
                    -webkit-touch-callout: none;
                }
                #uwu-voice-hold-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 99999;
                    display: none;
                    flex-direction: column;
                    justify-content: flex-end;
                    align-items: center;
                    background: rgba(0, 0, 0, 0.48);
                    backdrop-filter: blur(4px);
                    -webkit-backdrop-filter: blur(4px);
                    user-select: none;
                    -webkit-user-select: none;
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity 0.16s ease;
                }
                #uwu-voice-hold-overlay.visible {
                    display: flex;
                    opacity: 1;
                }
                .uwu-vh-card {
                    width: min(260px, 76vw);
                    margin-bottom: 42px;
                    padding: 20px 18px 16px;
                    border-radius: 20px;
                    background: #95ec69;
                    color: #1a2e12;
                    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 10px;
                    transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease;
                }
                #uwu-voice-hold-overlay.cancel-mode .uwu-vh-card {
                    background: #fa5151;
                    color: #ffffff;
                    transform: scale(0.96);
                }
                .uwu-vh-waves {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 5px;
                    height: 36px;
                }
                .uwu-vh-bar {
                    width: 4px;
                    height: 10px;
                    border-radius: 4px;
                    background: currentColor;
                    opacity: 0.85;
                    animation: uwuVhPulse 0.75s ease-in-out infinite;
                }
                .uwu-vh-bar:nth-child(2) { animation-delay: 0.1s; }
                .uwu-vh-bar:nth-child(3) { animation-delay: 0.2s; }
                .uwu-vh-bar:nth-child(4) { animation-delay: 0.3s; }
                .uwu-vh-bar:nth-child(5) { animation-delay: 0.15s; }
                .uwu-vh-bar:nth-child(6) { animation-delay: 0.25s; }
                .uwu-vh-bar:nth-child(7) { animation-delay: 0.05s; }
                .uwu-vh-bar:nth-child(8) { animation-delay: 0.35s; }
                .uwu-vh-bar:nth-child(9) { animation-delay: 0.12s; }
                @keyframes uwuVhPulse {
                    0%, 100% { height: 8px; opacity: 0.55; }
                    50% { height: 30px; opacity: 1; }
                }
                #uwu-voice-hold-overlay.cancel-mode .uwu-vh-bar {
                    animation-play-state: paused;
                    height: 8px;
                }
                .uwu-vh-timer {
                    font-size: 15px;
                    font-weight: 600;
                    font-variant-numeric: tabular-nums;
                    letter-spacing: 0.5px;
                }
                .uwu-vh-preview {
                    font-size: 13px;
                    line-height: 1.4;
                    max-height: 54px;
                    overflow: hidden;
                    text-align: center;
                    opacity: 0.9;
                    word-break: break-all;
                }
                .uwu-vh-cancel-zone {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 22px;
                }
                .uwu-vh-cancel-circle {
                    width: 56px;
                    height: 56px;
                    border-radius: 50%;
                    background: rgba(255, 255, 255, 0.22);
                    color: rgba(255, 255, 255, 0.85);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 22px;
                    font-weight: 600;
                    transition: transform 0.16s ease, background 0.16s ease, color 0.16s ease;
                }
                #uwu-voice-hold-overlay.cancel-mode .uwu-vh-cancel-circle {
                    background: #ffffff;
                    color: #fa5151;
                    transform: scale(1.18);
                }
                .uwu-vh-hint {
                    font-size: 13px;
                    color: rgba(255, 255, 255, 0.92);
                    letter-spacing: 0.3px;
                }
                .uwu-vh-arc {
                    width: 120%;
                    height: 112px;
                    border-radius: 50% 50% 0 0 / 48px 48px 0 0;
                    background: linear-gradient(180deg, rgba(245, 245, 245, 0.96) 0%, rgba(232, 232, 232, 0.98) 100%);
                    color: #333;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.2);
                    transition: background 0.16s ease, color 0.16s ease;
                }
                #uwu-voice-hold-overlay.cancel-mode .uwu-vh-arc {
                    background: rgba(56, 56, 56, 0.92);
                    color: rgba(255, 255, 255, 0.65);
                }
                .uwu-vh-arc-label {
                    font-size: 14px;
                    font-weight: 600;
                }
            `;
            document.head.appendChild(st);
        }
        ov = document.createElement('div');
        ov.id = 'uwu-voice-hold-overlay';
        ov.innerHTML = `
            <div class="uwu-vh-card">
                <div class="uwu-vh-waves">
                    <span class="uwu-vh-bar"></span><span class="uwu-vh-bar"></span><span class="uwu-vh-bar"></span>
                    <span class="uwu-vh-bar"></span><span class="uwu-vh-bar"></span><span class="uwu-vh-bar"></span>
                    <span class="uwu-vh-bar"></span><span class="uwu-vh-bar"></span><span class="uwu-vh-bar"></span>
                </div>
                <div class="uwu-vh-timer" id="uwu-vh-timer">00:00</div>
                <div class="uwu-vh-preview" id="uwu-vh-preview"></div>
            </div>
            <div class="uwu-vh-cancel-zone">
                <div class="uwu-vh-cancel-circle">✕</div>
                <div class="uwu-vh-hint" id="uwu-vh-hint">上滑取消</div>
            </div>
            <div class="uwu-vh-arc">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                <span class="uwu-vh-arc-label" id="uwu-vh-arc-label">松开 发送</span>
            </div>
        `;
        document.body.appendChild(ov);
        return ov;
    }

    function showHoldOverlay() {
        const ov = ensureHoldOverlay();
        ov.classList.remove('cancel-mode');
        ov.classList.add('visible');
        const timerEl = document.getElementById('uwu-vh-timer');
        const previewEl = document.getElementById('uwu-vh-preview');
        const hintEl = document.getElementById('uwu-vh-hint');
        const arcLabelEl = document.getElementById('uwu-vh-arc-label');
        if (timerEl) timerEl.textContent = '00:00';
        if (previewEl) previewEl.textContent = '';
        if (hintEl) hintEl.textContent = '上滑取消';
        if (arcLabelEl) arcLabelEl.textContent = '松开 发送';
        if (holdTimerId) clearInterval(holdTimerId);
        holdTimerId = setInterval(() => {
            const sec = Math.max(0, Math.floor((Date.now() - holdStartTime) / 1000));
            const mm = String(Math.floor(sec / 60)).padStart(2, '0');
            const ss = String(sec % 60).padStart(2, '0');
            const t = document.getElementById('uwu-vh-timer');
            if (t) t.textContent = `${mm}:${ss}`;
        }, 250);
    }

    function setHoldOverlayCancelState(isCancel) {
        const ov = document.getElementById('uwu-voice-hold-overlay');
        if (!ov) return;
        ov.classList.toggle('cancel-mode', Boolean(isCancel));
        const hintEl = document.getElementById('uwu-vh-hint');
        const arcLabelEl = document.getElementById('uwu-vh-arc-label');
        if (hintEl) hintEl.textContent = isCancel ? '松开手指，取消发送' : '上滑取消';
        if (arcLabelEl) arcLabelEl.textContent = isCancel ? '取消发送' : '松开 发送';
    }

    function hideHoldOverlay() {
        if (holdTimerId) {
            clearInterval(holdTimerId);
            holdTimerId = null;
        }
        const ov = document.getElementById('uwu-voice-hold-overlay');
        if (ov) {
            ov.classList.remove('visible', 'cancel-mode');
        }
    }

    const userAudioCache = new Map();

    async function sendAsVoiceMessage(text, audioBlobUrl = '') {
        const clean = (text || '').trim();
        if (!clean) return;
        const cfg = loadConfig();
        if (cfg.sendAsText) {
            const input = document.getElementById('message-input');
            if (input) {
                input.value = clean;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.focus();
            }
            return;
        }
        if (typeof currentChatId === 'undefined' || !window.db) return;
        const isGroup = typeof currentChatType !== 'undefined' && currentChatType === 'group';
        const chat = isGroup
            ? (db.groups || []).find(g => g.id === currentChatId)
            : (db.characters || []).find(c => c.id === currentChatId);
        if (!chat) return;

        const myName = isGroup ? (chat.me?.nickname || '我') : (chat.myName || '我');
        const voiceContent = `[${myName}的语音：${clean}]`;
        const msgId = `msg_uvoice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const voiceMsg = {
            id: msgId,
            role: 'user',
            content: voiceContent,
            parts: [{ type: 'text', text: voiceContent }],
            timestamp: Date.now()
        };
        if (audioBlobUrl) userAudioCache.set(msgId, audioBlobUrl);

        chat.history ||= [];
        chat.history.push(voiceMsg);
        if (typeof window.addMessageBubble === 'function') {
            window.addMessageBubble(voiceMsg, currentChatId, isGroup ? 'group' : 'private');
        } else if (typeof window.renderMessages === 'function') {
            window.renderMessages(false, true);
        }
        if (typeof window.saveData === 'function') await window.saveData();
        if (typeof window.renderChatList === 'function') window.renderChatList();
    }

    function fillOrSendText(text, audioBlobUrl = '') {
        return sendAsVoiceMessage(text, audioBlobUrl);
    }

    // 模式 A：浏览器内置实时语音识别（配合长按说话，支持实时预览）
    function startBrowserRecognition() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            hideHoldOverlay();
            holdActive = false;
            if (typeof window.showToast === 'function') {
                window.showToast('当前浏览器不支持内置语音识别，请在 API 设置切换为 Whisper 录音接口');
            }
            return;
        }
        const cfg = loadConfig();
        browserTranscriptFinal = '';
        browserTranscriptInterim = '';
        cancelPendingRecording = false;

        recognition = new SR();
        recognition.lang = cfg.lang || 'zh-CN';
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.continuous = true;

        isRecording = true;
        updateMicBtnState(true);

        recognition.onresult = (event) => {
            let fin = '';
            let inter = '';
            for (let i = 0; i < event.results.length; i++) {
                const res = event.results[i];
                const txt = res[0]?.transcript || '';
                if (res.isFinal) fin += txt;
                else inter += txt;
            }
            browserTranscriptFinal = fin;
            browserTranscriptInterim = inter;
            const previewEl = document.getElementById('uwu-vh-preview');
            if (previewEl) previewEl.textContent = (fin + inter).trim().slice(-40);
        };
        recognition.onerror = (event) => {
            isRecording = false;
            updateMicBtnState(false);
            const code = event?.error || 'unknown';
            if (code === 'not-allowed') {
                hideHoldOverlay();
                holdActive = false;
                if (typeof window.showToast === 'function') window.showToast('麦克风权限被拒绝，请在浏览器设置中允许麦克风');
            } else if (code !== 'aborted' && code !== 'no-speech' && !cancelPendingRecording) {
                if (typeof window.showToast === 'function') window.showToast(`语音识别失败 (${code})`);
            }
        };
        recognition.onend = () => {
            isRecording = false;
            updateMicBtnState(false);
            const finalText = (browserTranscriptFinal + browserTranscriptInterim).trim();
            const wasCancelled = cancelPendingRecording;
            recognition = null;
            if (!wasCancelled) {
                if (finalText) {
                    fillOrSendText(finalText);
                } else if (typeof window.showToast === 'function') {
                    window.showToast('未识别到清晰语音');
                }
            }
        };
        try {
            recognition.start();
        } catch (e) {
            isRecording = false;
            updateMicBtnState(false);
            hideHoldOverlay();
            holdActive = false;
        }
    }

    // 模式 B：真实录音并调用 Whisper /v1/audio/transcriptions 接口转文字
    async function startWhisperRecording() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            hideHoldOverlay();
            holdActive = false;
            if (typeof window.showToast === 'function') window.showToast('当前环境不支持麦克风录音');
            return;
        }
        const cfg = loadConfig();
        const apiKey = (cfg.apiKey || window.db?.apiSettings?.key || '').trim();
        if (!apiKey && !(cfg.endpoint || '').trim()) {
            hideHoldOverlay();
            holdActive = false;
            if (typeof window.showToast === 'function') window.showToast('请先在 API 设置中填写 Whisper 语音识别 Key 或接口');
            return;
        }

        cancelPendingRecording = false;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // 若在权限/设备初始化期间用户已经松手，立即释放麦克风并中止
            if (!holdActive) {
                try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
                return;
            }
            mediaStream = stream;
            const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
                : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
            mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                try { if (mediaStream) mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
                mediaStream = null;
                isRecording = false;
                const wasCancelled = cancelPendingRecording;
                if (wasCancelled || !audioChunks.length) {
                    updateMicBtnState(false, false);
                    mediaRecorder = null;
                    audioChunks = [];
                    return;
                }
                updateMicBtnState(false, true);
                try {
                    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                    const ext = (blob.type || '').includes('mp4') ? 'm4a' : 'webm';
                    const form = new FormData();
                    form.append('file', blob, `voice.${ext}`);
                    form.append('model', (cfg.model || 'whisper-1').trim());
                    if (cfg.lang && cfg.lang !== 'auto') {
                        form.append('language', cfg.lang.split('-')[0]);
                    }
                    const baseEndpoint = (cfg.endpoint || '').trim()
                        || ((window.db?.apiSettings?.url || '').replace(/\/$/, '') ? `${window.db.apiSettings.url.replace(/\/$/, '')}/v1/audio/transcriptions` : 'https://api.openai.com/v1/audio/transcriptions');
                    const headers = {};
                    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
                    const resp = await fetch(baseEndpoint, { method: 'POST', headers, body: form });
                    if (!resp.ok) {
                        const errTxt = await resp.text().catch(() => '');
                        throw new Error(`转文字失败 (${resp.status}): ${errTxt.slice(0, 100)}`);
                    }
                    const data = await resp.json();
                    const text = (data?.text || '').trim();
                    const blobUrl = URL.createObjectURL(blob);
                    if (text) await sendAsVoiceMessage(text, blobUrl);
                    else if (typeof window.showToast === 'function') window.showToast('未识别出语音内容');
                } catch (err) {
                    console.error('[VoiceInput Whisper]', err);
                    if (typeof window.showToast === 'function') window.showToast(err.message || '语音转文字失败');
                } finally {
                    updateMicBtnState(false, false);
                    mediaRecorder = null;
                    audioChunks = [];
                }
            };

            mediaRecorder.start();
            isRecording = true;
            updateMicBtnState(true);
        } catch (err) {
            isRecording = false;
            holdActive = false;
            hideHoldOverlay();
            updateMicBtnState(false);
            if (typeof window.showToast === 'function') window.showToast('无法打开麦克风，请检查浏览器权限');
        }
    }

    function startHoldRecording(clientY) {
        if (holdActive) return;
        holdActive = true;
        holdCancelled = false;
        cancelPendingRecording = false;
        holdStartY = clientY || 0;
        holdStartTime = Date.now();
        try { if (navigator.vibrate) navigator.vibrate(18); } catch (e) {}
        showHoldOverlay();
        const cfg = loadConfig();
        if (cfg.mode === 'whisper') {
            startWhisperRecording();
        } else {
            startBrowserRecognition();
        }
    }

    function moveHoldRecording(clientY) {
        if (!holdActive) return;
        const deltaUp = holdStartY - (clientY || 0);
        const shouldCancel = deltaUp > 55;
        if (shouldCancel !== holdCancelled) {
            holdCancelled = shouldCancel;
            setHoldOverlayCancelState(shouldCancel);
            try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
        }
    }

    function endHoldRecording(forceCancel = false) {
        if (!holdActive) return;
        holdActive = false;
        hideHoldOverlay();
        const elapsed = Date.now() - holdStartTime;
        const tooShort = !forceCancel && !holdCancelled && elapsed < 450;
        cancelPendingRecording = Boolean(forceCancel || holdCancelled || tooShort);

        if (recognition) {
            try {
                if (cancelPendingRecording) recognition.abort();
                else recognition.stop();
            } catch (e) {}
        }
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            try { mediaRecorder.stop(); } catch (e) {}
        }
        isRecording = false;
        updateMicBtnState(false);

        if (holdCancelled || forceCancel) {
            if (typeof window.showToast === 'function') window.showToast('已取消发送');
        } else if (tooShort) {
            if (typeof window.showToast === 'function') window.showToast('按住说话、松开发送（说话时间太短）');
        }
    }

    // 1. 注入聊天室底部左侧「麦克风」按钮（支持仿微信/QQ 长按说话、松开发送、上滑取消）
    function injectMicButton() {
        const expandBtn = document.getElementById('toggle-expansion-btn');
        const inputWrap = document.querySelector('#message-input-default .input-wrapper');
        const anchor = expandBtn || inputWrap;
        if (!anchor || !anchor.parentElement || document.getElementById('uwu-mic-input-btn')) return;
        const bar = anchor.parentElement;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'uwu-mic-input-btn';
        btn.className = 'icon-btn circle-bg uwu-mic-btn';
        btn.style.flexShrink = '0';
        btn.title = '按住说话';
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;

        btn.addEventListener('contextmenu', (e) => e.preventDefault());

        // 移动端触摸长按：按住录、上滑取消、松开发送
        btn.addEventListener('touchstart', (e) => {
            usingTouch = true;
            e.preventDefault();
            e.stopPropagation();
            const y = e.touches && e.touches[0] ? e.touches[0].clientY : 0;
            startHoldRecording(y);
        }, { passive: false });

        btn.addEventListener('touchmove', (e) => {
            if (!holdActive) return;
            e.preventDefault();
            const y = e.touches && e.touches[0] ? e.touches[0].clientY : 0;
            moveHoldRecording(y);
        }, { passive: false });

        btn.addEventListener('touchend', (e) => {
            if (!holdActive) return;
            e.preventDefault();
            e.stopPropagation();
            endHoldRecording(false);
        }, { passive: false });

        btn.addEventListener('touchcancel', () => {
            if (holdActive) endHoldRecording(true);
        });

        // 桌面端鼠标长按兼容
        btn.addEventListener('mousedown', (e) => {
            if (usingTouch || e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            startHoldRecording(e.clientY);
            const onMove = (ev) => moveHoldRecording(ev.clientY);
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                endHoldRecording(false);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });

        if (expandBtn) bar.insertBefore(btn, expandBtn.nextSibling);
        else bar.insertBefore(btn, inputWrap);
    }

    // 2. 在 API 设置页注入「真实语音输入（STT）」配置面板（全宽竖排，手机端无溢出）
    function injectApiVoiceInputSettings() {
        const timeSw = document.getElementById('time-perception-switch');
        if (!timeSw || document.getElementById('api-voice-input-section')) return;
        const anchor = document.getElementById('api-voice-tts-section') || timeSw.closest('.kkt-group') || timeSw.closest('.kkt-item')?.parentElement;
        if (!anchor || !anchor.parentElement) return;

        const cfg = loadConfig();
        const box = document.createElement('div');
        box.className = 'kkt-group';
        box.id = 'api-voice-input-section';
        box.innerHTML = `
            <div class="kkt-item" style="flex-direction:column;align-items:stretch;gap:8px;width:100%;box-sizing:border-box;overflow:hidden;">
                <div class="kkt-item-title">真实语音输入（麦克风说话转文字）</div>
                <select id="uwu-stt-mode" style="width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;background:#fff;font-size:13px;">
                    <option value="browser">浏览器自带识别（免费、无需 API）</option>
                    <option value="whisper">Whisper 录音接口（高准确率/中英混读）</option>
                </select>
                <select id="uwu-stt-lang" style="width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;background:#fff;font-size:13px;">
                    <option value="zh-CN">普通话 (zh-CN)</option>
                    <option value="en-AU">澳洲英语 (en-AU)</option>
                    <option value="en-US">美式英语 (en-US)</option>
                    <option value="auto">自动识别 (仅 Whisper)</option>
                </select>
                <div id="uwu-stt-whisper-fields" style="display:flex;flex-direction:column;gap:8px;width:100%;box-sizing:border-box;">
                    <input type="text" id="uwu-stt-endpoint" placeholder="Whisper 接口地址（留空则复用主 API 域名）" style="width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;font-size:13px;">
                    <input type="password" id="uwu-stt-apikey" placeholder="Whisper API Key（留空则复用主 API Key）" style="width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;font-size:13px;">
                    <div style="display:flex;gap:6px;width:100%;box-sizing:border-box;">
                        <input type="text" id="uwu-stt-model" placeholder="模型名（如 FunAudioLLM/SenseVoiceSmall）" style="flex:1;min-width:0;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;font-size:13px;">
                        <button type="button" id="uwu-stt-fetch-models-btn" style="flex-shrink:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;background:#fff;font-size:12px;cursor:pointer;">拉取模型</button>
                    </div>
                    <select id="uwu-stt-model-select" style="display:none;width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;background:#f8fafc;font-size:13px;"></select>
                </div>
                <label style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#333;padding:2px 0;">
                    <span>识别后仅填入文字框（不勾选则直接发出语音条）</span>
                    <input type="checkbox" id="uwu-stt-autosend">
                </label>
                <button type="button" id="uwu-stt-save-btn" class="btn btn-primary" style="width:100%;box-sizing:border-box;padding:8px 12px;font-size:13px;">保存语音输入设置</button>
            </div>
        `;
        anchor.parentElement.insertBefore(box, anchor.nextSibling);

        const modeEl = document.getElementById('uwu-stt-mode');
        const langEl = document.getElementById('uwu-stt-lang');
        const whisperFields = document.getElementById('uwu-stt-whisper-fields');
        const epEl = document.getElementById('uwu-stt-endpoint');
        const keyEl = document.getElementById('uwu-stt-apikey');
        const modelEl = document.getElementById('uwu-stt-model');
        const autoEl = document.getElementById('uwu-stt-autosend');
        const fetchSttBtn = document.getElementById('uwu-stt-fetch-models-btn');
        const sttModelSel = document.getElementById('uwu-stt-model-select');
        const saveBtn = document.getElementById('uwu-stt-save-btn');

        sttModelSel.addEventListener('change', () => {
            if (sttModelSel.value) modelEl.value = sttModelSel.value;
        });

        fetchSttBtn.addEventListener('click', async () => {
            fetchSttBtn.disabled = true;
            fetchSttBtn.textContent = '拉取中…';
            try {
                const rawEp = (epEl.value || '').trim() || (window.db?.apiSettings?.url || '').trim();
                if (!rawEp) throw new Error('请先填写接口地址（如 https://api.siliconflow.cn/v1/audio/transcriptions）');
                let modelsUrl = /\/models(\?|$)/.test(rawEp) ? rawEp
                    : (/\/v1\//.test(rawEp) ? rawEp.replace(/\/v1\/.*$/, '/v1/models') : rawEp.replace(/\/$/, '') + '/v1/models');
                if (modelsUrl.includes('siliconflow') && !modelsUrl.includes('?')) {
                    modelsUrl += '?sub_type=speech-to-text';
                }
                const headers = {};
                const k = (keyEl.value || window.db?.apiSettings?.key || '').trim();
                if (k) headers['Authorization'] = `Bearer ${k}`;
                const resp = await fetch(modelsUrl, { headers });
                if (!resp.ok) throw new Error(`拉取模型失败 (${resp.status})`);
                const data = await resp.json();
                const rawList = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
                const ids = rawList.map(m => typeof m === 'string' ? m : (m?.id || m?.name || '')).filter(Boolean);
                const asrRe = /whisper|sensevoice|asr|speech|transcrib|audio/i;
                ids.sort((a, b) => (asrRe.test(b) ? 1 : 0) - (asrRe.test(a) ? 1 : 0));
                const uniq = [...new Set(ids)];
                if (!uniq.length) throw new Error('接口未返回可用模型');
                sttModelSel.innerHTML = '<option value="">-- 请选择拉取到的语音识别模型 --</option>' + uniq.map(m => `<option value="${m.replace(/"/g, '&quot;')}">${m}</option>`).join('');
                sttModelSel.style.display = 'block';
                if (modelEl.value && uniq.includes(modelEl.value)) sttModelSel.value = modelEl.value;
                if (typeof window.showToast === 'function') window.showToast(`已拉取 ${uniq.length} 个模型`);
            } catch (err) {
                if (typeof window.showToast === 'function') window.showToast(err.message || '拉取模型失败');
            } finally {
                fetchSttBtn.disabled = false;
                fetchSttBtn.textContent = '拉取模型';
            }
        });

        modeEl.value = cfg.mode || 'browser';
        langEl.value = cfg.lang || 'zh-CN';
        epEl.value = cfg.endpoint || '';
        keyEl.value = cfg.apiKey || '';
        modelEl.value = cfg.model || 'whisper-1';
        autoEl.checked = Boolean(cfg.sendAsText);

        const syncVisibility = () => {
            whisperFields.style.display = modeEl.value === 'whisper' ? 'flex' : 'none';
        };
        modeEl.addEventListener('change', syncVisibility);
        syncVisibility();

        saveBtn.addEventListener('click', () => {
            saveConfig({
                mode: modeEl.value,
                lang: langEl.value,
                endpoint: epEl.value.trim(),
                apiKey: keyEl.value.trim(),
                model: modelEl.value.trim() || 'whisper-1',
                sendAsText: autoEl.checked
            });
            if (typeof window.showToast === 'function') window.showToast('语音输入设置已保存');
        });
    }

    function injectStyle() {
        if (document.getElementById('uwu-voice-input-style')) return;
        const st = document.createElement('style');
        st.id = 'uwu-voice-input-style';
        st.textContent = `
            .uwu-mic-btn.uwu-mic-recording { background-color: #ff4d4f !important; color: #fff !important; animation: uwuMicPulse 1s infinite ease-in-out; }
            .uwu-mic-btn.uwu-mic-busy { opacity: 0.6; }
            @keyframes uwuMicPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
        `;
        document.head.appendChild(st);
    }

    if (typeof window.injectChatRoomHtml === 'function' && !window.injectChatRoomHtml.__voiceInputWrapped) {
        const orig = window.injectChatRoomHtml;
        const wrapped = function () {
            const ret = orig.apply(this, arguments);
            injectMicButton();
            return ret;
        };
        wrapped.__voiceInputWrapped = true;
        window.injectChatRoomHtml = wrapped;
    }


    if (!document.__uwuUserVoicePlayBound) {
        document.__uwuUserVoicePlayBound = true;
        document.addEventListener('click', (e) => {
            const bubble = e.target?.closest?.('.message-wrapper.sent .voice-bubble');
            if (!bubble) return;
            const id = bubble.closest('.message-wrapper')?.dataset?.id;
            const url = id ? userAudioCache.get(id) : '';
            if (url) {
                try { new Audio(url).play(); } catch (err) {}
            }
        });
    }

    function bootstrap() {
        injectStyle();
        injectMicButton();
        injectApiVoiceInputSettings();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            bootstrap();
            let tries = 0;
            const t = setInterval(() => {
                tries++;
                bootstrap();
                if ((document.getElementById('uwu-mic-input-btn') && document.getElementById('api-voice-input-section')) || tries >= 40) {
                    clearInterval(t);
                }
            }, 500);
        });
    } else {
        bootstrap();
    }

    window.VoiceInputPlugin = { loadConfig, saveConfig, toggleRecording, fillOrSendText, bootstrap };
})();