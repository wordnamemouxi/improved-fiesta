/**
 * Smart Auto-Reply Plugin (plugins/smart-auto-reply.js)
 * 纯「智慧主动消息排程」模块（系统通知已拆分到同目录 plugins/os-notify.js）
 *
 * 功能：
 * 1. 智慧动态主动发消息：AI 根据聊天内容与客观时间，自主决定多久后再主动找你及理由（零额外 API 费用）。
 * 2. 真正多角色并发隔离：与角色 A 聊天完全不影响角色 B 的预约与后台生成；若后台请求失败/无回复自动 2 分钟后重试。
 * 3. 单角色轻量持久化：不再与主流程抢占全库 saveData 写锁，避免切屏卡顿与 499。
 * 4. 自动按需加载同目录 os-notify.js（即使 index.html 没单独引入也能自动工作）。
 */
(() => {
    if (window.__uwuSmartAutoReplyLoaded) return;
    window.__uwuSmartAutoReplyLoaded = true;

    // 若 index.html 尚未显式引入 plugins/os-notify.js，自动按同目录路径加载，零配置生效
    if (!window.__uwuOsNotifyLoaded && typeof document !== 'undefined' && document.head) {
        const hasTag = Array.from(document.scripts || []).some(s => (s.src || '').includes('os-notify.js'));
        if (!hasTag) {
            try {
                const curSrc = document.currentScript?.src || '';
                const base = curSrc ? curSrc.replace(/[^/]+$/, '') : './plugins/';
                const sc = document.createElement('script');
                sc.src = `${base}os-notify.js?v=20261124`;
                sc.async = false;
                sc.onload = () => {
                    try { syncUiFromChar(); } catch (e) {}
                };
                document.head.appendChild(sc);
            } catch (e) {}
        }
    }

    const MIN_MINUTES = 5;
    const MAX_MINUTES = 2880; // 最多 48 小时
    const pendingReasonMap = new Map();
    const test30sMap = new Map(); // charId -> { timer, tick, targetAt }
    const inFlightPingIds = new Set();

    async function saveChatQuick(chat) {
        if (typeof window.saveSingleChatFast === 'function' && chat) {
            return window.saveSingleChatFast(chat, 'private');
        }
        if (typeof window.saveData === 'function') {
            return window.saveData();
        }
    }

    function getActiveCharId() {
        try {
            if (typeof currentChatId !== 'undefined' && currentChatId) return currentChatId;
        } catch (e) {}
        return window.currentChatId || '';
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

    function countAssistantMessages(char) {
        if (!Array.isArray(char?.history)) return 0;
        let cnt = 0;
        for (const m of char.history) {
            if (m && m.role === 'assistant' && !m.isThinking && !m.isStatusUpdate) cnt++;
        }
        return cnt;
    }

    const androidAlarms = new Map();

    function syncAndroidAlarm(chat) {
        const bridge = window.MouxiAndroid;
        if (!bridge?.scheduleCharacterAlarm || !chat?.id) return;
        const due = chat.autoReply?.smartEnabled ? Number(chat.autoReply.nextPingAt) : 0;
        if (!(due > 0)) {
            bridge.cancelCharacterAlarm(String(chat.id));
            androidAlarms.delete(chat.id);
            return;
        }
        if (androidAlarms.get(chat.id) === due) return;
        androidAlarms.delete(chat.id);
        if (bridge.scheduleCharacterAlarm(String(chat.id), String(due))) androidAlarms.set(chat.id, due);
    }

    window.syncMouxiCharacterAlarms = () => {
        androidAlarms.clear();
        for (const chat of window.db?.characters || []) syncAndroidAlarm(chat);
        syncUiFromChar();
    };

    function clearSmartSchedule(char) {
        if (!char?.autoReply) return;
        char.autoReply.nextPingAt = 0;
        char.autoReply.nextPingReason = '';
        char.autoReply.nextPingSetAt = 0;
        syncAndroidAlarm(char);
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
        if (entry.nativeToken && !entry.dispatched) window.MouxiAndroid?.finishBackgroundTest(entry.nativeToken, 'cancel');
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
        if (window.MouxiAndroid?.startBackgroundTest) {
            entry.nativeToken = String(entry.targetAt);
            if (!window.MouxiAndroid.startBackgroundTest(cid, entry.nativeToken)) {
                window.showToast?.('后台测试未启动，请允许 App 通知，或等上一项测试结束');
                return;
            }
        }
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
        if (entry.nativeToken) return;
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

    if (window.MouxiAndroid?.startBackgroundTest) {
        const takeTest = (chatId, token) => {
            const entry = test30sMap.get(chatId);
            if (entry?.nativeToken !== token) return false;
            entry.dispatched = true;
            clearTest30sForChar(chatId);
            refreshTest30sBtn();
            return true;
        };
        window.expireMouxiBackgroundTest = takeTest;
        window.runMouxiBackgroundTest = async (chatId, token) => {
            if (!takeTest(chatId, token)) return;
            let success = false;
            try {
                const chat = window.db?.characters?.find(item => item.id === chatId);
                if (chat && typeof window.getAiReply === 'function') {
                    const before = countAssistantMessages(chat);
                    pendingReasonMap.set(chatId, '随手想起你，自然发一句日常消息打招呼');
                    await window.getAiReply(chatId, 'private', true);
                    success = countAssistantMessages(chat) > before;
                }
            } catch (error) {
                console.warn('[SmartAutoReply] Android test failed:', error);
            } finally {
                window.MouxiAndroid.finishBackgroundTest(token, success ? 'ok' : 'failed');
            }
        };
    }

    // 1. 挂载到 buildLivelyPostscript：注入动态排程指令 / 触发由头
    let hookedLively = false;
    function hookLivelyPostscript() {
        if (hookedLively || typeof window.buildLivelyPostscript !== 'function') return;
        hookedLively = true;
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
                extra.push('[智慧主动消息排程] 无论本轮是在回复对方，还是你主动发消息，都根据这轮聊天与当前时间决定：如果对方一直没回，你会在多久后再主动联系。每轮回复都必须在正常聊天内容之后另起一行写 [NEXT_PING:分钟数|简短理由]。把分钟数替换为你自己决定的正整数，理由用一句短语。把标签放在正文最后一行、思考标签之外，只输出一次；即使没有紧接着要聊的话题，也请选一个更晚的时间。');
            }
            if (extra.length) {
                note = note ? `${note}\n${extra.join('\n')}` : extra.join('\n');
            }
            return note;
        };
        wrapped.__smartWrapped = true;
        window.buildLivelyPostscript = wrapped;
    }

    // 2. 挂载到 handleAiReplyContent：解析并隐藏 [NEXT_PING:分钟|理由]，成功回复后保存下一次预约
    let hookedHandleAi = false;
    function hookHandleAiReplyContent() {
        if (hookedHandleAi || typeof window.handleAiReplyContent !== 'function') return;
        hookedHandleAi = true;
        const origHandle = window.handleAiReplyContent;
        const wrapped = async function (fullResponse, chat, targetChatId, targetChatType, isBackground = false) {
            if (typeof fullResponse !== 'string' || targetChatType !== 'private' || !chat?.autoReply?.smartEnabled) {
                return origHandle.call(this, fullResponse, chat, targetChatId, targetChatType, isBackground);
            }

            const lastUserTime = getLastUserTimestamp(chat);
            const beforeCount = countAssistantMessages(chat);
            const thinkEnd = fullResponse.lastIndexOf('</thinking>');
            const head = thinkEnd !== -1 ? fullResponse.slice(0, thinkEnd + 11) : '';
            const body = fullResponse.slice(head.length);
            const pingMatch = body.match(/\[NEXT_PING:\s*(\d{1,4})\s*(?:\|([^\]]*))?\]/i);
            const cleaned = head + body.replace(/\[NEXT_PING:[^\]]*\]/gi, '').trim();
            const result = await origHandle.call(this, cleaned, chat, targetChatId, targetChatType, isBackground);

            if (chat.autoReply?.smartEnabled && getLastUserTimestamp(chat) === lastUserTime
                    && countAssistantMessages(chat) > beforeCount) {
                const minutes = Number(pingMatch?.[1]);
                if (minutes > 0) {
                    const now = Date.now();
                    chat.autoReply.nextPingAt = now + Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, minutes)) * 60000;
                    chat.autoReply.nextPingReason = (pingMatch[2] || '').trim().slice(0, 60);
                    chat.autoReply.nextPingSetAt = Math.max(now, lastUserTime);
                    await saveChatQuick(chat);
                    syncAndroidAlarm(chat);
                } else if (chat.autoReply.nextPingAt) {
                    clearSmartSchedule(chat);
                    await saveChatQuick(chat);
                }
                if (getActiveCharId() === chat.id) syncUiFromChar();
            }
            return result;
        };
        wrapped.__smartWrapped = true;
        window.handleAiReplyContent = wrapped;
    }

    // 3. 挂载到 sendMessage：用户给角色 A 发新消息时，仅作废角色 A 自己的旧预约
    let hookedSendMsg = false;
    function hookSendMessage() {
        if (hookedSendMsg || typeof window.sendMessage !== 'function') return;
        hookedSendMsg = true;
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

    // 4. 融合原版 checkAutoReply：支持多角色真正并发（不再因为别的角色在生成而阻塞）+ 失败自动回滚重试
    let hookedCheckAuto = false;
    function hookCheckAutoReply() {
        if (hookedCheckAuto || typeof window.checkAutoReply !== 'function') return;
        hookedCheckAuto = true;
        const wrapped = async function (onlyChatId) {
            if (!window.db?.characters) return;
            const now = Date.now();

            for (const char of window.db.characters) {
                if (onlyChatId && String(char.id) !== onlyChatId) continue;
                const ar = char.autoReply;
                if (!ar || (!ar.enabled && !ar.smartEnabled)) continue;
                if (!Array.isArray(char.history) || char.history.length === 0) continue;
                if (inFlightPingIds.has(char.id)) continue;

                const lastMsgTime = char.history[char.history.length - 1]?.timestamp || 0;
                const lastUserTime = getLastUserTimestamp(char);

                // 仅当这个角色自己在预约之后收到了用户发给他的新消息，才作废他自己的旧预约
                if (ar.nextPingAt && ar.nextPingSetAt && lastUserTime > ar.nextPingSetAt + 1000) {
                    clearSmartSchedule(char);
                    saveChatQuick(char).catch(() => {});
                }

                // 路径 A：智慧动态排程生效中
                if (ar.smartEnabled && ar.nextPingAt > 0) {
                    if (now < ar.nextPingAt) continue;

                    const prevPingAt = ar.nextPingAt;
                    const prevReason = ar.nextPingReason || '';
                    const prevSetAt = ar.nextPingSetAt || 0;
                    const beforeAssistantCount = countAssistantMessages(char);

                    inFlightPingIds.add(char.id);
                    const job = (async () => {
                        try {
                            clearSmartSchedule(char);
                            ar.lastTriggerTime = now;
                            if (onlyChatId) await saveChatQuick(char);
                            if (prevReason) pendingReasonMap.set(char.id, prevReason);
                            console.log(`[SmartAutoReply] Dynamic ping triggered for ${char.remarkName || char.realName}: ${prevReason || 'natural check-in'}`);
                            if (typeof window.getAiReply === 'function') {
                                await window.getAiReply(char.id, 'private', true);
                            }
                            const afterAssistantCount = countAssistantMessages(char);
                            if (afterAssistantCount <= beforeAssistantCount && !onlyChatId) {
                                ar.nextPingAt = Date.now() + 2 * 60 * 1000;
                                ar.nextPingReason = prevReason;
                                ar.nextPingSetAt = prevSetAt;
                                console.warn(`[SmartAutoReply] Ping produced no reply for ${char.remarkName || char.realName}, rescheduled in 2m`);
                                await saveChatQuick(char).catch(() => {});
                            }
                        } catch (err) {
                            if (!onlyChatId) {
                                ar.nextPingAt = Math.max(prevPingAt, Date.now() + 2 * 60 * 1000);
                                ar.nextPingReason = prevReason;
                                ar.nextPingSetAt = prevSetAt;
                            }
                            console.warn(`[SmartAutoReply] Ping failed for ${char.remarkName || char.realName}, request failed:`, err);
                            await saveChatQuick(char).catch(() => {});
                        } finally {
                            inFlightPingIds.delete(char.id);
                            syncAndroidAlarm(char);
                        }
                    })();
                    if (onlyChatId) await job;
                    continue;
                }

                // 路径 B：固定间隔基础兜底
                if (ar.enabled && !onlyChatId) {
                    const intervalMs = (ar.interval || 60) * 60 * 1000;
                    const lastTriggerTime = ar.lastTriggerTime || 0;
                    if (now - lastTriggerTime < intervalMs) continue;
                    if (now - lastMsgTime > intervalMs) {
                        inFlightPingIds.add(char.id);
                        (async () => {
                            try {
                                console.log(`[SmartAutoReply] Fallback fixed-interval auto-reply triggered for ${char.remarkName || char.realName}`);
                                ar.lastTriggerTime = now;
                                await saveChatQuick(char).catch(() => {});
                                if (typeof window.getAiReply === 'function') {
                                    await window.getAiReply(char.id, 'private', true);
                                }
                            } finally {
                                inFlightPingIds.delete(char.id);
                            }
                        })();
                    }
                }
            }
        };
        wrapped.__smartWrapped = true;
        window.checkAutoReply = wrapped;
    }

    window.runMouxiScheduledReply = async (chatId, token) => {
        try {
            const chat = window.db?.characters?.find(item => String(item.id) === chatId);
            if (chat?.autoReply?.smartEnabled && String(chat.autoReply.nextPingAt) === token
                && !inFlightPingIds.has(chat.id) && Number(token) <= Date.now()) {
                await window.checkAutoReply(chatId);
                await saveChatQuick(chat);
            }
        } catch (error) {
            console.warn('[SmartAutoReply] Android schedule failed:', error);
        } finally {
            window.MouxiAndroid?.finishBackgroundTest(token, 'scheduled');
        }
    };

    let hookedInjectSettings = false;
    function hookInjectChatSettingsHtml() {
        if (hookedInjectSettings || typeof window.injectChatSettingsHtml !== 'function') return;
        hookedInjectSettings = true;
        const origInject = window.injectChatSettingsHtml;
        const wrapped = function () {
            const ret = origInject.apply(this, arguments);
            injectSmartSettingsUI();
            if (window.OsNotifyPlugin && typeof window.OsNotifyPlugin.bootstrap === 'function') {
                window.OsNotifyPlugin.bootstrap();
            }
            return ret;
        };
        wrapped.__smartWrapped = true;
        window.injectChatSettingsHtml = wrapped;
    }

    function syncUiFromChar() {
        window.OsNotifyPlugin?.syncCharacterSettings?.();
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
        swInput.closest('.feature-card')?.classList.toggle('is-on', swInput.checked);
        if (ch.autoReply?.smartEnabled && ch.autoReply?.nextPingAt > Date.now()) {
            const d = new Date(ch.autoReply.nextPingAt);
            const tStr = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            const reason = ch.autoReply.nextPingReason ? `（${ch.autoReply.nextPingReason}）` : '';
            statusLine.innerHTML = '';
            const span = document.createElement('span');
            const alarmPending = window.MouxiAndroid?.scheduleCharacterAlarm
                && androidAlarms.get(ch.id) !== Number(ch.autoReply.nextPingAt);
            span.textContent = `下次预计：${tStr}${reason}${alarmPending ? ' · 锁屏预约未设定，请检查系统的闹钟与提醒权限' : ''}`;
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.textContent = '取消';
            cancelBtn.className = 'uwu-smart-cancel-btn';
            cancelBtn.style.cssText = 'font-size:11px;padding:1px 6px;border-radius:6px;border:1px solid #ccc;background:#fff;cursor:pointer;margin-left:6px;flex-shrink:0;';
            cancelBtn.onclick = async (e) => {
                e.stopPropagation();
                clearSmartSchedule(ch);
                await saveChatQuick(ch).catch(() => {});
                syncUiFromChar();
            };
            statusLine.append(span, cancelBtn);
        } else {
            const nextTxt = swInput.checked ? '已开启 · 暂无预约' : '关闭 · 仅用原版固定间隔';
            if (statusLine.textContent !== nextTxt) statusLine.textContent = nextTxt;
        }
    }

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
                        <button type="button" id="uwu-test-30s-btn" style="font-size:11px;padding:4px 8px;border-radius:6px;border:1px solid #d0d7de;background:#fff;cursor:pointer;color:#333;">30秒后测试自动发消息</button>
                    </div>
                </div>
            `;
        } else {
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
            await saveChatQuick(ch).catch(() => {});
            syncUiFromChar();
        });

        syncUiFromChar();
        return true;
    }

    let hookedLoadSidebar = false;
    let hookedOpenRoom = false;
    function hookLoadSettingsToSidebar() {
        if (!hookedLoadSidebar && typeof window.loadSettingsToSidebar === 'function') {
            hookedLoadSidebar = true;
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
        if (!hookedOpenRoom && typeof window.openChatRoom === 'function') {
            hookedOpenRoom = true;
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

    function bootstrap() {
        hookCoreFunctions();
        observeSettingsScreen();
        injectSmartSettingsUI();
    }

    hookCoreFunctions();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            bootstrap();
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

    window.SmartAutoReplyPlugin = {
        clearSmartSchedule,
        getLastUserTimestamp,
        bootstrap,
        syncUiFromChar
    };
})();