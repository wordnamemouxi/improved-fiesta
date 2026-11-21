/**
 * Voice TTS Plugin (plugins/voice-tts.js)
 * 功能：
 * 1. 支持专属克隆音色（Fish Audio / MiniMax / ElevenLabs / OpenAI 兼容或自建 TTS）。
 * 2. 极省额度：点击聊天室里的语音条（.voice-bubble）时才实时合成并播放；同一条语音自动缓存，重听不再重复扣费。
 * 3. 全局 API Key 放在「API 设置」页；每个角色在「聊天设置 → 功能」拥有独立的音色 ID 与开关。
 */
(() => {
    if (window.__uwuVoiceTtsLoaded) return;
    window.__uwuVoiceTtsLoaded = true;

    const CFG_KEY = 'uwu_voice_tts_config';
    const audioCache = new Map(); // cacheKey -> blobUrl
    let currentAudio = null;
    let currentBubbleEl = null;

    function loadConfig() {
        try {
            const raw = localStorage.getItem(CFG_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function saveConfig(patch) {
        const next = { ...loadConfig(), ...patch };
        try { localStorage.setItem(CFG_KEY, JSON.stringify(next)); } catch (e) {}
        return next;
    }

    function stopCurrentAudio() {
        if (currentAudio) {
            try { currentAudio.pause(); currentAudio.currentTime = 0; } catch (e) {}
            currentAudio = null;
        }
        if (currentBubbleEl) {
            currentBubbleEl.classList.remove('uwu-voice-playing', 'uwu-voice-loading');
            currentBubbleEl = null;
        }
    }

    async function synthesizeSpeech({ provider, apiKey, groupId, endpoint, voiceId, text, speed = 1.0 }) {
        const cleanText = (text || '').trim();
        if (!cleanText) throw new Error('语音内容为空');
        if (!apiKey && provider !== 'custom') throw new Error('请先在 API 设置中填写语音 API Key');
        if (!voiceId && provider !== 'openai') throw new Error('请先在角色聊天设置中填写专属音色 ID');

        let url = '';
        let headers = { 'Content-Type': 'application/json' };
        let body = {};

        if (provider === 'fish') {
            url = (endpoint || '').trim() || 'https://api.fish.audio/v1/tts';
            headers['Authorization'] = `Bearer ${apiKey}`;
            body = {
                text: cleanText,
                reference_id: voiceId,
                format: 'mp3',
                mp3_bitrate: 128,
                latency: 'normal'
            };
        } else if (provider === 'minimax') {
            const base = (endpoint || '').trim() || 'https://api.minimax.chat/v1/t2a_v2';
            url = groupId ? `${base}${base.includes('?') ? '&' : '?'}GroupId=${encodeURIComponent(groupId)}` : base;
            headers['Authorization'] = `Bearer ${apiKey}`;
            body = {
                model: 'speech-02-hd',
                text: cleanText,
                stream: false,
                voice_setting: {
                    voice_id: voiceId,
                    speed: Number(speed) || 1.0,
                    vol: 1,
                    pitch: 0
                },
                audio_setting: {
                    sample_rate: 32000,
                    bitrate: 128000,
                    format: 'mp3',
                    channel: 1
                }
            };
        } else if (provider === 'elevenlabs') {
            const base = (endpoint || '').trim() || 'https://api.elevenlabs.io/v1/text-to-speech';
            url = `${base.replace(/\/$/, '')}/${encodeURIComponent(voiceId)}`;
            headers['xi-api-key'] = apiKey;
            body = {
                text: cleanText,
                model_id: 'eleven_multilingual_v2',
                voice_settings: { stability: 0.5, similarity_boost: 0.75 }
            };
        } else {
            // openai 或自定义兼容 /v1/audio/speech 接口
            url = (endpoint || '').trim() || 'https://api.openai.com/v1/audio/speech';
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            body = {
                model: 'tts-1',
                input: cleanText,
                voice: voiceId || 'alloy',
                speed: Number(speed) || 1.0,
                response_format: 'mp3'
            };
        }

        const resp = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errTxt = await resp.text().catch(() => '');
            throw new Error(`语音接口报错 (${resp.status}): ${errTxt.slice(0, 120)}`);
        }

        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('application/json')) {
            const json = await resp.json();
            // MiniMax 返回 hex 编码音频在 data.audio
            const hex = json?.data?.audio;
            if (typeof hex === 'string' && hex.length > 20) {
                const bytes = new Uint8Array(hex.length / 2);
                for (let i = 0; i < bytes.length; i++) {
                    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
                }
                return URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
            }
            const errMsg = json?.base_resp?.status_msg || json?.error?.message || json?.message || '接口未返回音频数据';
            throw new Error(errMsg);
        }

        const blob = await resp.blob();
        if (!blob || blob.size < 100) throw new Error('返回的音频数据无效');
        return URL.createObjectURL(blob);
    }

    async function playVoiceForBubble(bubbleEl, text, chat, msgId) {
        if (currentBubbleEl === bubbleEl && currentAudio) {
            stopCurrentAudio();
            return;
        }
        stopCurrentAudio();

        const cfg = loadConfig();
        const provider = chat?.voiceTts?.provider || cfg.provider || 'fish';
        const voiceId = (chat?.voiceTts?.voiceId || '').trim();
        const speed = chat?.voiceTts?.speed || 1.0;
        const cacheKey = `${provider}::${voiceId}::${msgId || ''}::${text}`;

        try {
            currentBubbleEl = bubbleEl;
            bubbleEl.classList.add('uwu-voice-loading');

            let blobUrl = audioCache.get(cacheKey);
            if (!blobUrl) {
                blobUrl = await synthesizeSpeech({
                    provider,
                    apiKey: (cfg.apiKey || '').trim(),
                    groupId: (cfg.groupId || '').trim(),
                    endpoint: (cfg.endpoint || '').trim(),
                    voiceId,
                    text,
                    speed
                });
                audioCache.set(cacheKey, blobUrl);
            }

            if (currentBubbleEl !== bubbleEl) return; // 期间被用户取消或点了另一条
            bubbleEl.classList.remove('uwu-voice-loading');
            bubbleEl.classList.add('uwu-voice-playing');

            const audio = new Audio(blobUrl);
            currentAudio = audio;
            audio.onended = () => stopCurrentAudio();
            audio.onerror = () => {
                stopCurrentAudio();
                if (typeof window.showToast === 'function') window.showToast('音频播放失败');
            };
            await audio.play();
        } catch (err) {
            stopCurrentAudio();
            console.error('[VoiceTTS]', err);
            if (typeof window.showToast === 'function') window.showToast(err.message || '语音合成失败');
        }
    }

    // 1. 监听聊天室点击语音条：点击即合成播放（同时保留原版展开文字功能）
    function bindVoiceBubbleClicks() {
        if (document.__uwuVoiceClickBound) return;
        document.__uwuVoiceClickBound = true;
        document.addEventListener('click', (e) => {
            const bubble = e.target?.closest?.('.voice-bubble');
            if (!bubble) return;
            if (typeof currentChatType === 'undefined' || currentChatType !== 'private') return;
            if (typeof currentChatId === 'undefined' || !window.db?.characters) return;
            const chat = window.db.characters.find(c => c.id === currentChatId);
            if (!chat?.voiceTts?.enabled) return;

            const wrapper = bubble.closest('.message-wrapper');
            if (!wrapper || wrapper.classList.contains('sent')) return; // 仅合成角色发来的语音条
            const transcript = wrapper.querySelector('.voice-transcript');
            const text = (transcript?.textContent || '').trim();
            if (!text) return;

            playVoiceForBubble(bubble, text, chat, wrapper.dataset?.id || '');
        });
    }

    // 2. 在 API 设置页面注入全局「专属语音合成 API」配置面板
    function injectApiVoiceSettings() {
        const timeSw = document.getElementById('time-perception-switch');
        if (!timeSw || document.getElementById('api-voice-tts-section')) return;
        const group = timeSw.closest('.kkt-group') || timeSw.closest('.kkt-item')?.parentElement;
        if (!group || !group.parentElement) return;

        const cfg = loadConfig();
        const box = document.createElement('div');
        box.className = 'kkt-group';
        box.id = 'api-voice-tts-section';
        box.innerHTML = `
            <div class="kkt-item" style="flex-direction:column;align-items:stretch;gap:8px;width:100%;box-sizing:border-box;overflow:hidden;">
                <div class="kkt-item-title">专属克隆语音 API（点语音条合成）</div>
                <select id="uwu-tts-provider" style="width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;background:#fff;font-size:13px;">
                    <option value="fish">Fish Audio</option>
                    <option value="minimax">MiniMax (T2A v2)</option>
                    <option value="elevenlabs">ElevenLabs</option>
                    <option value="custom">OpenAI / 自建兼容接口</option>
                </select>
                <input type="text" id="uwu-tts-groupid" placeholder="MiniMax GroupId（选填）" style="width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;font-size:13px;">
                <input type="password" id="uwu-tts-apikey" placeholder="语音 API Key" style="width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;font-size:13px;">
                <input type="text" id="uwu-tts-endpoint" placeholder="自定义接口 / 跨域反代地址（留空用官方默认）" style="width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;font-size:13px;">
                <button type="button" id="uwu-tts-save-api-btn" class="btn btn-primary" style="width:100%;box-sizing:border-box;padding:8px 12px;font-size:13px;">保存语音 API 设置</button>
            </div>
        `;
        group.parentElement.insertBefore(box, group.nextSibling);

        const provEl = document.getElementById('uwu-tts-provider');
        const keyEl = document.getElementById('uwu-tts-apikey');
        const gidEl = document.getElementById('uwu-tts-groupid');
        const epEl = document.getElementById('uwu-tts-endpoint');
        const saveBtn = document.getElementById('uwu-tts-save-api-btn');

        provEl.value = cfg.provider || 'fish';
        keyEl.value = cfg.apiKey || '';
        gidEl.value = cfg.groupId || '';
        epEl.value = cfg.endpoint || '';

        saveBtn.addEventListener('click', () => {
            saveConfig({
                provider: provEl.value,
                apiKey: keyEl.value.trim(),
                groupId: gidEl.value.trim(),
                endpoint: epEl.value.trim()
            });
            if (typeof window.showToast === 'function') window.showToast('语音 API 设置已保存');
        });
    }

    // 3. 在角色聊天设置 →「功能」标签页注入「专属克隆音色」卡片与音色 ID 设置
    function syncCharVoiceUi() {
        const sw = document.getElementById('setting-voice-tts-enabled');
        const vid = document.getElementById('setting-voice-tts-id');
        const prov = document.getElementById('setting-voice-tts-provider');
        if (!sw || !vid || !prov) return;
        if (typeof currentChatId === 'undefined' || !window.db?.characters) return;
        const ch = window.db.characters.find(c => c.id === currentChatId);
        if (!ch) return;
        sw.checked = ch.voiceTts?.enabled === true;
        vid.value = ch.voiceTts?.voiceId || '';
        prov.value = ch.voiceTts?.provider || '';
    }

    function injectCharVoiceCard() {
        const baseSwitch = document.getElementById('setting-auto-reply-enabled');
        if (!baseSwitch) return;
        if (document.getElementById('setting-voice-tts-enabled')) {
            syncCharVoiceUi();
            return;
        }
        const featureCard = baseSwitch.closest('.feature-card');
        const anchor = featureCard || baseSwitch.closest('.kkt-item');
        if (!anchor || !anchor.parentElement) return;

        const card = document.createElement('div');
        card.className = featureCard ? 'feature-card uwu-voice-tts-card' : 'kkt-item uwu-voice-tts-card';
        card.id = 'voice-tts-setting-card';
        card.style.cssText = 'grid-column: 1 / -1;';
        card.innerHTML = `
            <div class="feature-card-header">
                <div class="feature-card-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                </div>
                <label class="kkt-switch">
                    <input type="checkbox" id="setting-voice-tts-enabled">
                    <span class="kkt-slider"></span>
                </label>
            </div>
            <div class="feature-card-body">
                <div class="feature-card-title">专属克隆音色（点语音条合成）</div>
                <div class="feature-card-desc">开启后点击角色语音条才实时合成播放，同条自动缓存不重复扣费</div>
                <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;width:100%;box-sizing:border-box;">
                    <select id="setting-voice-tts-provider" style="width:100%;box-sizing:border-box;min-width:0;padding:6px 8px;border-radius:6px;border:1px solid #d0d7de;background:#fff;font-size:12px;">
                        <option value="">跟随全局 API</option>
                        <option value="fish">Fish Audio</option>
                        <option value="minimax">MiniMax</option>
                        <option value="elevenlabs">ElevenLabs</option>
                        <option value="custom">OpenAI/自建</option>
                    </select>
                    <div style="display:flex;gap:6px;width:100%;box-sizing:border-box;">
                        <input type="text" id="setting-voice-tts-id" placeholder="填该角色的音色 ID / Reference ID" style="flex:1;min-width:0;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid #d0d7de;font-size:12px;">
                        <button type="button" id="setting-voice-tts-test" style="flex-shrink:0;padding:6px 12px;border-radius:6px;border:1px solid #d0d7de;background:#fff;font-size:12px;cursor:pointer;">试听</button>
                    </div>
                </div>
            </div>
        `;
        anchor.parentElement.insertBefore(card, anchor.nextSibling);

        const sw = document.getElementById('setting-voice-tts-enabled');
        const vid = document.getElementById('setting-voice-tts-id');
        const prov = document.getElementById('setting-voice-tts-provider');
        const testBtn = document.getElementById('setting-voice-tts-test');

        const persistCharVoice = async () => {
            if (typeof currentChatId === 'undefined' || !window.db?.characters) return;
            const ch = window.db.characters.find(c => c.id === currentChatId);
            if (!ch) return;
            ch.voiceTts = {
                ...(ch.voiceTts || {}),
                enabled: sw.checked,
                voiceId: vid.value.trim(),
                provider: prov.value
            };
            if (typeof window.saveData === 'function') await window.saveData();
        };

        sw.addEventListener('change', persistCharVoice);
        vid.addEventListener('change', persistCharVoice);
        prov.addEventListener('change', persistCharVoice);
        testBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await persistCharVoice();
            const ch = (typeof currentChatId !== 'undefined' && window.db?.characters)
                ? window.db.characters.find(c => c.id === currentChatId)
                : null;
            if (!ch) return;
            const sample = `你好呀，我是${ch.remarkName || ch.realName || '你的专属语音'}。`;
            await playVoiceForBubble(testBtn, sample, ch, 'preview_' + ch.id);
        });

        syncCharVoiceUi();
    }

    function observeSettings() {
        const cs = document.getElementById('chat-settings-screen');
        if (cs && !cs.__voiceObserved) {
            cs.__voiceObserved = true;
            new MutationObserver(() => {
                if (!document.getElementById('setting-voice-tts-enabled')) injectCharVoiceCard();
                else if (cs.classList.contains('active')) syncCharVoiceUi();
            }).observe(cs, { childList: true, attributes: true, attributeFilter: ['class'] });
        }
        const api = document.getElementById('api-settings-screen');
        if (api && !api.__voiceObserved) {
            api.__voiceObserved = true;
            new MutationObserver(() => {
                if (api.classList.contains('active')) injectApiVoiceSettings();
            }).observe(api, { attributes: true, attributeFilter: ['class'] });
        }
    }

    // 注入轻微加载与播放中样式
    function injectStyle() {
        if (document.getElementById('uwu-voice-tts-style')) return;
        const st = document.createElement('style');
        st.id = 'uwu-voice-tts-style';
        st.textContent = `
            .voice-bubble.uwu-voice-loading { opacity: 0.7; }
            .voice-bubble.uwu-voice-playing .play-icon { animation: uwuVoicePulse 0.9s infinite ease-in-out; }
            @keyframes uwuVoicePulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.22); } }
        `;
        document.head.appendChild(st);
    }

    if (typeof window.injectChatSettingsHtml === 'function' && !window.injectChatSettingsHtml.__voiceWrapped) {
        const orig = window.injectChatSettingsHtml;
        const wrapped = function () {
            const ret = orig.apply(this, arguments);
            injectCharVoiceCard();
            return ret;
        };
        wrapped.__voiceWrapped = true;
        window.injectChatSettingsHtml = wrapped;
    }


    // 4. 语音/视频通话期间：拦截 getCallReply，收到 AI 回复后自动用该角色专属音色合成并播放
    function extractSpokenForCall(raw) {
        if (typeof raw !== 'string') return '';
        let txt = raw;
        const thinkEnd = txt.lastIndexOf('</thinking>');
        if (thinkEnd !== -1) txt = txt.slice(thinkEnd + 11);
        txt = txt
            .replace(/\[[^\]]*\]/g, ' ')
            .replace(/[（(][^）)]{1,40}[）)]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return txt || raw.replace(/<[^>]+>/g, '').trim();
    }

    async function autoPlayCallVoice(text, chat) {
        if (!chat?.voiceTts?.enabled || !text) return;
        const cfg = loadConfig();
        const provider = chat?.voiceTts?.provider || cfg.provider || 'fish';
        const voiceId = (chat?.voiceTts?.voiceId || '').trim();
        const speed = chat?.voiceTts?.speed || 1.0;
        const cleanSpoken = extractSpokenForCall(text);
        if (!cleanSpoken) return;

        stopCurrentAudio();
        try {
            const cacheKey = `call::${provider}::${voiceId}::${cleanSpoken}`;
            let blobUrl = audioCache.get(cacheKey);
            if (!blobUrl) {
                blobUrl = await synthesizeSpeech({
                    provider,
                    apiKey: (cfg.apiKey || '').trim(),
                    groupId: (cfg.groupId || '').trim(),
                    endpoint: (cfg.endpoint || '').trim(),
                    voiceId,
                    text: cleanSpoken,
                    speed
                });
                audioCache.set(cacheKey, blobUrl);
            }
            const audio = new Audio(blobUrl);
            currentAudio = audio;
            audio.onended = () => { if (currentAudio === audio) stopCurrentAudio(); };
            audio.onerror = () => { if (currentAudio === audio) stopCurrentAudio(); };
            await audio.play();
        } catch (err) {
            console.warn('[VoiceTTS Call]', err);
        }
    }

    function hookCallReply() {
        if (typeof window.getCallReply !== 'function' || window.getCallReply.__voiceCallWrapped) return;
        const origGetCallReply = window.getCallReply;
        const wrapped = async function (chat, callType, callContext, onStreamUpdate) {
            const result = await origGetCallReply.apply(this, arguments);
            if (typeof result === 'string' && result.trim() && chat?.voiceTts?.enabled) {
                autoPlayCallVoice(result, chat).catch(() => {});
            }
            return result;
        };
        wrapped.__voiceCallWrapped = true;
        window.getCallReply = wrapped;
    }

    // 挂断通话时立刻停止正在播放的语音
    if (!document.__uwuVoiceEndCallBound) {
        document.__uwuVoiceEndCallBound = true;
        document.addEventListener('click', (e) => {
            if (e.target?.closest?.('#vc-end-btn, .vc-end-btn, [data-action="end-call"]')) {
                stopCurrentAudio();
            }
        });
    }

    function bootstrap() {
        injectStyle();
        bindVoiceBubbleClicks();
        hookCallReply();
        observeSettings();
        injectApiVoiceSettings();
        injectCharVoiceCard();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            bootstrap();
            let tries = 0;
            const t = setInterval(() => {
                tries++;
                bootstrap();
                if (document.getElementById('setting-voice-tts-enabled') || tries >= 40) clearInterval(t);
            }, 500);
        });
    } else {
        bootstrap();
    }

    window.VoiceTtsPlugin = { loadConfig, saveConfig, synthesizeSpeech, playVoiceForBubble, autoPlayCallVoice, stopCurrentAudio, bootstrap };
})();