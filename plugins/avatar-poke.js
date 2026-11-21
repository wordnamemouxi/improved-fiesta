// === 按角色完全隔离“我的拍一拍文案”并持久化 ===
const MY_POKE_CHAR_PREFIX = 'uwu_my_poke_text_';
function getCharMyPokeKey(chat) {
    return chat && chat.id ? `${MY_POKE_CHAR_PREFIX}${chat.id}` : '';
}
function getCharMyPokeText(chat) {
    if (!chat) return '';
    if (typeof chat.myPokeText === 'string') return chat.myPokeText.trim();
    try {
        const key = getCharMyPokeKey(chat);
        const saved = key ? localStorage.getItem(key) : null;
        if (saved !== null) {
            chat.myPokeText = saved;
            return saved.trim();
        }
    } catch (e) {}
    return '';
}
function setCharMyPokeText(chat, val) {
    if (!chat) return;
    const clean = (val || '').trim();
    chat.myPokeText = clean;
    try {
        const key = getCharMyPokeKey(chat);
        if (key) localStorage.setItem(key, clean);
    } catch (e) {}
}
function syncMyPokePersistence() {
    try {
        if (typeof db !== 'undefined' && db && Array.isArray(db.characters)) {
            for (const ch of db.characters) {
                if (!ch || !ch.id) continue;
                const key = getCharMyPokeKey(ch);
                if (typeof ch.myPokeText === 'string') {
                    localStorage.setItem(key, ch.myPokeText);
                } else {
                    const saved = localStorage.getItem(key);
                    if (saved !== null) ch.myPokeText = saved;
                }
            }
        }
    } catch (e) {}
}
syncMyPokePersistence();
if (typeof window.loadData === 'function' && !window.loadData.__myPokeWrapped) {
    const origLoadData = window.loadData;
    const wrappedLoadData = async function () {
        const ret = await origLoadData.apply(this, arguments);
        syncMyPokePersistence();
        return ret;
    };
    wrappedLoadData.__myPokeWrapped = true;
    window.loadData = wrappedLoadData;
}

// === Plugin: Avatar Library, AI Self-Change Avatar & Double-Tap Poke ===
// === 角色头像库管理、AI 自主换头像与双击头像拍一拍模块 ===
async function applyAiAvatarChange(chat, ref, desc) {
    if (!chat) return;
    chat.avatarLibrary ||= [];
    let newUrl = '';
    let finalDesc = desc || '';
    if (ref.startsWith('lib:')) {
        const lid = ref.slice(4).trim();
        const found = chat.avatarLibrary.find(item => item.id === lid);
        if (found?.url) {
            newUrl = found.url;
            finalDesc = finalDesc || found.desc || '头像库头像';
        }
    } else if (ref.startsWith('img:')) {
        const idx = Number.parseInt(ref.slice(4).trim(), 10) - 1;
        const recentUserMsgs = (chat.history || []).filter(m => m && m.role === 'user').slice(-6);
        const imgs = [];
        for (const m of recentUserMsgs) {
            if (Array.isArray(m.parts)) {
                for (const p of m.parts) {
                    if (p.type === 'image' && p.data) imgs.push(p.data);
                }
            }
        }
        if (Number.isInteger(idx) && idx >= 0 && idx < imgs.length) {
            newUrl = imgs[idx];
            finalDesc = finalDesc || '和对方一起换的新头像';
        }
    }
    if (!newUrl) return;
    const isCouple = /情头|情侣头像|couple/i.test(finalDesc);
    chat.avatar = newUrl;
    chat.currentAvatarDesc = finalDesc;
    const existingItem = chat.avatarLibrary.find(item => item.url === newUrl);
    if (existingItem) {
        if (finalDesc) existingItem.desc = finalDesc;
        existingItem.isCouple = existingItem.isCouple || isCouple;
        existingItem.updatedAt = Date.now();
    } else {
        chat.avatarLibrary.unshift({
            id: 'av_' + Date.now().toString(36),
            url: newUrl,
            desc: finalDesc,
            isCouple,
            addedAt: Date.now()
        });
    }
    const cName = chat.remarkName || chat.realName || chat.name || '对方';
    chat.history ||= [];
    const avNotice = `[system-display:${cName} 更换了头像${finalDesc ? `（${finalDesc}）` : ''}]`;
    chat.history.push({
        id: `msg_avatar_${Date.now()}`,
        role: 'system',
        content: avNotice,
        parts: [{ type: 'text', text: avNotice }],
        timestamp: Date.now()
    });
    if (typeof saveData === 'function') await saveData();
    if (typeof renderMessages === 'function' && typeof currentChatId !== 'undefined' && currentChatId === chat.id) {
        renderMessages(false, true);
    }
    if (typeof showToast === 'function') showToast(`${cName} 更换了新头像`);
}

