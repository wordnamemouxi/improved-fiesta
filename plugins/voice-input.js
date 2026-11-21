/**
 * Voice Input Plugin (plugins/voice-input.js)
 * 功能：真实麦克风语音输入（让角色真正听懂你说的话）
 * 1. 支持两种模式：
 *    - 浏览器内置语音识别（免额外 API、零费用，支持实时转文字）
 *    - Whisper / 兼容 /v1/audio/transcriptions 接口（真实录音上传，准确率最高、支持方言与中英混说）
 * 2. 在聊天室底部输入框旁增加「麦克风」按钮，点一下开始说话，再点一下停止（可选“说完自动发送”）。
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
        btn.classList.toggle('uwu-mic-busy', Boolean(busy));
        btn.title = active ? '正在录音，点击停止' : (busy ? '正在识别语音…' : '语音输入');
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

    // 模式 A：浏览器内置实时语音识别
    function startBrowserRecognition() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            if (typeof window.showToast === 'function') {
                window.showToast('当前浏览器不支持内置语音识别，请在 API 设置切换为 Whisper 录音接口');
            }
            return;
        }
        const cfg = loadConfig();
        recognition = new SR();
        recognition.lang = cfg.lang || 'zh-CN';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.continuous = false;

        isRecording = true;
        updateMicBtnState(true);
        if (typeof window.showToast === 'function') window.showToast('请开始说话，说完再点一次停止');

        recognition.onresult = (event) => {
            const transcript = event?.results?.[0]?.[0]?.transcript || '';
            if (transcript.trim()) {
                fillOrSendText(transcript);
            } else if (typeof window.showToast === 'function') {
                window.showToast('未识别到清晰语音');
            }
        };
        recognition.onerror = (event) => {
            isRecording = false;
            updateMicBtnState(false);
            const code = event?.error || 'unknown';
            if (code === 'not-allowed') {
                if (typeof window.showToast === 'function') window.showToast('麦克风权限被拒绝，请在浏览器设置中允许麦克风');
            } else if (code !== 'aborted') {
                if (typeof window.showToast === 'function') window.showToast(`语音识别失败 (${code})`);
            }
        };
        recognition.onend = () => {
            isRecording = false;
            updateMicBtnState(false);
            recognition = null;
        };
        try {
            recognition.start();
        } catch (e) {
            isRecording = false;
            updateMicBtnState(false);
        }
    }

    // 模式 B：真实录音并调用 Whisper /v1/audio/transcriptions 接口转文字
    async function startWhisperRecording() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            if (typeof window.showToast === 'function') window.showToast('当前环境不支持麦克风录音');
            return;
        }
        const cfg = loadConfig();
        const apiKey = (cfg.apiKey || window.db?.apiSettings?.key || '').trim();
        if (!apiKey && !(cfg.endpoint || '').trim()) {
            if (typeof window.showToast === 'function') window.showToast('请先在 API 设置中填写 Whisper 语音识别 Key 或接口');
            return;
        }

        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
                : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
            mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                try { mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
                mediaStream = null;
                isRecording = false;
                if (!audioChunks.length) {
                    updateMicBtnState(false);
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
            if (typeof window.showToast === 'function') window.showToast('正在录音，说完点击麦克风停止并识别');
        } catch (err) {
            isRecording = false;
            updateMicBtnState(false);
            if (typeof window.showToast === 'function') window.showToast('无法打开麦克风，请检查浏览器权限');
        }
    }

    function toggleRecording() {
        if (isRecording) {
            if (recognition) {
                try { recognition.stop(); } catch (e) {}
            }
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                try { mediaRecorder.stop(); } catch (e) {}
            }
            isRecording = false;
            updateMicBtnState(false);
            return;
        }
        const cfg = loadConfig();
        if (cfg.mode === 'whisper') {
            startWhisperRecording();
        } else {
            startBrowserRecognition();
        }
    }

    // 1. 注入聊天室底部「麦克风」按钮
    function injectMicButton() {
        const getReplyBtn = document.getElementById('get-reply-btn');
        if (!getReplyBtn || document.getElementById('uwu-mic-input-btn')) return;
        const bar = getReplyBtn.parentElement;
        if (!bar) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'uwu-mic-input-btn';
        btn.className = 'icon-btn circle-bg uwu-mic-btn';
        btn.title = '语音输入';
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleRecording();
        });
        bar.insertBefore(btn, getReplyBtn);
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
                    <input type="text" id="uwu-stt-model" placeholder="模型名（默认 whisper-1）" style="width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;font-size:13px;">
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
        const saveBtn = document.getElementById('uwu-stt-save-btn');

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