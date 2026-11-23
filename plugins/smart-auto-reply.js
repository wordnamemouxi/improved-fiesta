/**
 * Smart Auto-Reply Plugin (smart-auto-reply.js)
 * 放置于 index.html 同级目录（或 plugins/ 目录），并在 index.html 的 </body> 前引入：
 * <script src="./smart-auto-reply.js"></script>
 *
 * 功能：
 * 1. 智慧动态主动发消息：AI 根据聊天内容与客观时间，自主决定多久后再主动找你及理由（零额外 API 费用）。
 * 2. 双重防误发：只要你在预约时间前发了任何新消息（文字/图片/语音/拍一拍），旧预约立即作废，绝不重复按旧时间发。
 * 3. 与原版固定间隔融合：保留原版固定间隔作为基础兜底；开启智慧动态时优先按动态排程走（如深夜晚安排明早，不被固定间隔半夜打断）。
 * 4. 原生卡片适配 + 延迟加载防漏注入：无论 IndexedDB 加载多慢，打开聊天设置页都能稳定显示并与当前角色同步。
 */
(() => {
    if (window.__uwuSmartAutoReplyLoaded) return;
    window.__uwuSmartAutoReplyLoaded = true;

    const MIN_MINUTES = 5;
    const MAX_MINUTES = 2880; // 最多 48 小时
    const pendingReasonMap = new Map();

    // === 手机系统级消息弹窗通知（Edge PWA 后台/切屏时触发，支持角色备注、头像与点击直达） ===
    const OS_NOTIFY_KEY = 'uwu_os_notify_enabled';
    const lastNotifyDedup = new Map();

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
            // 严格过滤非角色消息、系统消息、思考链、状态栏更新与已撤回消息
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
                // 若头像/图标路径导致系统拒绝，剥离 icon 与 badge 后用纯文本通知重试
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
        // 桌面浏览器兜底（移动端 Edge/Chrome 不允许直接 new Notification）
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

    function isWebPageInForeground() {
        try {
            if (document.visibilityState === 'visible') return true;
        } catch (e) {}
        return false;
    }

    let notifySeq = 0;
    async function showSystemNotification(chat, previewText, msgId = '') {
        if (!chat || !previewText) return;
        // 只要用户当前停留在网页内（任意页面/任意角色），都不弹出通知
        if (isWebPageInForeground()) return;

        const dedupKey = msgId ? `${chat.id}:id:${msgId}` : `${chat.id}:${previewText}`;
        const prevTs = lastNotifyDedup.get(dedupKey) || 0;
        if (Date.now() - prevTs < 3000) return;
        lastNotifyDedup.set(dedupKey, Date.now());
        const title = chat.remarkName || chat.realName || chat.name || '新消息';
        const body = previewText;

        // 仅在网页处于后台/锁屏/切出状态时，通过 Service Worker 逐条弹出系统通知
        try {
            if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
            if (localStorage.getItem(OS_NOTIFY_KEY) === '0') return;
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
            console.warn('[SmartAutoReply] System notification error:', e);
        }
    }

    async function showSystemNotificationsIndividually(chat, previewItems) {
        if (!chat || !Array.isArray(previewItems) || !previewItems.length) return;
        for (let i = 0; i < previewItems.length; i++) {
            if (isWebPageInForeground()) break;
            const item = previewItems[i];
            if (i > 0) {
                // 模拟真人发消息节奏：按下一句长度自然间隔约 2.0s ~ 4.2s
                const baseDelay = 1800 + Math.min((item.text || '').length * 45, 1600) + Math.floor(Math.random() * 800);
                await new Promise(res => setTimeout(res, baseDelay));
                if (isWebPageInForeground()) break;
            }
            await showSystemNotification(chat, item.text, item.id);
        }
    }

    let testNotifyInFlight = false;
    async function requestAndTestNotification(statusCallback) {
        if (testNotifyInFlight) return false;
        testNotifyInFlight = true;
        try {
            if (typeof Notification === 'undefined') {
                if (typeof window.showToast === 'function') window.showToast('当前浏览器不支持系统通知');
                return false;
            }
            let perm = Notification.permission;
            if (perm === 'default') {
                perm = await Notification.requestPermission();
            }
            if (perm !== 'granted') {
                if (typeof window.showToast === 'function') window.showToast('通知权限被拒绝，请在手机浏览器站点设置中允许通知');
                return false;
            }
            localStorage.setItem(OS_NOTIFY_KEY, '1');
            if (typeof statusCallback === 'function') statusCallback();
            const ch = (typeof currentChatId !== 'undefined' && window.db?.characters)
                ? window.db.characters.find(c => c.id === currentChatId)
                : null;
            const testTitle = ch ? (ch.remarkName || ch.realName || '某昔专线') : '某昔专线';
            const opts = {
                body: '测试成功：如果看到顶部横幅就说明后台弹窗完全打通啦！',
                tag: `uwu-test-${Date.now()}`,
                renotify: true,
                data: { chatId: ch?.id || '' }
            };
            const res = await deliverNotificationSafe(testTitle, opts, ch?.id || '');
            if (res.ok) {
                if (typeof window.showToast === 'function') window.showToast('已发送测试系统通知，请看顶部横幅');
                return true;
            } else {
                if (typeof window.showToast === 'function') window.showToast(`系统通知发送失败：${res.error || '请刷新页面后重试'}`);
                return false;
            }
        } finally {
            testNotifyInFlight = false;
        }
    }

    // 30秒后自动发消息一键测试（严格按角色 ID 隔离，互不串扰）
    const test30sMap = new Map(); // charId -> { timer, tick, targetAt }

    function getActiveCharId() {
        try {
            if (typeof currentChatId !== 'undefined' && currentChatId) return currentChatId;
        } catch (e) {}
        return window.currentChatId || '';
    }

    function refreshTest30sBtn() {
        const btn = document.getElementById('uwu-test-30s-btn');
        if (!btn) return;
        const cid = getActiveCharId();
        const entry = cid ? test30sMap.get(cid) : null;
        const leftSec = entry ? Math.max(0, Math.ceil((entry.targetAt - Date.now()) / 1000)) : 0;
        if (entry && leftSec > 0) {
            btn.textContent = `倒计时 ${leftSec}s（点此取消）`;
            btn.style.borderColor = '#d95c6c';
            btn.style.color = '#d95c6c';
        } else {
            btn.textContent = '30秒后测试自动发消息';
            btn.style.borderColor = '#d0d7de';
            btn.style.color = '#333';
        }
    }

    function clearTest30sForChar(charId) {
        const entry = test30sMap.get(charId);
        if (!entry) return;
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.tick) clearInterval(entry.tick);
        test30sMap.delete(charId);
    }

    function toggleTest30sAutoReply() {
        const cid = getActiveCharId();
        if (!cid || !window.db?.characters) {
            if (typeof window.showToast === 'function') window.showToast('请先进入某个角色的聊天设置');
            return;
        }
        const ch = window.db.characters.find(c => c.id === cid);
        if (!ch) return;
        if (test30sMap.has(cid)) {
            clearTest30sForChar(cid);
            refreshTest30sBtn();
            if (typeof window.showToast === 'function') window.showToast(`已取消「${ch.remarkName || ch.realName}」的 30 秒测试`);
            return;
        }
        const targetName = ch.remarkName || ch.realName || '角色';
        const entry = { timer: null, tick: null, targetAt: Date.now() + 30000 };
        test30sMap.set(cid, entry);
        refreshTest30sBtn();
        if (typeof window.showToast === 'function') {
            window.showToast(`已预约：30秒后让「${targetName}」自动发消息，现在可切去别的角色或最小化测试`);
        }
        entry.tick = setInterval(() => {
            if (!test30sMap.has(cid) || Date.now() >= entry.targetAt) {
                clearInterval(entry.tick);
                entry.tick = null;
            }
            refreshTest30sBtn();
        }, 1000);
        entry.timer = setTimeout(async () => {
            clearTest30sForChar(cid);
            refreshTest30sBtn();
            try {
                pendingReasonMap.set(cid, '随手想起你，自然发一句日常消息打招呼');
                if (typeof window.getAiReply === 'function') {
                    await window.getAiReply(cid, 'private', true);
                }
            } catch (e) {
                console.warn('[SmartAutoReply] 30s test trigger failed:', e);
            }
        }, 30000);
    }

    function getLastUserTimestamp(char) {
        const hist = Array.isArray(char?.history) ? char.history : [];
        for (let i = hist.length - 1; i >= 0; i--) {
            const m = hist[i];
            if (m && m.role === 'user' && !m.isWithdrawn && Number.isFinite(m.timestamp)) {
                return m.timestamp;
            }
        }
        return 0;
    }

    function clearSmartSchedule(char) {
        if (!char?.autoReply) return;
        char.autoReply.nextPingAt = 0;
        char.autoReply.nextPingReason = '';
        char.autoReply.nextPingSetAt = 0;
    }

    // 1. 挂载到 buildLivelyPostscript：注入动态排程指令 / 触发由头
    function hookLivelyPostscript() {
        if (typeof window.buildLivelyPostscript !== 'function' || window.buildLivelyPostscript.__smartWrapped) return;
        const origBuild = window.buildLivelyPostscript;
        const wrapped = function (chat, historySlice) {
            let note = origBuild.apply(this, arguments) || '';
            const extra = [];
            if (chat?.autoReply?.smartEnabled) {
                const pendingReason = pendingReasonMap.get(chat.id);
                if (pendingReason) {
                    pendingReasonMap.delete(chat.id);
                    extra.push(`[本次主动发消息由头] 你之前心里惦记着“${pendingReason}”，现在时间到了自然顺口来找对方聊两句（像真人想起这事一样自然，别生硬照念）。`);
                }
                extra.push('[智慧主动消息排程] 请结合刚才的聊天内容与当前客观时间，自然判断如果对方接下来没主动回你，你大概多少分钟后会再主动找她（以及简短理由）。请在正文最末尾附隐藏标签 [NEXT_PING:分钟数|简短理由]（例如刚说去洗澡可约25分钟、深夜互道晚安可约480分钟到明早、普通日常约120到240分钟；只写整数分钟）。');
            }
            if (extra.length) {
                note = note ? `${note}\n${extra.join('\n')}` : extra.join('\n');
            }
            return note;
        };
        wrapped.__smartWrapped = true;
        window.buildLivelyPostscript = wrapped;
    }

    // 2. 挂载到 handleAiReplyContent：在剥离 <thinking> 后的正文中解析 [NEXT_PING:分钟|理由] 并隐藏标签
    function hookHandleAiReplyContent() {
        if (typeof window.handleAiReplyContent !== 'function' || window.handleAiReplyContent.__smartWrapped) return;
        const origHandle = window.handleAiReplyContent;
        const wrapped = async function (fullResponse, chat, targetChatId, targetChatType, isBackground = false) {
            let cleaned = fullResponse;
            if (typeof cleaned === 'string' && targetChatType === 'private' && chat?.autoReply?.smartEnabled) {
                // 仅检查 </thinking> 之后的正式正文，绝不误触思考过程！
                const thinkEnd = cleaned.lastIndexOf('</thinking>');
                const head = thinkEnd !== -1 ? cleaned.slice(0, thinkEnd + 11) : '';
                let body = thinkEnd !== -1 ? cleaned.slice(thinkEnd + 11) : cleaned;

                const pingMatch = body.match(/\[NEXT_PING:(\d{1,4})(?:\|([^\]]*))?\]/i);
                if (pingMatch) {
                    const rawMins = Number.parseInt(pingMatch[1], 10);
                    const mins = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Number.isFinite(rawMins) ? rawMins : 90));
                    const reason = (pingMatch[2] || '').trim().slice(0, 60);
                    const now = Date.now();
                    chat.autoReply ||= {};
                    chat.autoReply.nextPingAt = now + mins * 60 * 1000;
                    chat.autoReply.nextPingReason = reason;
                    chat.autoReply.nextPingSetAt = Math.max(now, getLastUserTimestamp(chat));
                    body = body.replace(/\[NEXT_PING:[^\]]+\]/gi, '').trim();
                    cleaned = head + body;
                    if (typeof window.saveData === 'function') {
                        window.saveData().catch(() => {});
                    }
                }
            }
            const beforeIds = new Set(
                Array.isArray(chat?.history) ? chat.history.map(m => m && m.id).filter(Boolean) : []
            );
            const res = await origHandle.call(this, cleaned, chat, targetChatId, targetChatType, isBackground);
            if (chat) {
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
        wrapped.__smartWrapped = true;
        window.handleAiReplyContent = wrapped;
    }

    // 3. 挂载到 sendMessage：用户一发新消息，立刻作废该角色之前的动态预约
    function hookSendMessage() {
        if (typeof window.sendMessage !== 'function' || window.sendMessage.__smartWrapped) return;
        const origSend = window.sendMessage;
        const wrapped = async function () {
            if (typeof currentChatType !== 'undefined' && currentChatType === 'private' && typeof currentChatId !== 'undefined' && window.db?.characters) {
                const chat = window.db.characters.find(c => c.id === currentChatId);
                if (chat?.autoReply?.nextPingAt) {
                    clearSmartSchedule(chat);
                }
            }
            return origSend.apply(this, arguments);
        };
        wrapped.__smartWrapped = true;
        window.sendMessage = wrapped;
    }

    // 4. 融合原版 checkAutoReply：动态排程优先 + 并发保护（与 A 聊天绝不误清 B 的定时）+ 失败回滚重试 + 固定间隔兜底
    const inFlightPingIds = new Set();
    let deferredRetryTimer = null;

    function countAssistantMessages(char) {
        if (!Array.isArray(char?.history)) return 0;
        let cnt = 0;
        for (const m of char.history) {
            if (m && m.role === 'assistant' && !m.isThinking && !m.isStatusUpdate) cnt++;
        }
        return cnt;
    }

    function hookCheckAutoReply() {
        if (typeof window.checkAutoReply !== 'function' || window.checkAutoReply.__smartWrapped) return;
        const wrapped = async function () {
            if (!window.db?.characters) return;
            const now = Date.now();
            const someoneGenerating = (typeof isGenerating !== 'undefined' && Boolean(isGenerating));
            let needDeferredRetry = false;

            for (const char of window.db.characters) {
                const ar = char.autoReply;
                if (!ar || (!ar.enabled && !ar.smartEnabled)) continue;
                if (!Array.isArray(char.history) || char.history.length === 0) continue;
                if (inFlightPingIds.has(char.id)) continue;

                const lastMsgTime = char.history[char.history.length - 1]?.timestamp || 0;
                const lastUserTime = getLastUserTimestamp(char);

                // 二次防线：仅当「这个角色自己」在定下预约后又收到了用户发给他的新消息，才作废他自己的旧预约
                if (ar.nextPingAt && ar.nextPingSetAt && lastUserTime > ar.nextPingSetAt + 1000) {
                    clearSmartSchedule(char);
                    if (typeof window.saveData === 'function') await window.saveData().catch(() => {});
                }

                // 路径 A：智慧动态排程生效中
                if (ar.smartEnabled && ar.nextPingAt > 0) {
                    if (now < ar.nextPingAt) {
                        // 还没到 AI 约定的动态时间（例如深夜晚安约了明早），跳过固定间隔避免半夜抢发！
                        continue;
                    }
                    // 若当前用户正在和别的角色聊天且正在生成回复，暂缓本次触发，绝不清空当前角色的预约！
                    if (someoneGenerating) {
                        needDeferredRetry = true;
                        console.log(`[SmartAutoReply] Deferred ping for ${char.remarkName || char.realName} while another chat is generating`);
                        continue;
                    }
                    // 到达动态预约时间：先备份预约并在失败/无回复时自动回滚，防止定时凭空消失
                    const prevPingAt = ar.nextPingAt;
                    const prevReason = ar.nextPingReason || '';
                    const prevSetAt = ar.nextPingSetAt || 0;
                    const beforeAssistantCount = countAssistantMessages(char);

                    inFlightPingIds.add(char.id);
                    try {
                        clearSmartSchedule(char);
                        ar.lastTriggerTime = now;
                        if (prevReason) pendingReasonMap.set(char.id, prevReason);
                        console.log(`[SmartAutoReply] Dynamic ping triggered for ${char.remarkName || char.realName}: ${prevReason || 'natural check-in'}`);
                        if (typeof window.getAiReply === 'function') {
                            await window.getAiReply(char.id, 'private', true);
                        }
                        const afterAssistantCount = countAssistantMessages(char);
                        if (afterAssistantCount <= beforeAssistantCount) {
                            // 本次后台请求未产生有效回复（例如网络波动/499/限流），2 分钟后自动重试，不丢预约
                            ar.nextPingAt = Date.now() + 2 * 60 * 1000;
                            ar.nextPingReason = prevReason;
                            ar.nextPingSetAt = prevSetAt;
                            console.warn(`[SmartAutoReply] Ping produced no reply for ${char.remarkName || char.realName}, rescheduled in 2m`);
                        }
                        if (typeof window.saveData === 'function') await window.saveData().catch(() => {});
                    } catch (err) {
                        ar.nextPingAt = Math.max(prevPingAt, Date.now() + 2 * 60 * 1000);
                        ar.nextPingReason = prevReason;
                        ar.nextPingSetAt = prevSetAt;
                        console.warn(`[SmartAutoReply] Ping failed for ${char.remarkName || char.realName}, restored schedule:`, err);
                        if (typeof window.saveData === 'function') await window.saveData().catch(() => {});
                    } finally {
                        inFlightPingIds.delete(char.id);
                    }
                    continue;
                }

                // 路径 B：固定间隔基础兜底（仅当开启了原版自动发消息开关，且当前无待执行的动态预约时）
                if (ar.enabled) {
                    if (someoneGenerating) {
                        needDeferredRetry = true;
                        continue;
                    }
                    const intervalMs = (ar.interval || 60) * 60 * 1000;
                    const lastTriggerTime = ar.lastTriggerTime || 0;
                    if (now - lastTriggerTime < intervalMs) continue;
                    if (now - lastMsgTime > intervalMs) {
                        inFlightPingIds.add(char.id);
                        try {
                            console.log(`[SmartAutoReply] Fallback fixed-interval auto-reply triggered for ${char.remarkName || char.realName}`);
                            ar.lastTriggerTime = now;
                            if (typeof window.saveData === 'function') await window.saveData().catch(() => {});
                            if (typeof window.getAiReply === 'function') await window.getAiReply(char.id, 'private', true);
                        } finally {
                            inFlightPingIds.delete(char.id);
                        }
                    }
                }
            }

            if (needDeferredRetry && !deferredRetryTimer) {
                deferredRetryTimer = setTimeout(() => {
                    deferredRetryTimer = null;
                    if (typeof window.checkAutoReply === 'function') window.checkAutoReply();
                }, 12000);
            }
        };
        wrapped.__smartWrapped = true;
        window.checkAutoReply = wrapped;
    }

    // 5. 挂载到 injectChatSettingsHtml：每次聊天设置页模板注入后立刻挂载原生功能卡片
    function hookInjectChatSettingsHtml() {
        if (typeof window.injectChatSettingsHtml !== 'function' || window.injectChatSettingsHtml.__smartWrapped) return;
        const origInject = window.injectChatSettingsHtml;
        const wrapped = function () {
            const ret = origInject.apply(this, arguments);
            injectSmartSettingsUI();
        injectApiNotifySwitch();
            return ret;
        };
        wrapped.__smartWrapped = true;
        window.injectChatSettingsHtml = wrapped;
    }

    function syncUiFromChar() {
        const notifyBtn = document.getElementById('uwu-os-notify-btn');
        const refreshNotifyBtn = () => {
            if (!notifyBtn) return;
            if (typeof Notification === 'undefined') {
                notifyBtn.textContent = '浏览器不支持系统弹窗';
                notifyBtn.disabled = true;
            } else if (Notification.permission === 'granted' && localStorage.getItem(OS_NOTIFY_KEY) !== '0') {
                notifyBtn.textContent = '系统弹窗已开启（点此测试）';
            } else if (Notification.permission === 'denied') {
                notifyBtn.textContent = '通知已被拦截（需去浏览器开启）';
            } else {
                notifyBtn.textContent = '开启手机弹窗通知';
            }
        };
        if (notifyBtn) {
            if (!notifyBtn.dataset.uwuBound) {
                notifyBtn.dataset.uwuBound = '1';
                notifyBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    requestAndTestNotification(refreshNotifyBtn);
                });
            }
            refreshNotifyBtn();
        }
        const test30Btn = document.getElementById('uwu-test-30s-btn');
        if (test30Btn) {
            if (!test30Btn.dataset.uwuBound) {
                test30Btn.dataset.uwuBound = '1';
                test30Btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleTest30sAutoReply();
                });
            }
            refreshTest30sBtn();
        }
        const swInput = document.getElementById('setting-smart-auto-reply-enabled');
        const statusLine = document.getElementById('smart-auto-reply-status');
        if (!swInput || !statusLine) return;
        if (typeof currentChatId === 'undefined' || !window.db?.characters) return;
        const ch = window.db.characters.find(c => c.id === currentChatId);
        if (!ch) return;
        swInput.checked = ch.autoReply?.smartEnabled === true;
        if (ch.autoReply?.smartEnabled && ch.autoReply?.nextPingAt > Date.now()) {
            const d = new Date(ch.autoReply.nextPingAt);
            const tStr = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            const reason = ch.autoReply.nextPingReason ? `（${ch.autoReply.nextPingReason}）` : '';
            statusLine.innerHTML = '';
            const span = document.createElement('span');
            span.textContent = `下次预计：${tStr}${reason}`;
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.textContent = '取消';
            cancelBtn.className = 'uwu-smart-cancel-btn';
            cancelBtn.style.cssText = 'font-size:11px;padding:1px 6px;border-radius:6px;border:1px solid #ccc;background:#fff;cursor:pointer;margin-left:6px;flex-shrink:0;';
            cancelBtn.onclick = async (e) => {
                e.stopPropagation();
                clearSmartSchedule(ch);
                if (typeof window.saveData === 'function') await window.saveData();
                syncUiFromChar();
            };
            statusLine.append(span, cancelBtn);
        } else {
            const nextTxt = swInput.checked ? '已开启 · 按聊天与时间自动约下次联系' : '关闭 · 仅用原版固定间隔'; if (statusLine.textContent !== nextTxt) statusLine.textContent = nextTxt;
        }
    }

    // 6. 自动在角色聊天设置页注入原生样式的「智慧主动消息」功能卡片
    function injectSmartSettingsUI() {
        const baseSwitch = document.getElementById('setting-auto-reply-enabled');
        if (!baseSwitch) return false;
        if (document.getElementById('setting-smart-auto-reply-enabled')) {
            syncUiFromChar();
            return true;
        }

        const featureCard = baseSwitch.closest('.feature-card');
        const fallbackItem = baseSwitch.closest('.kkt-item') || baseSwitch.closest('.form-group');
        const anchor = featureCard || fallbackItem;
        if (!anchor || !anchor.parentElement) return false;

        let card;
        if (featureCard) {
            // 原生 feature-card 网格卡片风格，与「自动消息」并排显示，完美适配手机端与全局 CSS
            card = document.createElement('div');
            card.className = 'feature-card uwu-smart-autoreply-row';
            card.id = 'smart-auto-reply-setting-row';
            card.dataset.feature = 'smart-auto-reply';
            card.innerHTML = `
                <div class="feature-card-header">
                    <div class="feature-card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    </div>
                    <label class="kkt-switch">
                        <input type="checkbox" id="setting-smart-auto-reply-enabled">
                        <span class="kkt-slider"></span>
                    </label>
                </div>
                <div class="feature-card-body">
                    <div class="feature-card-title">智慧主动消息</div>
                    <div class="feature-card-desc" id="smart-auto-reply-status">关闭 · 仅用原版固定间隔</div>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
                        <button type="button" id="uwu-os-notify-btn" style="font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid #d0d7de;background:#fff;cursor:pointer;color:#333;">开启手机弹窗通知</button>
                        <button type="button" id="uwu-test-30s-btn" style="font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid #d0d7de;background:#fff;cursor:pointer;color:#333;">30秒后测试自动发消息</button>
                    </div>
                </div>
            `;
        } else {
            // 兼容非卡片布局的兜底样式
            card = document.createElement('div');
            card.className = 'kkt-item uwu-smart-autoreply-row';
            card.id = 'smart-auto-reply-setting-row';
            card.innerHTML = `
                <div class="kkt-item-content">
                    <div class="kkt-item-title">智慧主动消息</div>
                    <div class="kkt-item-subtitle" id="smart-auto-reply-status">关闭 · 仅用原版固定间隔</div>
                </div>
                <label class="kkt-switch">
                    <input type="checkbox" id="setting-smart-auto-reply-enabled">
                    <span class="kkt-slider"></span>
                </label>
            `;
        }

        anchor.parentElement.insertBefore(card, anchor.nextSibling);

        const swInput = document.getElementById('setting-smart-auto-reply-enabled');
        swInput.addEventListener('change', async () => {
            if (typeof currentChatId === 'undefined' || !window.db?.characters) return;
            const ch = window.db.characters.find(c => c.id === currentChatId);
            if (!ch) return;
            ch.autoReply ||= { enabled: false, interval: 60, lastTriggerTime: 0 };
            ch.autoReply.smartEnabled = swInput.checked;
            if (!swInput.checked) clearSmartSchedule(ch);
            if (typeof window.saveData === 'function') await window.saveData();
            syncUiFromChar();
        });

        syncUiFromChar();
        return true;
    }

    function hookLoadSettingsToSidebar() {
        if (typeof window.loadSettingsToSidebar === 'function' && !window.loadSettingsToSidebar.__smartWrapped) {
            const origLoad = window.loadSettingsToSidebar;
            const wrapped = function () {
                const ret = origLoad.apply(this, arguments);
                injectSmartSettingsUI();
                syncUiFromChar();
                return ret;
            };
            wrapped.__smartWrapped = true;
            window.loadSettingsToSidebar = wrapped;
        }
        if (typeof window.openChatRoom === 'function' && !window.openChatRoom.__smartWrapped) {
            const origOpen = window.openChatRoom;
            const wrappedOpen = function (chatId, type) {
                const ret = origOpen.apply(this, arguments);
                setTimeout(() => syncUiFromChar(), 0);
                return ret;
            };
            wrappedOpen.__smartWrapped = true;
            window.openChatRoom = wrappedOpen;
        }
    }

    function observeSettingsScreen() {
        const sidebar = document.getElementById('chat-settings-sidebar') || document.getElementById('chat-settings-screen');
        if (!sidebar || sidebar.__smartObserved) return;
        sidebar.__smartObserved = true;
        const obs = new MutationObserver(() => {
            if (!document.getElementById('setting-smart-auto-reply-enabled')) {
                injectSmartSettingsUI();
            } else if (sidebar.classList.contains('open') || sidebar.classList.contains('active')) {
                syncUiFromChar();
            }
        });
        obs.observe(sidebar, { childList: true, attributes: true, attributeFilter: ['class'] });
    }

    function hookCoreFunctions() {
        hookLivelyPostscript();
        hookHandleAiReplyContent();
        hookSendMessage();
        hookCheckAutoReply();
        hookInjectChatSettingsHtml();
        hookLoadSettingsToSidebar();
    }


    // 7. 在 API 设置页面注入「手机系统弹窗通知」全局开关（直接放在时间感知加强下方）
    function injectApiNotifySwitch() {
        const timeSw = document.getElementById('time-perception-switch');
        if (!timeSw || document.getElementById('api-os-notify-switch')) return;
        const timeItem = timeSw.closest('.kkt-item');
        if (!timeItem || !timeItem.parentElement) return;

        const item = document.createElement('div');
        item.className = 'kkt-item';
        item.id = 'api-os-notify-setting-row';
        item.innerHTML = `
            <div class="kkt-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
            </div>
            <div class="kkt-item-content">
                <div class="kkt-item-title">手机系统弹窗通知</div>
                <div class="kkt-item-subtitle" id="api-os-notify-subtitle">后台收到自动消息时在网页外弹窗（含备注与头像）</div>
            </div>
            <div class="kkt-item-control">
                <label class="kkt-switch">
                    <input type="checkbox" id="api-os-notify-switch">
                    <span class="kkt-slider"></span>
                </label>
            </div>
        `;
        timeItem.parentElement.insertBefore(item, timeItem.nextSibling);

        const sw = document.getElementById('api-os-notify-switch');
        const sub = document.getElementById('api-os-notify-subtitle');
        const syncApiSw = () => {
            if (typeof Notification === 'undefined') {
                sw.checked = false;
                sw.disabled = true;
                sub.textContent = '当前浏览器不支持系统级通知';
                return;
            }
            const perm = Notification.permission;
            const enabled = localStorage.getItem(OS_NOTIFY_KEY) !== '0';
            sw.checked = (perm === 'granted' && enabled);
            if (perm === 'denied') {
                sub.textContent = '通知权限已被拦截，请在浏览器站点设置中允许通知';
            } else if (sw.checked) {
                sub.textContent = '已开启 · 后台收到自动消息时将弹出系统通知';
            } else {
                sub.textContent = '开启后，切出网页或后台挂起时将收到系统弹窗通知';
            }
        };

        sw.addEventListener('change', async () => {
            if (sw.checked) {
                const ok = await requestAndTestNotification(syncApiSw);
                if (!ok) {
                    localStorage.setItem(OS_NOTIFY_KEY, '0');
                }
            } else {
                localStorage.setItem(OS_NOTIFY_KEY, '0');
                if (typeof window.showToast === 'function') window.showToast('已关闭手机系统弹窗通知');
            }
            syncApiSw();
        });

        const apiScreen = document.getElementById('api-settings-screen');
        if (apiScreen && !apiScreen.__osNotifyObserved) {
            apiScreen.__osNotifyObserved = true;
            new MutationObserver(() => {
                if (apiScreen.classList.contains('active')) syncApiSw();
            }).observe(apiScreen, { attributes: true, attributeFilter: ['class'] });
        }
        syncApiSw();
    }



    function bootstrap() {
        hookCoreFunctions();
        observeSettingsScreen();
        injectSmartSettingsUI();
        injectApiNotifySwitch();
    }

    // 立即同步挂载核心函数钩子（确保早于 DOMContentLoaded 里的 init() 与事件绑定！）
    hookCoreFunctions();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            bootstrap();
            // 兜底轮询：即使真机 IndexedDB 加载耗时较长，也能在模板渲染后第一时间补挂载
            let tries = 0;
            const timer = setInterval(() => {
                tries++;
                bootstrap();
                if (document.getElementById('setting-smart-auto-reply-enabled') || tries >= 40) {
                    clearInterval(timer);
                }
            }, 500);
        });
    } else {
        bootstrap();
    }

    // 点击系统通知后自动跳回对应角色聊天室
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

    // 导出供外部测试与调试
    window.SmartAutoReplyPlugin = { clearSmartSchedule, getLastUserTimestamp, bootstrap, syncUiFromChar, showSystemNotification, extractCleanPreview };
})();