function openAvatarPokeModal() {
    if (typeof currentChatType === 'undefined' || currentChatType !== 'private') {
        if (typeof showToast === 'function') showToast('请在单人私聊中打开头像库与拍一拍设置');
        return;
    }
    const chat = (db.characters || []).find(c => c.id === currentChatId);
    if (!chat) return;
    chat.avatarLibrary ||= [];
    if (chat.avatar && !chat.avatarLibrary.some(item => item.url === chat.avatar)) {
        chat.avatarLibrary.unshift({ id: 'av_init', url: chat.avatar, desc: chat.currentAvatarDesc || '当前默认头像', addedAt: Date.now() });
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'uwu-memory-dialog uwu-avatar-poke-dialog';
    const cName = chat.remarkName || chat.realName || chat.name || '角色';

    const drawModal = () => {
        dialog.replaceChildren();
        const title = document.createElement('h2');
        title.textContent = `${cName} · 头像库与拍一拍`;
        const hint = document.createElement('p');
        hint.className = 'uwu-memory-guide';
        hint.textContent = '把常用头像加入头像库并写一句简短描述；平时聊天不占 Token，提到头像或发两张图说一起换情头时，AI 会自动感知并自己换上。双击聊天室头像即可触发“拍一拍”。';

        // Poke settings section
        const pokeBox = document.createElement('div');
        pokeBox.className = 'uwu-poke-box';
        const myPokeLbl = document.createElement('label');
        myPokeLbl.className = 'uwu-poke-label';
        myPokeLbl.textContent = '我的拍一拍文案（仅对当前角色生效）';
        const myPokeInput = document.createElement('input');
        myPokeInput.type = 'text';
        myPokeInput.value = getCharMyPokeText(chat);
        myPokeInput.placeholder = '例如：拍了拍我的脑袋';
        myPokeInput.className = 'uwu-poke-input';
        myPokeLbl.append(myPokeInput);

        const aiPokeLbl = document.createElement('label');
        aiPokeLbl.className = 'uwu-poke-label';
        aiPokeLbl.textContent = `${cName} 的拍一拍文案（留空时 AI 下次聊天会自动设定）`;
        const aiPokeInput = document.createElement('input');
        aiPokeInput.type = 'text';
        aiPokeInput.value = chat.pokeText || '';
        aiPokeInput.placeholder = '留空让 AI 首次自动生成，也可手动填写';
        aiPokeInput.className = 'uwu-poke-input';
        aiPokeLbl.append(aiPokeInput);

        const savePokeBtn = document.createElement('button');
        savePokeBtn.type = 'button';
        savePokeBtn.className = 'btn btn-primary';
        savePokeBtn.textContent = '保存拍一拍设置';
        savePokeBtn.onclick = async () => {
            const val = myPokeInput.value.trim();
            setCharMyPokeText(chat, val);
            chat.pokeText = aiPokeInput.value.trim();
            if (typeof saveData === 'function') await saveData();
            if (typeof showToast === 'function') showToast('拍一拍文案已保存');
        };
        pokeBox.append(myPokeLbl, aiPokeLbl, savePokeBtn);

        // Avatar upload section
        const addBox = document.createElement('div');
        addBox.className = 'uwu-avatar-upload-box';
        const addTitle = document.createElement('strong');
        addTitle.textContent = '添加新头像到头像库';
        addTitle.className = 'uwu-avatar-upload-title';
        const descInput = document.createElement('input');
        descInput.type = 'text';
        descInput.placeholder = '简短描述（如：头顶小猫情头 / 野外自拍）';
        descInput.className = 'uwu-avatar-desc-input';
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.onchange = async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async () => {
                const url = reader.result;
                const desc = descInput.value.trim() || file.name.replace(/\.[^.]+$/, '');
                chat.avatarLibrary.unshift({ id: 'av_' + Date.now().toString(36), url, desc, addedAt: Date.now() });
                if (typeof saveData === 'function') await saveData();
                drawModal();
            };
            reader.readAsDataURL(file);
        };
        addBox.append(addTitle, descInput, fileInput);

        // Avatar grid
        const grid = document.createElement('div');
        grid.className = 'uwu-avatar-lib-grid';
        for (const item of chat.avatarLibrary) {
            const isCur = chat.avatar === item.url;
            const card = document.createElement('div');
            card.className = `uwu-avatar-lib-card${isCur ? ' is-current' : ''}`;
            const img = document.createElement('img');
            img.src = item.url;
            img.alt = item.desc || '';
            const p = document.createElement('p');
            const coupleTag = (item.isCouple || /情头|情侣头像/i.test(item.desc || '')) ? '💑 ' : '';
            p.textContent = (isCur ? '✓ ' : '') + coupleTag + (item.desc || '未命名头像');
            const btns = document.createElement('div');
            btns.className = 'uwu-av-btns';
            if (!isCur) {
                const useBtn = document.createElement('button');
                useBtn.type = 'button';
                useBtn.textContent = '使用';
                useBtn.onclick = async () => {
                    chat.avatar = item.url;
                    chat.currentAvatarDesc = item.desc || '';
                    if (typeof saveData === 'function') await saveData();
                    if (typeof renderMessages === 'function') renderMessages(false, true);
                    drawModal();
                };
                btns.append(useBtn);
            }
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.textContent = '删';
            delBtn.onclick = async () => {
                chat.avatarLibrary = chat.avatarLibrary.filter(x => x.id !== item.id);
                if (typeof saveData === 'function') await saveData();
                drawModal();
            };
            btns.append(delBtn);
            card.append(img, p, btns);
            grid.append(card);
        }

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'btn btn-secondary';
        closeBtn.textContent = '关闭';
        closeBtn.onclick = () => dialog.close();
        dialog.append(title, hint, pokeBox, addBox, grid, closeBtn);
    };

    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    drawModal();
    document.body.append(dialog);
    dialog.showModal();
}

