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
    let recordingSession = null;
    let holdActive = false;
    let holdCancelled = false;
    let holdStartY = 0;
    let holdStartTime = 0;
    let holdTimerId = null;
    let usingTouch = false;
    let recordingDb = null;
    let playingRecording = null;
    let playbackRequest = 0;

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

    function voiceRecordings() {
        if (!recordingDb) {
            recordingDb = new Dexie('uwu_voice_input_db');
            recordingDb.version(1).stores({ recordings: '&id' });
        }
        return recordingDb.table('recordings');
    }

    function getVoiceTarget() {
        if (typeof currentChatId === 'undefined' || !currentChatId
            || typeof currentChatType === 'undefined' || !['private', 'group'].includes(currentChatType)) return null;
        return { id: currentChatId, type: currentChatType };
    }

    function findVoiceChat(target) {
        const chats = target.type === 'group' ? window.db?.groups : window.db?.characters;
        return chats?.find(chat => chat.id === target.id);
    }

    function isVoiceTargetOpen(target) {
        return getVoiceTarget()?.id === target.id && currentChatType === target.type
            && document.getElementById('chat-room-screen')?.classList.contains('active');
    }

    function fillVoiceDraft(text, focus = false) {
        const input = document.getElementById('message-input');
        if (!input || input.value.trim()) return false;
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (focus) input.focus();
        return true;
    }

    async function fillOrSendText(text, audio, target = getVoiceTarget(), cfg = loadConfig()) {
        const clean = (text || '').trim();
        if (!clean || !target) return;
        const chat = findVoiceChat(target);
        if (!chat) return;

        if (cfg.sendAsText) {
            if (isVoiceTargetOpen(target) && fillVoiceDraft(clean, true)) return;
            chat.voiceInputDraft = [chat.voiceInputDraft, clean].filter(Boolean).join('\n');
            await window.saveSingleChatFast(chat, target.type);
            window.showToast?.('转写已保存到原会话的草稿');
            return;
        }

        const myName = target.type === 'group' ? (chat.me?.nickname || '我') : (chat.myName || '我');
        const content = `[${myName}的语音：${clean}]`;
        const id = `msg_uvoice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const message = { id, role: 'user', content, parts: [{ type: 'text', text: content }], timestamp: Date.now() };
        if (target.type === 'group') message.senderId = 'user_me';
        if (audio?.size) {
            try {
                await voiceRecordings().put({ id, audio });
                message.hasVoiceRecording = true;
            } catch (error) {
                console.warn('[VoiceInput] Recording save failed:', error);
                window.showToast?.('录音保存失败，仍会保留转写文字');
            }
        }

        if (findVoiceChat(target) !== chat) {
            if (message.hasVoiceRecording) await voiceRecordings().delete(id);
            return;
        }
        chat.history ||= [];
        chat.history.push(message);
        try {
            await window.saveSingleChatFast(chat, target.type);
        } catch (error) {
            chat.history = chat.history.filter(item => item.id !== id);
            if (message.hasVoiceRecording) {
                await voiceRecordings().delete(id).catch(cleanupError => console.warn('[VoiceInput] Recording cleanup failed:', cleanupError));
            }
            throw error;
        }
        if (isVoiceTargetOpen(target) && !document.querySelector(`.message-wrapper[data-id="${id}"]`)) {
            window.addMessageBubble?.(message, target.id, target.type);
        }
        window.renderChatList?.();
    }

    function restoreVoiceDraft() {
        const target = getVoiceTarget();
        if (!target || !isVoiceTargetOpen(target)) return;
        const chat = findVoiceChat(target);
        if (chat?.voiceInputDraft && fillVoiceDraft(chat.voiceInputDraft)) {
            delete chat.voiceInputDraft;
            window.saveSingleChatFast(chat, target.type).catch(error => console.warn('[VoiceInput] Draft save failed:', error));
        }
    }

    function stopAudioCapture(session) {
        if (session.finishNativeRecording) {
            session.finishNativeRecording();
        } else if (session.recorder?.state === 'recording') {
            session.recorder.stop();
        }
    }

    async function captureVoiceAudio(session) {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            throw new Error('当前浏览器无法录制麦克风音频');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        try {
            if (session.released) return null;
            const mimeType = ['audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            session.recorder = recorder;
            const chunks = [];
            return await new Promise((resolve, reject) => {
                recorder.ondataavailable = event => {
                    if (event.data?.size) chunks.push(event.data);
                };
                recorder.onstop = () => resolve(chunks.length
                    ? new Blob(chunks, { type: recorder.mimeType || chunks[0].type || 'audio/webm' })
                    : null);
                recorder.onerror = event => reject(event.error || new Error('录音失败'));
                recorder.start();
            });
        } finally {
            for (const track of stream.getTracks()) track.stop();
        }
    }

    function releaseHold(session) {
        session.released = true;
        holdActive = false;
        hideHoldOverlay();
        stopAudioCapture(session);
        updateMicBtnState(false, !session.cancelled);
    }

    function finishVoiceSession(session) {
        if (recordingSession !== session) return;
        if (!session.released) releaseHold(session);
        recordingSession = null;
        updateMicBtnState(false);
    }

    function startBrowserRecognition(session) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            window.showToast?.('当前浏览器不支持内置识别，请在 API 设置切换为 Whisper 录音接口');
            finishVoiceSession(session);
            return;
        }

        try {
            const recognition = new SpeechRecognition();
            session.recognition = recognition;
            recognition.lang = session.cfg.lang || 'zh-CN';
            recognition.interimResults = true;
            recognition.maxAlternatives = 1;
            recognition.continuous = true;

            let transcript = '';
            recognition.onresult = event => {
                transcript = Array.from(event.results, result => result[0]?.transcript || '').join('').trim();
                const preview = document.getElementById('uwu-vh-preview');
                if (preview) preview.textContent = transcript.slice(-40);
            };
            recognition.onerror = event => {
                if (session.cancelled || event.error === 'aborted' || event.error === 'no-speech') return;
                session.cancelled = true;
                window.showToast?.(event.error === 'not-allowed'
                    ? '麦克风权限被拒绝，请在浏览器中允许使用麦克风'
                    : `语音识别失败 (${event.error || 'unknown'})`);
                releaseHold(session);
            };
            recognition.onend = async () => {
                if (recordingSession !== session) return;
                try {
                    if (!session.released) releaseHold(session);
                    const audio = await session.audio;
                    if (session.cancelled) return;
                    if (transcript) await fillOrSendText(transcript, audio, session.target, session.cfg);
                    else window.showToast?.('未识别到清晰语音');
                } catch (error) {
                    console.error('[VoiceInput] Could not save speech:', error);
                    window.showToast?.('语音消息保存失败');
                } finally {
                    finishVoiceSession(session);
                }
            };
            recognition.start();
            if (!session.cfg.sendAsText) {
                session.audio = captureVoiceAudio(session).catch(error => {
                    console.warn('[VoiceInput] Browser recording unavailable:', error);
                    if (!session.cancelled) window.showToast?.('当前浏览器未保存原声，可用 Whisper 模式录制并保存原声');
                    return null;
                });
            }
        } catch (error) {
            console.warn('[VoiceInput] Could not start speech recognition:', error);
            finishVoiceSession(session);
            window.showToast?.('无法开始语音识别');
        }
    }

    function captureAndroidVoiceAudio(session, bridge) {
        const status = bridge.startVoiceRecording();
        if (status === 'permission') {
            window.showToast?.('请允许某昔专线使用麦克风，然后重新长按录音');
            return null;
        }
        if (status !== 'recording') {
            throw new Error(status === 'busy' ? '麦克风正在录音' : '安卓录音启动失败，请确认麦克风可用后重试');
        }
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                endHoldRecording(true);
                window.showToast?.('单条语音最长录制 2 分钟');
            }, 120000);
            session.finishNativeRecording = () => {
                session.finishNativeRecording = null;
                clearTimeout(timeout);
                try {
                    const encoded = bridge.finishVoiceRecording(!session.cancelled);
                    if (session.cancelled) {
                        resolve(null);
                        return;
                    }
                    if (!encoded) throw new Error('未收到录音，请重新长按说话');
                    const audio = Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0));
                    resolve(new Blob([audio], { type: 'audio/mp4' }));
                } catch (error) {
                    reject(error);
                }
            };
        });
    }

    async function startWhisperRecording(session) {
        const cfg = session.cfg;
        const apiKey = (cfg.apiKey || window.db?.apiSettings?.key || '').trim();
        const mainUrl = (window.db?.apiSettings?.url || '').replace(/\/$/, '');
        const endpoint = (cfg.endpoint || '').trim()
            || (mainUrl ? `${mainUrl}/v1/audio/transcriptions` : 'https://api.openai.com/v1/audio/transcriptions');
        if (!apiKey && !(cfg.endpoint || '').trim()) {
            finishVoiceSession(session);
            window.showToast?.('请先在 API 设置中填写 Whisper 语音识别 Key 或接口');
            return;
        }

        try {
            const bridge = window.MouxiAndroid;
            const audio = await (bridge?.startVoiceRecording
                ? captureAndroidVoiceAudio(session, bridge)
                : captureVoiceAudio(session));
            if (!audio || session.cancelled) return;
            const ext = audio.type.includes('mp4') ? 'm4a' : 'webm';
            const form = new FormData();
            form.append('file', audio, `voice.${ext}`);
            form.append('model', (cfg.model || 'whisper-1').trim());
            if (cfg.lang && cfg.lang !== 'auto') form.append('language', cfg.lang.split('-')[0]);
            const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
            const response = await fetch(endpoint, { method: 'POST', headers, body: form });
            if (!response.ok) throw new Error(`转文字失败 (HTTP ${response.status})`);
            const data = await response.json();
            const text = (data?.text || '').trim();
            if (text) await fillOrSendText(text, audio, session.target, cfg);
            else window.showToast?.('未识别出语音内容');
        } catch (error) {
            if (!session.cancelled) {
                console.error('[VoiceInput Whisper]', error);
                window.showToast?.(error.message || '语音转文字失败');
            }
        } finally {
            finishVoiceSession(session);
        }
    }

    function startHoldRecording(clientY) {
        if (recordingSession) return;
        const target = getVoiceTarget();
        if (!target || !findVoiceChat(target)) return;
        const session = { target, cfg: loadConfig(), released: false, cancelled: false };
        recordingSession = session;
        holdActive = true;
        holdCancelled = false;
        holdStartY = clientY || 0;
        holdStartTime = Date.now();
        try { if (navigator.vibrate) navigator.vibrate(18); } catch (error) {}
        showHoldOverlay();
        updateMicBtnState(true);
        if (session.cfg.mode === 'whisper') startWhisperRecording(session);
        else startBrowserRecognition(session);
    }

    function moveHoldRecording(clientY) {
        if (!holdActive) return;
        const shouldCancel = holdStartY - (clientY || 0) > 55;
        if (shouldCancel !== holdCancelled) {
            holdCancelled = shouldCancel;
            setHoldOverlayCancelState(shouldCancel);
            try { if (navigator.vibrate) navigator.vibrate(12); } catch (error) {}
        }
    }

    function endHoldRecording(forceCancel = false) {
        const session = recordingSession;
        if (!holdActive || !session) return;
        const tooShort = !forceCancel && !holdCancelled && Date.now() - holdStartTime < 450;
        session.cancelled = forceCancel || holdCancelled || tooShort;
        releaseHold(session);
        if (session.recognition) {
            try {
                if (session.cancelled) session.recognition.abort();
                else session.recognition.stop();
            } catch (error) {
                finishVoiceSession(session);
            }
        }
        if (holdCancelled || forceCancel) window.showToast?.('已取消发送');
        else if (tooShort) window.showToast?.('按住说话、松开发送（说话时间太短）');
    }

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
                <div class="kkt-item-title">麦克风转写</div>
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
        const slot = document.getElementById('api-stt-settings-slot');
        if (slot) slot.appendChild(box);
        else anchor.parentElement.insertBefore(box, anchor.nextSibling);

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


    if (typeof window.openChatRoom === 'function') {
        const openChatRoom = window.openChatRoom;
        window.openChatRoom = function () {
            const result = openChatRoom.apply(this, arguments);
            restoreVoiceDraft();
            return result;
        };
    }

    function stopPlayingRecording() {
        if (!playingRecording) return;
        playingRecording.audio.pause();
        URL.revokeObjectURL(playingRecording.url);
        playingRecording = null;
    }

    document.addEventListener('click', async event => {
        const bubble = event.target?.closest?.('.message-wrapper.sent .voice-bubble');
        const id = bubble?.closest('.message-wrapper')?.dataset?.id;
        if (!id?.startsWith('msg_uvoice_')) return;
        const target = getVoiceTarget();
        if (!target) return;
        const request = ++playbackRequest;
        const wasPlaying = playingRecording?.id === id;
        stopPlayingRecording();
        if (wasPlaying) return;
        try {
            const saved = await voiceRecordings().get(id);
            if (request !== playbackRequest || !isVoiceTargetOpen(target)) return;
            if (!saved?.audio) return;
            const url = URL.createObjectURL(saved.audio);
            const audio = new Audio(url);
            playingRecording = { id, audio, url };
            audio.onended = () => {
                if (playingRecording?.audio === audio) stopPlayingRecording();
            };
            audio.onerror = () => {
                if (playingRecording?.audio === audio) stopPlayingRecording();
            };
            await audio.play();
        } catch (error) {
            if (request === playbackRequest) {
                stopPlayingRecording();
                window.showToast?.('录音播放失败');
            }
        }
    });

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

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && recordingSession?.finishNativeRecording) endHoldRecording(true);
    });

    function finishAndroidPermission(granted) {
        window.showToast?.(granted
            ? '麦克风已允许，请重新长按录音'
            : '请在手机设置中允许某昔专线使用麦克风');
    }

    window.VoiceInputPlugin = {
        loadConfig, saveConfig, startHoldRecording, endHoldRecording, fillOrSendText, bootstrap, finishAndroidPermission
    };
})();