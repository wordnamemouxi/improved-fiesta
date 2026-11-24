/**
 * OS Notification Plugin (plugins/os-notify.js)
 * 独立的手机系统级通知模块（与智慧主动消息排程解耦，方便后续单独维护）
 *
 * 功能：
 * 1. 仅在网页处于后台/切出/锁屏时弹出系统通知；只要停留在网页内任意界面，彻底不弹。
 * 2. 按本次新生成的角色气泡逐条独立推送（间隔 1.8s ~ 4.2s 模拟真人打字节奏），切回网页立即中止后续队列。
 * 3. 严格过滤思维链、系统消息、拍一拍系统动作与状态栏消息（含角色自定义状态栏正则）。
 * 4. 不附带右侧头像图标，点击通知直达对应角色聊天室。
 */
(() => {
    if (window.__uwuOsNotifyLoaded) return;
    window.__uwuOsNotifyLoaded = true;

    const savingPreferenceIds = new Set();
    const lastNotifyDedup = new Map();
    let notifySeq = 0;
    let testNotifyInFlight = false;

    function isWebPageInForeground() {
        try {
            if (document.visibilityState === 'visible') return true;
        } catch (e) {}
        return false;
    }

    function stripStatusPanelText(txt, chat) {
        if (!txt || !chat?.statusPanel?.enabled || !chat.statusPanel.regexPattern) return txt;
        try {
            let pattern = String(chat.statusPanel.regexPattern).trim();
            let flags = 'gs';
            const slashMatch = pattern.match(/^\/([\s\S]+)\/([gimsuy]*)$/);
            if (slashMatch) {
                pattern = slashMatch[1];
                flags = slashMatch[2].includes('g') ? slashMatch[2] : (slashMatch[2] + 'g');
            }
            const re = new RegExp(pattern, flags);
            return txt.replace(re, '');
        } catch (e) {
            return txt;
        }
    }

    function extractCleanPreview(rawText, chat) {
        if (typeof rawText !== 'string') return '';
        let txt = rawText.trim();
        if (!txt) return '';

        // 0. 整条就是系统消息/私聊监控/撤回提示的，直接丢弃不弹通知
        if (/^\[(?:system(?:-display)?|系统动作|系统提示|系统消息|Private|Private-End)[：:\s]/i.test(txt)) return '';
        if (/^\[[^\]]*?(?:更新状态为|更新状态|状态栏|当前状态|撤回了一条消息|withdrew a message)[：:\s]/i.test(txt)) return '';

        // 1. 剥离思考过程与各类隐藏 XML/HTML 状态栏块（含角色自定义状态栏正则）
        txt = txt.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
        const thinkEnd = txt.lastIndexOf('</thinking>');
        if (thinkEnd !== -1) txt = txt.slice(thinkEnd + 11);
        txt = txt.replace(/<(?:status|state|stat|status_bar|statusbar|panel|memory|meta)[^>]*>[\s\S]*?<\/(?:status|state|stat|status_bar|statusbar|panel|memory|meta)>/gi, '');
        txt = stripStatusPanelText(txt, chat);

        // 2. 剥离所有隐藏/状态栏/系统指令标签
        txt = txt
            .replace(/\[NEXT_PING:[^\]]+\]/gi, '')
            .replace(/\[SET_POKE:[^\]]+\]/gi, '')
            .replace(/\[CHANGE_AVATAR:[^\]]+\]/gi, '')
            .replace(/\[POKE_USER(?::[^\]]*)?\]/gi, '')
            .replace(/\[system(?:-display)?:[^\]]*\]/gi, '')
            .replace(/\[系统动作[：:][^\]]*\]/g, '')
            .replace(/\[[^\]]*?(?:更新状态为|更新状态|状态栏|当前状态)[：:][^\]]*\]/gi, '')
            .replace(/\[[^\]]*?(?:接收|退回)[^\]]*?的转账\]/g, '')
            .replace(/\[[^\]]*?已接收礼物\]/g, '')
            .replace(/\[[^\]]*?邀请[^\]]*?加入了群聊\]/g, '')
            .replace(/\[[^\]]*?修改群名为[：:][^\]]*\]/g, '');

        // 3. 把单条可见聊天消息转为干净文本（普通消息/语音/照片/表情/转账/礼物）
        txt = txt
            .replace(/\[[^\]]*?的语音[：:]([^\]]+)\]/g, '[语音] $1')
            .replace(/\[[^\]]*?发来的照片\/视频[：:][^\]]*\]/g, '[照片/视频]')
            .replace(/\[[^\]]*?(?:的表情包|发送的表情包)[：:][^\]]*\]/g, '[表情包]')
            .replace(/\[[^\]]*?的转账[：:]([^；;\]]+)(?:[；;][^\]]*)?\]/g, '[转账] $1')
            .replace(/\[[^\]]*?送来的礼物[：:][^\]]*\]/g, '[礼物]')
            .replace(/\[[^\]]*?(?:的消息|并回复|回复)[：:]([\s\S]*?)\]/g, '$1')
            .replace(/\s+/g, ' ')
            .trim();

        if (!txt) return '';
        return txt.length > 120 ? txt.slice(0, 120) + '…' : txt;
    }

    function extractMessagePreviewList(newMessages, chat) {
        const list = [];
        if (!Array.isArray(newMessages)) return list;
        for (const msg of newMessages) {
            if (!msg) continue;
            if (msg.role !== 'assistant') continue;
            if (msg.isThinking || msg.isStatusUpdate || msg.isSystem || msg.isHidden || msg.isWithdrawn) continue;
            const raw = typeof msg.content === 'string' ? msg.content : '';
            const preview = extractCleanPreview(raw, chat);
            if (preview) {
                list.push({ id: msg.id || '', text: preview });
            }
        }
        return list;
    }

    function navigateToChatSafe(chatId, chatType = 'private') {
        if (!chatId) return;
        try {
            if (typeof currentChatId !== 'undefined') currentChatId = chatId;
        } catch (e) {}
        try {
            if (typeof currentChatType !== 'undefined') currentChatType = chatType;
        } catch (e) {}
        window.currentChatId = chatId;
        window.currentChatType = chatType;
        try {
            const sidebar = document.getElementById('chat-settings-sidebar');
            if (sidebar) sidebar.classList.remove('open');
        } catch (e) {}
        if (typeof window.openChatRoom === 'function') {
            window.openChatRoom(chatId, chatType);
        }
        try {
            if (typeof window.switchScreen === 'function') {
                window.switchScreen('chat-room-screen');
            } else {
                document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
                const cr = document.getElementById('chat-room-screen');
                if (cr) cr.classList.add('active');
            }
        } catch (e) {}
    }

    async function getActiveSwRegistration() {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
        try {
            let reg = await navigator.serviceWorker.getRegistration('./').catch(() => null);
            if (!reg) reg = await navigator.serviceWorker.getRegistration().catch(() => null);
            if (!reg) {
                reg = await navigator.serviceWorker.register('./sw.js').catch(() => null);
            }
            if (reg && reg.active) return reg;
            const readyReg = await Promise.race([
                navigator.serviceWorker.ready.catch(() => null),
                new Promise(res => setTimeout(() => res(null), 3500))
            ]);
            if (readyReg && readyReg.active) return readyReg;
            return reg && reg.active ? reg : null;
        } catch (e) {
            return null;
        }
    }

    async function deliverNotificationSafe(title, opts, chatId = '') {
        let lastErr = '';
        const reg = await getActiveSwRegistration();
        if (reg && typeof reg.showNotification === 'function') {
            try {
                await reg.showNotification(title, opts);
                return { ok: true, via: 'sw' };
            } catch (err1) {
                lastErr = err1?.message || String(err1);
                try {
                    const minimalOpts = {
                        body: opts.body,
                        tag: opts.tag,
                        renotify: Boolean(opts.renotify),
                        data: opts.data || {}
                    };
                    await reg.showNotification(title, minimalOpts);
                    return { ok: true, via: 'sw-minimal' };
                } catch (err2) {
                    lastErr = err2?.message || String(err2);
                }
            }
        }
        try {
            const n = new Notification(title, opts);
            n.onclick = () => {
                window.focus();
                if (chatId) navigateToChatSafe(chatId, opts?.data?.chatType || 'private');
                n.close();
            };
            return { ok: true, via: 'window' };
        } catch (err3) {
            return { ok: false, error: lastErr || err3?.message || 'Service Worker 未激活或浏览器拦截了通知' };
        }
    }

    async function showSystemNotification(chat, previewText, msgId = '') {
        if (chat?.osNotifyEnabled !== true || !previewText) return;
        if (isWebPageInForeground()) return;

        const dedupKey = msgId ? `${chat.id}:id:${msgId}` : `${chat.id}:${previewText}`;
        const prevTs = lastNotifyDedup.get(dedupKey) || 0;
        if (Date.now() - prevTs < 3000) return;
        lastNotifyDedup.set(dedupKey, Date.now());
        const title = chat.remarkName || chat.realName || chat.name || '新消息';
        const body = previewText;

        try {
            if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
            const uniqueTag = `uwu-msg-${chat.id}-${msgId || Date.now()}-${++notifySeq}`;
            const opts = {
                body,
                tag: uniqueTag,
                renotify: true,
                timestamp: Date.now(),
                data: { chatId: chat.id, chatType: chat.members ? 'group' : 'private', msgId }
            };
            await deliverNotificationSafe(title, opts, chat.id);
        } catch (e) {
            console.warn('[OsNotify] System notification error:', e);
        }
    }

    async function showSystemNotificationsIndividually(chat, previewItems) {
        if (chat?.osNotifyEnabled !== true || !previewItems?.length) return;
        for (let i = 0; i < previewItems.length; i++) {
            if (chat.osNotifyEnabled !== true || isWebPageInForeground()) break;
            const item = previewItems[i];
            if (i > 0) {
                const baseDelay = 1800 + Math.min((item.text || '').length * 45, 1600) + Math.floor(Math.random() * 800);
                await new Promise(res => setTimeout(res, baseDelay));
                if (isWebPageInForeground()) break;
            }
            await showSystemNotification(chat, item.text, item.id);
        }
    }

    function getActiveCharacter() {
        if (typeof currentChatId === 'undefined' || typeof currentChatType === 'undefined' || currentChatType !== 'private') {
            return null;
        }
        return window.db?.characters?.find(chat => chat.id === currentChatId) || null;
    }

    async function requestAndTestNotification(chat) {
        if (testNotifyInFlight || chat?.osNotifyEnabled !== true
            || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        testNotifyInFlight = true;
        syncCharacterSettings();
        try {
            const title = chat.remarkName || chat.realName || '某昔专线';
            const result = await deliverNotificationSafe(title, {
                body: '这是一条来自当前角色的测试通知。',
                tag: `uwu-test-${chat.id}-${Date.now()}`,
                data: { chatId: chat.id, chatType: 'private' }
            }, chat.id);
            window.showToast?.(result.ok ? '已发送测试通知' : `测试通知发送失败：${result.error || '请重试'}`);
        } finally {
            testNotifyInFlight = false;
            syncCharacterSettings();
        }
    }

    async function saveCharacterPreference(chat, enabled) {
        if (!chat || savingPreferenceIds.has(chat.id)) return;
        savingPreferenceIds.add(chat.id);
        syncCharacterSettings();
        const previous = chat.osNotifyEnabled;
        try {
            if (enabled) {
                const permission = Notification.permission === 'default'
                    ? await Notification.requestPermission()
                    : Notification.permission;
                if (permission !== 'granted') {
                    window.showToast?.('请先在浏览器的站点设置中允许通知');
                    return;
                }
            }
            chat.osNotifyEnabled = enabled;
            await window.saveSingleChatFast(chat, 'private');
        } catch (error) {
            if (previous === undefined) delete chat.osNotifyEnabled;
            else chat.osNotifyEnabled = previous;
            console.warn('[OsNotify] Could not save character notification preference:', error);
            window.showToast?.('通知设置保存失败，请重试');
        } finally {
            savingPreferenceIds.delete(chat.id);
            syncCharacterSettings();
        }
    }

    // 独立挂载到 handleAiReplyContent：捕获本次新增的可见角色气泡，仅在后台逐条推送
    let handleAiReplyHooked = false;
    function hookHandleAiReplyContent() {
        if (handleAiReplyHooked || typeof window.handleAiReplyContent !== 'function') return;
        handleAiReplyHooked = true;
        const origHandle = window.handleAiReplyContent;
        const wrapped = async function (fullResponse, chat, targetChatId, targetChatType, isBackground = false) {
            if (targetChatType !== 'private' || chat?.osNotifyEnabled !== true) {
                return origHandle.apply(this, arguments);
            }
            const beforeIds = new Set(
                Array.isArray(chat?.history) ? chat.history.map(m => m && m.id).filter(Boolean) : []
            );
            const res = await origHandle.apply(this, arguments);
            if (chat.osNotifyEnabled === true && !isWebPageInForeground()) {
                const addedMsgs = Array.isArray(chat.history)
                    ? chat.history.filter(m => m && (!m.id || !beforeIds.has(m.id)))
                    : [];
                const previewItems = extractMessagePreviewList(addedMsgs, chat);
                if (previewItems.length > 0) {
                    showSystemNotificationsIndividually(chat, previewItems).catch(() => {});
                }
            }
            return res;
        };
        wrapped.__osNotifyWrapped = true;
        window.handleAiReplyContent = wrapped;
    }

    // 在 API 设置页注入「手机系统弹窗通知」全局开关
    function syncCharacterSettings() {
        const anchor = document.getElementById('setting-auto-reply-enabled')?.closest('.feature-card');
        if (!anchor) return;

        let card = document.getElementById('os-notify-setting-card');
        if (!card) {
            card = document.createElement('div');
            card.className = 'feature-card';
            card.id = 'os-notify-setting-card';
            card.innerHTML = `
                <div class="feature-card-header">
                    <div class="feature-card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"></path></svg>
                    </div>
                    <label class="kkt-switch">
                        <input type="checkbox" id="setting-os-notify-enabled" aria-labelledby="setting-os-notify-title">
                        <span class="kkt-slider"></span>
                    </label>
                </div>
                <div class="feature-card-body">
                    <div class="feature-card-title" id="setting-os-notify-title">新消息通知</div>
                    <div class="feature-card-desc" id="setting-os-notify-status"></div>
                    <button type="button" id="setting-os-notify-test" class="btn btn-small btn-secondary" style="margin:8px 0 0;padding:6px 8px;">测试通知</button>
                </div>
            `;
            const smartCard = document.getElementById('smart-auto-reply-setting-row');
            (smartCard || anchor).after(card);
            card.querySelector('#setting-os-notify-enabled').addEventListener('change', event => {
                saveCharacterPreference(getActiveCharacter(), event.target.checked);
            });
            card.querySelector('#setting-os-notify-test').addEventListener('click', () => {
                requestAndTestNotification(getActiveCharacter());
            });
        }

        const chat = getActiveCharacter();
        const enabled = chat?.osNotifyEnabled === true;
        const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
        const saving = chat && savingPreferenceIds.has(chat.id);
        const toggle = card.querySelector('#setting-os-notify-enabled');
        toggle.checked = enabled;
        toggle.disabled = !chat || saving || permission === 'unsupported';
        card.querySelector('#setting-os-notify-test').disabled = !enabled || saving || testNotifyInFlight || permission !== 'granted';

        let status = enabled ? '切到后台时提醒这个角色的新消息' : '为这个角色单独开启通知';
        if (permission === 'unsupported') status = '当前浏览器不支持系统通知';
        if (permission === 'denied') status = '请在浏览器站点设置中允许通知';
        card.querySelector('#setting-os-notify-status').textContent = status;
    }

    function bootstrap() {
        hookHandleAiReplyContent();
        syncCharacterSettings();
    }

    bootstrap();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    }

    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', event => {
            const d = event.data;
            if (d && d.type === 'uwu-open-chat' && d.chatId) {
                navigateToChatSafe(d.chatId, d.chatType || 'private');
            }
        });
    }
    try {
        const qp = new URLSearchParams(location.search);
        const openId = qp.get('openChat');
        if (openId) {
            setTimeout(() => {
                navigateToChatSafe(openId, 'private');
            }, 900);
        }
    } catch (e) {}

    window.OsNotifyPlugin = {
        isWebPageInForeground,
        extractCleanPreview,
        extractMessagePreviewList,
        showSystemNotification,
        showSystemNotificationsIndividually,
        syncCharacterSettings,
        requestAndTestNotification,
        navigateToChatSafe,
        bootstrap
    };
})();