document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', event => {
        if (event.target?.closest?.('#avatar-poke-panel-btn')) {
            openAvatarPokeModal();
        }
    });

    // Double-tap / double-click avatar in chat room to trigger WeChat-style "拍一拍"
    let lastTapTime = 0;
    let lastTapEl = null;
    document.addEventListener('click', async event => {
        const img = event.target?.closest?.('.message-info img');
        if (!img || typeof currentChatType === 'undefined' || currentChatType !== 'private') return;
        const now = Date.now();
        if (lastTapEl === img && now - lastTapTime <= 380) {
            lastTapTime = 0;
            lastTapEl = null;
            event.preventDefault();
            event.stopPropagation();
            const chat = (db.characters || []).find(c => c.id === currentChatId);
            if (!chat) return;
            const wrapper = img.closest('.message-wrapper');
            const targetMsgId = wrapper?.dataset?.id || '';
            const isSelf = wrapper?.classList.contains('sent');
            const cName = chat.remarkName || chat.realName || chat.name || '对方';
            syncMyPokePersistence();
            const mySavedPoke = getCharMyPokeText(chat);
            const displayLine = isSelf
                ? `你${mySavedPoke || '拍了拍自己'}`
                : `你${(chat.pokeText || '').trim() || `拍了拍 ${cName}`}`;
            const msgContent = `[系统动作：${displayLine}]`;

            // 手机端触觉微震反馈（支持的设备生效）
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                try { navigator.vibrate([18, 35, 18]); } catch (e) {}
            }

            chat.history ||= [];
            chat.history.push({
                id: `msg_poke_${Date.now()}`,
                role: 'user',
                content: msgContent,
                parts: [{ type: 'text', text: msgContent }],
                isPoke: true,
                pokeDisplay: displayLine,
                timestamp: Date.now()
            });
            if (typeof saveData === 'function') await saveData();
            if (typeof renderMessages === 'function') renderMessages(false, true);

            // 重绘后再对新渲染出的对应头像施加抖动动画，确保肉眼清晰可见
            const freshImg = targetMsgId
                ? document.querySelector(`.message-wrapper[data-id="${targetMsgId}"] .message-info img`)
                : null;
            const animTarget = freshImg || img;
            if (animTarget) {
                animTarget.classList.remove('uwu-poke-shake');
                void animTarget.offsetWidth;
                animTarget.classList.add('uwu-poke-shake');
                setTimeout(() => animTarget.classList.remove('uwu-poke-shake'), 520);
            }
        } else {
            lastTapTime = now;
            lastTapEl = img;
        }
    }, true);
});

