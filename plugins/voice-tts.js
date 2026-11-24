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
    const IDB_NAME = 'uwu_voice_tts_db';
    const IDB_STORE = 'audio_blobs';
    let voiceDbPromise = null;
    const pendingAudio = new Map();
    const PREVIEW_TEXT = '你好，这是一条语音试听。';

    function openVoiceDb() {
        if (voiceDbPromise) return voiceDbPromise;
        voiceDbPromise = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') return resolve(null);
            try {
                const req = indexedDB.open(IDB_NAME, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(IDB_STORE)) {
                        db.createObjectStore(IDB_STORE);
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
        return voiceDbPromise;
    }

    async function getSavedAudioBlob(key) {
        try {
            const db = await openVoiceDb();
            if (!db) return null;
            return await new Promise((resolve) => {
                const tx = db.transaction(IDB_STORE, 'readonly');
                const req = tx.objectStore(IDB_STORE).get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch (e) {
            return null;
        }
    }

    async function saveAudioBlob(key, blob) {
        if (!blob) return;
        try {
            const db = await openVoiceDb();
            if (!db) return;
            await new Promise((resolve) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                tx.objectStore(IDB_STORE).put(blob, key);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch (e) {}
    }

    function getVoiceCacheKey(chatId, msgId, text) {
        if (msgId) return `msg::${chatId || ''}::${msgId}`;
        return `txt::${chatId || ''}::${(text || '').trim()}`;
    }
    let currentAudio = null;
    let currentBubbleEl = null;
    let playbackVersion = 0;

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
        localStorage.setItem(CFG_KEY, JSON.stringify(next));
        return next;
    }

    function stopCurrentAudio() {
        playbackVersion++;
        if (currentAudio) {
            try { currentAudio.pause(); currentAudio.currentTime = 0; } catch (e) {}
            currentAudio = null;
        }
        if (currentBubbleEl) {
            currentBubbleEl.classList.remove('uwu-voice-playing', 'uwu-voice-loading');
            currentBubbleEl = null;
        }
    }

    function resolveMiniMaxEndpoint(endpoint, groupId) {
        const input = (endpoint || '').trim() || 'https://api.minimax.io';
        let url;
        try {
            url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
        } catch {
            throw new Error('MiniMax 接口地址无效，请填写域名或完整的 HTTP(S) 接口地址');
        }
        if (url.pathname === '/') url.pathname = '/v1/t2a_v2';
        if (groupId && !url.searchParams.has('GroupId')) url.searchParams.set('GroupId', groupId);
        url.hash = '';
        return url.href;
    }

    function miniMaxApiError(response) {
        const code = Number(response?.base_resp?.status_code);
        if (code === 1004) return new Error('MiniMax 鉴权失败（1004），请检查 API Key、地址和 GroupId');
        if (Number.isFinite(code) && code !== 0) {
            const detail = String(response.base_resp.status_msg || '').trim().slice(0, 120);
            return new Error(`MiniMax 接口报错（${code}）${detail ? '：' + detail : ''}`);
        }
        return null;
    }

    async function synthesizeSpeech({ provider, apiKey, groupId, endpoint, model, voiceId, text, speed = 1.0, pitch = 0, emotion = '', stylePrefix = '' }) {
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
            url = resolveMiniMaxEndpoint(endpoint, groupId);
            headers['Authorization'] = `Bearer ${apiKey}`;
            const prefix = (stylePrefix || '').trim();
            const spokenText = prefix ? `${prefix} ${cleanText}` : cleanText;
            const voiceSetting = {
                voice_id: voiceId,
                speed: Math.max(0.5, Math.min(2.0, Number(speed) || 1.0)),
                vol: 1,
                pitch: Math.max(-12, Math.min(12, Math.round(Number(pitch) || 0)))
            };
            if (emotion && String(emotion).trim()) {
                voiceSetting.emotion = String(emotion).trim();
            }
            body = {
                model: (model || '').trim() || 'speech-2.8-hd',
                text: spokenText,
                stream: false,
                output_format: 'hex',
                voice_setting: voiceSetting,
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
        } else if (provider === 'siliconflow') {
            url = (endpoint || '').trim() || 'https://api.siliconflow.cn/v1/audio/speech';
            headers['Authorization'] = `Bearer ${apiKey}`;
            const sfModel = (model || '').trim() || 'FunAudioLLM/CosyVoice2-0.5B';
            body = {
                model: sfModel,
                input: cleanText,
                voice: voiceId || `${sfModel}:alex`,
                speed: Number(speed) || 1.0,
                response_format: 'mp3'
            };
        } else {
            // openai 或自定义兼容 /v1/audio/speech 接口
            url = (endpoint || '').trim() || 'https://api.openai.com/v1/audio/speech';
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            body = {
                model: (model || '').trim() || 'tts-1',
                input: cleanText,
                voice: voiceId || 'alloy',
                speed: Number(speed) || 1.0,
                response_format: 'mp3'
            };
        }

        let resp;
        try {
            resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        } catch (error) {
            throw new Error('无法连接语音接口。请检查地址、网络或浏览器跨域设置', { cause: error });
        }

        if (resp.status === 401 || resp.status === 403) {
            throw new Error(`语音接口鉴权失败（HTTP ${resp.status}），请检查 Key 和账号权限`);
        }
        if (!resp.ok) {
            const detail = await resp.text().catch(() => '');
            throw new Error(`语音接口报错（HTTP ${resp.status}）${detail ? '：' + detail.slice(0, 120) : ''}`);
        }

        const contentType = (resp.headers.get('content-type') || '').toLowerCase();
        const isAudio = contentType.startsWith('audio/') || contentType.includes('application/octet-stream');
        if (contentType.includes('json') || (provider === 'minimax' && !isAudio)) {
            const json = await resp.json().catch(() => null);
            if (provider === 'minimax') {
                const apiError = miniMaxApiError(json);
                if (apiError) throw apiError;
            }
            const hex = json?.data?.audio;
            if (typeof hex === 'string' && hex.length % 2 === 0 && /^[a-f0-9]+$/i.test(hex)) {
                const bytes = new Uint8Array(hex.length / 2);
                for (let i = 0; i < bytes.length; i++) {
                    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
                }
                return new Blob([bytes], { type: 'audio/mpeg' });
            }
            const detail = json?.error?.message || json?.message;
            throw new Error(`接口未返回可播放的音频${detail ? '：' + String(detail).slice(0, 120) : ''}`);
        }

        const blob = await resp.blob();
        if (!blob.size || contentType.startsWith('text/')) throw new Error('接口未返回可播放的音频');
        return blob;
    }

    function getBubbleAudioUrl(cacheKey, options, forceRegenerate) {
        const pending = pendingAudio.get(cacheKey);
        if (pending) {
            if (!forceRegenerate || pending.forceRegenerate) return pending.promise;
            return pending.promise.catch(() => {}).then(() => getBubbleAudioUrl(cacheKey, options, true));
        }
        const cachedUrl = audioCache.get(cacheKey);
        if (!forceRegenerate && cachedUrl) return Promise.resolve(cachedUrl);

        const promise = (async () => {
            const savedAudio = forceRegenerate ? null : await getSavedAudioBlob(cacheKey);
            const audio = savedAudio || await synthesizeSpeech(options);
            if (!savedAudio) await saveAudioBlob(cacheKey, audio);
            const url = URL.createObjectURL(audio);
            if (cachedUrl) URL.revokeObjectURL(cachedUrl);
            audioCache.set(cacheKey, url);
            return url;
        })().finally(() => pendingAudio.delete(cacheKey));
        pendingAudio.set(cacheKey, { promise, forceRegenerate });
        return promise;
    }

    async function playVoiceForBubble(bubbleEl, text, chat, msgId, { forceRegenerate = false, cfg = loadConfig() } = {}) {
        if (!forceRegenerate && currentBubbleEl === bubbleEl && currentAudio) {
            stopCurrentAudio();
            return;
        }
        stopCurrentAudio();
        const version = playbackVersion;
        const voice = chat?.voiceTts || {};
        const cacheKey = getVoiceCacheKey(chat?.id, msgId, text);

        try {
            currentBubbleEl = bubbleEl;
            bubbleEl.classList.add('uwu-voice-loading');
            const blobUrl = await getBubbleAudioUrl(cacheKey, {
                provider: voice.provider || cfg.provider || 'siliconflow',
                apiKey: (cfg.apiKey || '').trim(),
                groupId: (cfg.groupId || '').trim(),
                endpoint: (cfg.endpoint || '').trim(),
                model: (cfg.model || '').trim(),
                voiceId: (voice.voiceId || '').trim(),
                text,
                speed: voice.speed ?? 1.0,
                pitch: voice.pitch ?? 0,
                emotion: (voice.emotion || '').trim(),
                stylePrefix: (voice.stylePrefix || '').trim()
            }, forceRegenerate);

            if (version !== playbackVersion) return;
            bubbleEl.classList.remove('uwu-voice-loading');
            bubbleEl.classList.add('uwu-voice-playing');
            const audio = new Audio(blobUrl);
            currentAudio = audio;
            audio.onended = () => {
                if (currentAudio === audio) stopCurrentAudio();
            };
            audio.onerror = () => {
                if (currentAudio === audio) {
                    stopCurrentAudio();
                    window.showToast?.('音频播放失败');
                }
            };
            await audio.play();
            return true;
        } catch (error) {
            if (version === playbackVersion) {
                stopCurrentAudio();
                console.error('[VoiceTTS]', error);
                window.showToast?.(error.name === 'NotAllowedError' ? '音频已就绪，请再点一次播放' : (error.message || '语音合成失败'));
            }
            return false;
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

    // 2. 在 API 设置页面注入全局「专属语音合成 API」配置面板（支持硅基流动与拉取模型）
    function resolveModelsUrl(rawEndpoint, provider) {
        const ep = (rawEndpoint || '').trim();
        if (ep) {
            if (/\/models(\?|$)/.test(ep)) return ep;
            if (/\/v1\//.test(ep)) return ep.replace(/\/v1\/.*$/, '/v1/models');
            return ep.replace(/\/$/, '') + '/v1/models';
        }
        if (provider === 'siliconflow') return 'https://api.siliconflow.cn/v1/models?sub_type=text-to-speech';
        if (provider === 'custom') return ((window.db?.apiSettings?.url || 'https://api.openai.com').replace(/\/$/, '').replace(/\/v1$/, '')) + '/v1/models';
        return '';
    }

    async function fetchTtsModels(provider, endpoint, apiKey) {
        if (provider === 'minimax') {
            // MiniMax 官方 /v1/models 只返回 M 系列文本模型、不列语音模型；直接返回官方 Speech 全系模型
            return ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo', 'speech-02-hd', 'speech-02-turbo'];
        }
        const url = resolveModelsUrl(endpoint, provider);
        if (!url) throw new Error('该平台使用固定音色接口，请直接在角色设置填写音色 ID，或填入自定义接口地址后拉取');
        const headers = {};
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        const resp = await fetch(url, { headers });
        if (!resp.ok) throw new Error(`拉取模型失败 (${resp.status})`);
        const data = await resp.json();
        const rawList = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
        const ids = rawList.map(m => typeof m === 'string' ? m : (m?.id || m?.name || '')).filter(Boolean);
        // 将语音/TTS 相关模型优先排在最前面
        const audioRe = /tts|speech|voice|audio|cosy|fish|moss|kokoro|bark|chattts|f5/i;
        ids.sort((a, b) => (audioRe.test(b) ? 1 : 0) - (audioRe.test(a) ? 1 : 0));
        return [...new Set(ids)];
    }

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
                <div class="kkt-item-title">角色语音合成</div>
                <select id="uwu-tts-provider" style="width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;background:#fff;font-size:13px;">
                    <option value="siliconflow">硅基流动 (SiliconFlow)</option>
                    <option value="fish">Fish Audio</option>
                    <option value="minimax">MiniMax (T2A v2)</option>
                    <option value="elevenlabs">ElevenLabs</option>
                    <option value="custom">OpenAI / 自建兼容接口</option>
                </select>
                <input type="text" id="uwu-tts-groupid" placeholder="MiniMax GroupId（仅 MiniMax 选填）" style="width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;font-size:13px;">
                <input type="password" id="uwu-tts-apikey" placeholder="语音 API Key" style="width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;font-size:13px;">
                <input type="text" id="uwu-tts-endpoint" placeholder="自定义接口 / 跨域反代地址（留空用官方默认）" style="width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;font-size:13px;">
                <div style="display:flex;gap:6px;width:100%;box-sizing:border-box;">
                    <input type="text" id="uwu-tts-model" placeholder="语音合成模型名（如 FunAudioLLM/CosyVoice2-0.5B）" style="flex:1;min-width:0;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;font-size:13px;">
                    <button type="button" id="uwu-tts-fetch-models-btn" style="flex-shrink:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;background:#fff;font-size:12px;cursor:pointer;">拉取模型</button>
                </div>
                <select id="uwu-tts-model-select" style="display:none;width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #d0d7de;background:#f8fafc;font-size:13px;"></select>
                <div id="uwu-tts-preview-fields" hidden>
                    <label for="uwu-tts-preview-voice">MiniMax 试听音色 ID</label>
                    <div style="display:flex;gap:6px;margin-top:6px;">
                        <input type="text" id="uwu-tts-preview-voice" placeholder="填入你的角色音色 ID" style="flex:1;min-width:0;padding:8px;border:1px solid #d0d7de;border-radius:8px;font-size:13px;">
                        <button type="button" id="uwu-tts-preview-btn" style="flex-shrink:0;padding:8px 10px;border:1px solid #d0d7de;border-radius:8px;background:#fff;">保存并试听</button>
                    </div>
                </div>
                <button type="button" id="uwu-tts-save-api-btn" class="btn btn-primary" style="width:100%;box-sizing:border-box;padding:8px 12px;font-size:13px;">保存语音 API 设置</button>
            </div>
        `;
        const slot = document.getElementById('api-tts-settings-slot');
        if (slot) slot.appendChild(box);
        else group.parentElement.insertBefore(box, group.nextSibling);

        const provEl = document.getElementById('uwu-tts-provider');
        const keyEl = document.getElementById('uwu-tts-apikey');
        const gidEl = document.getElementById('uwu-tts-groupid');
        const epEl = document.getElementById('uwu-tts-endpoint');
        const modelEl = document.getElementById('uwu-tts-model');
        const fetchBtn = document.getElementById('uwu-tts-fetch-models-btn');
        const modelSel = document.getElementById('uwu-tts-model-select');
        const saveBtn = document.getElementById('uwu-tts-save-api-btn');
        const previewFields = document.getElementById('uwu-tts-preview-fields');
        const previewVoice = document.getElementById('uwu-tts-preview-voice');
        const previewBtn = document.getElementById('uwu-tts-preview-btn');

        provEl.value = cfg.provider || 'siliconflow';
        keyEl.value = cfg.apiKey || '';
        gidEl.value = cfg.groupId || '';
        epEl.value = cfg.endpoint || '';
        modelEl.value = cfg.model || '';

        const syncProviderUi = () => {
            const isMiniMax = provEl.value === 'minimax';
            gidEl.style.display = isMiniMax ? 'block' : 'none';
            previewFields.hidden = !isMiniMax;
            epEl.placeholder = isMiniMax ? 'MiniMax 域名或完整语音接口地址' : '自定义接口 / 跨域反代地址（留空用官方默认）';
            if (provEl.value === 'minimax') {
                modelEl.placeholder = '语音合成模型名（默认 speech-2.8-hd）';
            } else if (provEl.value === 'siliconflow') {
                modelEl.placeholder = '语音合成模型名（如 FunAudioLLM/CosyVoice2-0.5B）';
            } else {
                modelEl.placeholder = '语音合成模型名（可选）';
            }
        };
        provEl.addEventListener('change', syncProviderUi);
        syncProviderUi();

        modelSel.addEventListener('change', () => {
            if (modelSel.value) modelEl.value = modelSel.value;
        });

        fetchBtn.addEventListener('click', async () => {
            fetchBtn.disabled = true;
            fetchBtn.textContent = '拉取中…';
            try {
                const list = await fetchTtsModels(provEl.value, epEl.value, keyEl.value.trim());
                if (!list.length) throw new Error('接口未返回任何可用模型');
                modelSel.innerHTML = '<option value="">-- 请选择拉取到的语音模型 --</option>' + list.map(m => `<option value="${m.replace(/"/g, '&quot;')}">${m}</option>`).join('');
                modelSel.style.display = 'block';
                if (modelEl.value && list.includes(modelEl.value)) modelSel.value = modelEl.value;
                if (typeof window.showToast === 'function') window.showToast(`已拉取 ${list.length} 个模型`);
            } catch (err) {
                if (typeof window.showToast === 'function') window.showToast(err.message || '拉取模型失败');
            } finally {
                fetchBtn.disabled = false;
                fetchBtn.textContent = '拉取模型';
            }
        });

        const readApiSettings = () => ({
            provider: provEl.value,
            apiKey: keyEl.value.trim(),
            groupId: gidEl.value.trim(),
            endpoint: epEl.value.trim(),
            model: modelEl.value.trim()
        });

        const saveApiSettings = settings => {
            try {
                saveConfig(settings);
                window.showToast?.('语音 API 设置已保存，可在角色页使用');
            } catch (error) {
                console.warn('[VoiceTTS] Could not save API settings:', error.name);
                window.showToast?.('浏览器未能保存语音 API 设置');
            }
        };
        saveBtn.addEventListener('click', () => saveApiSettings(readApiSettings()));

        previewBtn.addEventListener('click', async () => {
            const voiceId = previewVoice.value.trim();
            if (!voiceId) {
                window.showToast?.('请填写要试听的音色 ID');
                return;
            }
            const settings = readApiSettings();
            previewBtn.disabled = true;
            previewBtn.textContent = '合成中…';
            try {
                const played = await playVoiceForBubble(previewBtn, PREVIEW_TEXT, {
                    voiceTts: { voiceId }
                }, 'api_minimax_preview', { forceRegenerate: true, cfg: settings });
                if (!played) return;
                const current = readApiSettings();
                if (Object.keys(settings).every(key => settings[key] === current[key])) saveApiSettings(settings);
                else window.showToast?.('试听期间配置有改动，请重新保存');
            } finally {
                previewBtn.disabled = false;
                previewBtn.textContent = '保存并试听';
            }
        });
    }

    // 3. 在角色聊天设置 →「功能」标签页注入「专属克隆音色」卡片与音色 ID 设置
    function syncCharVoiceUi() {
        const sw = document.getElementById('setting-voice-tts-enabled');
        const vid = document.getElementById('setting-voice-tts-id');
        const prov = document.getElementById('setting-voice-tts-provider');
        const spd = document.getElementById('setting-voice-tts-speed');
        const spdVal = document.getElementById('setting-voice-tts-speed-val');
        const pit = document.getElementById('setting-voice-tts-pitch');
        const pitVal = document.getElementById('setting-voice-tts-pitch-val');
        const emo = document.getElementById('setting-voice-tts-emotion');
        const sty = document.getElementById('setting-voice-tts-style');
        if (!sw || !vid || !prov) return;
        if (typeof currentChatId === 'undefined' || !window.db?.characters) return;
        const ch = window.db.characters.find(c => c.id === currentChatId);
        if (!ch) return;
        sw.checked = ch.voiceTts?.enabled === true;
        vid.value = ch.voiceTts?.voiceId || '';
        prov.value = ch.voiceTts?.provider || '';
        const speedNum = Number(ch.voiceTts?.speed ?? 1.0);
        const pitchNum = Math.round(Number(ch.voiceTts?.pitch ?? 0));
        if (spd) spd.value = String(speedNum);
        if (spdVal) spdVal.textContent = `${speedNum.toFixed(2)}x`;
        if (pit) pit.value = String(pitchNum);
        if (pitVal) pitVal.textContent = pitchNum > 0 ? `+${pitchNum}` : String(pitchNum);
        if (emo) emo.value = ch.voiceTts?.emotion || '';
        if (sty) sty.value = ch.voiceTts?.stylePrefix || '';
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
                        <option value="siliconflow">硅基流动</option>
                        <option value="fish">Fish Audio</option>
                        <option value="minimax">MiniMax</option>
                        <option value="elevenlabs">ElevenLabs</option>
                        <option value="custom">OpenAI/自建</option>
                    </select>
                    <div style="display:flex;gap:6px;width:100%;box-sizing:border-box;">
                        <input type="text" id="setting-voice-tts-id" placeholder="填该角色的音色 ID / Reference ID" style="flex:1;min-width:0;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid #d0d7de;font-size:12px;">
                        <button type="button" id="setting-voice-tts-test" style="flex-shrink:0;padding:6px 12px;border-radius:6px;border:1px solid #d0d7de;background:#fff;font-size:12px;cursor:pointer;">试听</button>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;font-size:12px;color:#555;">
                        <span style="flex-shrink:0;">语速</span>
                        <input type="range" id="setting-voice-tts-speed" min="0.5" max="1.6" step="0.05" value="1.0" style="flex:1;min-width:0;">
                        <span id="setting-voice-tts-speed-val" style="width:42px;text-align:right;font-variant-numeric:tabular-nums;">1.00x</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;font-size:12px;color:#555;">
                        <span style="flex-shrink:0;">音调</span>
                        <input type="range" id="setting-voice-tts-pitch" min="-12" max="12" step="1" value="0" style="flex:1;min-width:0;">
                        <span id="setting-voice-tts-pitch-val" style="width:42px;text-align:right;font-variant-numeric:tabular-nums;">0</span>
                    </div>
                    <select id="setting-voice-tts-emotion" style="width:100%;box-sizing:border-box;min-width:0;padding:6px 8px;border-radius:6px;border:1px solid #d0d7de;background:#fff;font-size:12px;">
                        <option value="">默认情绪（MiniMax 自然发挥）</option>
                        <option value="happy">轻快带笑意 (happy)</option>
                        <option value="calm">松弛沉稳 (calm)</option>
                        <option value="fluent">自然流畅口语 (fluent · 2.6/2.8)</option>
                        <option value="whisper">轻微低语贴耳 (whisper · 2.6/2.8)</option>
                        <option value="sad">温柔低落 (sad)</option>
                        <option value="surprised">惊喜活泼 (surprised)</option>
                        <option value="angry">傲娇生气 (angry)</option>
                    </select>
                    <input type="text" id="setting-voice-tts-style" placeholder="隐藏语气/气口前缀（仅语音生效，如 (chuckle) 或 (sighs)）" style="width:100%;box-sizing:border-box;min-width:0;padding:6px 8px;border-radius:6px;border:1px solid #d0d7de;font-size:12px;">
                </div>
            </div>
        `;
        anchor.parentElement.insertBefore(card, anchor.nextSibling);

        const sw = document.getElementById('setting-voice-tts-enabled');
        const vid = document.getElementById('setting-voice-tts-id');
        const prov = document.getElementById('setting-voice-tts-provider');
        const spd = document.getElementById('setting-voice-tts-speed');
        const spdVal = document.getElementById('setting-voice-tts-speed-val');
        const pit = document.getElementById('setting-voice-tts-pitch');
        const pitVal = document.getElementById('setting-voice-tts-pitch-val');
        const emo = document.getElementById('setting-voice-tts-emotion');
        const sty = document.getElementById('setting-voice-tts-style');
        const testBtn = document.getElementById('setting-voice-tts-test');

        const persistCharVoice = async () => {
            if (typeof currentChatId === 'undefined' || !window.db?.characters) return;
            const ch = window.db.characters.find(c => c.id === currentChatId);
            if (!ch) return;
            const speedNum = Number(spd?.value ?? 1.0);
            const pitchNum = Math.round(Number(pit?.value ?? 0));
            if (spdVal) spdVal.textContent = `${speedNum.toFixed(2)}x`;
            if (pitVal) pitVal.textContent = pitchNum > 0 ? `+${pitchNum}` : String(pitchNum);
            ch.voiceTts = {
                ...(ch.voiceTts || {}),
                enabled: sw.checked,
                voiceId: vid.value.trim(),
                provider: prov.value,
                speed: speedNum,
                pitch: pitchNum,
                emotion: emo?.value || '',
                stylePrefix: (sty?.value || '').trim()
            };
            await window.saveSingleChatFast(ch, 'private');
            return ch;
        };

        sw.addEventListener('change', persistCharVoice);
        vid.addEventListener('change', persistCharVoice);
        prov.addEventListener('change', persistCharVoice);
        if (spd) {
            spd.addEventListener('input', () => { if (spdVal) spdVal.textContent = `${Number(spd.value).toFixed(2)}x`; });
            spd.addEventListener('change', persistCharVoice);
        }
        if (pit) {
            pit.addEventListener('input', () => {
                const v = Math.round(Number(pit.value));
                if (pitVal) pitVal.textContent = v > 0 ? `+${v}` : String(v);
            });
            pit.addEventListener('change', persistCharVoice);
        }
        if (emo) emo.addEventListener('change', persistCharVoice);
        if (sty) sty.addEventListener('change', persistCharVoice);
        testBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const ch = await persistCharVoice();
            if (!ch || ch.id !== currentChatId) return;
            await playVoiceForBubble(testBtn, PREVIEW_TEXT, ch, 'preview_' + ch.id, { forceRegenerate: true });
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
        const speed = chat?.voiceTts?.speed ?? 1.0;
        const pitch = chat?.voiceTts?.pitch ?? 0;
        const emotion = (chat?.voiceTts?.emotion || '').trim();
        const stylePrefix = (chat?.voiceTts?.stylePrefix || '').trim();
        const cleanSpoken = extractSpokenForCall(text);
        if (!cleanSpoken) return;

        stopCurrentAudio();
        try {
            const cacheKey = `call::${provider}::${voiceId}::${cleanSpoken}`;
            let blobUrl = audioCache.get(cacheKey);
            if (!blobUrl) {
                const callBlob = await synthesizeSpeech({
                    provider,
                    apiKey: (cfg.apiKey || '').trim(),
                    groupId: (cfg.groupId || '').trim(),
                    endpoint: (cfg.endpoint || '').trim(),
                    model: (cfg.model || '').trim(),
                    voiceId,
                    text: cleanSpoken,
                    speed,
                    pitch,
                    emotion,
                    stylePrefix
                });
                blobUrl = callBlob instanceof Blob ? URL.createObjectURL(callBlob) : callBlob;
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


    // 长按角色语音条菜单注入「重新生成语音」选项（未手动重生成时永久复用本地保存的音频）
    let activeLongPressVoiceCtx = null;

    function hookVoiceLongPressMenu() {
        if (typeof window.handleMessageLongPress === 'function' && !window.handleMessageLongPress.__uwuVoiceWrapped) {
            const origLongPress = window.handleMessageLongPress;
            const wrapped = function (messageWrapper, x, y) {
                activeLongPressVoiceCtx = null;
                try {
                    if (
                        messageWrapper &&
                        !messageWrapper.classList.contains('sent') &&
                        typeof currentChatType !== 'undefined' && currentChatType === 'private' &&
                        typeof currentChatId !== 'undefined' && window.db?.characters
                    ) {
                        const bubble = messageWrapper.querySelector('.voice-bubble');
                        const transcript = messageWrapper.querySelector('.voice-transcript');
                        const text = (transcript?.textContent || '').trim();
                        const chat = window.db.characters.find(c => c.id === currentChatId);
                        if (bubble && text && chat?.voiceTts?.enabled) {
                            activeLongPressVoiceCtx = {
                                bubble,
                                text,
                                chat,
                                msgId: messageWrapper.dataset?.id || ''
                            };
                        }
                    }
                } catch (e) {}
                const ret = origLongPress.apply(this, arguments);
                activeLongPressVoiceCtx = null;
                return ret;
            };
            wrapped.__uwuVoiceWrapped = true;
            window.handleMessageLongPress = wrapped;
        }

        if (typeof window.createContextMenu === 'function' && !window.createContextMenu.__uwuVoiceWrapped) {
            const origCreateMenu = window.createContextMenu;
            const wrappedMenu = function (menuItems, x, y) {
                if (activeLongPressVoiceCtx && Array.isArray(menuItems)) {
                    const ctx = activeLongPressVoiceCtx;
                    const alreadyHas = menuItems.some(it => it && it.label === '重新生成语音');
                    if (!alreadyHas) {
                        menuItems = [
                            {
                                label: '重新生成语音',
                                action: () => {
                                    if (typeof window.showToast === 'function') window.showToast('正在重新生成这条语音…');
                                    playVoiceForBubble(ctx.bubble, ctx.text, ctx.chat, ctx.msgId, { forceRegenerate: true });
                                }
                            },
                            ...menuItems
                        ];
                    }
                }
                return origCreateMenu.call(this, menuItems, x, y);
            };
            wrappedMenu.__uwuVoiceWrapped = true;
            window.createContextMenu = wrappedMenu;
        }
    }

    function bootstrap() {
        injectStyle();
        bindVoiceBubbleClicks();
        hookVoiceLongPressMenu();
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