// === AI 主动拍一拍用户 ([POKE_USER]) 钩子 ===
(() => {
    if (window.__uwuAiPokeHookLoaded) return;
    window.__uwuAiPokeHookLoaded = true;

    function getMyPokeTextSafe(chat) {
        return getCharMyPokeText(chat);
    }

    function formatAiPokeLine(chat, customSuffix) {
        const cName = chat?.remarkName || chat?.realName || chat?.name || '对方';
        const custom = (customSuffix || '').trim().slice(0, 40);
        if (custom) {
            return custom.startsWith(cName) ? custom : `${cName} ${custom}`;
        }
        const myText = getMyPokeTextSafe(chat);
        if (myText) {
            const converted = myText.replace(/自己/g, '你').replace(/我/g, '你');
            return `${cName} ${converted}`;
        }
        return `${cName} 拍了拍你`;
    }

    function triggerUserAvatarShake() {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            try { navigator.vibrate([18, 35, 18]); } catch (e) {}
        }
        const sentImgs = document.querySelectorAll('.message-wrapper.sent .message-info img');
        const target = sentImgs.length ? sentImgs[sentImgs.length - 1] : null;
        if (target) {
            target.classList.remove('uwu-poke-shake');
            void target.offsetWidth;
            target.classList.add('uwu-poke-shake');
            setTimeout(() => target.classList.remove('uwu-poke-shake'), 520);
        }
    }

    function splitPokeTagsCleanly(body, chat) {
        const cName = chat?.remarkName || chat?.realName || chat?.name || '对方';
        const lines = body.split('\n');
        const out = [];
        for (const line of lines) {
            if (!/\[POKE_USER(?::[^\]]*)?\]/i.test(line)) {
                out.push(line);
                continue;
            }
            // 检测是否被包在 [角色的消息：...] 里，若是则安全拆成独立气泡与独立拍一拍系统行
            const wrapMatch = line.match(/^\s*(\[([^\]]+?[：:])\s*)([\s\S]*)(\]\s*)$/);
            if (wrapMatch && /消息|回复/.test(wrapMatch[2])) {
                const prefix = wrapMatch[1];
                const inner = wrapMatch[3];
                const parts = inner.split(/(\[POKE_USER(?::[^\]]*)?\])/i);
                for (const part of parts) {
                    const m = part.match(/^\[POKE_USER(?::([^\]]*))?\]$/i);
                    if (m) {
                        out.push(`[系统动作：${formatAiPokeLine(chat, m[1])}]`);
                    } else if (part.trim()) {
                        out.push(`${prefix}${part.trim()}]`);
                    }
                }
            } else {
                const parts = line.split(/(\[POKE_USER(?::[^\]]*)?\])/i);
                for (const part of parts) {
                    const m = part.match(/^\[POKE_USER(?::([^\]]*))?\]$/i);
                    if (m) {
                        out.push(`[系统动作：${formatAiPokeLine(chat, m[1])}]`);
                    } else if (part.trim()) {
                        out.push(part.trim());
                    }
                }
            }
        }
        return out.join('\n');
    }

    function hookAiPoke() {
        if (typeof window.buildLivelyPostscript === 'function' && !window.buildLivelyPostscript.__aiPokeWrapped) {
            const origBuild = window.buildLivelyPostscript;
            const wrapped = function (chat, historySlice) {
                let note = origBuild.apply(this, arguments) || '';
                if (chat && (!chat.members)) {
                    const cName = chat.remarkName || chat.realName || chat.name || '你';
                    const myText = getMyPokeTextSafe(chat);
                    const pokePreview = myText
                        ? `${cName} ${myText.replace(/自己/g, '对方').replace(/我/g, '对方')}`
                        : `${cName} 拍了拍对方`;
                    const tip = [
                        '[拍一拍互动（类似微信 WeChat 拍一拍）]',
                        '你拥有“拍一拍”功能：如果你想在打招呼、提醒/叫对方、安慰、庆祝、逗对方、回拍对方或顺手轻拍一下时触发，必须在回复中单独另起一行输出标签 [POKE_USER]（不能写在 [消息：...] 括号里面，也不要只在对话里口头说“我拍了你”，否则系统不会显示拍一拍）。',
                        `【重要系统提示｜角色不可见】对方设置的系统拍一拍提示文案是「${pokePreview}」。请严格记住：这仅是系统内部提示，在没有触发拍一拍时角色完全看不到这条内容，也绝对不要主动提及或剧透它！只有在你真的输出了 [POKE_USER] 完成拍一拍之后，系统才会把这行提示作为系统动作显示出来，此时角色才算真正看到这条拍一拍文案。再次强调：未拍一拍时完全不可见！`
                    ].join('\n');
                    note = note ? `${note}\n${tip}` : tip;
                }
                return note;
            };
            wrapped.__aiPokeWrapped = true;
            window.buildLivelyPostscript = wrapped;
        }

        if (typeof window.handleAiReplyContent === 'function' && !window.handleAiReplyContent.__aiPokeWrapped) {
            const origHandle = window.handleAiReplyContent;
            const wrapped = async function (fullResponse, chat, targetChatId, targetChatType, isBackground = false) {
                let processed = fullResponse;
                if (typeof processed === 'string' && targetChatType === 'private' && chat) {
                    const thinkEnd = processed.lastIndexOf('</thinking>');
                    const head = thinkEnd !== -1 ? processed.slice(0, thinkEnd + 11) : '';
                    let body = thinkEnd !== -1 ? processed.slice(thinkEnd + 11) : processed;
                    if (/\[POKE_USER(?::[^\]]*)?\]/i.test(body)) {
                        body = splitPokeTagsCleanly(body, chat);
                        processed = head + body;
                    }
                }
                return origHandle.call(this, processed, chat, targetChatId, targetChatType, isBackground);
            };
            wrapped.__aiPokeWrapped = true;
            window.handleAiReplyContent = wrapped;
        }

        if (typeof window.addMessageBubble === 'function' && !window.addMessageBubble.__aiPokeWrapped) {
            const origAdd = window.addMessageBubble;
            const wrapped = function (message, targetChatId, targetChatType) {
                const ret = origAdd.apply(this, arguments);
                if (message && message.role === 'assistant' && typeof message.content === 'string' && /^\[系统动作[：:].*拍了拍/.test(message.content.trim())) {
                    if (typeof currentChatId !== 'undefined' && currentChatId === targetChatId) {
                        triggerUserAvatarShake();
                    }
                }
                return ret;
            };
            wrapped.__aiPokeWrapped = true;
            window.addMessageBubble = wrapped;
        }
    }

    hookAiPoke();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            syncMyPokePersistence();
            hookAiPoke();
        });
    }
})();