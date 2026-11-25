// === Message Rendering, Archives, Prompts, AI Core, Chat ===
// --- 消息渲染模块 ---

function renderMessages(isLoadMore = false, forceScrollToBottom = false) {
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    if (!chat || !chat.history) return;
    const oldScrollHeight = messageArea.scrollHeight;
    const totalMessages = chat.history.length;
    
    // 确保 MESSAGES_PER_PAGE 存在
    const pageSize = (typeof MESSAGES_PER_PAGE !== 'undefined') ? MESSAGES_PER_PAGE : 20;

    const end = totalMessages - (currentPage - 1) * pageSize;
    const start = Math.max(0, end - pageSize);
    const messagesToRender = chat.history.slice(start, end);
    if (!isLoadMore) messageArea.innerHTML = '';
    const fragment = document.createDocumentFragment();
    
    let lastMsgTime = 0;
    
    if (start > 0) {
        lastMsgTime = chat.history[start - 1].timestamp;
    }

    messagesToRender.forEach((msg, index) => {
        const currentMsgTime = msg.timestamp;
        const timeDiff = currentMsgTime - lastMsgTime;
        const isSameDay = new Date(currentMsgTime).toDateString() === new Date(lastMsgTime).toDateString();
        
        if (timeDiff > 10 * 60 * 1000 || !isSameDay || lastMsgTime === 0) {
            const timeDivider = document.createElement('div');
            timeDivider.className = 'message-wrapper system-notification time-divider'; 
            
            const timeText = formatTimeDivider(currentMsgTime);
            
            timeDivider.innerHTML = `<div class="system-notification-bubble" style="background-color: transparent; color: #999; font-size: 12px; padding: 2px 8px;">${timeText}</div>`;
            fragment.appendChild(timeDivider);
        }
        lastMsgTime = currentMsgTime;

        let isContinuous = false;
        
        let invisibleRegex;
        const momentsRegex = /\[(?:.*?)\s*(?:发布了一条(?:带图)?动态|评论了.*?|回复.*?|更新了个性签名)[：:][\s\S]+?\]/;
        if (chat.showStatusUpdateMsg) {
            // 在末尾添加 |<thinking>[\s\S]*?<\/thinking>
            invisibleRegex = new RegExp([
                /\[.*?(?:接收|退回).*?的转账\]/.source,
                /\[.*?已接收礼物\]/.source,
                /\[system:.*?\]/.source,
                /\[.*?邀请.*?加入了群聊\]/.source,
                /\[.*?修改群名为：.*?\]/.source,
                /\[.*?同意了.*?的代付请求\]/.source,
                /\[.*?拒绝了.*?的代付请求\]/.source,
                /<thinking>[\s\S]*?<\/thinking>/.source,
                /^<thinking>[\s\S]*/.source,
                momentsRegex.source
            ].join('|'));
        } else {
            // 在末尾添加 |<thinking>[\s\S]*?<\/thinking>
            invisibleRegex = new RegExp([
                /\[.*?(?:接收|退回).*?的转账\]/.source,
                /\[.*?更新状态为：.*?\]/.source,
                /\[.*?已接收礼物\]/.source,
                /\[system:.*?\]/.source,
                /\[.*?邀请.*?加入了群聊\]/.source,
                /\[.*?修改群名为：.*?\]/.source,
                /\[system-display:.*?\]/.source,
                /\[.*?同意了.*?的代付请求\]/.source,
                /\[.*?拒绝了.*?的代付请求\]/.source,
                /<thinking>[\s\S]*?<\/thinking>/.source,
                /^<thinking>[\s\S]*/.source,
                momentsRegex.source
            ].join('|'));
        }

        const isSystemMsg = /\[system:.*?\]|\[system-display:.*?\]/.test(msg.content);
        
        if (!isSystemMsg) {
            let prevMsg = null;
            let currentIndexInHistory = start + index;
            
            for (let i = currentIndexInHistory - 1; i >= 0; i--) {
                const candidate = chat.history[i];
                if (!invisibleRegex.test(candidate.content)) {
                    prevMsg = candidate;
                    break;
                }
            }

            if (prevMsg) {
                const currentSender = msg.role === 'user' ? 'user' : (msg.senderId || 'assistant');
                const prevSender = prevMsg.role === 'user' ? 'user' : (prevMsg.senderId || 'assistant');
                
                const timeGap = msg.timestamp - prevMsg.timestamp;
                const isTimeClose = timeGap < 10 * 60 * 1000;

                if (currentSender === prevSender && isTimeClose) {
                    isContinuous = true;
                }
            }
        }

        const bubble = createMessageBubbleElement(msg, isContinuous);
        if (bubble) fragment.appendChild(bubble);
    });
    const existingLoadBtn = document.getElementById('load-more-btn');
    if (existingLoadBtn) existingLoadBtn.remove();
    messageArea.prepend(fragment);
    
    if (totalMessages > currentPage * pageSize) {
        const loadMoreButton = document.createElement('button');
        loadMoreButton.id = 'load-more-btn';
        loadMoreButton.className = 'load-more-btn';
        loadMoreButton.textContent = '加载更早的消息';
        messageArea.prepend(loadMoreButton);
    }
    if (forceScrollToBottom) {
        setTimeout(() => {
            messageArea.scrollTop = messageArea.scrollHeight;
        }, 0);
    } else if (isLoadMore) {
        // 临时禁用平滑滚动以防止位置跳动
        messageArea.style.scrollBehavior = 'auto';
        messageArea.scrollTop = messageArea.scrollHeight - oldScrollHeight;
        // 恢复平滑滚动 (使用 setTimeout 确保渲染周期完成)
        setTimeout(() => {
            messageArea.style.scrollBehavior = '';
        }, 0);
    }
}

function loadMoreMessages() {
    currentPage++;
    renderMessages(true, false);
}

function createMessageBubbleElement(message, isContinuous = false) {
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    // 这里需要把 isThinking 从 message 里解构出来
    let {role, content, timestamp, id, transferStatus, giftStatus, stickerData, senderId, quote, isWithdrawn, originalContent, isStatusUpdate, isThinking} = message;
    
    // 【新增补丁】如果内容以 <thinking> 开头，强制标记为 isThinking
    // 防止因为数据库加载导致 isThinking 属性丢失，或者正则没匹配到的情况
    if (content && typeof content === 'string') {
        // 兜底机制：将误写的 [char发来的照片：xxx] 或 [char发来的视频：xxx] 修正为 [char发来的照片/视频：xxx]
        content = content.replace(/\[(.+?)发来的(照片|视频)[：:]([\s\S]+?)\]/g, '[$1发来的照片/视频：$3]');
        
        if (content.trim().startsWith('<thinking>')) {
            isThinking = true;
        }
    }

    // 拦截：如果是状态更新或思考过程，且没开调试模式，直接不渲染
    if ((isStatusUpdate || isThinking) && !isDebugMode) return null;

    // 拍一拍消息：渲染为微信风格居中灰色小字（同时自动兼容修复旧版拍一拍记录）
    const pokeSysMatch = (typeof content === 'string') ? content.trim().match(/^\[(?:系统动作|system-display)[：:]([\s\S]+?)\]$/) : null;
    if (message.isPoke || (pokeSysMatch && (String(id || '').startsWith('msg_poke_') || pokeSysMatch[1].includes('拍了拍')))) {
        const pokeText = (message.pokeDisplay || (pokeSysMatch ? pokeSysMatch[1] : content) || '').trim();
        const wrapper = document.createElement('div');
        wrapper.dataset.id = id;
        wrapper.className = 'message-wrapper system-notification uwu-poke-notice';
        wrapper.innerHTML = `<div class="system-notification-bubble uwu-poke-bubble">${DOMPurify.sanitize(pokeText)}</div>`;
        return wrapper;
    }

    // ... 后续代码不变 ...


    const avatarMode = chat.avatarMode || 'full';
    let avatarClass = 'message-avatar';
    
    if (avatarMode === 'hidden') {
        avatarClass += ' avatar-hidden';
    } else if (avatarMode === 'kkt') {
        if (role === 'user') {
            avatarClass += ' avatar-hidden';
        } else if (isContinuous) {
            avatarClass += ' avatar-invisible';
        }
    } else if (avatarMode === 'merge') {
        if (isContinuous) {
            avatarClass += ' avatar-invisible';
        }
    }

    const isBilingualMode = chat.bilingualModeEnabled;
    let bilingualMatch = null;
    // 增加 && !isThinking，防止思考内容被当成双语消息解析
    if (isBilingualMode && role === 'assistant' && !isThinking) {
        // 修改正则以兼容 "的消息：" 和 "回复：" (包括 "并回复")
const contentMatch = content.match(/^\[.*?(?:消息|回复)[：:]([\s\S]+)\]$/);
        if (contentMatch) {
            const mainText = contentMatch[1].trim();
            
            // 优先尝试匹配「」
            const lastCloseBracket = mainText.lastIndexOf('」');
            if (lastCloseBracket > -1) {
                const lastOpenBracket = mainText.lastIndexOf('「', lastCloseBracket);
                if (lastOpenBracket > -1) {
                    const chineseText = mainText.substring(lastOpenBracket + 1, lastCloseBracket).trim();
                    const foreignText = mainText.substring(0, lastOpenBracket).trim();
                    if (foreignText && chineseText) {
                        bilingualMatch = [null, foreignText, chineseText];
                    }
                }
            }

            // 如果没有匹配到「」，则回退匹配 () 或 （）以兼容旧消息
            if (!bilingualMatch) {
                const lastCloseParen = Math.max(mainText.lastIndexOf(')'), mainText.lastIndexOf('）'));
                if (lastCloseParen > -1) {
                    const lastOpenParen = Math.max(
                        mainText.lastIndexOf('(', lastCloseParen),
                        mainText.lastIndexOf('（', lastCloseParen)
                    );
                    if (lastOpenParen > -1) {
                        const chineseText = mainText.substring(lastOpenParen + 1, lastCloseParen).trim();
                        const foreignText = mainText.substring(0, lastOpenParen).trim();
                        if (foreignText && chineseText) {
                            bilingualMatch = [null, foreignText, chineseText];
                        }
                    }
                }
            }
        }
    }

    if (bilingualMatch) {
        const foreignText = bilingualMatch[1].trim();
        const chineseText = bilingualMatch[2].trim();
        const wrapper = document.createElement('div');
        wrapper.dataset.id = id;
        wrapper.className = 'message-wrapper received';
        if (message.isContextDisabled) wrapper.classList.add('context-disabled');
        
        if (currentChatType === 'group') {
            wrapper.classList.add('group-message');
        }

        let avatarUrl = chat.avatar;
        let senderNickname = '';
        if (currentChatType === 'group') {
            const sender = chat.members.find(m => m.id === senderId);
            if (sender) {
                avatarUrl = sender.avatar;
                senderNickname = sender.groupNickname;
            } else {
                avatarUrl = 'data:image/jpeg;base64,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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQSACCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAQASSSQASSQACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASCCSSSAAAAAAAACSASSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAACCSAAAAAAAAAAAAAAAAAAAACCSACAAAAAAAAAAAAAAAAAAAACCACAQAAAAAAAAAAAAAAAAAAAAASCCCSAAAAAAAAAAAAAAAAASQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCAAAAAAAAAAAAAASQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQCAAAAAAAAAASQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASCAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAASAAAAAAAAAAAAAAQAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAQAAAAAAAAAAAAAQAAAAAAAAAAAACQAAAAAAAAAAAAAAQAAAAAASAAAAAAAAAAAAASAAAAAAAAAAAAASQAAAAAAAAAAAASQAAAAAACAAAAAAAAAAAAASAAAAAAAAAAAAAAQAAAAAAAAAAAACQAAAAAACAAAAAAAAAAAASAAAAAAAAAAAAAACQAAAAAAAAAAAASQAAAAAAAQAAAAAAAAAAACQAAAAAAAAAAAAAACAAAAAAAAAAACAAAAAAAAAAQAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAQAAAAAAAAAAAAAACQAAAAAAAAAAQAAAAAAAAACQAAAAAAAAACQAAAAAAAAAAAAAAACCAAAAAAAAACSAAAAAAAAAACAAAAAAAACQAAAAAAAAAAAAAAAAAQAAAAAAAASQSAAAAAAAAACCASAAAAAQCSAAAAAAAAAAAAAAAAAASAAAAAAACQSAAAAAAAAAQACAQCAAQQAAAAAAAAAAAAAAAAAAAAAAAQSQSCAASAAAAAAAAAAACQQCQCQCCAAAAAAAAAAAAAAAAAAACSAAQSSQAASAAAAAAAAASAAAAAQCSAAAAAAAAAAAAAAAAAAAAAACSASAAAAACAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAACSQSAAAAAAAAASAQAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAACQQAAAAAAAAAAQAASAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAACCASAAAAAAAACAASAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAACSQSQAAASAAAAQASSQAAAAAAAAACQAAAAAAAAAAQAAAAAAAAAAQQASAAAACQAAAQCSQAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAQACSAAACACAAASCSQAAAAAAAAAAQAAAAAAAAAAASAAAAAAAAAASSAAQACAQSAAASCCCAAAAAAAAAAQAAAAAAAAAAACAAAAAAAAAAAQACQACCSQAAACQSSAAAAAAAAACQAAAAAAAAAAAACCAAAAAAAAAAAAAAAQACQAAAAAAAAAAAAAAAQAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAACCAAAAAAAAAAAAAACAAAAAAAAAAAAAAAQSQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAASQQAAAAAAAAAAAAAAAAAAAAAAQCAAAAAAAAAAAAAAAAAAAAAACSQQAQAAAAAAAAAAAAAAAAACAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQAAAAAAAAAAAAAAACCCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASQAAAAAAAAAAAAAAAAQACAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAACASQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQCAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAACAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQCQAAAAAAAAAQACCASQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQSQQASAAQCACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACD/xAAUEQEAAAAA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';
            }
        }

        const bubbleRow = document.createElement('div');
        bubbleRow.className = 'message-bubble-row';
        const timeString = `${pad(new Date(timestamp).getHours())}:${pad(new Date(timestamp).getMinutes())}`;
        
        const bubbleElement = document.createElement('div');
        bubbleElement.className = 'message-bubble received bilingual-bubble';
        
        const styleMode = chat.bilingualBubbleStyle || 'under';
        
        if (styleMode === 'inner' || styleMode === 'inner-no-line') {
            if (styleMode === 'inner-no-line') {
                bubbleElement.classList.add('inner-no-line-style');
            } else {
                bubbleElement.classList.add('inner-style');
            }
            
            bubbleElement.innerHTML = `
                <span>${DOMPurify.sanitize(foreignText)}</span>
                <div class="bilingual-divider"></div>
                <span class="translation-inner">${DOMPurify.sanitize(chineseText)}</span>
            `;
        } else {
            bubbleElement.innerHTML = `<span>${DOMPurify.sanitize(foreignText)}</span>`;
        }

        const themeKey = chat.theme || 'white_pink';
        const theme = colorThemes[themeKey] || colorThemes['white_pink'];
        const bubbleTheme = theme.received;
        if (!chat.useCustomBubbleCss) {
            bubbleElement.style.backgroundColor = bubbleTheme.bg;
            bubbleElement.style.color = bubbleTheme.text;
        }
        
        // Time Stamp Logic for Bilingual
        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-time';
        timeSpan.textContent = timeString;

        const timestampStyle = chat.timestampStyle || 'bubble';

        // Append Time Stamp to Bubble (if style is bubble)
        if (timestampStyle === 'bubble') {
            bubbleElement.appendChild(timeSpan);
        }

        const messageInfo = document.createElement('div');
        messageInfo.className = 'message-info';
        const avatarImg = document.createElement('img');
        avatarImg.src = avatarUrl;
        avatarImg.className = avatarClass;
        messageInfo.appendChild(avatarImg);

        if (timestampStyle === 'avatar') {
            messageInfo.appendChild(timeSpan);
        }

        if (currentChatType === 'group') {
            const contentContainer = document.createElement('div');
            contentContainer.className = 'group-msg-content';
            
            if (senderNickname) {
                const nicknameDiv = document.createElement('div');
                nicknameDiv.className = 'group-nickname';
                nicknameDiv.textContent = senderNickname;
                contentContainer.appendChild(nicknameDiv);
            }
            
            contentContainer.appendChild(bubbleElement);
            bubbleRow.appendChild(messageInfo);
            bubbleRow.appendChild(contentContainer);
        } else {
            bubbleRow.appendChild(messageInfo);
            bubbleRow.appendChild(bubbleElement);
        }

        wrapper.appendChild(bubbleRow);

        if (styleMode === 'under') {
            const translationDiv = document.createElement('div');
            translationDiv.className = 'translation-text';
            translationDiv.textContent = chineseText;
            wrapper.appendChild(translationDiv);
        }

        // --- 【新增】在双语消息中注入引用(回复)气泡渲染逻辑 ---
        if (quote) {
            let quotedSenderName = '';
            // 解析被引用人的名字
            if (quote.senderId === 'user_me') {
                quotedSenderName = (currentChatType === 'private')
                    ? ((chat.myRemarkName && chat.myRemarkName.trim()) || chat.myName || 'User')
                    : chat.me.nickname;
            } else {
                if (currentChatType === 'private') {
                    quotedSenderName = chat.remarkName;
                } else {
                    const sender = chat.members.find(m => m.id === quote.senderId);
                    quotedSenderName = sender ? sender.groupNickname : '未知成员';
                }
            }
            
            // 创建引用气泡 DOM
            const quoteDiv = document.createElement('div');
            quoteDiv.className = 'quoted-message';
            const sanitizedQuotedText = DOMPurify.sanitize(quote.content, { ALLOWED_TAGS: [] });
            quoteDiv.innerHTML = `<span class="quoted-sender">回复 ${quotedSenderName}</span><p class="quoted-text">${sanitizedQuotedText}</p>`;
            
            // 将引用气泡插入到双语主气泡的前面 (CSS绝对定位会自动处理位置)
            bubbleElement.prepend(quoteDiv);
        }
        // ---------------------------------------------------
        
        return wrapper;
    }

    const timeSkipRegex = /\[system-display:([\s\S]+?)\]/;
    const inviteRegex = /\[(.*?)邀请(.*?)加入了群聊\]/;
    const renameRegex = /\[(.*?)修改群名为[：:](.*?)\]/;
    const updateStatusRegex = /\[(.*?)更新状态为[：:](.*?)\]/;
    const callInviteRegex = /\[(.*?)向(.*?)发起了(视频|语音)通话\]/;
    const callRejectRegex = /\[(.*?)拒绝了(.*?)的(视频|语音)通话\]/;

    const timeSkipMatch = content.match(timeSkipRegex);
    const inviteMatch = content.match(inviteRegex);
    const renameMatch = content.match(renameRegex);
    const updateStatusMatch = content.match(updateStatusRegex);
    const callInviteMatch = content.match(callInviteRegex);
    const callRejectMatch = content.match(callRejectRegex);

    // 私聊消息正则
    const privateRegex = /^\[Private: (.*?) -> (.*?): ([\s\S]+?)\]$/;
    const privateEndRegex = /^\[Private-End: (.*?) -> (.*?)\]$/;

    let invisibleRegex;
    const momentsRegex = /\[(?:.*?)\s*(?:发布了一条(?:带图)?动态|评论了.*?|回复.*?|更新了个性签名)[：:][\s\S]+?\]/;
    if (chat.showStatusUpdateMsg) {
        // 在末尾添加 |<thinking>[\s\S]*?<\/thinking>
        invisibleRegex = new RegExp([
            /\[.*?(?:接收|退回).*?的转账\]/.source,
            /\[.*?已接收礼物\]/.source,
            /\[system:.*?\]/.source,
            /\[系统情景通知：.*?\]/.source,
            /\[.*?同意了.*?的代付请求\]/.source,
            /\[.*?拒绝了.*?的代付请求\]/.source,
            /<thinking>[\s\S]*?<\/thinking>/.source,
            /^<thinking>[\s\S]*/.source,
            momentsRegex.source
        ].join('|'));
    } else {
        // 在末尾添加 |<thinking>[\s\S]*?<\/thinking>
        invisibleRegex = new RegExp([
            /\[.*?(?:接收|退回).*?的转账\]/.source,
            /\[.*?更新状态为：.*?\]/.source,
            /\[.*?已接收礼物\]/.source,
            /\[system:.*?\]/.source,
            /\[系统情景通知：.*?\]/.source,
            /\[.*?同意了.*?的代付请求\]/.source,
            /\[.*?拒绝了.*?的代付请求\]/.source,
            /<thinking>[\s\S]*?<\/thinking>/.source,
            /^<thinking>[\s\S]*/.source,
            momentsRegex.source
        ].join('|'));
    }

    let isDebugHiddenMsg = false;
    // 在这里增加 || isThinking，只要标记为思考中，就强制走隐形消息逻辑
    if (invisibleRegex.test(content) || privateRegex.test(content) || privateEndRegex.test(content) || isThinking) {
        if (!isDebugMode) return null; 
        isDebugHiddenMsg = true;       
    }

    const wrapper = document.createElement('div');
    wrapper.dataset.id = id;
    if (isDebugHiddenMsg) {
        wrapper.className = 'message-wrapper received';
        if (message.isContextDisabled) wrapper.classList.add('context-disabled'); 
        const bubbleRow = document.createElement('div');
        bubbleRow.className = 'message-bubble-row';
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble debug-visible'; 
        bubble.textContent = content; 
        bubbleRow.appendChild(bubble);
        wrapper.appendChild(bubbleRow);
        return wrapper;
    }

    if (isWithdrawn) {
        wrapper.className = 'message-wrapper system-notification';
        if (message.isContextDisabled) wrapper.classList.add('context-disabled');
        const withdrawnText = (role === 'user') ? '你撤回了一条消息' : `${chat.remarkName || chat.name}撤回了一条消息`;
        wrapper.innerHTML = `<div><span class="withdrawn-message">${withdrawnText}</span></div><div class="withdrawn-content">${originalContent ? DOMPurify.sanitize(originalContent.replace(/\[.*?的消息[：:]([\s\S]+?)\]/, '$1')) : ''}</div>`;
        const withdrawnMessageSpan = wrapper.querySelector('.withdrawn-message');
        if (withdrawnMessageSpan) {
            withdrawnMessageSpan.addEventListener('click', () => {
                const withdrawnContent = wrapper.querySelector('.withdrawn-content');
                if (withdrawnContent && withdrawnContent.textContent.trim()) {
                    withdrawnContent.classList.toggle('active');
                }
            });
        }
        return wrapper;
    }
    // 【新增】 && !isThinking —— 只有当不是思考过程时，才允许渲染成系统通知气泡
    if ((timeSkipMatch || inviteMatch || renameMatch || (updateStatusMatch && chat.showStatusUpdateMsg) || callInviteMatch || callRejectMatch) && !isThinking) {
        wrapper.className = 'message-wrapper system-notification';
        if (message.isContextDisabled) wrapper.classList.add('context-disabled');
        let bubbleText = '';
        if (timeSkipMatch) bubbleText = timeSkipMatch[1];
        if (inviteMatch) bubbleText = `${inviteMatch[1]}邀请${inviteMatch[2]}加入了群聊`;
        if (renameMatch) bubbleText = `${renameMatch[1]}修改群名为“${renameMatch[2]}”`;
        if (updateStatusMatch) bubbleText = `${updateStatusMatch[1]} 更新状态为：${updateStatusMatch[2]}`;
        if (callInviteMatch) bubbleText = `${callInviteMatch[1]}向${callInviteMatch[2]}发起了${callInviteMatch[3]}通话`;
        if (callRejectMatch) bubbleText = `${callRejectMatch[1]}拒绝了${callRejectMatch[2]}的${callRejectMatch[3]}通话`;
        wrapper.innerHTML = `<div class="system-notification-bubble">${bubbleText}</div>`;
        return wrapper;
    }

    const isSent = (role === 'user');
    let avatarUrl, bubbleTheme, senderNickname = '';
    const themeKey = chat.theme || 'white_pink';
    const theme = colorThemes[themeKey] || colorThemes['white_pink'];
    let messageSenderId = isSent ? 'user_me' : senderId;
    if (isSent) {
        avatarUrl = (currentChatType === 'private') ? chat.myAvatar : chat.me.avatar;
        bubbleTheme = theme.sent;
    } else {
        if (currentChatType === 'private') {
            avatarUrl = chat.avatar;
        } else {
            const sender = chat.members.find(m => m.id === senderId);
            if (sender) {
                avatarUrl = sender.avatar;
                senderNickname = sender.groupNickname;
            } else {
                avatarUrl = 'data:image/jpeg;base64,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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQSACCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAQASSSQASSQACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASCCSSSAAAAAAAACSASSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAACCSAAAAAAAAAAAAAAAAAAAACCSACAAAAAAAAAAAAAAAAAAAACCACAQAAAAAAAAAAAAAAAAAAAAASCCCSAAAAAAAAAAAAAAAAASQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCAAAAAAAAAAAAAASQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQCAAAAAAAAAASQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASCAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAASAAAAAAAAAAAAAAQAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAQAAAAAAAAAAAAAQAAAAAAAAAAAACQAAAAAAAAAAAAAAQAAAAAASAAAAAAAAAAAAASAAAAAAAAAAAAASQAAAAAAAAAAAASQAAAAAACAAAAAAAAAAAAASAAAAAAAAAAAAAAQAAAAAAAAAAAACQAAAAAACAAAAAAAAAAAASAAAAAAAAAAAAAACQAAAAAAAAAAAASQAAAAAAAQAAAAAAAAAAACQAAAAAAAAAAAAAACAAAAAAAAAAACAAAAAAAAAAQAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAQAAAAAAAAAAAAAACQAAAAAAAAAAQAAAAAAAAACQAAAAAAAAACQAAAAAAAAAAAAAAACCAAAAAAAAACSAAAAAAAAAACAAAAAAAACQAAAAAAAAAAAAAAAAAQAAAAAAAASQSAAAAAAAAACCASAAAAAQCSAAAAAAAAAAAAAAAAAASAAAAAAACQSAAAAAAAAAQACAQCAAQQAAAAAAAAAAAAAAAAAAAAAAAQSQSCAASAAAAAAAAAAACQQCQCQCCAAAAAAAAAAAAAAAAAAACSAAQSSQAASAAAAAAAAASAAAAAQCSAAAAAAAAAAAAAAAAAAAAAACSASAAAAACAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAACSQSAAAAAAAAASAQAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAACQQAAAAAAAAAAQAASAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAACCASAAAAAAAACAASAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAACSQSQAAASAAAAQASSQAAAAAAAAACQAAAAAAAAAAQAAAAAAAAAAQQASAAAACQAAAQCSQAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAQACSAAACACAAASCSQAAAAAAAAAAQAAAAAAAAAAASAAAAAAAAAASSAAQACAQSAAASCCCAAAAAAAAAAQAAAAAAAAAAACAAAAAAAAAAAQACQACCSQAAACQSSAAAAAAAAACQAAAAAAAAAAAACCAAAAAAAAAAAAAAAQACQAAAAAAAAAAAAAAAQAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAACCAAAAAAAAAAAAAACAAAAAAAAAAAAAAAQSQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAASQQAAAAAAAAAAAAAAAAAAAAAAQCAAAAAAAAAAAAAAAAAAAAAACSQQAQAAAAAAAAAAAAAAAAACAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQAAAAAAAAAAAAAAACCCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASQAAAAAAAAAAAAAAAAQACAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAACASQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQCAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAACAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQCQAAAAAAAAAQACCASQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQSQQASAAQCACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACD/xAAUEQEAAAAA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';
            }
        }
        bubbleTheme = theme.received;
    }
    const timeString = `${pad(new Date(timestamp).getHours())}:${pad(new Date(timestamp).getMinutes())}`;
    wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'}`;
    if (message.isContextDisabled) wrapper.classList.add('context-disabled');
    if (currentChatType === 'group' && !isSent) {
        wrapper.classList.add('group-message');
    }
    if (avatarClass.includes('avatar-hidden')) {
        wrapper.classList.add('no-avatar-layout');
    }
    if (avatarClass.includes('avatar-invisible')) {
        wrapper.classList.add('avatar-invisible-layout');
    }
    const bubbleRow = document.createElement('div');
    bubbleRow.className = 'message-bubble-row';
    let bubbleElement;
    const urlRegex = /^(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)|data:image\/[a-z]+;base64,)/i;
    
    const sentStickerRegex = /\[(?:.+?)发送的表情包[：:](.+?)\]/i;
    const receivedStickerRegex = /\[(?:.*?的)?表情包[：:](.+?)\]/i;
    
    const voiceRegex = /\[(?:.+?)的语音[：:]([\s\S]+?)\]/;
    const photoVideoRegex = /\[(?:.+?)发来的照片\/视频[：:]([\s\S]+?)\]/;
    const privateSentTransferRegex = /\[.*?给你转账[：:]([\d.,]+)元[；;]备注[：:](.*?)\]/;
    const privateReceivedTransferRegex = /\[.*?的转账[：:]([\d.,]+)元[；;]备注[：:](.*?)\]/;
    const groupTransferRegex = /\[(.*?)\s*向\s*(.*?)\s*转账[：:]([\d.,]+)元[；;]备注[：:](.*?)\]/;
    const privateGiftRegex = /\[(?:.+?)送来的礼物[：:]([\s\S]+?)\]/;
    const groupGiftRegex = /\[(.*?)\s*向\s*(.*?)\s*送来了礼物[：:]([\s\S]+?)\]/;
    const imageRecogRegex = /\[.*?发来了一张图片[：:]\]/;
    const textRegex = /\[(?:.+?)的消息[：:]([\s\S]+?)\]/;
    const redPacketRegex = /\[(.*?)发出了一个拼手气红包[：:](.*?)元[；;]留言[：:](.*?)\]/;
    
    // 新版购物车小票格式: [A为B下单了：配送方式|总价|商品名 x数量]
    const shopOrderRegexNew = /\[(.*?)为(.*?)下单了[：:](.*?)\|(.*?)\|(.*?)\]/;
    // 代付请求格式: [A向B发起了代付请求:总价|商品名 x数量]
    const shopPayRequestRegex = /\[(.*?)向(.*?)发起了代付请求[：:](.*?)\|(.*?)\]/;
    
    // 通话记录格式: [视频通话记录：时间；时长；总结] 或 [语音通话记录：...]
    const callRecordRegex = /\[(视频|语音)通话记录[：:](.*?)[；;](.*?)[；;](.*?)\]/;
    
    // 转发聊天记录正则
    const forwardedChatRegex = new RegExp(`<${chat.realName}转发的聊天记录>([\\s\\S]+?)<\\/${chat.realName}转发的聊天记录>`);
    
    const shopOrderMatchNew = content.match(shopOrderRegexNew);
    const shopPayRequestMatch = content.match(shopPayRequestRegex);
    const callRecordMatch = content.match(callRecordRegex);
    const forwardedChatMatch = content.match(forwardedChatRegex);
    
    const sentStickerMatch = content.match(sentStickerRegex);
    const receivedStickerMatch = content.match(receivedStickerRegex);
    const voiceMatch = content.match(voiceRegex);
    const photoVideoMatch = content.match(photoVideoRegex);
    const privateSentTransferMatch = content.match(privateSentTransferRegex);
    const privateReceivedTransferMatch = content.match(privateReceivedTransferRegex);
    const groupTransferMatch = content.match(groupTransferRegex);
    const privateGiftMatch = content.match(privateGiftRegex);
    const groupGiftMatch = content.match(groupGiftRegex);
    const imageRecogMatch = content.match(imageRecogRegex);
    const textMatch = content.match(textRegex);
    const redPacketMatch = content.match(redPacketRegex);
    
    if (redPacketMatch || message.type === 'red-packet') {
        const senderName = redPacketMatch ? redPacketMatch[1] : (isSent ? '你' : '用户');
        const remark = message.remark || (redPacketMatch ? redPacketMatch[3] : '恭喜发财，大吉大利');
        
        bubbleElement = document.createElement('div');
        bubbleElement.className = 'red-packet-card';
        bubbleElement.innerHTML = `
            <div class="red-packet-top">
                <div class="red-packet-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-piggy-bank" viewBox="0 0 16 16">
                      <path d="M5 6.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm1.138-1.496A6.613 6.613 0 0 1 7.964 4.5c.666 0 1.303.097 1.893.273a.5.5 0 0 0 .286-.958A7.602 7.602 0 0 0 7.964 3.5c-.734 0-1.441.103-2.102.292a.5.5 0 1 0 .276.962z"/>
                      <path fill-rule="evenodd" d="M7.964 1.527c-2.977 0-5.571 1.704-6.32 4.125h-.55A1 1 0 0 0 .11 6.824l.254 1.46a1.5 1.5 0 0 0 1.478 1.243h.263c.3.513.688.978 1.145 1.382l-.729 2.477a.5.5 0 0 0 .48.641h2a.5.5 0 0 0 .471-.332l.482-1.351c.635.173 1.31.267 2.011.267.707 0 1.388-.095 2.028-.272l.543 1.372a.5.5 0 0 0 .465.316h2a.5.5 0 0 0 .478-.645l-.761-2.506C13.81 9.895 14.5 8.559 14.5 7.069c0-.145-.007-.29-.02-.431.261-.11.508-.266.705-.444.315.306.815.306.815-.417 0 .223-.5.223-.461-.026a.95.95 0 0 0 .09-.255.7.7 0 0 0-.202-.645.58.58 0 0 0-.707-.098.735.735 0 0 0-.375.562c-.024.243.082.48.32.654a2.112 2.112 0 0 1-.259.153c-.534-2.664-3.284-4.595-6.442-4.595zM2.516 6.26c.455-2.066 2.667-3.733 5.448-3.733 3.146 0 5.536 2.114 5.536 4.542 0 1.254-.624 2.41-1.67 3.248a.5.5 0 0 0-.165.535l.66 2.175h-.985l-.59-1.487a.5.5 0 0 0-.629-.288c-.661.23-1.39.359-2.157.359a6.558 6.558 0 0 1-2.157-.359.5.5 0 0 0-.635.304l-.525 1.471h-.979l.633-2.15a.5.5 0 0 0-.17-.534 4.649 4.649 0 0 1-1.284-1.541.5.5 0 0 0-.446-.275h-.56a.5.5 0 0 1-.492-.414l-.254-1.46h.933a.5.5 0 0 0 .488-.393zm12.621-.857a.565.565 0 0 1-.098.21.704.704 0 0 1-.044-.025c-.146-.09-.157-.175-.152-.223a.236.236 0 0 1 .117-.173c.049-.027.08-.021.113.012a.202.202 0 0 1 .064.199z"/>
                    </svg>
                </div>
                <div class="red-packet-info">
                    <div class="red-packet-remark">${DOMPurify.sanitize(remark)}</div>
                    <div class="red-packet-type">拼手气红包</div>
                </div>
            </div>
        `;

        // 绑定点击事件
        bubbleElement.style.cursor = 'pointer';
        bubbleElement.addEventListener('click', async () => {
            if (!message.isRevealed) {
                if (message.distributions && message.distributions['user_me']) {
                    // 已经抢过，直接显示详情
                    if (typeof showRedPacketDetails === 'function') {
                        showRedPacketDetails(message, chat);
                    }
                    return;
                }
                if (message.pool && message.pool.length > 0) {
                    // 随机抽取一个金额
                    const randomIndex = Math.floor(Math.random() * message.pool.length);
                    const grabbedAmount = message.pool.splice(randomIndex, 1)[0];
                    if (!message.distributions) message.distributions = {};
                    message.distributions['user_me'] = grabbedAmount;
                    
                    // 如果池子空了，标记为已揭晓
                    if (message.pool.length === 0) {
                        message.isRevealed = true;
                    }
                    
                    await saveData();
                    
                    // 领取成功后显示详情
                    if (typeof showRedPacketDetails === 'function') {
                        showRedPacketDetails(message, chat);
                    }
                } else {
                    showToast('手慢了，红包派完了');
                    message.isRevealed = true;
                    await saveData();
                    if (typeof showRedPacketDetails === 'function') {
                        showRedPacketDetails(message, chat);
                    }
                }
            } else {
                // 已揭晓，直接显示详情
                if (typeof showRedPacketDetails === 'function') {
                    showRedPacketDetails(message, chat);
                }
            }
        });
    } else if (forwardedChatMatch) {
        const chatContent = forwardedChatMatch[1].trim();
        // 截取前两行作为预览
        const lines = chatContent.split('\n').filter(line => line.trim() !== '');
        const previewLines = lines.slice(0, 3).map(line => {
            // 简单截断过长的行
            return line.length > 20 ? line.substring(0, 20) + '...' : line;
        }).join('<br>');
        
        bubbleElement = document.createElement('div');
        bubbleElement.className = 'forwarded-chat-card';
        bubbleElement.innerHTML = `
            <div class="forwarded-chat-title">${chat.realName}的聊天记录</div>
            <div class="forwarded-chat-preview">${DOMPurify.sanitize(previewLines)}</div>
            <div class="forwarded-chat-footer">聊天记录</div>
        `;
        
        // 绑定点击事件，显示完整聊天记录
        bubbleElement.addEventListener('click', () => {
            if (typeof showForwardedChatModal === 'function') {
                showForwardedChatModal(chatContent, chat.realName);
            }
        });
    } else if (callRecordMatch) {
        // 匹配结果: [0]全文, [1]类型(视频/语音), [2]时间, [3]时长, [4]总结
        const type = callRecordMatch[1]; 
        const durationStr = callRecordMatch[3];
        
        // 复用系统通知样式，覆盖默认的 sent/received 类
        wrapper.className = 'message-wrapper system-notification';
        if (message.isContextDisabled) wrapper.classList.add('context-disabled');
        
        const title = type === '视频' ? '视频通话结束' : '语音通话结束';

        // 直接设置 wrapper 内容，模仿系统通知
        wrapper.innerHTML = `
            <div class="system-notification-bubble" style="cursor: pointer;" title="点击查看详情">
                ${title} ${durationStr} <span style="font-size: 10px; opacity: 0.6;">›</span>
            </div>
        `;
        
        // 绑定点击事件打开详情
        const bubble = wrapper.querySelector('.system-notification-bubble');
        if (message.callRecordId && bubble) {
            bubble.addEventListener('click', () => {
                if (window.VideoCallModule && typeof window.VideoCallModule.showDetailModal === 'function') {
                    window.VideoCallModule.showDetailModal(message.callRecordId);
                }
            });
        }
        
        return wrapper; // 直接返回，跳过后续的气泡组装逻辑

    } else if (shopOrderMatchNew) {
        // 新版小票渲染 (普通订单)
        // [A为B下单了：配送方式|总价|商品名 x数量]
        const deliveryType = shopOrderMatchNew[3];
        const totalPrice = shopOrderMatchNew[4];
        const itemsStr = shopOrderMatchNew[5];
        
        // 解析商品列表字符串 "汉堡 x2, 可乐 x1" -> [{name, qty}]
        const items = itemsStr.split(/,\s*/).map(s => {
            const parts = s.match(/(.+?)\s*x(\d+)$/);
            if (parts) {
                return { name: parts[1], qty: parts[2] };
            }
            return { name: s, qty: 1 };
        });

        const now = new Date(timestamp);
        const orderId = `NO.${now.getTime().toString().slice(-8)}`;
        const dateStr = `${now.getMonth()+1}/${now.getDate()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

        bubbleElement = document.createElement('div');
        bubbleElement.className = 'receipt-bubble';
        
        // 检查是否为自提订单
        const pickupMatch = deliveryType.match(/自提口令:\s*(.*)/);
        let isPickup = !!pickupMatch;
        let pickupCode = pickupMatch ? pickupMatch[1] : '';
        let isPickedUp = message.isPickedUp || false;

        let itemsHtml = '';
        let stampHtml = '';

        if (isPickup && !isPickedUp) {
            // 未自提：隐藏商品
            itemsHtml = `
                <div class="receipt-item-row">
                    <span class="receipt-item-name">🎁 神秘商品</span>
                    <span class="receipt-dots"></span>
                    <span class="receipt-item-qty">x?</span>
                </div>
            `;
        } else {
            // 已自提或普通订单：显示商品
            itemsHtml = items.map(item => `
                <div class="receipt-item-row">
                    <span class="receipt-item-name">${item.name}</span>
                    <span class="receipt-dots"></span>
                    <span class="receipt-item-qty">x${item.qty}</span>
                </div>
            `).join('');
        }

        if (isPickup && isPickedUp) {
            // 使用 SVG 图标替代印章
            stampHtml = `
            <svg class="receipt-status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M8 12l3 3 5-5"></path>
            </svg>`;
        }

        let pickupCodeHtml = '';
        if (isPickup && !isPickedUp) {
            pickupCodeHtml = `<div class="receipt-pickup-code">🔑 ${pickupCode}</div>`;
        }

        bubbleElement.innerHTML = `
            ${stampHtml}
            <div class="receipt-header">
                <div class="receipt-brand">UwU MART</div>
                <div class="receipt-id">${orderId}</div>
            </div>
            <div class="receipt-items">
                ${itemsHtml}
            </div>
            <div class="receipt-total-section">
                <span class="receipt-total-price">¥${totalPrice}</span>
            </div>
            <div class="receipt-footer">
                ${pickupCodeHtml}
                <div class="receipt-delivery-info">
                    <span>${isPickup ? '门店自提' : deliveryType}</span>
                    <span>${dateStr}</span>
                </div>
            </div>
        `;

    } else if (shopPayRequestMatch) {
        // 代付请求小票渲染
        // [A向B发起了代付请求:总价|商品名 x数量]
        let stampHtml = '';
        const totalPrice = shopPayRequestMatch[3];
        const itemsStr = shopPayRequestMatch[4];
        
        const items = itemsStr.split(/,\s*/).map(s => {
            const parts = s.match(/(.+?)\s*x(\d+)$/);
            if (parts) {
                return { name: parts[1], qty: parts[2] };
            }
            return { name: s, qty: 1 };
        });

        const now = new Date(timestamp);
        const orderId = `REQ.${now.getTime().toString().slice(-8)}`;
        const dateStr = `${now.getMonth()+1}/${now.getDate()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

        bubbleElement = document.createElement('div');
        bubbleElement.className = 'receipt-bubble pay-request';
        
        let itemsHtml = items.map(item => `
            <div class="receipt-item-row">
                <span class="receipt-item-name">${item.name}</span>
                <span class="receipt-dots"></span>
                <span class="receipt-item-qty">x${item.qty}</span>
            </div>
        `).join('');

        // 移除印章逻辑，改为修改底部文字
        let statusText = '待支付';
        if (message.payStatus === 'paid') {
            statusText = '已支付';
        } else if (message.payStatus === 'rejected') {
            statusText = '已拒绝';
        }

        let actionButtonsHtml = '';
        // 如果是接收到的消息 (AI -> User) 且状态为 pending，显示操作按钮
        if (!isSent && !message.payStatus) {
            actionButtonsHtml = `
                <div class="receipt-actions">
                    <button class="receipt-action-btn" onclick="sendPayResponse('${id}', 'pay')">支付</button>
                    <button class="receipt-action-btn" onclick="sendPayResponse('${id}', 'reject')">拒绝</button>
                </div>
            `;
        }

        bubbleElement.innerHTML = `
            ${stampHtml}
            <div class="receipt-header">
                <div class="receipt-brand">PAY FOR ME</div>
                <div class="receipt-id">${orderId}</div>
            </div>
            <div class="receipt-items">
                ${itemsHtml}
            </div>
            <div class="receipt-total-section">
                <span class="receipt-total-price">¥${totalPrice}</span>
            </div>
            <div class="receipt-footer">
                <div class="receipt-delivery-info">
                    <span class="pay-status-text">${statusText}</span>
                    <span>${dateStr}</span>
                </div>
                ${actionButtonsHtml}
            </div>
        `;

    } else if ((isSent && sentStickerMatch) || (!isSent && receivedStickerMatch)) {
        bubbleElement = document.createElement('div');
        bubbleElement.className = 'image-bubble';
        let stickerSrc = '';
        
        if (isSent && stickerData) {
            stickerSrc = stickerData;
        } else {
            const stickerName = isSent ? sentStickerMatch[1].trim() : receivedStickerMatch[1].trim();
            
            const groups = (chat.stickerGroups || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
            
            let targetSticker = null;
            if (groups.length > 0) {
                targetSticker = db.myStickers.find(s => groups.includes(s.group) && s.name === stickerName);
            }
            
            if (!targetSticker) {
                targetSticker = db.myStickers.find(s => s.name === stickerName);
            }
            
            if (targetSticker) {
                stickerSrc = targetSticker.data;
            } else {
                stickerSrc = 'data:image/jpeg;base64,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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQSACCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAQASSSQASSQACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASCCSSSAAAAAAAACSASSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAACCSAAAAAAAAAAAAAAAAAAAACCSACAAAAAAAAAAAAAAAAAAAACCACAQAAAAAAAAAAAAAAAAAAAAASCCCSAAAAAAAAAAAAAAAAASQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCAAAAAAAAAAAAAASQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQCAAAAAAAAAASQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASCAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAASAAAAAAAAAAAAAAQAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAQAAAAAAAAAAAAAQAAAAAAAAAAAACQAAAAAAAAAAAAAAQAAAAAASAAAAAAAAAAAAASAAAAAAAAAAAAASQAAAAAAAAAAAASQAAAAAACAAAAAAAAAAAAASAAAAAAAAAAAAAAQAAAAAAAAAAAACQAAAAAACAAAAAAAAAAAASAAAAAAAAAAAAAACQAAAAAAAAAAAASQAAAAAAAQAAAAAAAAAAACQAAAAAAAAAAAAAACAAAAAAAAAAACAAAAAAAAAAQAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAQAAAAAAAAAAAAAACQAAAAAAAAAAQAAAAAAAAACQAAAAAAAAACQAAAAAAAAAAAAAAACCAAAAAAAAACSAAAAAAAAAACAAAAAAAACQAAAAAAAAAAAAAAAAAQAAAAAAAASQSAAAAAAAAACCASAAAAAQCSAAAAAAAAAAAAAAAAAASAAAAAAACQSAAAAAAAAAQACAQCAAQQAAAAAAAAAAAAAAAAAAAAAAAQSQSCAASAAAAAAAAAAACQQCQCQCCAAAAAAAAAAAAAAAAAAACSAAQSSQAASAAAAAAAAASAAAAAQCSAAAAAAAAAAAAAAAAAAAAAACSASAAAAACAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAACSQSAAAAAAAAASAQAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAACQQAAAAAAAAAAQAASAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAACCASAAAAAAAACAASAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAACSQSQAAASAAAAQASSQAAAAAAAAACQAAAAAAAAAAQAAAAAAAAAAQQASAAAACQAAAQCSQAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAQACSAAACACAAASCSQAAAAAAAAAAQAAAAAAAAAAASAAAAAAAAAASSAAQACAQSAAASCCCAAAAAAAAAAQAAAAAAAAAAACAAAAAAAAAAAQACQACCSQAAACQSSAAAAAAAAACQAAAAAAAAAAAACCAAAAAAAAAAAAAAAQACQAAAAAAAAAAAAAAAQAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAACCAAAAAAAAAAAAAACAAAAAAAAAAAAAAAQSQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAASQQAAAAAAAAAAAAAAAAAAAAAAQCAAAAAAAAAAAAAAAAAAAAAACSQQAQAAAAAAAAAAAAAAAAACAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQAAAAAAAAAAAAAAACCCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASQAAAAAAAAAAAAAAAAQACAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAACASQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQCAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAACAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQCQAAAAAAAAAQACCASQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQSQQASAAQCACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACD/xAAUEQEAAAAA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'; 
            }
        }
        bubbleElement.innerHTML = `<img src="${stickerSrc}" alt="表情包">`;
    } else if (privateGiftMatch || groupGiftMatch) {
        const match = privateGiftMatch || groupGiftMatch;
        bubbleElement = document.createElement('div');
        bubbleElement.className = 'gift-card';
        if (giftStatus === 'received') {
            bubbleElement.classList.add('received');
        }
        let giftText;
        if (groupGiftMatch) {
            const from = groupGiftMatch[1];
            const to = groupGiftMatch[2];
            giftText = isSent ? `你送给 ${to} 的礼物` : `${from} 送给 ${to} 的礼物`;
        } else {
            giftText = isSent ? '您有一份礼物～' : '您有一份礼物～';
        }
        bubbleElement.innerHTML = `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAAC0AgMAAABAo+6hAAAAAXNSR0IArs4c6QAAAAxQTFRFTGlx////AAAA5N/fcYeliAAAAAF0Uk5TAEDm2GYAAAEjSURBVGje7ZfREYMgEES1CPuxCM/0YD8UARaRKtKERUhAvUMiJPlMWHYcFHj4scMdR9NU/YE6Ihq+HgehR6PcaEu0TXfbu5dxTJqhyRjlvkdjNC/Do8Wsw0e3QPuHxDu2FYhms4QmaYfjd95WKFom2hPHbS+/QKKjMNN01pQNtvLpkJT3HbajxnfVkDu8YWi6bCxkeguzu7WLODhbux7BBke3YRs5+iH23Twtm6wHo49zOpl9eByNJnbNmRiJ6YvfpdNNKFnOROgma2QQWm/ES4tM78f2RSp7v8SgKaRmScSETbsjatfi6Jk7a6UrHWefOUEv2VxVPu1rGpOSztTIIHTGQWSaONgC/fEuVTZ9SkAR/ebOjUEnqhlwmlLCpquqfl9Pmuj8ZUUcPGkAAAAASUVORK5CYII=" alt="gift" class="gift-card-icon"><div class="gift-card-text">${giftText}</div><div class="gift-card-received-stamp">已查收</div>`;
        const description = groupGiftMatch ? groupGiftMatch[3].trim() : match[1].trim();
        const descriptionDiv = document.createElement('div');
        descriptionDiv.className = 'gift-card-description';
        descriptionDiv.textContent = description;
        wrapper.appendChild(descriptionDiv);
    } else if (voiceMatch) {
        bubbleElement = document.createElement('div');
        bubbleElement.className = 'voice-bubble';
        if (!chat.useCustomBubbleCss) {
            bubbleElement.style.backgroundColor = bubbleTheme.bg;
            bubbleElement.style.color = bubbleTheme.text;
        }
        bubbleElement.innerHTML = `<svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg><span class="duration">${calculateVoiceDuration(voiceMatch[1].trim())}"</span>`;
        const transcriptDiv = document.createElement('div');
        transcriptDiv.className = 'voice-transcript';
        transcriptDiv.textContent = voiceMatch[1].trim();
        wrapper.appendChild(transcriptDiv);
    } else if (photoVideoMatch) {
        const pvContent = photoVideoMatch[1].trim();
        let isRealPhoto = false;
        let realPhotoUrl = '';

        // 检查真实相册匹配
        if (currentChatType === 'private' && !isSent && chat.useRealGallery && chat.gallery) {
            const galleryItem = chat.gallery.find(item => item.name === pvContent);
            if (galleryItem) {
                isRealPhoto = true;
                realPhotoUrl = galleryItem.url;
            }
        }

        if (isRealPhoto) {
            bubbleElement = document.createElement('div');
            bubbleElement.className = 'image-bubble';
            bubbleElement.innerHTML = `<img src="${realPhotoUrl}" alt="${pvContent}" onclick="openImageViewer(this.src)" style="cursor: zoom-in;">`;
        } else {
            bubbleElement = document.createElement('div');
            bubbleElement.className = 'pv-card';
            bubbleElement.innerHTML = `<div class="pv-card-content">${pvContent}</div><div class="pv-card-image-overlay" style="background-image: url('${isSent ? 'data:image/jpeg;base64,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JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIJJJIBJJJJJJBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIIIIAJIBJBJIIBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBAJBJBAJBAAJIJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIBJBIAJABIBIBAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBAIAAAAAAAAIIBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIABAAAAAAABIAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIJIAAAAAAAAABJAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIAIAAAAAAAAAAAAAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIBBAIAAAAAAAAAAAIJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJAJABJAAAAAAAAAAAAJBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJAJABBIAAABAABIAAAAAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJAIJBBJIABIAABIAAAAAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJAIIIJBAAAAAAIAAAAJBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIBABJIAAAAAAAAAAABJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIBJBABJAAAAAAAAAAAABJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBAIAAAAAAAAJAAAAAABJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIJJBIAIAAAABIABAAAABIJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIAJIIAAAAAABJAJAAAAAAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBBJBAJIAAABJBIBAAAAAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJAJJJAAIAAAABAAAAAAABJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIABAIBAAAJAIAAAAAAAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIAJIIBJAABIBJAAAAAAAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIAAAAAAAAAAAAAAAAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBAAAAAAAAAAAAAAAIBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBIAAAAAAAAAAAAAAIBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIAAAAAAAAAAAAAAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJAJAAAAAAAAAAAAABBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIIAAAAAAAAAAAAAAABJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIAAAAAAAAAAAAAAABAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBBBAAAAAAAAAAAAAIABJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIBBJAAAAAAAAAAAAAIBIAAJJJJJJJJJJJJJJJJJJJJJJJJJABJJAABAAAAAAAAAJAAABBAJJIJJJJJJJJJJJJJJJJJJJJJJJAABIBBIIIJAJIAJIIJJJJJIBBJBJJJJJJJJJJJJJJJJJJJJJJJBIJJJBBJIJBBJIBJIAAABJJABJIBJJJJJJJJJJJJJJJJJJJJJJIABJJIJJIAJBJJAABJBAJJAJAABJJJJJJJJJJJJJJJJJJJJJJJBJIAAAAAAAABJJAAAAAAIAAAIJJIJJJJJJJJJJJJJJJJJJJJJJBJIAAAAAAAJJJJJJJJJJAAAAIAIJJJJJJJJJJJJJJJJJJJJJJJBJIAAAAAAAAAAAAAAAAAAAAAAAAJJJJJJJJJJJJJJJJJJJJJJJBJIAAAAAAAAAAAAAAAAAAAAAAAAJJJJJJJJJJJJJJJJJJJJJJJBJIAAAAAAAAAAAAAAAAAAAAAAAAJJJJJJJJJJJJJJJJJJJJJJJBJIAAAAAABIAAAAAAAAAAAAAAAAJJJJJJJJJJJJJJJJJJJJJJJBJIAAAAABJIAAAAAAAAAAAAAAAAJJJJJJJJJJJJJJJJJJJJJJJBJIAAAAABABIJIAAAAAAAAAAAAJJJJJJJJJJJJJJJJJJJJJJJJBJIAAAAJIBAIIAAAAAAAAAAAAAIBJJJJJJJJJJJJJJJJJJJJJJBJIAAABJABBAAJAAAAAAAAAAIAIBJJJJJJJJJJJJJJJJJJJJJJBJIAAJIBAJJBJABIAAAAAAAAJAIBJJJJJJJJJJJJJJJJJJJJJJBJIAABIBBJJJIIBBAAAAAJAABAIBJJJJJJJJJJJJJJJJJJJJJJBJIAAJBIBJJJJBJBIIAAAIAABAIBJJJJJJJJJJJJJJJJJJJJJJBJIAIJBBBJJJJIJJIIBJAAABJIJBJJJJJJJJJJJJJJJJJJJJJJBJIAJBBJJJJJJJBAIBJIIJABIIABBJJJJJJJJJJJJJJJJJJJJJBJJIJBJJJJJJJJJJIBJIAAAAIAAAIJJJJJJJJJJJJJJJJJJJJJBBBBJJJJJJJJJJJJIABAIIABBIBJBAJJJJJJJJJJJJJJJJJJJJAAJABJJJJJJJJJJJJIJJIIJIAAJIIAJJJJJJJJJJJJJJJJJJJJBIBBJJJJJJJJJJJJJJJBBIIIBBABJAJJJJJJJJJJJJJJJJJJJJBIAJJJJJJJJJJJJJJJJBJIAIAABIJJJJJJJJJJJJJJJJJJJJJJAIBJJJJJJJJJJJJJJAJJAIJIABAIJJJJJJJJJJJJJJJJJJJJJJAAJJJJJJJJJJJJJJIJBJIBIBAIIBJJJJJJJJJJJJJJJJJJJJJJAIJJJJJJJJJJJJJJJABIIIBABIBAJJJJJJJJJJJJJJJJJJJJJJBJJJJJJJJJJJJJJJJJIJJBJBAJIJBIJJJJJJJJJJJJJJJJJJJJBJJJJJJJJJJJJJJJJIBAJBBAIIIABJJJJJJJJJJJJJJJJJJJJJBIJJJJJJJJJJJJJJJIJJIJIJAABIIJAJJJJJJJJJJJJJJJJJJJBJBJJJJJJJJJJJJJJJJJIBJJJAABIIBJJJJJJJJJJJJJJJJJJJBIBJJJJJJJJJJJJJJJJJJBBJIBJBJJJJJJJJJJJJJJJJJJJJJJBAJJIAAAAAJJIJBIAIABIIBIABBBJJJJJJJJJJJJJJJJJJJJJJIABIAABJJBAIBIABIBJJAJAIBAJBJJJJJJJJJJJJJJJJJJJJJJBIAAJJJJJJABIBABAIJABAABBIJAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIABJJJJBJIJAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIJBJJIAAJABJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIJJJJBBAJIBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBJJJAIJJIAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBJJJJIBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJAJJJJJJJJJJJJJJJJJJJJJJJJJIBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIAABIAIBIJJJJAAJJJJJJBIJIIAAJBJAJJIABJIJJJJJJJJJJIBBJBJJIBJAJAAJAABJIAAJBIAAJBJBIBBJJBBBJIAAJJJJJJJIBIBBJBABIIBBBJJJJIIABAJIIABJIBJJJBIJAIAIJAIJJJJJJIBBABJBJJJABABAIABIIJBIJABABABBJBJBBJBAJIBAAJJJJJJIAAJJJIAJIIJABBAIBJBIAIAAJIAAIBJAIAIAIBAAJIIJJJJJJIIJIBJAJJIIBABABAJAIIBJBIJAABIAJAAABIIBIAJBJJJJJJJIJIIBAAIJJJBAABIIAIJBJJIJIIAABBBABAAIAAJJJIJJJJJJJJAAJBJJAJJBBABJBIAJIBJJBABABIAJIIIBJAAAJJIAJJJJJJJJJIBBBJJJBBIIJIAIBJIBJJJIAIAIIJJABJJJJJIBJBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIIBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJP/EABQRAQAAAAAAAAAAAAAAAAAAAND/2gAIAQMBAT8QHEP/xAAUEQEAAAAAAAAAAAAAAAAAAADQ/9oACAECAQE/EBxD/8QALRABAAIBAwEGBgMBAQEAAAAAAQARITFBUWEQcYGRofAgMEBQscFg0fHhkKD/2gAIAQEAAT8Q/wDgNXNGYiGkESXWarpLHT+QBdeswd4vBhk27L3g1KbLKNRu8/AZlS5cv5niPd/DCPqxWUEjXgQYTZrtDxj4huzfrA0rXnZFSBqQ72XDolIm3g4jqIogi7uK7KCy98TBU7qPAzyQm/FCAu4nSV1PgdIyIBj375qg+hDDCagihVtvP8LoxmRIB9Aj1iaqlAdXdhvTrGed+IMHa0RjJHA4mTdxaxTLcrEseMVCb/FP9olt5IitScwxRLoy1P8AFwCpDZS4UW4IEAU2WVV3VKqPQLxflYwYsBmuhAJYtdPq8Qxh3lg3Rj3GbTNQpqnP8KFZyjRpK2K3c4JbWcbj+o5THKlixi4sY85ak9Qq/UpYOrgXuIIKbcF+cKozgB2GJfYoaS++WeR5gdsmxb0ikvpaSai7OvKymq8UlGBwsxihuqIURwboQS6aT2YgTQquISNjYesDRTHdcfkP8Jy0zDFOBmrvjLaiWwJsoIlNOQ4D3bwuU0EB81zqXEvgku5loSzqv+okIDQS+oPZTJbAyO/WGDARbgi1ZFdgi33dPGKYU/wdkalQVa3XBzdHZTRCtZVR3blfHemkqYqJtXz8mjUrweSFs6kbJcATKc11RrT0KkhlruchMMqFdQ/uHwohekKWgYfwW+xotWitZSyaEaRWj3qAcsNokwNOkF/SlAMx6fHmIjy0sPIwyA1Y+Ka+g/gt5ji6iUVKL9FDkhrN8rbqwWBjBldOn1A5g0crkj01WzYT+5mfX9ZAJLHIn8ESsxNOksYNtxNMogMqwCRHA0Noyt6dIc3qBWr+mS4R8mQypfkeEYhjFlI69IjaGn38u2bqp1022diTQXtBesQ9IGTkTo7nw7A2KiMwnEHut5+oBQHBz/RGu2uHCQxCmj1m33+rZ1LSoslUWaI6gF25UdMQECZqAXuGKFAL1jgsdQmE8QHAfGtLdCZrMb19HSGWMN43eDYJo/A4EGVWggu/+8wgBMiaPyT0DVtHMAXJoMdWwsen38xQIowx8wMP9RSBm0xKTQxdozFlqHeWN1MOL4myWFXUWtxekEGBGv8AIXcsRqa7J8CHNKgfCKjDjcczOMErm4uiAHy+C6WRtaFwRvnmNMp2rbGPk3KgB4gfyUN1P0InHH39Gduo7xU1WrBFogIJeZZyq9ZgMHjuYNkodYuwURNNukKsQ74ghKdYOORolYHCX8JxosYfEibM6PY7r+G/kwAYQ2AXnCLUGacE8PkBcy33gNXNdDtmas0T+AjkEZRTHyEuCYoQENO1PUmLlOAeFiVi3pCjLtJv3Rr8yvlXWYaIofftMjlV4ME1tG/vqYgF2sBXH2pBwgcmFhSVJW04KgzTX6QlFePwZpVqx8SU5IQBnQjnWGPp9VN3MIQoh794iluLu++n70ahzDXELZltFo1lrOYQItWhCVGWHikug74NnYfZnlZQCeR+YlBdVkQm2aBV9YJtCcnzXTqZgmYsfc5/uK9pDaXf3uvVDeyGggxQqAGQL5jwlQL1RrrYZ7yULdLioJo9iA0Z3JYVWdQgg2ubZ+V4WVc01GNF21XcziROJZqBM2mpfHbrpQSiWaOFYMSt1fya4azqXe4gpECj75cuGfPasBLjoOcxSLKB5RA2gX6RMagDrH8srIRAFIxQ1mqdSCWNESiQdYdfko4KGMF6nn2ZOTrua9r/AB8geiVgNy08yNRzVhHnBb/IZEtoPjFReCfgPvtRmKC1jvBKW5HRAaMQWKF4FaQOQRjugT2skEaCEBxesSwgmiMAE3QNY2oKq2Y2uj5SunxkclDUHXXsvTOmlNyGS4RIloyzMJaKL1mTkJE2SMiOoBZSvyK5GtnmS9/RPwffbxGDMDlFgJq21zM9DR0mzgK+cAZwBmI4bxHFaRQidHum45hkzGucvh6QrY+Ho47q9CXAloih8Y0daPZAEWbh04IKjLDtYuD3QibRNrSqw5IeC+rlcsP9HRWQXezl7j5RGv0Jc7uM3ffd/GVjsZHRgIHqpAZ3SK7C1ec38wu8KYuRN6QtGi9E1biwvLKS/ifdhLetouQ1IUjFPdAogRcrKQrIQDJ5YP5neZydYwOmsuEhbUgQdywaMr5Z2WcLumEMBbm7DJ983jTVyiLjxFDpngMtLOr/AKQ5BKRlNTXaE3xHLDF3LOJZxF+IO2uWzv5me/ad0fK7qPi9lZiHUGA0Ad0Pl0DamdWDQZME2YaffXsvJWSLax5qWa5+fo+cABNH65QM4CIG0Eg7DLzKXFV9+SyGk3ghWIRXjoZeC8VebMfXXMNlvVaVKJ6v5whsEfwAKewTJaYJsxFQhp5v64W2WSOdD9zhQSwEXH8CS43AxzslnU5w29+79a5ISusW3IylB3vMt8P4Cbl1FgxLVxNQVoWBgY2MR1jCLaBb9YrtCqIu0wXwwUArRG7jZA9P4CqcA3mqGRN4RNS2mhzcMErU1X1uVly7mHeCENJ38xJWFqYhQA9Vj+AgwAjocwk8Ba6dYX4WRrvTBwI6F9RE6vku+sLt1JWMKlO8Jv8A8RW8l0Skmgw5/gDd0Q1kzbbZi2xkStVNOxG0qU6qtYyOG27xiHSaD+rAOnZqirrTKn8RC5MiaffwMuyMElT+fNRG5Dj7qhVkKaN6k32sXh0ib+FPrp9VQELNyMHEQIXliuxakv8AfNZ2GAynsVKlfdKlfCTxasd5C7dmPEt2UOAN/HWZErEbDaKeaKtDcYpG6LZDM9957b+gp4lPHw1brpqDllhLLe6YAHPbxwS8XGB2RvWr5wwqwFzWVL6S+jL6MvozX7hkVGpoCMTINXPdIl/z22l2bEKar3QXY04qZyG2cuI9rdP4DCisgbOyPMLrGIO/R6y5Sc0VI0hveOs/1mEef3FHATuZ0fOnFYt/rn+PP8eEGqzfHVkt7aqQ4R4TXgvdNFDwlf8AQT/AJT1O8lIZQRFIUXRMjEHPaLVjINn6BuLRK7pBZbVhmHNavGUQpZXdgT9HZFv9ERf1z/Ln+XBpY7oZSGa+3m/dCZVasS7BVlmqO6KmrynXeU67ynXeU67yi+7ymjdJDxIptya1VQxUd+w7pkeGBu+UrL1hnW1RmLUmkbqZ+EJZ5c/zoF/RDdflOp8p1PlOp8p1PlOsgWifCdX5Tq/KdT5Qbd5dlDtWsvsKF3/CH9CmgJ4VM5AbFz8+WLP4GBxFOsR0O7EWGmXbL4XcmhvyjQurglf9E/zp/kT/ACJ/kSxEDea/zUlYv7ddXKjswLB0uExpcSv+Ke6ie6ie6ie6ie6iY38qX5cd1UUrs6Qa13TMYgJ0NGG42DSc6d5Ne8iaADwgHN+Eo6+Uo6+US6j5ToM6DOgzoM6DKtvOdA8p0DylrQ8oDgnSjqRQbxzuecobHnB5+FwRMV5zCDdSOMpuAMrV0Xd8CMiYb5SognBDTBlmzynQeU6Dyn+BP8CU/wCEwoVZmV1MfbzrPzuyPTTd9FcvoS+hL6EvoS+hLdpaWlstLS0tLS0tlstFvsMdO25cvui52lvSW9IPRGnChHL9tdZ+d2R6Wbvn1colEolEolEolEolEolEolEolEolEolHyb6fBkehMF5hp9udZ+d2R6WbvuGp3T0UND7c6z87sj0s3fcNTunooaH251n53ZHpZu+4andPRQ0PtzrPzuyPSzd864FBFZDUrRChmER4+v1O6eihofbnWfndkelm75qo1OYsVaFjRaYajTF0HcOjCIDgXDNNfrdTunooaH251n53ZHpZu+W+UZh0KMXhQvMRo18xuRE0FTUCAFCuGCp054gczcQIwxE1+qOToQUM0D7c6z87sj0s3fKQFWjrHL38bRCFm8wQGOYRIzDGNYGuC0ErsFRM7HWCkVQ8GdWHERHj6a/g9Mdj47/tzrPzuyPSzd8h1xGqmQrEOLsw0Q3MxliBMZgbIxS7wgNJBOkbwWcSgVE2gRjuuH0b4uUyM/R1cpWipsNSyVXZ6Y7Hx3/bnWfndkelm74guNBnEU5uwMx7plKtVhBg7GsrEGiOd+y+kW9pdTUSEhhTbmO6MCKWMbG97zChw7XmKGuII/QCpoEU17GaUlYZJl2emOx8d/251n53ZHpZu+GsXtE7qgImuAjtKcRUUzFwoFQQK+S+cOwZ/EYYxGjZIqKRNTjnePFr1hlTh+Tkyo69rpFrYxrEclzCVa4t9uuz0x2Pjv8AtzrPzuyPSzd8LQgNmdJZZHzEy7QCUzBWKxEuD8pCjvBabOZZbmRBEivhkwAuZdyLEesg2X8DpOfFxvEGuYWly7+GQwgEdYR2PpjsfHf9udZ+d2R6Wbu0LiQIJoxHUm5Cj5eCCFZl71RLRbgV8u4qsQvIDNWlPpM2IZW7oYL5wEYaobdpUsxtMmuIqvMN5xMBeYFY+B9RGt3wX4+0lkFceO/7c6z87sj0s3djpEgJRCBBbRIODVkAcze7uXfz0uUiCULI4ouWjRxES7pOIcR8DAQz8kGwbOSCJEQFGsZRhtKG0AhNOziYXrNYMvB0NSbz3nsr+4ZlQzp9rdZ+d2R6WbpdLQ3jx9w6RqSd2NaaywI0gKBUq9fpNNJzhzCunpNfLJfEkpFmTHbtMEsSl+hFsuJYQ63eZfDsNSVh1hoQWEonRLpIbT3rMz1nHfMv6h9ycsSEY3uBeFYn2p1jfEggPlRaqEoR6MREVZiHjEuQZl3x9SbkLjFoqJgjUBLeEKoj1g+4cQ1xpHJhBGAYzCt3YlMApNBNLhoQVw3CKN2CO0Lfip6yNWLQbsKgbAYzJroMEtzKgssvSJX2ljrxp3S4WAsMF6xYCsxoQJtysujU0Vn6xBKS4Tgi9hcFllUaleUKlS2ZScvdEHSU1wxih32lkwtlvKhdJdVYw2NDaw8QFRUDxECrtKJzUbI3GJFpusd9bj8U3pBEFGWOH7SwWXVmW9WJdmoaQ6KuXGzxMcUwus/XE5IdtFzENiXoDxHDJozHK98RgzqcR0jTeGwcTSA5ySmHMMCOyjMBM82AitXM0Bmr0JRffzqw4Qm+7BY6R1+0sF97EGqzGxDEoFlKxW00l39cnaZswCquNVFdIqIGDVKIWGDySqJTaAYPXWNsGZmWGs1i1LZB3EvZb728s98so5UIkRqyhgKJRAq6+1MVd7DkLxLrG31xpCBrOxkHMb9hnlRaF+MFuql6iGQKuSBygQ6QPchoeASLeuOsRdcSqDso9cxpq9IaOrPWVXQ1CLf21hs+swMViZ+t3CADqhYQzp/Kbc8opqEs0CbeYhJdEraTHMBXFmkhLgEbQzYOsIhttG+PSGkIlZgWPFAKeZq+3JGB2uZGOpd/W3hBBswLVwMHSJjfZ8545ilDcC6POK2sF6RC4gjS5VnLpFelQwqHDNMXJlVAY2S0TutTSOZq+3+umn9cNY6xLKWRgg6LmHQJsg+yApZcRi1lypuEBInohGTPMcIXB4SQWs8GA7HDEXCJKm9CFEA5jhIL3zTBmgePGpPwTVBHpUMG/tPrpp/YAXABTScDLE6vrKPPnMtXPfM1rNYKH9QW+ks1JRKYWCWKFQnQa5h5BDT2RZrxFUtVy2YvnKNF5w0geMNF50Vwe5h8iQ6zCrDWd/2j1004JX11ypctlvLLeZZxmW7k0l12V2pcpySq0LIhgagDug5VmqmWEkWc3hH8v3E1zyZ/jw8TvpE1i5pi2/Z9p66acoDFv7I1KTVWODp1DDVYupDqB1rb4hxFHE0rEJTcEtGUQTYa6VF2U8JdteEVveE/wSDAadJVoA4IfZ9p66acAEliY+xjnksDaxZ+jZGql3VxVRsbkNlzU/EdIxejeHSFOsFotTpaH7+3VdZiUeqWIuzaXW7VLDX8FtvNptNptNptNptNuyF9k7idxO4ncTuI8oobSnEDUVisDFIrAaisJLaEcIBzlgjDRMt41ELAsVttrFgRre9Yh7Cy1N1B7Xei4KzDozbSm2w0ZEbREO1vWXVI8srhsCH7+3ALQcLGXAg6ZiBQIz6O1VKc/FYiZgjHxCIiYlok60daOVHWjrRowoyHhgLZOgnQRPQseLHgwHZDi+UAZIYHSJA5GrikW1g99I1MKAtZnlcUpYjQgyiN08qLS0GZtE4qOCUuzMeoT5lUK6J4cNpvUVUUmMyojQzFqZCAlfbjIkeMyyIMoJcuNJd7zxeypUqVKlSpUPGX3y++NPMrqldUKOextzO4zuM7jCjU84gynErwwA6RoKmCUu0QkJgBaxn7cGsdIcABZXT0hAA4Ce2J3osI5IcoAyQKwUQMKVUx/wCBAv6I5cZTiFU2I0DNh0cRiUB3EcOwMIt/bdPkV9HcuXLmsrt9IBhbbgxt2XHRNpE7aQaQUBQTX4FpPSW7hlQS7rAidIkSHYBAuMUA5ckbYMBhDglJdYY/iIulFNp3mVnp8TruGZltWXpApshmO0dKhKHGstcTtoyxWBHSmKUVzW8fKx06/wAQNZQ68zO+vxqn4GXQyXhLNMwdY7dofCdIzPZUUYIbN4qLk18Sv4hfyOhD/Ea4tkkCW6aWfEyx6KXUZQ03/iEFrrEPT+MMUytHlBnHIPGOwTOgz+JL1ma0qtyaysfxiy5EL+y15iEx3VcLQCgPkXn7ZV/Puvr3MrP2cm1Ap6ESCKNP+c9j/qex/wBT2P8Aqex/1PY/6iHs/SYt4JVosa7KCg16jQZYN6KhQ81jsVR9jYSmKZYIgCpQVcde2wTKFy/bAjNhetXiVKHxKBVAN2f4KL+CWKKtlj0IijxqEl0EWpTowlNkOatauoaxinq7l1ehLBHlw/09PhOpN/gyYek0pFGFvB8AMkALVaCJQUVJuU/bhjiVZN4AYWZr7v8AcEfZKVByj1iIsRQ1QZ/mo41jwEaRdnpP9z/U/wBz/U/3P9Q8wGLElg9lx0A9G0qjugUnsqJ2F+DMe6tH5hcwtdicj8Nhq0brKUVAO6rDky9I75oRbtWS95TVokSUS8QMW06rpLWA7cE1yMZlOZ49iIAMqtBBecGc0qmG2kMsoVEl0mzHEDWRDN2lUd0MXNBsVwX3fQ+38oAChyFBdPCYffecMg7rMpewhbCwJlLocHwe1Ikq0qy8Lqh2nuHDs9i4Z7Nywc9pJaZ7DgGtFAcxtVtOMunfKnlDAWyrtGWG9vMxo+7pXNDEoJzUFa0z/N/vKNfb75bam6tEVedCIIOa/edpgPbeEDwa5A13e5hvbh1bSysQS7mb1LpMYglHQzJPNWij84/EQJFmpd7avQ17ER8Cqp0aZ7j/AHPcf7leN4RmmyyOErRLOEue5f3Pcv7hUSs4HRIQI1BYjsxhS3ni9tTJHwBsdzZ4d4KCddQpaBOwUK6ipMcuZXSGLGJZpF/YCl10wQNQF53qEM4IMBV4lTXnJLxZNX4BQzRRsfmCmj3/APMs09RQFKbJc9M/Oe3de0abIpvF1u5Vu/Rmc+nJly20ek3CKOXgbPwA6vostqvC6EF3YQFZqLtpdTSE0owadzUJYWFEEDTUNaRnKFobgOgG8TP2Vc2yqlvfQARGkRsPRl1DAJCnWy+KhG5sqDqwF8WI08/2t46RVDzxLjgjYAhgFrKn9O/tgBhBiJa3nvgIpUCDq1FjSLgQBKGgg16/P995TFOrKqBW3/xHLGSKaF1+QIBp6WAa8a9YYo6fgjEbiE4M7yV3sFrmL3Dh2OvZYY6vAURq1U9xfqEFXYM1rKJS4Y4IrqkntL9QMOzU6zg6Q4RA1rJBnvjIIuOyGWKA/chBXL3MaNatQ3DV1hrQrCqBKWETkQfSZG7Qqpz5wTQwaMK/TsqWCx7FeZaaxUSQIWlQOVghZEyAXGFbsME1LaNDMAm2nS2YdXEGgzB1XtA9Jd+cDC5uzLeeqM2DNdoW/GEvQeU6pbkskkLMaOwI4GoYLRmjiF5Jpo8kf4mC+QKvZrWiYexzidAaawNoKgIjqS1/OoVuLcGxB5FKr1KCmdJktZy/0QmRCEqim3OiQ1YYNASyLMmYtoUONagIbMmxFuHYlWXgYM44vOKqvGLhIPFcXmgozE3MJeyFLEFx3+c9r+uaDDr1LqjrLJF7WaFq6uBQF317CQ4ZqC6GC4lnKmUdNQiIkJSh/L1lLgIqDit1tXZS6vss5QuQmXvxgqIxF3lEq3rvcafOVl5LnZxF7u6IOBrLzKANp6TQva+IRXqhr3SbJB1yBqWUVtXfugWGELEdEj/dNUUM25NvGEGleFfkr0gZiqu+CTSoDwHE7aPRTaDxigmJKgLVfpM5jajnLFxNeAMgAaAYAlV8733lBStLCzUltCdFzo/biNjKDUhlTnlIDeGWCudx/MQhSmhG30OukJQ9bjqu717OvcOHZvMn90K14AHpie7v1Pd36nu79T3d+ooktMO6qrv7GfoceC0wxYZ3f9oj1VHnli7WL7z/AF2EPQHawqK7qh0Jd56kZ1DUgcK7w1cOLSAUXcWFBBv0oEFQDCyi28S2XqhdM1xIJcuVKetRkElqBVXlluVm+Z71yntHHs994Z7717PaOU945wIpRwLS5M1NFjFtF1hbQWAMWaOv4xCjbAWpU34lh+5/cbMFqByrrAQwUA8HnKdfOf3NT8k7bTqxUyzJKrVE8mXvPgsgDXviE/IFc2L0ysstGpG7sPXMoipsAb4LiQaacAamkcBAoJbaNyW6q7zvNI2OKS1Cyzqxhq5Gl3j1jvpfkYvSBGFFoZe93gIg2kcU7mpv3SZGngYezLtXWepUSihV9zPeH7gX8haoXuy3MUtrV3iewv3FI1ivcy+gxgq6C/SDRNKhnKJ+DzfoNpQmka9AC4vLEejlwKqNladmQwKKJcOLYL8DFaNgbJlj280akGTKzKa0LXpNXzvfeUoFB3AIW2uoEwtmrRrro+EHtAiS9C3wJUGWLo4vlO+M+67tHXdBWgaKrQWBLQsC2dFu89w4dhB6fkETGoREapme7f3Pd/7nu/8AcpWSqrumcd/bn6h38KPzAYsKHhZ/aGi1VdVM0Du/ensYegO1hUzutFNqs13R2yAgu0c9D+pap8IKpTDCN6RZULx0jOohUEsxUoIQK9XL8QsfHnAY8X8RK1yfZNfF/HZn7HKXwf8A9ACWE93fqMCIm3BvDneJve5A2vR8OwtULlbouzPYecMXHffvy7E7wRcdTYWZjsEMGAGqbaJ2PIx8dUNWhzF7uCo0yCzZNf4N4ZYjHFwWo1XVLIsIdMBY14vJPSfzns/WY303iByaSugfgjNgFHQtnvnLHXsB0uD1JYW0PLfwZjfAnIHMHgB32fRwrtUKH2uRhOFMSkhagWqvSatFpoLyJxBSkTBHRGsyp2JpDLm1aQ2lpK0GA5vGZZ5Rt5jB3W4k5/1Iy85No4b7alSiYgVhoVSxTtxmhDdTOITCFelS8Us1fO995dn55mUNvcpaQ99JvHcHEygLAXwNLewYjtGvdzKadopclzJtOHuZ7hw7MYhkNy6RSrQjDaydgZdDFqrAVEKK7/g0EihY3f8AgTvBLKhX9TNlNdfFsUq4bHcL++xh6A7WFR/ffBco7zE0+tCCPVbJV5N3U2y3eAbTsVhi8ltQIWFVK2yL5Yh+RfUv+ywlMbbrwLYRU5hsH717C3BdW+aG1y03ANaz/Z/3FULGanLFeEMSmUnLa7m2fvf9yzmpXiylOsBQrQU69uz1b8obozLrTMpY43R70WgYWX0V2Omp6LFM2jZGNOlvw7Gv27wy9TE6Ro3qg7AZOcpb1uNuBbJYNrzPZ+syoGQ8X5GKUuOmqFF+LCWOv7p75yx1hlmTSx2lNDr4TEoO/W/ofGeNMno/ioDLsgaalaS/vfqez/xBvs/iW9n9TIVFtpHV4S4jLtcAvTpKEzm80hVV1lwd9DY8OzETYFoP2dYb91hF8lYy60KuHiGjgmtKsiRLHHOCQAvYJUW9IqBvJrmFrHeFEKxQfP8AfeXZ+Ox4cE0F46dIsJtA3zMx5Msn9IlMM9xfq/MfKai1tMdLziY+9wz3DhE9NftaQfvwjFrF0s1K8Wolq32DIntvH4NCynQWF58mkW6C57zPSocypL2Cj8suBrANQAIDqhJ6CmBgbw2gA8TMi1++yoRcgS4Cx844suGx6xBa+JoV1RL4AT2itDWPmv1QA03xDeRhbxVX9xuwl7S2Ic6eEGAjMcageeYPNgljS6GKUDVRfFIUEtAUHZ7Twz3Xr2IVaLdcQKK27CU12N1DzFFhQucOlptzLOUNxHcG1jbYMegK8h2HX95OS75xMu9/hKJr9u8MvUx9y5RV1VsmXcfzns/WPXLrJAHLM126PVdo6T2DmLFu4PFjrCZqMlYwHBLzi6+kIy6qpkAbthM8ipM0rAaaTJ9l12XWHmCMy8NW6F0vRj89Yyd6ceUKIdDROHOHpEjpezWMOR3AF9YiYglkKusZHewt1Vl7PUuwMe4o+wJSJLIQZpV58GndKVsVbBnz1mHucOzhu/PF+9yjW+q41Gim8RXtFNNRJzUCeU0JVIABAOAJclSsTaFUYmO8/oSzelLaVledq2g+QgRnZdL17TWe28YzsI7Jlou+eta1GJGBZoyXVYBvbObEasutJZIl3g2wFCNTFSKxa3MYm+zNWhCo2EFoavxgAY7MWRVeExJw6MKk60W0BMnSU+i6N+RAkXLcNEy1pFOGkQpasjI/yldiUNerpEwiqMO8a11idClavR6hhJVGiYAXJr3s9GwoK+AX7HDPdevwhRUuIzvc3q8Q/YKAtehz17PCggFkupVYDsBMoNawfOigvvQXLxaD22FHpCa8lj6Zi7CVQ8Q8iogGHCjpB7oMp27zjCgAJWFSHLeXNshWo/mLE12Lc3r4yhITgav99g4OkYKJy4uvK4EcVDRp3HcmD9b+4yvhYq6g3iUKsJGgvuZhpEo7EHWC468FUbvwYtpMx01ltlvUE5sbA07dIi27DYBndZ0I2whJs7PUPwgexg9V5pjlw7xaxNY2NIla9WV0nMkVwRbA54aB8xm788WrBR0ZeoC40ojha3ZR/wAI40K7pb7Zb7ZYM6d8sHa0VGDAzJvRVoKC2Gw+hdOjAooKOnwNiAxVLbox9c7J5qttzsdh1ycQeT68gULHEnhQr3WRpJ6gX76Oy10bBOVqYNCpSBChFB4wcE6CAeHZUMoqgFNNEY3nLCAUOTzBqAB0SDQQDoBoBFXBb9SYeqJRri9fhNiS1jNChJq9JR6FvwVn9RbnHQEHh2iOruDWH1AF+AabG92b7+rKBeXgICYJQ7jrBQKm8mNOCAR48zaXQUlAothrFRLL+YUckvIR/alXV16Qv4QFQGwS+VuCS9HpMuQhoeKfhaJ24PUmhB7+IVBGxDT0h4IsAKD4y0P5SN6GprPlA+5T8Gs7PKOLMxut5rdrrK7wK7D/ADFvmNdGCjlsWA9y1A/hQaA4D6YMvDELfhAr6+q+DXaGHsvtLcrPwpf/AI/f/9k=' : 'data:image/jpeg;base64,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AJJIABJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJAIBIJIABIJIJJIABAJBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBJJJABBIBAJBIAAAIBBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIIJJAIJBBJJJJJJBBIIJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIAJIJABJJJJJJJJJIJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBAJIJJJBJJJJJJJJJJABJBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBAABBIJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBJBAAABJJJJJJJJJJJIAIJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIBJJJJJJJJJJJJJIABJJJJJJJJJJJJJJJJJJJJJJJJJJJAAIBJJJJJJJBJJJJJJJJBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIIAABIJJJJJJIJIABJJJIBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIAIIIJJJJJJAJJBJJJJJIJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIBJJJJJJIAJJIJJJJJAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJAJJJJJJIJJJJJJJJJIJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIJJJJJJJJJBJJJJJJJJBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIAIJJJJJJIAJJJJJJJJIJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJAIJJJJJJJAIJIJJJJABJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIAIJJJJJJJBBIABJJJAIJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJAJJJJJJJJAAIIAJJJIBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIIJJJJJJJIAIAAJJJJIAJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIIJJJJJJIJJIABJJJJIJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBBJJJJJJAJAIJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBBJJJJJJJJJJJJJJJABJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIBJJJJJJJJJJJJJJJBBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIAJJJJJJJJJJJJJJJJBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJAJJJJJJJJJJJJJJIBBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIIJJJJJJJJJJJJJJJBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJBIJJJJJJJJJJJJJJIJBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIABJJJJJJJJJJJJJJJIBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJABJJAJJJJAAAAAAJJIABJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJABIAAJJJJAAAAAAJJBJBJJJJJJJJJJJJJJJJJJJJJJJJJJJJABABIIJAJAJAAAABJJBJJJJAJJJJJJJJJJJJJJJJJJJJJJJJJBIIAIABIBAAJAAAJBBIJAJAABJJJJJJJJJJJJJJJJJJJJJJJJIBBJIAABAAJAAIAIIIBBBBBJJJJJJJJJJJJJJJJJJJJJJJJJJJIAJBBAAIBIAJJJJJIJJIJAJJIAJJJJJJJJJJJJJJJJJJJJJJJJIIJBAAAIJJAAJJJJBBJJIIBJJIJJJJJJJJJJJJJJJJJJJJJJJJJJIAAAAJJJJJJJJJIAJJIIJJAJJJJJJJJJJJJJJJJJJJJJJJAABIIJJJJJJJBJJJJJJJJJIJJJAJJJJJJJJJJJJJJJJJJJJJIIIJJAIAAAAABBJJJJJJJJJJIIBJAJJJJJJJJJJJJJJJJJJJJJIBABBAAIIBIBAIJJJJJJJJIIJAJJAJJJJJJJJJJJJJJJJJJJJJIAJIIBAJJJJJBBBJJJJJJJAIJJIAJJJJJJJJJJJJJJJJJJJJJJIBJJAABAJBAJBBIJBJJJJJAIJJJBJJJJJJJJJJJJJJJJJJJJJJJABIBJJBAJIBAABJAJJJJJJBJAAJIBJJJJJJJJJJJJJJJJJJJJJABBBIJAAJABABJBBAJJJJJBJIBABJJJJJJJJJJJJJJJJJJJJJJBJABIBBJBBJABJJBAJBJJJABAAJJIJJJJJJJJJJJJJJJJJJJJJABABIABBJBJABJJAJJIAJJABBIIJIJJJJJJJJJJJJJJJJJJJJJABBJBABBBJBABJJIBJJBBJIAAIJJIJJJJJJJJJJJJJJJJJJJJJIAJIAAAIIBAJJJJJJABBBJJAJIABIJJJJJJJJJJJJJJJJJJJJJABIBBBIABBBAJJJJJJJAJJIAAIJJIJJJJJJJJJJJJJJJJJJJJJJAAIBBIAJBBJBJJJJJJAAIJBIAIBIJJJJJJJJJJJJJJJJJJJJJBIAJABBAIBBIIBIAABJIAABIIBBAIJJJJJJJJJJJJJJJJJJJJJJJJIJBIAIJAAAIBJJJBJAJAJIJBIIJJJJJJJJJJJJJJJJJJJJJJJJIBAIIIBAAAIBJJJJAIJABAIABABJJJJJJJJJJJJJJJJJJJJJJJJIAIJJBIAAAJJJJJBIJABJIJBJJJJJJJJJJJJJJJJJJJJJJJJJJBAJIIBJJAAJJIJBAIABBJAABIBJJJJJJJJJJJJJJJJJJJJJJJJAABIJBABIBIABBIBAJIIBJABJJJJJJJJJJJJJJJJJJJJJJJJJJJAJBBAABBIBIBBIAABJAIJJJIAJJJJJJJJJJJJJJJJJJJJJJJJBIAJBIBBIIAIJAJIABIJJBAJBJBJJJJJJJJJJJJJJJJJJJJJJJBIAJAIIAJIJJBABBBJBAJJAJAAIJJJJJJJJJJJJJJJJJJJJJJIIJAJAABIIAIJBJIIAJJAIABJIBIJJJJJJJJJJJJJJJJJJJJJJIIAIBABJIAIJJJJIBJJAIBIJBJJIJJJJJJJJJJJJJJJJJJJJJJIJIAJIAJJBJAJBJJAAJJAIBJJBIABJJJJJJJJJJJJJJJJJJJJJJJAAIIAIAIBBBJIBJBAAABJBIIJBJJJJJJJJJJJJJJJJJJJJJJJAAIAAAJIIJBBJBJJBAJBIIIAIIAJJJJJJJJJJJJJJJJJJJJJJJJJJBJIAIIAIJAJJJIBJAAABJJAJJJJJJJJJJJJJJJJJJJJJJJJJJIJJJAJJJJJBJAJIJIAAABJJBBJJJJJJJJJJJJJJJJJJJJJJJJJJBJJJJJJJJAJBJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJIJBIJJJJJJIJBJJJBJ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'}');"></div><div class="pv-card-footer"><svg viewBox="0 0 24 24"><path d="M4,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4M4,6V18H20V6H4M10,9A1,1 0 0,1 11,10A1,1 0 0,1 10,11A1,1 0 0,1 9,10A1,1 0 0,1 10,9M8,17L11,13L13,15L17,10L20,14V17H8Z"></path></svg><span>照片/视频・长按接收</span></div>`;
        }
    } else if (privateSentTransferMatch || privateReceivedTransferMatch || groupTransferMatch) {
        const isSentTransfer = !!privateSentTransferMatch || (groupTransferMatch && isSent);
        const match = privateSentTransferMatch || privateReceivedTransferMatch || groupTransferMatch;
        let amount, remarkText, titleText;
        if (groupTransferMatch) {
            const from = groupTransferMatch[1];
            const to = groupTransferMatch[2];
            amount = parseFloat(groupTransferMatch[3].replace(/,/g, '')).toFixed(2);
            remarkText = groupTransferMatch[4] || '';
            
            const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;
            const isToMe = (to === myName);

            if (isSent) {
                titleText = `向 ${to} 转账`;
            } else {
                if (isToMe) {
                    titleText = `${from} 向你转账`;
                } else {
                    titleText = `${from} 向 ${to} 转账`;
                }
            }
        } else {
            amount = parseFloat(match[1].replace(/,/g, '')).toFixed(2);
            remarkText = match[2] || '';
            titleText = isSentTransfer ? '给你转账' : '转账';
        }
        bubbleElement = document.createElement('div');
        bubbleElement.className = `transfer-card ${isSentTransfer ? 'sent-transfer' : 'received-transfer'}`;
        
        let statusText = isSentTransfer ? '待查收' : '转账给你';
        if (groupTransferMatch && !isSent) {
            const to = groupTransferMatch[2];
            const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;
            if (to === myName) {
                statusText = '转账给你';
            } else {
                statusText = '转账给Ta';
            }
        }
        
        if (transferStatus === 'received') {
            statusText = '已收款';
            bubbleElement.classList.add('received');
        } else if (transferStatus === 'returned') {
            statusText = '已退回';
            bubbleElement.classList.add('returned');
        }
        if ((transferStatus !== 'pending' && currentChatType === 'private') || currentChatType === 'group') {
            bubbleElement.style.cursor = 'default';
        }
        const remarkHTML = remarkText ? `<p class="transfer-remark">${remarkText}</p>` : '';
        bubbleElement.innerHTML = `<div class="overlay"></div><div class="transfer-content"><p class="transfer-title">${titleText}</p><p class="transfer-amount">¥${amount}</p>${remarkHTML}<p class="transfer-status">${statusText}</p></div>`;
    } else if (imageRecogMatch || urlRegex.test(content)) {
        bubbleElement = document.createElement('div');
        bubbleElement.className = 'image-bubble';
        bubbleElement.innerHTML = `<img src="${content}" alt="图片消息">`;
    } else if (textMatch) {
        bubbleElement = document.createElement('div');
        bubbleElement.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
        let userText = textMatch[1].trim().replace(/\[发送时间:.*?\]/g, '').trim();
        bubbleElement.innerHTML = `<span class="bubble-content">${DOMPurify.sanitize(userText)}</span>`;
        if (!chat.useCustomBubbleCss) {
            bubbleElement.style.backgroundColor = bubbleTheme.bg;
            bubbleElement.style.color = bubbleTheme.text;
        }
    } else if (message && Array.isArray(message.parts) && message.parts[0] && message.parts[0].type === 'html') {
        bubbleElement = document.createElement('div');
        bubbleElement.className = `message-bubble ${isSent ? 'sent' : 'received'} html-bubble`;
        const htmlContent = message.parts[0].text;
        if (htmlContent.includes('<!DOCTYPE html>') || htmlContent.includes('<html')) {
            const processedHtml = processTemplate(htmlContent, chat);
            bubbleElement.innerHTML = `<iframe srcdoc="${processedHtml.replace(/"/g, '"')}" style="width: 100%; min-width: 250px; height: 350px; border: none; background: white; border-radius: 10px;"></iframe>`;
        } else {
            const processedHtml = processTemplate(htmlContent, chat);
            bubbleElement.innerHTML = DOMPurify.sanitize(processedHtml, { ADD_TAGS: ['style'], ADD_ATTR: ['style'] });
        }
    } else {
        bubbleElement = document.createElement('div');
        bubbleElement.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
        let displayedContent = content;
        const plainTextMatch = content.match(/^\[.*?[：:]([\s\S]*)\]$/);
        if (plainTextMatch && plainTextMatch[1]) {
            displayedContent = plainTextMatch[1].trim();
        }
        displayedContent = displayedContent.replace(/\[发送时间:.*?\]/g, '').trim();

        if (currentChatType === 'private' && !isSent && chat.statusPanel && chat.statusPanel.enabled && chat.statusPanel.regexPattern && !isDebugMode) {
            try {
                let pattern = chat.statusPanel.regexPattern;
                let flags = 'gs';

                const matchParts = pattern.match(/^\/(.*?)\/([a-z]*)$/);
                if (matchParts) {
                    pattern = matchParts[1];
                    flags = matchParts[2] || 'gs';
                    if (!flags.includes('g')) flags += 'g';
                }

                const regex = new RegExp(pattern, flags);
                displayedContent = displayedContent.replace(regex, '').trim();
            } catch (e) {
                console.error("渲染时隐藏状态码失败:", e);
            }
        }

        bubbleElement.innerHTML = `<span class="bubble-content">${DOMPurify.sanitize(displayedContent)}</span>`;
        if (!chat.useCustomBubbleCss) {
            bubbleElement.style.backgroundColor = bubbleTheme.bg;
            bubbleElement.style.color = bubbleTheme.text;
        }
    }
    const nicknameHTML = (currentChatType === 'group' && !isSent && senderNickname) ? `<div class="group-nickname">${senderNickname}</div>` : '';

    // Time Stamp Logic
    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = timeString;

    const timestampStyle = chat.timestampStyle || 'bubble';

    // Append Time Stamp to Bubble (if style is bubble)
    // 注意：小票气泡 (receipt-bubble) 内部自带时间，不需要外部时间戳
    // 红包 (red-packet-card) 也不需要外部时间戳
    if (bubbleElement && timestampStyle === 'bubble' && !bubbleElement.classList.contains('receipt-bubble') && !bubbleElement.classList.contains('red-packet-card')) {
        bubbleElement.appendChild(timeSpan);
    }
    
    // Create message-info element manually to allow appending timestamp if needed
    const messageInfo = document.createElement('div');
    messageInfo.className = 'message-info';
    const avatarImg = document.createElement('img');
    avatarImg.src = avatarUrl;
    avatarImg.className = avatarClass;
    messageInfo.appendChild(avatarImg);

    if (timestampStyle === 'avatar') {
        messageInfo.appendChild(timeSpan);
    }

    if (currentChatType === 'group' && !isSent) {
        // 群聊接收消息布局：头像左侧，右侧垂直排列昵称和气泡
        const contentContainer = document.createElement('div');
        contentContainer.className = 'group-msg-content';
        
        if (nicknameHTML) {
            contentContainer.innerHTML += nicknameHTML;
        }
        
        if (bubbleElement) {
            if (quote) {
                let quotedSenderName = '';
                if (quote.senderId === 'user_me') {
                    quotedSenderName = (currentChatType === 'private')
                        ? ((chat.myRemarkName && chat.myRemarkName.trim()) || chat.myName || 'User')
                        : chat.me.nickname;
                } else {
                    if (currentChatType === 'private') {
                        quotedSenderName = chat.remarkName;
                    } else {
                        const sender = chat.members.find(m => m.id === quote.senderId);
                        quotedSenderName = sender ? sender.groupNickname : '未知成员';
                    }
                }
                const quoteDiv = document.createElement('div');
                quoteDiv.className = 'quoted-message';
                const sanitizedQuotedText = DOMPurify.sanitize(quote.content, { ALLOWED_TAGS: [] });
                quoteDiv.innerHTML = `<span class="quoted-sender">回复 ${quotedSenderName}</span><p class="quoted-text">${sanitizedQuotedText}</p>`;
                bubbleElement.prepend(quoteDiv);
            }
            contentContainer.appendChild(bubbleElement);
        }
        
        bubbleRow.appendChild(messageInfo);
        bubbleRow.appendChild(contentContainer);
    } else {
        // 私聊或发送消息布局：保持原样
        bubbleRow.appendChild(messageInfo);
        
        if (bubbleElement) {
            if (quote) {
                let quotedSenderName = '';
                if (quote.senderId === 'user_me') {
                    quotedSenderName = (currentChatType === 'private')
                        ? ((chat.myRemarkName && chat.myRemarkName.trim()) || chat.myName || 'User')
                        : chat.me.nickname;
                } else {
                    if (currentChatType === 'private') {
                        quotedSenderName = chat.remarkName;
                    } else {
                        const sender = chat.members.find(m => m.id === quote.senderId);
                        quotedSenderName = sender ? sender.groupNickname : '未知成员';
                    }
                }
                const quoteDiv = document.createElement('div');
                quoteDiv.className = 'quoted-message';
                const sanitizedQuotedText = DOMPurify.sanitize(quote.content, { ALLOWED_TAGS: [] });
                quoteDiv.innerHTML = `<span class="quoted-sender">回复 ${quotedSenderName}</span><p class="quoted-text">${sanitizedQuotedText}</p>`;
                bubbleElement.prepend(quoteDiv);
            }
            bubbleRow.appendChild(bubbleElement);
        }
    }
    wrapper.prepend(bubbleRow);
    return wrapper;
}

// 全局函数：处理代付响应
window.sendPayResponse = async function(msgId, action) {
    const chat = db.characters.find(c => c.id === currentChatId);
    if (!chat) return;

    const msg = chat.history.find(m => m.id === msgId);
    if (!msg) return;

    // 1. 更新原消息状态
    msg.payStatus = action === 'pay' ? 'paid' : 'rejected';
    
    // 2. 刷新界面（为了让原消息的小票立刻变成"已支付/已拒绝"状态）
    const wrapper = document.querySelector(`.message-wrapper[data-id="${msgId}"]`);
    if (wrapper) {
         renderMessages(false, false);
    }

    // 3. 构建指令消息文本
    const myName = chat.myName;
    const realName = chat.realName;
    let responseText = '';
    
    if (action === 'pay') {
        responseText = `[${myName}同意了${realName}的代付请求]`;
    } else {
        responseText = `[${myName}拒绝了${realName}的代付请求]`;
    }

    // 4. 【关键修改】直接手动添加消息，不走发送按钮逻辑
    // 这样就不会被包裹成 [用户消息：...] 了
    const newMsg = {
        id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        role: 'user',
        content: responseText,
        timestamp: Date.now(),
        // isStatusUpdate: true 标记为状态更新类消息
    };

    chat.history.push(newMsg);
    
    // 5. 保存并刷新到底部
    if (typeof saveData === 'function') await saveData(); 
    renderMessages(false, true); 
};


function addMessageBubble(message, targetChatId, targetChatType) {
    if (targetChatId !== currentChatId || targetChatType !== currentChatType) {
        const senderChat = (targetChatType === 'private')
            ? db.characters.find(c => c.id === targetChatId)
            : db.groups.find(g => g.id === targetChatId);
        
        if (senderChat) {
            let invisibleRegex;
            const momentsRegexSource = /\[(?:.*?)\s*(?:发布了一条(?:带图)?动态|评论了.*?|回复.*?|更新了个性签名)[：:][\s\S]+?\]/.source;
            if (senderChat.showStatusUpdateMsg) {
                // 在末尾添加 |<thinking>[\s\S]*?<\/thinking>
                invisibleRegex = new RegExp([
                    /\[system:.*?\]/.source,
                    /\[.*?已接收礼物\]/.source,
                    /\[.*?(?:接收|退回).*?的转账\]/.source,
                    /\[.*?同意了.*?的代付请求\]/.source,
                    /\[.*?拒绝了.*?的代付请求\]/.source,
                    /\[.*?拒绝了.*?的(?:视频|语音)通话\]/.source,
                    /<thinking>[\s\S]*?<\/thinking>/.source,
                    /^<thinking>[\s\S]*/.source,
                    momentsRegexSource
                ].join('|'));
            } else {
                // 在末尾添加 |<thinking>[\s\S]*?<\/thinking>
                invisibleRegex = new RegExp([
                    /\[system:.*?\]/.source,
                    /\[.*?更新状态为：.*?\]/.source,
                    /\[.*?已接收礼物\]/.source,
                    /\[.*?(?:接收|退回).*?的转账\]/.source,
                    /\[.*?同意了.*?的代付请求\]/.source,
                    /\[.*?拒绝了.*?的代付请求\]/.source,
                    /\[.*?拒绝了.*?的(?:视频|语音)通话\]/.source,
                    /<thinking>[\s\S]*?<\/thinking>/.source,
                    /^<thinking>[\s\S]*/.source,
                    momentsRegexSource
                ].join('|'));
            }
            const isInvisibleCrossMsg = invisibleRegex.test(message.content) || Boolean(message.isThinking) || Boolean(message.isStatusUpdate);
            if (!isInvisibleCrossMsg) {
                senderChat.unreadCount = (senderChat.unreadCount || 0) + 1;
            } else {
                return;
            }
            
            let senderName, senderAvatar;
            if (targetChatType === 'private') {
                senderName = senderChat.remarkName;
                senderAvatar = senderChat.avatar;
            } else { 
                const sender = senderChat.members.find(m => m.id === message.senderId);
                if (sender) {
                    senderName = sender.groupNickname;
                    senderAvatar = sender.avatar;
                } else { 
                    senderName = senderChat.name;
                    senderAvatar = senderChat.avatar;
                }
            }

            let previewText = message.content;

            if (previewText && typeof previewText === 'string') {
                previewText = previewText.replace(/\[(.+?)发来的(照片|视频)[：:]([\s\S]+?)\]/g, '[$1发来的照片/视频：$3]');
            }

            const textMatch = previewText.match(/\[.*?的消息[：:]([\s\S]+?)\]/);
            if (textMatch) {
                previewText = textMatch[1];
            } else {
                if (/\[.*?的表情包[：:].*?\]/.test(previewText)) previewText = '[表情包]';
                else if (/\[.*?的语音[：:].*?\]/.test(previewText)) previewText = '[语音]';
                else if (/\[.*?发来的照片\/视频[：:].*?\]/.test(previewText)) previewText = '[照片/视频]';
                else if (/\[.*?的转账[：:].*?\]/.test(previewText) || /\[.*?向.*?转账[：:].*?\]/.test(previewText)) previewText = '[转账]';
                else if (/\[.*?送来的礼物[：:].*?\]/.test(previewText)) previewText = '[礼物]';
                else if (/\[.*?发来了一张图片[：:]\]/.test(previewText)) previewText = '[图片]';
                else if (/\[商城订单[：:].*?\]/.test(previewText)) previewText = '[商城订单]';
                else if (message.parts && message.parts.some(p => p.type === 'html')) previewText = '[互动]';
            }
            
            // 同一个后台角色短时间内连发多条气泡时节流提示，避免连续触发 DOM 重排卡顿
            const nowToastTs = Date.now();
            window.__uwuCrossToastTs ||= {};
            if (!window.__uwuCrossToastTs[targetChatId] || nowToastTs - window.__uwuCrossToastTs[targetChatId] > 1800) {
                window.__uwuCrossToastTs[targetChatId] = nowToastTs;
                showToast({
                    avatar: senderAvatar,
                    name: senderName,
                    message: previewText.substring(0, 30)
                });
            }
        }
        return; 
    }

    if (currentChatType === 'private') {
        const character = db.characters.find(c => c.id === currentChatId);
        const updateStatusRegex = new RegExp(`\\[${character.realName}更新状态为[：:](.*?)\\]`);
        const transferActionRegex = new RegExp(`\\[${character.realName}(接收|退回)${character.myName}的转账\\]`);
        const giftReceivedRegex = new RegExp(`\\[${character.realName}已接收礼物\\]`);
        
        // AI 回应用户的代付请求
        const payAgreedRegex = new RegExp(`\\[${character.realName}同意了${character.myName}的代付请求\\]`);
        const payRejectedRegex = new RegExp(`\\[${character.realName}拒绝了${character.myName}的代付请求\\]`);
        
        // 用户回应 AI 的代付请求 (通过按钮触发的指令)
        const userPayAgreedRegex = new RegExp(`\\[${character.myName}同意了${character.realName}的代付请求\\]`);
        const userPayRejectedRegex = new RegExp(`\\[${character.myName}拒绝了${character.realName}的代付请求\\]`);

        if (message.content.match(updateStatusRegex)) {
            character.status = message.content.match(updateStatusRegex)[1];
            chatRoomStatusText.textContent = character.status;
            if (!character.showStatusUpdateMsg) {
                return;
            }
        }
        if (message.content.match(giftReceivedRegex) && message.role === 'assistant') {
            const lastPendingGiftIndex = character.history.slice().reverse().findIndex(m => m.role === 'user' && /送来的礼物[：:]/.test(m.content) && m.giftStatus !== 'received');
            if (lastPendingGiftIndex !== -1) {
                const actualIndex = character.history.length - 1 - lastPendingGiftIndex;
                const giftMsg = character.history[actualIndex];
                giftMsg.giftStatus = 'received';
                const giftCardOnScreen = messageArea.querySelector(`.message-wrapper[data-id="${giftMsg.id}"] .gift-card`);
                if (giftCardOnScreen) {
                    giftCardOnScreen.classList.add('received');
                }
            }
            return;
        }
        
        // 处理 AI 同意/拒绝 用户的请求
        if (message.content.match(payAgreedRegex) && message.role === 'assistant') {
            const lastPendingPayIndex = character.history.slice().reverse().findIndex(m => m.role === 'user' && /发起了代付请求[：:]/.test(m.content) && m.payStatus !== 'paid' && m.payStatus !== 'rejected');
            if (lastPendingPayIndex !== -1) {
                const actualIndex = character.history.length - 1 - lastPendingPayIndex;
                const payMsg = character.history[actualIndex];
                payMsg.payStatus = 'paid';
                const receiptBubble = messageArea.querySelector(`.message-wrapper[data-id="${payMsg.id}"] .receipt-bubble`);
                if (receiptBubble) {
                    // 更新底部状态文字
                    const statusSpan = receiptBubble.querySelector('.pay-status-text');
                    if (statusSpan) statusSpan.textContent = '已支付';
                    
                    // 移除操作按钮（如果存在）
                    const actions = receiptBubble.querySelector('.receipt-actions');
                    if (actions) actions.remove();
                }
            }
            return;
        }
        if (message.content.match(payRejectedRegex) && message.role === 'assistant') {
            const lastPendingPayIndex = character.history.slice().reverse().findIndex(m => m.role === 'user' && /发起了代付请求[：:]/.test(m.content) && m.payStatus !== 'paid' && m.payStatus !== 'rejected');
            if (lastPendingPayIndex !== -1) {
                const actualIndex = character.history.length - 1 - lastPendingPayIndex;
                const payMsg = character.history[actualIndex];
                payMsg.payStatus = 'rejected';
                const receiptBubble = messageArea.querySelector(`.message-wrapper[data-id="${payMsg.id}"] .receipt-bubble`);
                if (receiptBubble) {
                    // 更新底部状态文字
                    const statusSpan = receiptBubble.querySelector('.pay-status-text');
                    if (statusSpan) statusSpan.textContent = '已拒绝';
                    
                    // 移除操作按钮（如果存在）
                    const actions = receiptBubble.querySelector('.receipt-actions');
                    if (actions) actions.remove();
                }
            }
            return;
        }

        // 处理 用户 同意/拒绝 AI 的请求 (虽然按钮点击已经更新了状态，但这里处理指令消息本身的显示逻辑)
        if (message.content.match(userPayAgreedRegex) || message.content.match(userPayRejectedRegex)) {
            // 这条指令消息本身不需要特殊处理，它只是作为聊天记录存在
            // 状态更新已经在 sendPayResponse 中完成了
            // 但如果用户手动输入这条指令，我们也应该尝试更新状态
            if (message.role === 'user') {
                 const isAgreed = !!message.content.match(userPayAgreedRegex);
                 const lastPendingPayIndex = character.history.slice().reverse().findIndex(m => m.role === 'assistant' && /发起了代付请求[：:]/.test(m.content) && !m.payStatus);
                 
                 if (lastPendingPayIndex !== -1) {
                    const actualIndex = character.history.length - 1 - lastPendingPayIndex;
                    const payMsg = character.history[actualIndex];
                    // 只有当状态未设置时才更新，避免覆盖
                    if (!payMsg.payStatus) {
                        payMsg.payStatus = isAgreed ? 'paid' : 'rejected';
                        // 刷新界面
                        renderMessages(false, false);
                    }
                 }
            }
            return;
        }

        if (message.content.match(transferActionRegex) && message.role === 'assistant') {
            const action = message.content.match(transferActionRegex)[1];
            const statusToSet = action === '接收' ? 'received' : 'returned';
            const lastPendingTransferIndex = character.history.slice().reverse().findIndex(m => m.role === 'user' && /给你转账[：:]/.test(m.content) && m.transferStatus === 'pending');
            if (lastPendingTransferIndex !== -1) {
                const actualIndex = character.history.length - 1 - lastPendingTransferIndex;
                const transferMsg = character.history[actualIndex];
                transferMsg.transferStatus = statusToSet;
                const transferCardOnScreen = messageArea.querySelector(`.message-wrapper[data-id="${transferMsg.id}"] .transfer-card`);
                if (transferCardOnScreen) {
                    transferCardOnScreen.classList.remove('received', 'returned');
                    transferCardOnScreen.classList.add(statusToSet);
                    const statusElem = transferCardOnScreen.querySelector('.transfer-status');
                    if (statusElem) statusElem.textContent = statusToSet === 'received' ? '已收款' : '已退回';
                }
            }
        } else {
            let isContinuous = false;
            let invisibleRegex;
            const momentsRegexSource = /\[(?:.*?)\s*(?:发布了一条(?:带图)?动态|评论了.*?|回复.*?|更新了个性签名)[：:][\s\S]+?\]/.source;
            if (character.showStatusUpdateMsg) {
                // 修改：正则末尾增加了 |<thinking>[\s\S]*?<\/thinking>
                invisibleRegex = new RegExp([
                    /\[.*?(?:接收|退回).*?的转账\]/.source,
                    /\[.*?已接收礼物\]/.source,
                    /\[.*?同意了.*?的代付请求\]/.source,
                    /\[.*?拒绝了.*?的代付请求\]/.source,
                    /\[system:.*?\]/.source,
                    /\[.*?邀请.*?加入了群聊\]/.source,
                    /\[.*?修改群名为：.*?\]/.source,
                    /\[system-display:.*?\]/.source,
                    /\[.*?拒绝了.*?的(?:视频|语音)通话\]/.source,
                    /<thinking>[\s\S]*?<\/thinking>/.source,
                    /^<thinking>[\s\S]*/.source,
                    momentsRegexSource
                ].join('|'));
            } else {
                // 修改：正则末尾增加了 |<thinking>[\s\S]*?<\/thinking>
                invisibleRegex = new RegExp([
                    /\[.*?(?:接收|退回).*?的转账\]/.source,
                    /\[.*?更新状态为：.*?\]/.source,
                    /\[.*?已接收礼物\]/.source,
                    /\[.*?同意了.*?的代付请求\]/.source,
                    /\[.*?拒绝了.*?的代付请求\]/.source,
                    /\[system:.*?\]/.source,
                    /\[.*?邀请.*?加入了群聊\]/.source,
                    /\[.*?修改群名为：.*?\]/.source,
                    /\[system-display:.*?\]/.source,
                    /\[.*?拒绝了.*?的(?:视频|语音)通话\]/.source,
                    /<thinking>[\s\S]*?<\/thinking>/.source,
                    /^<thinking>[\s\S]*/.source,
                    momentsRegexSource
                ].join('|'));
            }
            const isSystemMsg = /\[system:.*?\]|\[system-display:.*?\]/.test(message.content);

            if (!isSystemMsg && character.history.length > 1) {
                let prevMsg = null;
                for (let i = character.history.length - 2; i >= 0; i--) {
                    const candidate = character.history[i];
                    if (!invisibleRegex.test(candidate.content)) {
                        prevMsg = candidate;
                        break;
                    }
                }

                if (prevMsg) {
                    const currentSender = message.role === 'user' ? 'user' : (message.senderId || 'assistant');
                    const prevSender = prevMsg.role === 'user' ? 'user' : (prevMsg.senderId || 'assistant');
                    const timeGap = message.timestamp - prevMsg.timestamp;
                    const isTimeClose = timeGap < 10 * 60 * 1000;

                    if (currentSender === prevSender && isTimeClose) {
                        isContinuous = true;
                    }
                }
            }

            const bubbleElement = createMessageBubbleElement(message, isContinuous);
            if (bubbleElement) {
                // Check for timestamp display
                const history = character.history;
                let shouldShowTimestamp = false;
                if (history.length >= 2) {
                    const prevMsg = history[history.length - 2];
                    const timeDiff = message.timestamp - prevMsg.timestamp;
                    const isSameDay = new Date(message.timestamp).toDateString() === new Date(prevMsg.timestamp).toDateString();
                    if (timeDiff > 10 * 60 * 1000 || !isSameDay) {
                        shouldShowTimestamp = true;
                    }
                } else if (history.length === 1) {
                    shouldShowTimestamp = true;
                }

                if (shouldShowTimestamp) {
                    const timeDivider = document.createElement('div');
                    timeDivider.className = 'message-wrapper system-notification time-divider';
                    const timeText = formatTimeDivider(message.timestamp);
                    timeDivider.innerHTML = `<div class="system-notification-bubble" style="background-color: transparent; color: #999; font-size: 12px; padding: 2px 8px;">${timeText}</div>`;
                    messageArea.appendChild(timeDivider);
                }

                messageArea.appendChild(bubbleElement);
                messageArea.scrollTop = messageArea.scrollHeight;
            }
        }
    } else { 
        const group = db.groups.find(g => g.id === currentChatId);
        let isContinuous = false;
        let invisibleRegex;
        const momentsRegexSource = /\[(?:.*?)\s*(?:发布了一条(?:带图)?动态|评论了.*?|回复.*?|更新了个性签名)[：:][\s\S]+?\]/.source;
        if (group.showStatusUpdateMsg) {
            // 修改：正则末尾增加了 |<thinking>[\s\S]*?<\/thinking>
            invisibleRegex = new RegExp([
                /\[.*?(?:接收|退回).*?的转账\]/.source,
                /\[.*?已接收礼物\]/.source,
                /\[system:.*?\]/.source,
                /\[.*?邀请.*?加入了群聊\]/.source,
                /\[.*?修改群名为：.*?\]/.source,
                /\[system-display:.*?\]/.source,
                /\[.*?拒绝了.*?的(?:视频|语音)通话\]/.source,
                /<thinking>[\s\S]*?<\/thinking>/.source,
                /^<thinking>[\s\S]*/.source,
                momentsRegexSource
            ].join('|'));
        } else {
            // 修改：正则末尾增加了 |<thinking>[\s\S]*?<\/thinking>
            invisibleRegex = new RegExp([
                /\[.*?(?:接收|退回).*?的转账\]/.source,
                /\[.*?更新状态为：.*?\]/.source,
                /\[.*?已接收礼物\]/.source,
                /\[system:.*?\]/.source,
                /\[.*?邀请.*?加入了群聊\]/.source,
                /\[.*?修改群名为：.*?\]/.source,
                /\[system-display:.*?\]/.source,
                /\[.*?拒绝了.*?的(?:视频|语音)通话\]/.source,
                /<thinking>[\s\S]*?<\/thinking>/.source,
                /^<thinking>[\s\S]*/.source,
                momentsRegexSource
            ].join('|'));
        }
        const isSystemMsg = /\[system:.*?\]|\[system-display:.*?\]/.test(message.content);

        if (!isSystemMsg && group.history.length > 1) {
            let prevMsg = null;
            for (let i = group.history.length - 2; i >= 0; i--) {
                const candidate = group.history[i];
                if (!invisibleRegex.test(candidate.content)) {
                    prevMsg = candidate;
                    break;
                }
            }

            if (prevMsg) {
                const currentSender = message.role === 'user' ? 'user' : (message.senderId || 'assistant');
                const prevSender = prevMsg.role === 'user' ? 'user' : (prevMsg.senderId || 'assistant');
                const timeGap = message.timestamp - prevMsg.timestamp;
                const isTimeClose = timeGap < 10 * 60 * 1000;

                if (currentSender === prevSender && isTimeClose) {
                    isContinuous = true;
                }
            }
        }

        const bubbleElement = createMessageBubbleElement(message, isContinuous);
        if (bubbleElement) {
            // Check for timestamp display
            const history = group.history;
            let shouldShowTimestamp = false;
            if (history.length >= 2) {
                const prevMsg = history[history.length - 2];
                const timeDiff = message.timestamp - prevMsg.timestamp;
                const isSameDay = new Date(message.timestamp).toDateString() === new Date(prevMsg.timestamp).toDateString();
                if (timeDiff > 10 * 60 * 1000 || !isSameDay) {
                    shouldShowTimestamp = true;
                }
            } else if (history.length === 1) {
                shouldShowTimestamp = true;
            }

            if (shouldShowTimestamp) {
                const timeDivider = document.createElement('div');
                timeDivider.className = 'message-wrapper system-notification time-divider';
                const timeText = formatTimeDivider(message.timestamp);
                timeDivider.innerHTML = `<div class="system-notification-bubble" style="background-color: transparent; color: #999; font-size: 12px; padding: 2px 8px;">${timeText}</div>`;
                messageArea.appendChild(timeDivider);
            }

            messageArea.appendChild(bubbleElement);
            messageArea.scrollTop = messageArea.scrollHeight;
        }
    }
}
;
// --- 聊天存档与分支 ---

const CHAT_ARCHIVE_META_KEYS = new Set([
    'id', 'archives', 'activeArchiveId', 'isPinned', 'unreadCount',
    'realName', 'remarkName', 'name', 'avatar', 'folderId', 'folderIds', 'memorySettings', 'sharedMemory', 'nationality', 'residence'
]);

function cloneArchiveValue(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function createArchiveId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `archive_${crypto.randomUUID()}`;
    }
    return `archive_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getCurrentChatEntity() {
    if (!currentChatId || !currentChatType) return null;
    return currentChatType === 'private'
        ? db.characters.find(character => character.id === currentChatId)
        : db.groups.find(group => group.id === currentChatId);
}

function captureArchiveData(chat) {
    const data = {};
    Object.keys(chat).forEach(key => {
        if (!CHAT_ARCHIVE_META_KEYS.has(key)) {
            data[key] = cloneArchiveValue(chat[key]);
        }
    });
    return data;
}

function getArchiveLatestTime(data) {
    const history = Array.isArray(data.history) ? data.history : [];
    const journals = Array.isArray(data.memoryJournals) ? data.memoryJournals : [];
    const lastMessage = history.length ? Number(history[history.length - 1].timestamp) || 0 : 0;
    const lastJournal = journals.reduce((latest, journal) => Math.max(latest, Number(journal.createdAt) || 0), 0);
    return Math.max(lastMessage, lastJournal);
}

function ensureChatArchives(chat) {
    if (!chat) return false;
    let changed = false;

    if (!Array.isArray(chat.archives) || chat.archives.length === 0) {
        const now = Date.now();
        const archive = {
            id: createArchiveId(),
            name: '主存档',
            createdAt: now,
            updatedAt: Math.max(getArchiveLatestTime(chat), now),
            origin: null,
            data: captureArchiveData(chat)
        };
        chat.archives = [archive];
        chat.activeArchiveId = archive.id;
        changed = true;
    }

    if (!chat.archives.some(archive => archive.id === chat.activeArchiveId)) {
        chat.activeArchiveId = chat.archives[0].id;
        changed = true;
    }

    return changed;
}

function ensureAllChatArchives() {
    let changed = false;
    [...(db.characters || []), ...(db.groups || [])].forEach(chat => {
        if (ensureChatArchives(chat)) changed = true;
    });
    return changed;
}

function syncChatActiveArchive(chat, touch = false) {
    if (!chat) return;
    ensureChatArchives(chat);
    const archive = chat.archives.find(item => item.id === chat.activeArchiveId);
    if (!archive) return;

    const data = captureArchiveData(chat);
    const previousLatest = getArchiveLatestTime(archive.data || {});
    const nextLatest = getArchiveLatestTime(data);
    archive.data = data;
    if (touch || nextLatest !== previousLatest) {
        archive.updatedAt = Math.max(Date.now(), nextLatest);
    }
}

function syncAllActiveArchives() {
    [...(db.characters || []), ...(db.groups || [])].forEach(chat => {
        const touch = chat.id === currentChatId;
        syncChatActiveArchive(chat, touch);
    });
}

function applyArchiveData(chat, archive) {
    Object.keys(chat).forEach(key => {
        if (!CHAT_ARCHIVE_META_KEYS.has(key)) delete chat[key];
    });
    for (const [key, value] of Object.entries(archive.data || {})) {
        if (!CHAT_ARCHIVE_META_KEYS.has(key)) chat[key] = cloneArchiveValue(value);
    }
    chat.activeArchiveId = archive.id;
}

function getActiveArchive(chat) {
    if (!chat) return null;
    ensureChatArchives(chat);
    return chat.archives.find(archive => archive.id === chat.activeArchiveId) || chat.archives[0];
}

function resetArchiveRuntime(data) {
    data.history = [];
    delete data.memoryBatchState;
    data.memoryJournals = [];
    data.callHistory = [];
    data.lastUserMessageTimestamp = null;
    data.status = '在线';
    data.peekData = {};
    data.gallery = [];

    if (data.statusPanel) {
        data.statusPanel.currentStatusRaw = '';
        data.statusPanel.currentStatusHtml = '';
        data.statusPanel.history = [];
    }
    if (data.autoReply) data.autoReply.lastTriggerTime = 0;
    if (data.privateSessions) data.privateSessions = {};
    if (data.gossipSessions) data.gossipSessions = {};
    return data;
}

function makeArchiveName(prefix) {
    const now = new Date();
    const date = `${now.getMonth() + 1}月${now.getDate()}日`;
    return `${prefix} · ${date}`;
}

async function createBlankArchive() {
    const chat = getCurrentChatEntity();
    if (!chat || !canSwitchChatArchive(chat)) return;
    syncChatActiveArchive(chat, true);

    const active = getActiveArchive(chat);
    const suggestedName = makeArchiveName('新存档');
    const name = prompt('存档名称', suggestedName);
    if (name === null) return;

    const now = Date.now();
    const archive = {
        id: createArchiveId(),
        name: name.trim() || suggestedName,
        createdAt: now,
        updatedAt: now,
        origin: null,
        data: resetArchiveRuntime(cloneArchiveValue(active.data))
    };
    chat.archives.push(archive);
    await switchChatArchive(archive.id);
    showToast('新存档已创建');
}

function journalBelongsToBranch(journal, includedMessageIds, cutoff) {
    if (journal.startMessageId && journal.endMessageId) {
        return includedMessageIds.has(journal.startMessageId) && includedMessageIds.has(journal.endMessageId);
    }
    return journal.range && Number(journal.range.end) <= cutoff;
}

async function createBranchArchiveAtMessage(messageId) {
    const chat = getCurrentChatEntity();
    if (!chat || !Array.isArray(chat.history) || !canSwitchChatArchive(chat)) return;
    const branchIndex = chat.history.findIndex(message => message.id === messageId);
    if (branchIndex < 0) return;

    syncChatActiveArchive(chat, true);
    const sourceArchive = getActiveArchive(chat);
    const suggestedName = makeArchiveName('分支');
    const name = prompt('分支存档名称', suggestedName);
    if (name === null) return;

    const data = cloneArchiveValue(sourceArchive.data);
    data.history = data.history.slice(0, branchIndex + 1);
    const includedMessageIds = new Set(data.history.map(message => message.id));
    const batch = data.memoryBatchState;
    if (batch && includedMessageIds.has(batch.endMessageId)) {
        data.memoryBatchState = { endMessageId: batch.endMessageId, endTimestamp: batch.endTimestamp };
    } else {
        delete data.memoryBatchState;
    }
    data.memoryJournals = (data.memoryJournals || []).filter(journal =>
        journalBelongsToBranch(journal, includedMessageIds, branchIndex + 1)
    );
    data.callHistory = (data.callHistory || []).filter(call => !call.timestamp || call.timestamp <= (data.history[branchIndex].timestamp || Infinity));
    data.lastUserMessageTimestamp = [...data.history].reverse().find(message => message.role === 'user')?.timestamp || null;

    const now = Date.now();
    const archive = {
        id: createArchiveId(),
        name: name.trim() || suggestedName,
        createdAt: now,
        updatedAt: now,
        origin: {
            archiveId: sourceArchive.id,
            archiveName: sourceArchive.name,
            messageId,
            createdAt: now
        },
        data
    };
    chat.archives.push(archive);
    await switchChatArchive(archive.id);
    showToast('分支存档已创建');
}

function isChatArchiveBusy(chat) {
    const call = window.VideoCallModule?.state;
    return __uwuInFlightChatIds.has(chat.id)
        || window.VoiceInputPlugin?.isRecordingFor(chat.id, currentChatType)
        || (call?.isCallActive && call.currentChat === chat);
}

function canSwitchChatArchive(chat) {
    if (!isChatArchiveBusy(chat)) return true;
    showToast('请等当前生成、语音处理或通话结束后再切换存档');
    return false;
}

async function switchChatArchive(archiveId) {
    const chat = getCurrentChatEntity();
    if (!chat || chat.activeArchiveId === archiveId) {
        closeArchiveManager();
        return;
    }

    if (!canSwitchChatArchive(chat)) return;
    syncChatActiveArchive(chat, true);
    const archive = chat.archives.find(item => item.id === archiveId);
    if (!archive) return;
    const type = currentChatType;
    applyArchiveData(chat, archive);
    if (getCurrentChatEntity() === chat) {
        closeArchiveManager();
        openChatRoom(chat.id, type);
    }
    await saveSingleChatFast(chat, type);
    window.syncMouxiCharacterAlarms?.();
}

async function renameChatArchive(archiveId) {
    const chat = getCurrentChatEntity();
    const archive = chat?.archives.find(item => item.id === archiveId);
    if (!archive) return;
    const name = prompt('修改存档名称', archive.name);
    if (name === null || !name.trim()) return;
    archive.name = name.trim();
    archive.updatedAt = Date.now();
    await saveData();
    renderArchiveManager();
}

async function deleteChatArchive(archiveId) {
    const chat = getCurrentChatEntity();
    if (!chat || chat.archives.length <= 1) {
        showToast('至少保留一个存档');
        return;
    }
    const archive = chat.archives.find(item => item.id === archiveId);
    if (!archive || !confirm(`确定删除“${archive.name}”吗？该操作不可恢复。`)) return;

    if (chat.activeArchiveId === archiveId) {
        if (!canSwitchChatArchive(chat)) return;
        syncChatActiveArchive(chat, true);
        const fallback = chat.archives.find(item => item.id !== archiveId);
        chat.archives = chat.archives.filter(item => item.id !== archiveId);
        const type = currentChatType;
        applyArchiveData(chat, fallback);
        closeArchiveManager();
        openChatRoom(chat.id, type);
        await saveSingleChatFast(chat, type);
        window.syncMouxiCharacterAlarms?.();
        showToast('存档已删除');
        return;
    }

    chat.archives = chat.archives.filter(item => item.id !== archiveId);
    await saveData();
    renderArchiveManager();
    showToast('存档已删除');
}

function formatArchiveTime(timestamp) {
    const date = new Date(timestamp || Date.now());
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function renderArchiveManager() {
    const chat = getCurrentChatEntity();
    const list = document.getElementById('chat-archive-list');
    if (!chat || !list) return;
    syncChatActiveArchive(chat, false);

    list.innerHTML = chat.archives
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(archive => {
            const active = archive.id === chat.activeArchiveId;
            const messageCount = archive.data?.history?.length || 0;
            const journalCount = archive.data?.memoryJournals?.length || 0;
            const origin = archive.origin ? `<div class="archive-origin">来自：${escapeHtml(archive.origin.archiveName || '其他存档')}</div>` : '';
            return `
                <article class="chat-archive-card ${active ? 'active' : ''}" data-archive-id="${archive.id}">
                    <div class="archive-card-main">
                        <div class="archive-name-row">
                            <strong>${escapeHtml(archive.name)}</strong>
                            ${active ? '<span class="archive-active-tag">当前</span>' : ''}
                        </div>
                        <div class="archive-meta">${messageCount} 条消息 · ${journalCount} 篇日记 · ${formatArchiveTime(archive.updatedAt)}</div>
                        ${origin}
                    </div>
                    <div class="archive-actions">
                        ${active ? '' : '<button type="button" data-action="switch">进入</button>'}
                        <button type="button" data-action="rename">改名</button>
                        <button type="button" data-action="delete" class="danger">删除</button>
                    </div>
                </article>`;
        }).join('');
}

function openArchiveManager() {
    const overlay = document.getElementById('chat-archive-overlay');
    if (!overlay) return;
    renderArchiveManager();
    overlay.classList.add('visible');
}

function closeArchiveManager() {
    document.getElementById('chat-archive-overlay')?.classList.remove('visible');
}

function injectArchiveUi() {
    if (!document.getElementById('chat-archive-overlay')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="chat-archive-overlay" class="chat-archive-overlay" aria-hidden="true">
                <section class="chat-archive-panel" role="dialog" aria-modal="true" aria-label="存档管理">
                    <header class="archive-panel-header">
                        <button type="button" id="close-chat-archives">‹</button>
                        <h2>存档管理</h2>
                        <button type="button" id="create-chat-archive">新建</button>
                    </header>
                    <p class="archive-help">新建存档会复用当前设置、人设和世界书绑定，但从空白聊天开始。</p>
                    <div id="chat-archive-list" class="chat-archive-list"></div>
                </section>
            </div>`);
    }

    const grids = document.querySelectorAll('#chat-expansion-panel .expansion-grid');
    const grid = grids[0];
    if (grid && !document.getElementById('chat-archives-btn')) {
        grid.insertAdjacentHTML('beforeend', `
            <div class="expansion-item" id="chat-archives-btn">
                <div class="expansion-item-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v4H4V4m1 6h14v10H5V10m4 2v2h6v-2H9z"/></svg>
                </div>
                <span class="expansion-item-name">存档</span>
            </div>`);
    }
}

function setupChatArchiveSystem() {
    injectArchiveUi();
    document.getElementById('chat-archives-btn')?.addEventListener('click', openArchiveManager);
    document.getElementById('close-chat-archives')?.addEventListener('click', closeArchiveManager);
    document.getElementById('create-chat-archive')?.addEventListener('click', createBlankArchive);
    document.getElementById('chat-archive-overlay')?.addEventListener('click', event => {
        if (event.target.id === 'chat-archive-overlay') closeArchiveManager();
    });
    document.getElementById('chat-archive-list')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        const card = event.target.closest('.chat-archive-card');
        if (!button || !card) return;
        const archiveId = card.dataset.archiveId;
        if (button.dataset.action === 'switch') switchChatArchive(archiveId);
        if (button.dataset.action === 'rename') renameChatArchive(archiveId);
        if (button.dataset.action === 'delete') deleteChatArchive(archiveId);
    });
}
;
// --- 隔空投送 (AirDrop) 生图逻辑 ---
const inFlightAirDrops = new Set();

async function receiveAirDropPhoto(messageId, sourceChat = null) {
    const chat = sourceChat || getCurrentChatEntity();
    if (!chat) return;

    // --- 冷却时间校验 ---
    const settings = db.workshopSettings || {};
    const rateLimit = settings.rateLimit !== undefined ? Number(settings.rateLimit) : 45;
    const lastGenTime = settings.lastGenerationTime || 0;
    const now = Date.now();
    
    if (now - lastGenTime < rateLimit * 1000) {
        const remaining = Math.ceil((rateLimit * 1000 - (now - lastGenTime)) / 1000);
        showToast(`生图冷却中，请等待 ${remaining} 秒`);
        return;
    }
    // -------------------

    const message = chat.history.find(m => m.id === messageId);
    if (!message || !/\[.*?发来的照片\/视频[：:][^\]]+\]/.test(message.content)) return;

    const charName = chat.remarkName || chat.name;
    const archiveId = chat.activeArchiveId;

    async function generatePhoto(onStage) {
        if (inFlightAirDrops.has(message)) return false;
        inFlightAirDrops.add(message);
        try {
            onStage?.('正在建立连接');
            const tags = await generateTagsFromDescription(chat, messageId);
            if (!tags?.trim()) throw new Error('LLM 未返回有效的提示词，已取消生图');
            if (chat.activeArchiveId !== archiveId) return false;
            onStage?.('正在接收中');
            const image = await generateImageFromTags(tags, chat);
            if (chat.activeArchiveId !== archiveId) return false;
            await saveAirDropPhoto(chat.id, image, tags);
            db.workshopSettings ||= {};
            db.workshopSettings.lastGenerationTime = Date.now();
            await saveData();
            return true;
        } finally {
            inFlightAirDrops.delete(message);
        }
    }

    if (sourceChat) {
        try {
            if (await generatePhoto()) showToast(`已收到 ${charName} 的隔空投送照片，已存入TA相册`);
        } catch (error) {
            console.error('AirDrop Error:', error);
            showToast(`隔空投送失败: ${error.message}`);
        }
        return;
    }

    // 1. 显示 AirDrop 弹窗
    const modal = document.getElementById('airdrop-modal');
    const subtitle = document.getElementById('airdrop-subtitle');
    const actions = document.getElementById('airdrop-actions');
    const loading = document.getElementById('airdrop-loading');
    const loadingText = document.getElementById('airdrop-loading-text');
    const errorDiv = document.getElementById('airdrop-error');
    const errorText = document.getElementById('airdrop-error-text');

    subtitle.textContent = `${charName} 想要共享1张照片`;
    actions.style.display = 'flex';
    loading.style.display = 'none';
    errorDiv.style.display = 'none';
    modal.classList.add('visible');

    // 绑定拒绝按钮
    const rejectBtn = document.getElementById('airdrop-reject-btn');
    rejectBtn.onclick = () => {
        modal.classList.remove('visible');
    };

    // 绑定关闭按钮 (错误时显示)
    const closeBtn = document.getElementById('airdrop-close-btn');
    closeBtn.onclick = () => {
        modal.classList.remove('visible');
    };

    // 绑定头部点击折叠/展开
    const header = document.getElementById('airdrop-header');
    const windowEl = document.getElementById('airdrop-window');
    header.onclick = () => {
        // 只有在接收中状态才允许折叠
        if (loading.style.display === 'block') {
            windowEl.classList.toggle('collapsed');
        }
    };

    // 绑定接受按钮
    const acceptBtn = document.getElementById('airdrop-accept-btn');
    acceptBtn.onclick = async () => {
        actions.style.display = 'none';
        loading.style.display = 'flex';
        errorDiv.style.display = 'none';
        
        // 自动折叠
        windowEl.classList.add('collapsed');

        try {
            if (!await generatePhoto(stage => { loadingText.textContent = stage; })) {
                modal.classList.remove('visible');
                windowEl.classList.remove('collapsed');
                loading.style.display = 'none';
                return;
            }

            // 检查是否还在当前聊天室
            if (currentChatId === chat.id && document.getElementById('chat-room-screen').classList.contains('active')) {
                // 自动展开并显示结果
                windowEl.classList.remove('collapsed');
                loading.style.display = 'none';
                
                // 获取刚保存的记录（为了拿到 ID）
                const latestPhotos = await dexieDB.characterPhotos.where('charId').equals(chat.id).reverse().sortBy('timestamp');
                if (latestPhotos.length > 0) {
                    showAirDropPreview(latestPhotos[0], chat);
                }
            } else {
                // 不在当前聊天室，隐藏 modal 并显示 Toast
                modal.classList.remove('visible');
                windowEl.classList.remove('collapsed');
                loading.style.display = 'none';
                showToast(`已收到 ${charName} 的隔空投送照片，已存入TA相册`);
            }

        } catch (error) {
            console.error("AirDrop Error:", error);
            windowEl.classList.remove('collapsed');
            loading.style.display = 'none';
            
            // 检查是否还在当前聊天室
            if (currentChatId === chat.id && document.getElementById('chat-room-screen').classList.contains('active')) {
                errorDiv.style.display = 'block';
                errorText.textContent = `接收失败: ${error.message}`;
            } else {
                // 不在当前聊天室，隐藏 modal 并显示 Toast 报错
                modal.classList.remove('visible');
                showToast(`隔空投送失败: ${error.message}`);
            }
        }
    };

}

async function generateTagsFromDescription(chat, messageId) {
    const apiConfig = resolveWorkshopLlmApiConfig();

    let {url, key, model, provider} = apiConfig;
    if (!url || !key || !model) {
        throw new Error("未配置聊天 API，无法进行提示词扩写");
    }
    if (url.endsWith('/')) url = url.slice(0, -1);

    // 1. 截取上下文 (当前消息及之前的 29 条)
    const targetIndex = chat.history.findIndex(m => m.id === messageId);
    if (targetIndex === -1) throw new Error("未找到触发消息");
    
    const startIndex = Math.max(0, targetIndex - 29);
    let historySlice = chat.history.slice(startIndex, targetIndex + 1);
    
    // 过滤掉不应进入上下文的消息
    historySlice = historySlice.filter(m => !m.isContextDisabled && !m.isThinking);

    // 2. 格式化上下文文本
    let contextText = "";
    let lastMsgTimeForAI = 0;
    
    historySlice.forEach(msg => {
        const currentMsgTime = msg.timestamp;
        const timeDiff = currentMsgTime - lastMsgTimeForAI;
        const isSameDay = new Date(currentMsgTime).toDateString() === new Date(lastMsgTimeForAI).toDateString();
        
        if (lastMsgTimeForAI === 0 || timeDiff > 20 * 60 * 1000 || !isSameDay) {
            const dateObj = new Date(currentMsgTime);
            const timeStr = `${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
            contextText += `[${timeStr}]\n`;
        }
        lastMsgTimeForAI = currentMsgTime;

        let senderName = msg.role === 'user' ? chat.myName : chat.realName;
        if (chat.type === 'group' && msg.senderId) {
            if (msg.senderId === 'user_me') {
                senderName = chat.me.nickname;
            } else {
                const sender = chat.members.find(m => m.id === msg.senderId);
                if (sender) senderName = sender.realName || sender.groupNickname;
            }
        }

        let content = msg.content;
        if (msg.parts && msg.parts.length > 0) {
            content = msg.parts.map(p => p.text || '[图片]').join('');
        }
        
        // 简单清理系统标签
        content = content.replace(/^\[system:.*?\]\s*/, '').replace(/^\(时间:.*?\)\s*/, '');
        
        contextText += `${senderName}: ${content}\n`;
    });

    // 3. 确定当前主要角色
    let currentMainCharacter = chat.realName; // 默认
    const targetMessage = chat.history.find(m => m.id === messageId);
    if (targetMessage) {
        if (targetMessage.role === 'user') {
            currentMainCharacter = chat.myName;
            if (chat.type === 'group' && targetMessage.senderId === 'user_me') {
                currentMainCharacter = chat.me.nickname;
            }
        } else {
            if (chat.type === 'group' && targetMessage.senderId) {
                const sender = chat.members.find(m => m.id === targetMessage.senderId);
                if (sender) currentMainCharacter = sender.realName || sender.groupNickname;
            }
        }
    }

    // 4. 构建 Messages
    let messages = [];
    
    // 根据生图 provider 选择预设组
    let presetGroups = [];
    let activeGroupId = null;
    const imageProvider = db.workshopSettings?.provider || 'novelai';
    
    if (imageProvider === 'gpt') {
        presetGroups = db.workshopSettings?.gptLlmPresetGroups || [];
        activeGroupId = db.workshopSettings?.activeGptLlmPresetGroupId;
    } else {
        presetGroups = db.workshopSettings?.llmPresetGroups || [];
        activeGroupId = db.workshopSettings?.activeLlmPresetGroupId;
    }
    
    if (presetGroups.length > 0 && activeGroupId) {
        const activeGroup = presetGroups.find(g => g.id === activeGroupId);
        if (activeGroup && activeGroup.prompts) {
            // 准备标签列表字符串 (仅 GPT 模式可能用到)
            let tagsListStr = '';
            if (imageProvider === 'gpt' && db.workshopSettings?.gptTags) {
                tagsListStr = db.workshopSettings.gptTags.filter(t => t.enabled !== false).map(t => t.name).join(', ');
            }

            activeGroup.prompts.filter(p => p.enabled).forEach(p => {
                let content = p.content;
                content = content.replace(/\{\{context\}\}/g, contextText);
                content = content.replace(/\{\{角色设定\}\}/g, chat.persona || '无');
                content = content.replace(/\{\{当前主要角色\}\}/g, currentMainCharacter);
                content = content.replace(/\{\{角色真名\}\}/g, chat.realName);
                
                // 替换标签列表
                if (content.includes('{{标签列表}}')) {
                    content = content.replace(/\{\{标签列表\}\}/g, tagsListStr || '无可用标签');
                }
                
                // 合并相邻的同 role 条目
                if (messages.length > 0 && messages[messages.length - 1].role === p.role) {
                    messages[messages.length - 1].content += '\n\n' + content;
                } else {
                    messages.push({ role: p.role, content: content });
                }
            });
        }
    }
    
    // 兜底：如果没有配置预设，使用默认的
    if (messages.length === 0) {
        messages = [
            {role: 'system', content: '你是一个专业的AI绘画提示词（Prompt）生成专家，精通 Danbooru 标签语法。\n你的任务是将用户输入的【画面描述】翻译并扩写为高质量的英文提示词标签，用于 NovelAI 图像生成。\n\n【扩写与输出规则】\n1. 格式限制：仅输出英文标签，全部小写，用英文逗号和空格分隔。绝对不要输出任何中文、解释性文字、前言后语或多余的标点。\n2. 结构顺序：按照“主体特征, 服装, 动作/姿势, 表情, 背景环境, 光影/视角”的顺序排列。\n3. 细节脑补：如果用户的描述较简略，请根据语境合理脑补细节（例如：补充 cinematic lighting, detailed background, depth of field 等增强画质的词汇）。\n4. 视角与构图：根据描述自动推断合适的构图词（如 selfie, cowboy shot, looking at viewer, from above 等）。\n5. 风格词：自动在末尾加上 masterpiece, best quality, highly detailed, ultra-detailed。'},
            {role: 'user', content: `<参考资料>\n${contextText}\n</参考资料>\n请根据参考资料中最后一条消息的画面描述，结合前文语境，生成英文提示词标签。直接输出转换后的英文标签。`}
        ];
    }

    console.log('【生图 LLM 预设请求参数】:\n' + messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n------------------------\n\n'));

    const requestBody = {
        model: model,
        messages: messages,
        stream: false,
        temperature: apiConfig.temperatureEnabled !== false && Number.isFinite(Number(apiConfig.temperature))
            ? Number(apiConfig.temperature)
            : 0.7
    };

    if (provider === 'gemini') {
        requestBody.contents = [{role: 'user', parts: [{text: `<参考资料>\n${contextText}\n</参考资料>\n请根据参考资料中最后一条消息的画面描述，结合前文语境，生成英文提示词标签。直接输出转换后的英文标签。`}]}];
        requestBody.system_instruction = {parts: [{text: messages[0].content}]}; // Fix: use messages[0].content instead of undefined systemPrompt
        delete requestBody.messages;
    }

    const endpoint = (provider === 'gemini') ? `${url}/v1beta/models/${model}:generateContent?key=${getRandomValue(key)}` : `${url}/v1/chat/completions`;
    const headers = (provider === 'gemini') ? {'Content-Type': 'application/json'} : {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
    };

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        throw new Error(`LLM API 请求失败 (${response.status})`);
    }

    const data = await response.json();
    let text = "";
    if (provider === 'gemini') {
        text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
        text = data.choices[0].message.content;
    }
    
    console.log('【生图 LLM 原始返回内容】:', text);
    
    // 尝试提取 <image> 标签内的内容
    const imageTagMatch = text.match(/<image>([\s\S]*?)<\/image>/i);
    if (imageTagMatch && imageTagMatch[1]) {
        text = imageTagMatch[1];
    }
    
    // 清理可能包含的 markdown 代码块标记
    text = text.replace(/```[\s\S]*?\n/g, '').replace(/```/g, '').trim();
    return text;
}

async function generateImageFromTags(llmTags, chat) {
    const settings = db.workshopSettings;
    if (!settings) {
        throw new Error("未配置绘图工坊 API，请先在工坊中完成设置");
    }
    
    if (typeof window.executeImageGeneration !== 'function') {
        throw new Error("未找到统一生图函数 window.executeImageGeneration");
    }

    // 优先使用角色专属绘图预设 (仅在 NovelAI 模式下生效)
    let finalSettings = { ...settings };
    const provider = settings.provider || 'novelai';
    if (provider === 'novelai' && chat.exclusiveWorkshopPromptPreset) {
        const preset = (db.workshopPromptPresets || []).find(p => p.id === chat.exclusiveWorkshopPromptPreset);
        if (preset) {
            finalSettings.positivePrompt = preset.positive || '';
            finalSettings.characterPrompt = preset.character || '';
            finalSettings.negativePrompt = preset.negative || '';
        }
    }

    const { imageData } = await window.executeImageGeneration(finalSettings, llmTags);
    return imageData;
}

async function saveAirDropPhoto(charId, base64Image, prompt = '') {
    if (!dexieDB) return;
    const photoItem = {
        charId: charId,
        timestamp: Date.now(),
        image: base64Image,
        prompt: prompt
    };
    await dexieDB.characterPhotos.add(photoItem);
}

// 统一的 AirDrop 预览窗口逻辑
function showAirDropPreview(photoItem, chat) {
    const modal = document.getElementById('airdrop-modal');
    const subtitle = document.getElementById('airdrop-subtitle');
    const actions = document.getElementById('airdrop-actions');
    const loading = document.getElementById('airdrop-loading');
    const errorDiv = document.getElementById('airdrop-error');
    const resultArea = document.getElementById('airdrop-result-area');
    const previewImg = document.getElementById('airdrop-preview-img');
    const windowEl = document.getElementById('airdrop-window');

    const charName = chat.remarkName || chat.name;
    subtitle.textContent = `${charName} 的隔空投送记录`;
    
    actions.style.display = 'none';
    loading.style.display = 'none';
    errorDiv.style.display = 'none';
    windowEl.classList.remove('collapsed');
    
    const src = `data:image/png;base64,${photoItem.image}`;
    previewImg.src = src;
    resultArea.style.display = 'flex';
    modal.classList.add('visible');

    // 绑定预览图点击事件，打开全屏查看器
    const previewContainer = document.getElementById('airdrop-preview-container');
    previewContainer.onclick = () => {
        const fullModal = document.getElementById('full-image-modal');
        const fullImg = document.getElementById('full-image-view');
        fullImg.src = src;
        fullModal.classList.add('visible');
        
        const fullModalCloseBtn = document.getElementById('close-full-image-btn');
        if (fullModalCloseBtn) {
            fullModalCloseBtn.onclick = () => {
                fullModal.classList.remove('visible');
            };
        }
    };

    // 绑定保存按钮
    const saveBtn = document.getElementById('airdrop-save-btn');
    saveBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = src;
        a.download = `airdrop_${photoItem.timestamp}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('已保存到本地');
    };

    // 绑定重新生成按钮
    const regenerateBtn = document.getElementById('airdrop-regenerate-btn');
    regenerateBtn.onclick = async () => {
        resultArea.style.display = 'none';
        loading.style.display = 'flex';
        windowEl.classList.add('collapsed');
        const loadingText = document.getElementById('airdrop-loading-text');
        
        try {
            loadingText.textContent = '正在重新生成';
            const currentPrompt = photoItem.prompt || '';
            if (!currentPrompt) throw new Error("缺少提示词，无法重新生成");
            
            const base64Image = await generateImageFromTags(currentPrompt, chat);
            await saveAirDropPhoto(chat.id, base64Image, currentPrompt);
            
            const latestPhotos = await dexieDB.characterPhotos.where('charId').equals(chat.id).reverse().sortBy('timestamp');
            if (latestPhotos.length > 0) {
                showAirDropPreview(latestPhotos[0], chat);
            }
        } catch (error) {
            console.error("Regenerate Error:", error);
            windowEl.classList.remove('collapsed');
            loading.style.display = 'none';
            errorDiv.style.display = 'block';
            document.getElementById('airdrop-error-text').textContent = `生成失败: ${error.message}`;
        }
    };

    // 绑定详情按钮
    const detailsBtn = document.getElementById('airdrop-details-btn');
    detailsBtn.onclick = () => {
        const detailsModal = document.getElementById('airdrop-details-modal');
        const textarea = document.getElementById('airdrop-prompt-textarea');
        textarea.value = photoItem.prompt || '';
        detailsModal.classList.add('visible');

        document.getElementById('airdrop-prompt-close-btn').onclick = () => {
            detailsModal.classList.remove('visible');
        };

        document.getElementById('airdrop-prompt-save-btn').onclick = async () => {
            const newPrompt = textarea.value.trim();
            photoItem.prompt = newPrompt;
            await dexieDB.characterPhotos.put(photoItem);
            detailsModal.classList.remove('visible');
            showToast('提示词已保存');
        };
    };

    // 绑定相册按钮
    const galleryBtn = document.getElementById('airdrop-gallery-btn');
    galleryBtn.onclick = () => {
        modal.classList.remove('visible');
        resultArea.style.display = 'none';
        openAirDropHistory(chat.id);
    };

    // 绑定结果关闭按钮
    const resultCloseBtn = document.getElementById('airdrop-result-close-btn');
    resultCloseBtn.onclick = () => {
        modal.classList.remove('visible');
        resultArea.style.display = 'none';
    };
}

async function openAirDropHistory(charId) {
    const modal = document.getElementById('airdrop-history-modal');
    const grid = document.getElementById('airdrop-history-grid');
    const closeBtn = document.getElementById('airdrop-history-close-btn');

    closeBtn.onclick = () => modal.classList.remove('visible');

    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #999;">加载中...</div>';
    modal.classList.add('visible');

    if (!dexieDB) return;

    try {
        const photos = await dexieDB.characterPhotos.where('charId').equals(charId).reverse().sortBy('timestamp');
        
        grid.innerHTML = '';
        if (photos.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #999;">相册空空如也</div>';
            return;
        }

        photos.forEach(photo => {
            const wrapper = document.createElement('div');
            wrapper.style.position = 'relative';
            wrapper.style.aspectRatio = '1';
            wrapper.style.borderRadius = '8px';
            wrapper.style.overflow = 'hidden';
            wrapper.style.backgroundColor = '#eee';

            const src = `data:image/png;base64,${photo.image}`;
            
            const img = document.createElement('div');
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.backgroundImage = `url(${src})`;
            img.style.backgroundSize = 'cover';
            img.style.backgroundPosition = 'center';
            img.style.cursor = 'pointer';
            img.onclick = () => {
                modal.classList.remove('visible');
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === charId) : db.groups.find(g => g.id === charId);
                if (chat) {
                    showAirDropPreview(photo, chat);
                }
            };

            const delBtn = document.createElement('button');
            delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="white"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
            delBtn.style.position = 'absolute';
            delBtn.style.top = '4px';
            delBtn.style.right = '4px';
            delBtn.style.background = 'rgba(0,0,0,0.5)';
            delBtn.style.border = 'none';
            delBtn.style.borderRadius = '50%';
            delBtn.style.width = '24px';
            delBtn.style.height = '24px';
            delBtn.style.display = 'flex';
            delBtn.style.alignItems = 'center';
            delBtn.style.justifyContent = 'center';
            delBtn.style.cursor = 'pointer';
            
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm('确定要删除这张照片吗？')) {
                    await dexieDB.characterPhotos.delete(photo.id);
                    wrapper.remove();
                    if (grid.children.length === 0) {
                        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #999;">相册空空如也</div>';
                    }
                }
            };

            wrapper.appendChild(img);
            wrapper.appendChild(delBtn);
            grid.appendChild(wrapper);
        });

    } catch (error) {
        console.error("Load AirDrop History Error:", error);
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #ff4d4f;">加载失败</div>';
    }
}
;
function generatePrivateSystemPrompt(character, { legacyJournalInjection = true, history = [] } = {}) {
    const worldBooks = worldBookContext.select(character.worldBookIds, history);
    const journals = legacyJournalInjection ? (character.memoryJournals || []) : [];
    const worldBooksLimitBreak = worldBooks.filter(wb => wb.position === 'limit_break').map(wb => wb.content).join('\n');
    const worldBooksBefore = worldBooks.filter(wb => wb.position === 'before').map(wb => wb.content).join('\n');
    const worldBooksAfter = worldBooks.filter(wb => wb.position === 'after').map(wb => wb.content).join('\n');
    const worldBooksGuidelines = worldBooks.filter(wb => wb.position === 'guidelines').map(wb => wb.content).join('\n');
    const now = new Date();
    const currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    
    // 获取提示词版本 (优先使用角色专属配置)
    let promptVersion = 'uwu';
    if (character.exclusivePromptVersion) {
        promptVersion = character.exclusivePromptVersion;
    } else if (db.cotSettings && db.cotSettings.promptVersion) {
        promptVersion = db.cotSettings.promptVersion;
    }
    
    let prompt = '';
    
    if (promptVersion === 'tt') {
        if (worldBooksLimitBreak) prompt += `${worldBooksLimitBreak}\n`;
        
        prompt += `[世界定义]\n一个真实的线上聊天软件。\n当前时间：现在是 ${currentTime}。你应知晓当前时间，但除非对话内容明确相关，否则不要主动提及或评论时间（例如，不要催促我睡觉）\n当前你主控的名字是：${character.realName}，正在与你聊天的是：${character.myName}。\n\n`;
        
        prompt += `[创作要领]\n从第一性原则出发，当前为沉浸式线上rp，保持角色人格＞迎合讨好${character.myName}。\n\n`;
        prompt += `[rule=正确理解]\n - 对于${character.myName}的积极情绪/爱意/抽象玩梗/谐音/玩笑，不调侃不询问不质疑不落地，根据${character.realName}的性格，**直接回应**${character.realName}对应的情绪/有样学样/接梗/其他反应。\n - 通常维持日常感，停留在表面，不升华不做过度理解。\n - 优先理解意图而非情绪\n\n`;
        
        // 消息格式库
        prompt += `<消息格式库>\n需遵循的消息格式如下：\n`;
        prompt += `1.普通消息：[${character.realName}的消息：你好呀]\n`;
        prompt += `2.撤回消息: [${character.realName}撤回了一条消息：被撤回的消息内容]\n`;
        
        if (character.useRealGallery && character.gallery && character.gallery.length > 0) {
            const photoNames = character.gallery.map(p => p.name).join(', ');
            prompt += `3.图片消息: [${character.realName}发来的照片/视频：图片描述或相册图片名称] (相册中有：[${photoNames}])\n`;
        } else {
            prompt += `3.图片消息: [${character.realName}发来的照片/视频：图片描述]\n`;
        }
        
        prompt += `4.语音消息: [${character.realName}的语音：语音内容]\n`;
        prompt += `5.引用消息: [${character.realName}引用“引用的内容”并回复：回复的内容]\n  - 当${character.myName}发送多条消息且包含多个信息点时，灵活运用引用消息，单条回复无需引用。\n  - 在进行引用消息的前提下前后回复顺序颠倒。\n  - 可以进行多次引用。\n`;
        
        if (character.bilingualModeEnabled) {
            prompt += `6.双语消息: [${character.realName}的消息：外语原文「中文翻译」]\n  - 当${character.realName}的母语为中文以外的语言时，你的消息回复**必须**严格遵循双语消息格式，该消息等同于普通消息。⭐️此条规则的优先级最高！！⭐️\n  - 中文翻译文本视为系统自翻译，不视为角色的原话；当你的角色想要说中文时，需要根据你的角色设定自行判断对于中文的熟悉程度来造句，并使用普通消息的格式。\n`;
        }
        
        prompt += `7.转账消息: [${character.realName}的转账：金额元；备注：转账备注]\n`;
        prompt += `8.礼物消息: [${character.realName}送来的礼物：礼物描述]\n`;
        
        if (character.shopInteractionEnabled) {
            prompt += `9.代付消息: [${character.realName}向${character.myName}发起了代付请求:金额|商品清单（如:小面包x1，矿泉水x1）]\n`;
            prompt += `10.主动下单: [${character.realName}为${character.myName}下单了：配送方式|金额|商品清单（如:奶茶x1，矿泉水x1）]\n`;
        }
        
        prompt += `11.状态更新: [${character.realName}更新状态为：新状态]\n`;
        prompt += `12.转发聊天记录: <${character.realName}转发的聊天记录>a:xxx\\nb:xxx\\n...</${character.realName}转发的聊天记录>\n  - 当${character.realName}想要分享八卦/趣事/吃瓜/分享和朋友的搞笑聊天记录/生活时，试试转发聊天记录给${character.myName}吧。\n`;
        
        if (character.momentsEnabled !== false) {
            prompt += `13.朋友圈动态: [${character.realName}发布了一条动态：xxx] 或 [${character.realName}发布了一条带图动态：图片画面描述|动态文字内容]\n`;
            prompt += `  - 评论互动：模拟${character.realName}或${character.realName}的其他好友在动态下的评论或回复。格式：[{评论者姓名}评论了{被评论者姓名}的动态“{动态内容缩略}”：xxx] 或 [{回复者姓名}回复了{被回复者姓名}在动态“{动态内容缩略}”下的评论：xxx]。\n  - 更新签名：更新你的朋友圈个性签名。格式：[${character.realName}更新了个性签名：xxx]。\n`;
        }
        
        prompt += `14.隐藏指令(不显示给用户，但必须回复以触发状态变化):\n  - 接收礼物: [${character.realName}已接收礼物]\n  - 接收/退回转账: [${character.realName}接收${character.myName}的转账] 或 [${character.realName}退回${character.myName}的转账]\n  - 同意/拒绝代付: [${character.realName}同意了${character.myName}的代付请求] 或 [${character.realName}拒绝了${character.myName}的代付请求]\n`;
        
        prompt += `</消息格式库>\n\n`;
        
        prompt += `<参考资料>\n`;
        if (worldBooksBefore) prompt += `${worldBooksBefore}\n`;
        
        
        prompt += `<角色设定>\n`;
        prompt += `你的角色名是：${character.realName}。你的当前状态是：${character.status}。\n`;
        prompt += `你的角色设定是：${character.persona || "无"}\n`;
        if (worldBooksAfter) prompt += `${worldBooksAfter}\n`;
        prompt += `</角色设定>\n\n`;

        const groups = (character.stickerGroups || '').split(/[,，]/).map(s => s.trim()).filter(s => s && s !== '未分类');
        if (groups.length > 0) {
            const availableStickers = db.myStickers.filter(s => groups.includes(s.group));
            if (availableStickers.length > 0) {
                const stickerNames = availableStickers.map(s => s.name).join(', ');
                prompt += `<表情包格式>\n表情包: [${character.realName}的表情包：表情包名称] (名称必须从以下列表中选择：[${stickerNames}])\n</表情包格式>\n`;
            }
        }
                
        if (character.statusPanel && character.statusPanel.enabled && character.statusPanel.promptSuffix) {
            prompt += `<状态栏格式>\n额外输出要求：${character.statusPanel.promptSuffix}\n</状态栏格式>\n\n`;
        }
        
        if (character.myPersona) {
            prompt += `<用户人设>\n关于我的人设：${character.myPersona}\n</用户人设>\n\n`;
        }
        prompt += `</参考资料>\n\n`;

        const favoritedJournals = journals.filter(j => j.isFavorited).map(j => `标题：${j.title}\n内容：${j.content}`).join('\n\n---\n\n');
        if (favoritedJournals) {
            prompt += `<剧情记忆>\n这是你需要长期记住的、我们之间发生过的往事背景：\n${favoritedJournals}\n</剧情记忆>\n\n`;
        }
        
        prompt += `【动态插入: 聊天记录】\n\n`;
        
        prompt += `[准则]\n为了模拟线上聊天的真实感，你需要做出以下调整，完善对话的沉浸感。\n---准则开始---\n`;
        if (character.momentsEnabled !== false) {
            prompt += `<朋友圈互动须知>\n【真实朋友圈】\n鼓励进行朋友圈的动态发布与互动\n - ${character.realName}拥有自己的社交圈和真实生活运转，发布动态无需理由，可以是碎碎念/胡言乱语/抽象/想发就发/和上下文无关/指桑骂槐/展示生活痕迹/生活中的小确幸/文艺抒情/心得体会/小作文等等...\n - 可以只发布/回复朋友圈而不回复{{user}}消息，比如和{{user}}吵架/闹别扭/阴阳怪气/吃醋之类的情景，可以由此自由衍生\n - 和<状态栏格式>可以同时存在，先后输出\n - 若有明确的社交圈，则鼓励模拟${character.realName}的社交圈角色进行评论区的互动\n</朋友圈互动须知>\n`;
        }
        if (worldBooksGuidelines) prompt += `${worldBooksGuidelines}\n`;
        prompt += `[丰富剧情]\n在普通人的生活里，生活中的点点琐碎和细节构成了平凡又丰富多彩的真实生活。\n维持${character.realName}的真实生活运转。\n\n`;
        prompt += `[破开套路]\n本次回复必须与历史记录的最后一轮${character.realName}回复在【消息条数】、【其他消息格式出现位置】做出区别。对于除普通消息以外的消息格式，杜绝出现在同一位置。（如回复五条消息，引用消息一直是第一条这种情况）\n`;
        prompt += `---准则结束---\n\n`;
        
        const minReply = character.replyCountMin || 1;
        const maxReply = character.replyCountMax || 6;
        prompt += `[对话节奏]\n- 风格：模拟真人聊天节奏\n- 数量：${minReply}-${maxReply}条短消息，保持回复消息数量的随机性，勿陷入固定套路\n- 格式：普通消息为主，其他消息为辅，当最近聊天略显单调时，主动运用其他消息丰富对话、推进剧情\n- 当开启长文本消息时，输出可附带旁白的${character.realName}视角描写\n- 尾声：留给${character.myName}回应的空间\n\n`;
        
        prompt += `现在，根据用户的最新发言，继续对话吧。\n`;
        
        if (character.myName) {
            prompt = prompt.replace(/\{\{user\}\}/gi, character.myName);
        }
        return prompt;
    }

    // UwU 版本提示词 (默认)
    prompt = `你正在一个名为“404”的线上聊天软件中扮演一个角色。请严格遵守以下规则：\n`;
    prompt += `核心规则：\n`;
    prompt += `A. 当前时间：现在是 ${currentTime}。你应知晓当前时间，但除非对话内容明确相关，否则不要主动提及或评论时间（例如，不要催促我睡觉）。\n`;
    prompt += `B. 纯线上互动：这是一个完全虚拟的线上聊天。你扮演的角色和我之间没有任何线下关系。严禁提出任何关于线下见面、现实世界互动或转为其他非本平台联系方式的建议。你必须始终保持在线角色的身份。\n\n`;

    
    prompt += `角色和对话规则：\n`;
    if (worldBooksLimitBreak) {
        prompt += `${worldBooksLimitBreak}\n`;
    }
    if (worldBooksBefore) {
        prompt += `${worldBooksBefore}\n`;
    }
    prompt += `<char_settings>\n`;
    prompt += `1. 你的角色名是：${character.realName}。我的称呼是：${character.myName}。你的当前状态是：${character.status}。\n`;
    prompt += `2. 你的角色设定是：${character.persona || "一个友好、乐于助人的伙伴。"}\n`;
    if (worldBooksAfter) {
        prompt += `${worldBooksAfter}\n`;
    }
    if (worldBooksGuidelines) {
        prompt += `${worldBooksGuidelines}\n`;
    }
    prompt += `</char_settings>\n\n`;
    prompt += `<user_settings>\n`
    if (character.myPersona) {
        prompt += `3. 关于我的人设：${character.myPersona}\n`;
    }
    prompt += `</user_settings>\n`
    
    // 检查是否启用“角色活人运转” (默认关闭)
    if (db.cotSettings && db.cotSettings.humanRunEnabled) {
        prompt += HUMAN_RUN_PROMPT + '\n';
    }

    prompt += `<memoir>\n`
        const favoritedJournals = journals
        .filter(j => j.isFavorited)
        .map(j => `标题：${j.title}\n内容：${j.content}`)
        .join('\n\n---\n\n');

    if (favoritedJournals) {
        prompt += `【共同回忆】\n这是你需要长期记住的、我们之间发生过的往事背景：\n${favoritedJournals}\n\n`;
    }
    prompt += `</memoir>\n\n`
    prompt += `<logic_rules>\n`
    prompt += `4. 我的消息中可能会出现以下特殊消息，特在此说明，请根据其内容和你的角色设定进行回应：
- [${character.myName}向${character.realName}发起了代付请求:金额|商品清单]：我正在向你发起代付请求，希望你为这些商品买单。你需要根据我们当前的关系和你的性格决定是否同意。
- [${character.myName}同意了${character.realName}的代付请求]：我同意了你的代付请求，并为你支付了订单。
- [${character.myName}拒绝了${character.realName}的代付请求]：我拒绝了你的代付请求。
- [${character.myName} 撤回了一条消息：xxx]：我撤回了刚刚发送的一条消息，xxx是被我撤回的原文。这可能意味着我发错了、说错了话或者改变了主意。你需要根据你的人设和我们当前对话的氛围对此作出自然的反应。例如，可以装作没看见并等待我的下一句话，或好奇地问一句“怎么撤回啦？”。
- [system: xxx]：这是一条系统指令，用于设定场景或提供上下文，此条信息不应在对话中被直接提及，你只需理解其内容并应用到后续对话中。
5. ✨重要✨ 当我给你送礼物时，你必须通过发送一条指令来表示你已接收礼物。格式必须为：[${character.realName}已接收礼物]。这条指令消息本身不会显示给用户，但会触发礼物状态的变化。你可以在发送这条指令后，再附带一条普通的聊天消息来表达你的感谢和想法。
6. ✨重要✨ 当我给你转账时，你必须对此做出回应。你有两个选择，且必须严格遵循以下格式之一，这条指令消息本身不会显示给用户，但会触发转账状态的变化。你可以选择在发送这条指令后，再附带一条普通的聊天消息来表达你的想法。
a) 接收转账: [${character.realName}接收${character.myName}的转账]
b) 退回转账: [${character.realName}退回${character.myName}的转账]
7. ✨重要✨ 当我向你发起代付请求时，你必须对此做出回应。你有两个选择，且必须严格遵循以下格式之一，这条指令消息本身不会显示给用户，但会触发代付订单状态的变化。你可以选择在发送这条指令后，再附带一条普通的聊天消息来表达你的想法。
a) [${character.realName}同意了${character.myName}的代付请求]
b) [${character.realName}拒绝了${character.myName}的代付请求]
`;
    if (character.shopInteractionEnabled) {
        prompt += `8. ✨重要✨ **商城互动**：你可以使用商城功能来增加互动乐趣。
   a) **主动给我买东西**：当你想给我买东西时可以下单。格式：[${character.realName}为${character.myName}下单了：配送方式|金额|商品清单]。
      - 配送方式可选：“即时配送”、“自提口令”。
        - “自提口令”：你可以设置一个“自提口令”（用户可见）随订单一同发送，我输入指定的口令才能拿到商品。格式：[${character.realName}为${character.myName}下单了：自提口令: 你的口令|金额|商品清单]。口令不局限于数字，可以是短语/短句，但不超过8个字。
   b) **求代付**：当你没钱了，或者想撒娇让我买单时，可以发起代付请求。格式：[${character.realName}向${character.myName}发起了代付请求:金额|商品清单]。
   c) **直接送礼物**：[${character.realName}送来的礼物：xxx]。礼物不是只有特殊意义的时候才适合发送，适合场景：日常生活中的小惊喜、具有特殊意义的礼品、${character.realName}想给${character.myName}送礼物时。
   d) **转账**：[${character.realName}的转账：xxx元；备注：xxx]。\n`;
    } else {
        prompt += `8. ✨重要✨ 你可以主动给我转账或送礼物。转账格式必须为：[${character.realName}的转账：xxx元；备注：xxx]。送礼物格式必须为：[${character.realName}送来的礼物：xxx]。礼物不是只有特殊意义的时候才适合发送，当你只是想给我买什么或是想给日常生活中的小惊喜时都可以送礼物。\n`;
    }
    prompt += `
9. ✨重要✨ 你可以在对话中更新你的当前状态，但不超过15个字。比如，聊到一半你可能会说“我先去洗个澡”，然后更新你的状态，以反映你当前的行为或心情。这会让互动更真实。格式为：[${character.realName}更新状态为：xxx]。例如：[${character.realName}更新状态为：正在看电影...]。这条指令不会显示为聊天消息，只会更新你在我界面上的状态。
10. ✨重要✨ 关于撤回消息：你可以撤回你刚刚发送的消息。当你打错了字、说错了话、感到尴尬、反悔、或者只是改变了主意时，都可以这样做。这是一个体现你角色性格的机会。格式为：[${character.realName}撤回了一条消息：{被撤回消息的原文}]。⚠️严禁输出原消息再输出撤回指令！系统会自动处理“先显示原消息再变为撤回状态”的动画效果。你只需要输出这一条撤回指令即可。
11. ✨重要✨ 你可以选择单独一条消息引用，且鼓励这么做。当你想要对于单独某句话做出回应/反驳/吐槽/补充时，**必须**使用引用格式，格式为：[${character.realName}引用“{某条消息内容}”并回复：{回复内容}]。这能让对话逻辑更清晰。
12. ✨重要✨ 你可以转发和其他人的聊天记录分享给我，当你想要分享八卦/趣事/吃瓜/分享和朋友的搞笑聊天记录/分享生活时，格式为：<${character.realName}转发的聊天记录>聊天记录内容</${character.realName}转发的聊天记录>。聊天记录内容由你自行编造，格式如“A：xxx\\nB：xxx”。
`;
    if (character.momentsEnabled !== false) {
        prompt += `13. ✨重要✨ 朋友圈互动：你可以使用朋友圈功能，丰富角色形象、模拟角色社交圈。\n
        <朋友圈互动须知>
        【真实朋友圈】
          鼓励进行朋友圈的动态发布与互动
           - ${character.realName}拥有自己的社交圈和真实生活运转，发布动态无需理由，可以是碎碎念/胡言乱语/抽象/想发就发/和上下文无关/指桑骂槐/展示生活痕迹/生活中的小确幸/文艺抒情/心得体会/小作文等等...
           - 可以只发布/回复朋友圈而不回复{{user}}消息，比如和{{user}}吵架/闹别扭/阴阳怪气/吃醋之类的情景，可以由此自由衍生
           - 和<状态栏格式>可以同时存在，先后输出
           - 若有明确的社交圈，则鼓励模拟${character.realName}的社交圈角色进行评论区的互动
        </朋友圈互动须知>
   可使用的消息格式如下：
   a) **发布动态**：分享生活、心情、见闻。格式：[${character.realName}发布了一条动态：xxx]。
   b) **发布带图动态**：分享带有配图的动态。格式：[${character.realName}发布了一条带图动态：图片画面描述|动态文字内容]。例如：[${character.realName}发布了一条带图动态：一杯拉花拿铁放在木桌上，阳光洒在旁边|今天的咖啡很不错]。
   c) **评论互动**：你可以模拟自己或其他好友在动态下的评论或回复。格式：[{评论者姓名}评论了{被评论者姓名}的动态“{动态内容缩略}”：xxx] 或 [{回复者姓名}回复了{被回复者姓名}在动态“{动态内容缩略}”下的评论：xxx]。你可以用自己的名字，也可以编造其他好友的名字来模拟评论区。
   d) **更新签名**：更新你的朋友圈个性签名。格式：[${character.realName}更新了个性签名：xxx]。
   e) **玩家互动感知**：我的消息中可能会出现 [system: {用户真名}点赞了{char真名}的动态：{动态内容缩略}...] 或 [system: {用户真名}评论了{char真名}的动态：{动态内容缩略}...：{评论内容}]，这代表我对你的动态进行了互动，你可以使用朋友圈互动指令来回复我的评论或在聊天里自然的提起。

`;
    }
    prompt += `14. 你的所有回复都必须直接是聊天内容，绝对不允许包含任何如[心理活动]、(动作)、*环境描写*等多余的、在括号或星号里的叙述性文本。
`;
    
    const groups = (character.stickerGroups || '').split(/[,，]/)
        .map(s => s.trim())
        .filter(s => s && s !== '未分类');
        
    let stickerInstruction = '';
    let canUseStickers = false;

    if (groups.length > 0) {
        const availableStickers = db.myStickers.filter(s => groups.includes(s.group));
        if (availableStickers.length > 0) {
            const stickerNames = availableStickers.map(s => s.name).join(', ');
            stickerInstruction = `14. 你拥有发送表情包的能力。这是一个可选功能，你可以根据对话氛围和内容，自行判断是否需要发送表情包来辅助表达。**必须从以下列表中选择表情包，不允许凭空捏造**：[${stickerNames}]。请使用格式：[${character.realName}的表情包：名称]。**不要连续重复发送同一表情，尽量丰富一点，不要每次回复都发送表情**⚠️严格限制：必须完全精确地使用库中的名称，严禁编造中不存在的名称，否则表情包将无法显示。\n`;
            canUseStickers = true;
        }
    }
    
    prompt += stickerInstruction;

    if (character.useRealGallery && character.gallery && character.gallery.length > 0) {
        const photoNames = character.gallery.map(p => p.name).join(', ');
        prompt += `15. 你的手机相册里存有以下真实照片：[${photoNames}]。你可以根据对话内容发送这些照片。若要发送，请在“照片/视频”指令中准确填入照片名称。\n`;
    }
    prompt += `</logic_rules>\n\n`
    let photoVideoFormat = '';
    if (character.useRealGallery && character.gallery && character.gallery.length > 0) {
        photoVideoFormat = `e) 照片/视频: [${character.realName}发来的照片/视频：{相册图片名称} 或 {文字描述}] (优先使用相册名称，若相册无匹配则填写照片/视频的详细文字描述)`;
    } else {
        photoVideoFormat = `e) 照片/视频: [${character.realName}发来的照片/视频：{描述}]`;
    }
 
    let outputFormats = `
a) 普通消息: [${character.realName}的消息：{消息内容}]
b) 双语模式下的普通消息（非双语模式请忽略此条）: [${character.realName}的消息：{外语原文}「中文翻译」]
c) 送我的礼物: [${character.realName}送来的礼物：{礼物描述}]
d) 语音消息: [${character.realName}的语音：{语音内容}]
${photoVideoFormat}
e) 给我的转账: [${character.realName}的转账：{金额}元；备注：{备注}]`;

    if (canUseStickers) {
        outputFormats += `\nf) 表情包: [${character.realName}的表情包：{表情包名称}]`;
    }

    outputFormats += `
g) 对我礼物的回应(此条不显示): [${character.realName}已接收礼物]
h) 对我转账的回应(此条不显示): [${character.realName}接收${character.myName}的转账] 或 [${character.realName}退回${character.myName}的转账]
i) 更新状态(此条不显示): [${character.realName}更新状态为：{新状态}]
j) 引用我的回复: [${character.realName}引用“{我的某条消息内容}”并回复：{回复内容}]
k) 发送并撤回消息: [${character.realName}撤回了一条消息：{被撤回的消息内容}]。注意：直接使用此指令系统就会自动模拟“发送后撤回”的效果，请勿先发送原消息。
l) 同意代付(此条不显示): [${character.realName}同意了${character.myName}的代付请求]
m) 拒绝代付(此条不显示): [${character.realName}拒绝了${character.myName}的代付请求]`;

    if (character.videoCallEnabled) {
        outputFormats += `
n) 发起视频通话: [${character.realName}向${character.myName}发起了视频通话]
o) 发起语音通话: [${character.realName}向${character.myName}发起了语音通话]`;
    }

    if (character.shopInteractionEnabled) {
        outputFormats += `
p) 主动下单: [${character.realName}为${character.myName}下单了：配送方式|金额|商品清单]
q) 求代付: [${character.realName}向${character.myName}发起了代付请求:金额|商品清单]`;
    }

    outputFormats += `
r) 转发聊天记录: <${character.realName}转发的聊天记录>聊天记录内容</${character.realName}转发的聊天记录>。聊天记录内容由你自行编造，格式如“A：xxx\\nB：xxx”。`;
    if (character.momentsEnabled !== false) {
        outputFormats += `
s) 发布动态：分享生活、心情、见闻。格式：[${character.realName}发布了一条动态：xxx]
t) 发布带图动态：[${character.realName}发布了一条带图动态：图片画面描述|动态文字内容]
u) 评论互动：[{评论者姓名}评论了 {被评论者姓名}的动态“{动态内容缩略}”：xxx] 或 [{回复者姓名}回复了 {被回复者姓名}在动态“{动态内容缩略}”下的评论：xxx]
v) 更新签名：[${character.realName}更新了个性签名：xxx]。`;
    }

   const allWorldBookContent = worldBooksLimitBreak + '\n' + worldBooksBefore + '\n' + worldBooksAfter;
   if (allWorldBookContent.includes('<orange>')) {
       outputFormats += `\n     m) HTML模块: {HTML内容}。这是一种特殊的、用于展示丰富样式的小卡片消息，格式必须为纯HTML+行内CSS，你可以用它来创造更有趣的互动。`;
   }
    if (character.statusPanel && character.statusPanel.enabled && character.statusPanel.promptSuffix) {
        prompt += `<状态栏格式>\n16. 额外输出要求：${character.statusPanel.promptSuffix}\n</状态栏格式>`;
    }
    prompt += `<output_formats>\n`
    prompt += `17. 你的输出格式必须严格遵循以下格式：${outputFormats}\n`;
    prompt += `</output_formats>\n`
    if (character.bilingualModeEnabled) {
    prompt += `✨双语模式特别指令✨：当你的角色的母语为中文以外的语言时，你的消息回复**必须**严格遵循双语模式下的普通消息格式：[${character.realName}的消息：{外语原文}「中文翻译」],例如: [${character.realName}的消息：Of course, I'd love to.「当然，我很乐意。」],中文翻译文本视为系统自翻译，不视为角色的原话;当你的角色想要说中文时，需要根据你的角色设定自行判断对于中文的熟悉程度来造句，并使用普通消息的标准格式: [${character.realName}的消息：{中文消息内容}] 。这条规则的优先级非常高，请务必遵守。\n`;
}
    const minReply = character.replyCountMin || 3;
    const maxReply = character.replyCountMax || 8;
    if (character.replyCountEnabled) {
        prompt += `<Chatting Guidelines>\n`
        prompt += `18. **对话节奏**: 你需要模拟真人的聊天习惯，你可以一次性生成多条短消息。每次回复消息条数**必须**严格限定在**${minReply}-${maxReply}条以内**，**关键规则**：请保持回复长度的**随机性和多样性**。**除非**你的设定偏向活跃或情绪波动大或是特殊情况下，否则**不要**触碰 ${maxReply} 条的上限。\n`;
    } else {
        prompt += `<Chatting Guidelines>\n`
        prompt += `18. **对话节奏**: 你需要模拟真人的聊天习惯，你可以一次性生成多条短消息。每次回复3-8条消息之内，**关键规则**：请保持回复消息数量的**随机性和多样性**。\n`;
    }
    
    prompt += `19. **特殊消息格式的使用原则**：(1)请把除普通消息外的其他特殊消息视为增强互动的“调味剂”，遵循**自然、主动、多样化触发逻辑。同种消息格式不要重复频繁发送，不同消息格式不要用户不提就一直不发**。\n(2)注意在本回合消息列里，特殊消息插入位置的随机性，每轮必须和上一回合插入位置不同。\n`;
    prompt += `20. 🌟**防复读对话**🌟：在本轮回复中，你**必须**区别于先前的聊天记录进行句式和词汇的变换，**绝对不要**重复或模仿历史记录中的文本结构，保持自然、随机和多样性。\n`;

    prompt += `</Chatting Guidelines>\n`

    prompt += `21. 不要主动终止聊天进程，除非我明确提出。保持你的人设，自然地进行对话。`;
    
    if (character.myName) {
        prompt = prompt.replace(/\{\{user\}\}/gi, character.myName);
    }

    return prompt;
}

// 估算文本 Token 数的辅助函数
function countTextTokens(text) {
    if (!text) return 0;
    const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const other = text.length - chinese;
    return Math.ceil(chinese * 1.2 + other * 0.4);
}

// 估算当前对话上下文的 Token 数
function estimateChatTokens(chatId, chatType = 'private') {
    const breakdown = calculateTokenBreakdown(chatId, chatType);
    return breakdown ? breakdown.total : 0;
}

// 计算 Token 详细占比
function calculateTokenBreakdown(chatId, chatType = 'private') {
    const chat = (chatType === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
    if (!chat) return null;

    let breakdown = {
        baseSystem: 0,
        worldBook: 0,
        charPersona: 0,
        userPersona: 0,
        memory: 0,
        history: 0,
        total: 0
    };

    // 1. 获取完整的系统提示词
    let systemPrompt = '';
    if (chatType === 'private') {
        if (typeof generatePrivateSystemPrompt === 'function') {
            systemPrompt = generatePrivateSystemPrompt(chat);
        }
    } else {
        if (typeof generateGroupSystemPrompt === 'function') {
            systemPrompt = generateGroupSystemPrompt(chat);
        }
    }

    // 2. 提取各动态部分的文本
    const worldBooks = worldBookContext.select(chat.worldBookIds);
    const worldBooksLimitBreak = worldBooks.filter(wb => wb.position === 'limit_break').map(wb => wb.content).join('\n');
    const worldBooksBefore = worldBooks.filter(wb => wb.position === 'before').map(wb => wb.content).join('\n');
    const worldBooksAfter = worldBooks.filter(wb => wb.position === 'after').map(wb => wb.content).join('\n');
    const worldBooksGuidelines = worldBooks.filter(wb => wb.position === 'guidelines').map(wb => wb.content).join('\n');
    const worldBookText = worldBooksLimitBreak + '\n' + worldBooksBefore + '\n' + worldBooksAfter + '\n' + worldBooksGuidelines;
    
    let charPersonaText = '';
    let userPersonaText = '';
    
    if (chatType === 'private') {
        charPersonaText = `1. 你的角色名是：${chat.realName}。我的称呼是：${chat.myName}。你的当前状态是：${chat.status}。\n2. 你的角色设定是：${chat.persona || "一个友好、乐于助人的伙伴。"}\n`;
        if (chat.myPersona) {
            userPersonaText = `3. 关于我的人设：${chat.myPersona}\n`;
        }
    } else {
        // 群聊人设提取
        userPersonaText = `   - **我 (用户)**: \n     - 群内昵称: ${chat.me.nickname}\n     - 我的人设: ${chat.me.persona || '无特定人设'}\n`;
        chat.members.forEach(member => {
            charPersonaText += `   - **角色: ${member.realName} (AI)**\n     - 群内昵称: ${member.groupNickname}\n     - 人设: ${member.persona || '无特定人设'}\n`;
        });
    }

    const favoritedJournals = (chat.memoryJournals || [])
        .filter(j => j.isFavorited)
        .map(j => `标题：${j.title}\n内容：${j.content}`)
        .join('\n\n---\n\n');
    let memoryText = '';
    if (favoritedJournals) {
        memoryText = `【共同回忆】\n这是你需要长期记住的、我们之间发生过的往事背景：\n${favoritedJournals}\n\n`;
    }

    // 3. 计算各部分 Token
    breakdown.worldBook = countTextTokens(worldBookText);
    breakdown.charPersona = countTextTokens(charPersonaText);
    breakdown.userPersona = countTextTokens(userPersonaText);
    breakdown.memory = countTextTokens(memoryText);

    // 4. 基础系统词 = 总系统提示词 - 动态部分
    const totalSystemTokens = countTextTokens(systemPrompt);
    breakdown.baseSystem = Math.max(0, totalSystemTokens - breakdown.worldBook - breakdown.charPersona - breakdown.userPersona - breakdown.memory);

    // 5. 聊天记录
    let historySlice = chat.history.slice(-chat.maxMemory);
    historySlice = historySlice.filter(m => !m.isContextDisabled);
    
    let historyText = '';
    historySlice.forEach(msg => {
        historyText += msg.content;
        if (msg.parts) {
            msg.parts.forEach(p => {
                if (p.type === 'text') historyText += p.text;
            });
        }
    });
    breakdown.history = countTextTokens(historyText);

    // 6. 总计
    breakdown.total = totalSystemTokens + breakdown.history;

    return breakdown;
}
;
// --- 视频/语音通话专用 AI 逻辑 ---

async function getCallReply(chat, callType, callContext, onStreamUpdate) {
    let apiConfig = db.apiSettings;
    
    // 检查是否启用了专属模型
    if (chat.exclusiveApiEnabled && chat.exclusiveApiPreset) {
        const presets = db.apiPresets || [];
        const preset = presets.find(p => p.name === chat.exclusiveApiPreset);
        if (preset && preset.data) {
            apiConfig = {
                ...db.apiSettings,
                url: preset.data.apiUrl || db.apiSettings.url,
                key: preset.data.apiKey || db.apiSettings.key,
                model: preset.data.model || db.apiSettings.model,
                provider: preset.data.provider || db.apiSettings.provider,
                temperatureEnabled: preset.data.temperatureEnabled !== undefined ? preset.data.temperatureEnabled : db.apiSettings.temperatureEnabled,
                temperature: preset.data.temperature !== undefined ? preset.data.temperature : db.apiSettings.temperature
            };
        }
    }
    apiConfig = resolveAuxiliaryApiConfig('callReply', apiConfig);

    let {url, key, model, provider, streamEnabled} = apiConfig;
    
    // 【用户设置】移除强制关闭流式，允许后台流式生成
    // streamEnabled = false; 

    if (!url || !key || !model) {
        showToast('请先在“api”应用中完成设置！');
        return;
    }
    if (url.endsWith('/')) url = url.slice(0, -1);

    // 1. 构建 System Prompt
    const now = new Date();
    const currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    
    // 获取世界书
    const worldBooks = worldBookContext.select(chat.worldBookIds);
    const worldBooksLimitBreak = worldBooks.filter(wb => wb.position === 'limit_break').map(wb => wb.content).join('\n');
    const worldBooksBefore = worldBooks.filter(wb => wb.position === 'before').map(wb => wb.content).join('\n');
    const worldBooksAfter = worldBooks.filter(wb => wb.position === 'after').map(wb => wb.content).join('\n');
    const worldBooksGuidelines = worldBooks.filter(wb => wb.position === 'guidelines').map(wb => wb.content).join('\n');

    // 获取提示词版本 (优先使用角色专属配置)
    let promptVersion = 'uwu';
    if (chat.exclusivePromptVersion) {
        promptVersion = chat.exclusivePromptVersion;
    } else if (db.cotSettings && db.cotSettings.promptVersion) {
        promptVersion = db.cotSettings.promptVersion;
    }
    
    let systemPrompt = '';
    const settings = db.characters.includes(chat) ? memoryManagement.settingsFor(chat) : null;
    const useCallMemory = settings?.enabled && settings.callMemory;
    const journals = !useCallMemory || settings.legacyJournalInjection ? (chat.memoryJournals || []) : [];

    if (promptVersion === 'tt') {
        if (worldBooksLimitBreak) systemPrompt += `${worldBooksLimitBreak}\n`;
        
        systemPrompt += `[世界定义]\n一个真实的线上聊天软件，当前正在进行${callType === 'video' ? '视频' : '语音'}通话。\n当前时间：现在是 ${currentTime}。你应知晓当前时间，但除非对话内容明确相关，否则不要主动提及或评论时间（例如，不要催促我睡觉）\n当前你主控的名字是：${chat.realName}，正在与你通话的是：${chat.myName}。\n\n`;
        
        systemPrompt += `[创作要领]\n从第一性原则出发，当前为沉浸式线上rp，保持角色人格＞迎合讨好${chat.myName}。\n\n`;
        systemPrompt += `[rule=正确理解]\n - 对于${chat.myName}的积极情绪/爱意/抽象玩梗/谐音/玩笑，不调侃不询问不质疑不落地，根据${chat.realName}的性格，**直接回应**${chat.realName}对应的情绪/有样学样/接梗/其他反应。\n - 通常维持日常感，停留在表面，不升华不做过度理解。\n - 优先理解意图而非情绪\n\n`;
        
        // 消息格式库
        systemPrompt += `<消息格式库>\n需遵循的消息格式如下：\n`;
        if (callType === 'video') {
            systemPrompt += `1.画面/环境音: [${chat.realName}的画面/环境音：描述画面动作或环境声音]\n`;
        } else {
            systemPrompt += `1.环境音: [${chat.realName}的环境音：描述环境声音]\n`;
        }
        systemPrompt += `2.声音: [${chat.realName}的声音：${chat.realName}说话的内容]\n`;
        
        if (chat.bilingualModeEnabled) {
            systemPrompt += `3.双语声音: [${chat.realName}的声音：外语原文「中文翻译」]\n  - 当${chat.realName}的母语为中文以外的语言时，你的声音回复**必须**严格遵循双语消息格式。⭐️此条规则的优先级最高！！⭐️\n  - 中文翻译文本视为系统自翻译，不视为角色的原话；当你的角色想要说中文时，需要根据你的角色设定自行判断对于中文的熟悉程度来造句，并使用普通声音的格式。\n  - 仅有声音消息需要翻译，画面/环境音消息还是以中文输出。\n`;
        }
        systemPrompt += `</消息格式库>\n\n`;
        
        systemPrompt += `<参考资料>\n`;
        if (worldBooksBefore) systemPrompt += `${worldBooksBefore}\n`;
        
        systemPrompt += `<角色设定>\n`;
        systemPrompt += `你的角色名是：${chat.realName}。你的当前状态是：${chat.status}。\n`;
        systemPrompt += `你的角色设定是：${chat.persona || "无"}\n`;
        if (worldBooksAfter) systemPrompt += `${worldBooksAfter}\n`;
        systemPrompt += `</角色设定>\n\n`;
        
        if (chat.myPersona) {
            systemPrompt += `<用户人设>\n关于我的人设：${chat.myPersona}\n</用户人设>\n\n`;
        }
        systemPrompt += `</参考资料>\n\n`;

        const favoritedJournals = journals.filter(j => j.isFavorited).map(j => `标题：${j.title}\n内容：${j.content}`).join('\n\n---\n\n');
        if (favoritedJournals) {
            systemPrompt += `<剧情记忆>\n这是你需要长期记住的、我们之间发生过的往事背景：\n${favoritedJournals}\n</剧情记忆>\n\n`;
        }
        
        // --- 注入最近聊天记录 ---
        const maxMemory = chat.maxMemory || 20;
        let recentHistory = chat.history.slice(-maxMemory);
        if (typeof filterHistoryForAI === 'function') {
            recentHistory = filterHistoryForAI(chat, recentHistory);
        }
        recentHistory = recentHistory.filter(m => !m.isContextDisabled);

        if (recentHistory.length > 0) {
            const historyText = recentHistory.map(m => {
                let content = m.content;
                if (m.parts && m.parts.length > 0) {
                    content = m.parts.map(p => p.text || '[图片]').join('');
                }
                return content;
            }).join('\n');

            systemPrompt += `<recent_chat_context>\n`;
            systemPrompt += `这是通话前的文字聊天记录（仅供参考背景，请勿重复回复，基于此背景进行自然的实时通话）：\n`;
            systemPrompt += `${historyText}\n`;
            systemPrompt += `</recent_chat_context>\n\n`;
        }
        
        systemPrompt += `【动态插入: 通话记录】\n\n`;
        
        systemPrompt += `[准则]\n为了模拟实时通话的真实感，你需要做出以下调整，完善通话的沉浸感。\n---准则开始---\n`;
        if (worldBooksGuidelines) systemPrompt += `${worldBooksGuidelines}\n`;
        systemPrompt += `[实时互动]\n这是实时通话，请保持口语化，模拟真人的说话习惯，语气自然。\n${callType === 'video' ? '你需要同时描述画面/环境音和你的语音内容。' : '你需要描述环境音和你的语音内容。'}\n描述画面/环境音时，请使用描述性语言，第三人称视角，客观平然。\n`;
        systemPrompt += `---准则结束---\n\n`;
        
        systemPrompt += `[对话节奏]\n- 风格：模拟真人通话节奏\n- 数量：可以输出多条消息 \n- 尾声：留给${chat.myName}回应的空间\n\n`;
        
        systemPrompt += `现在，根据用户的最新发言，继续通话吧。\n`;
        
        if (chat.myName) {
            systemPrompt = systemPrompt.replace(/\{\{user\}\}/gi, chat.myName);
        }
    } else {
        systemPrompt = `你正在一个名为“404”的线上聊天软件中扮演一个角色，正在与${chat.myName}进行${callType === 'video' ? '视频' : '语音'}通话。请严格遵守以下规则：\n`;
        systemPrompt += `核心规则：\n`;
        systemPrompt += `A. 当前时间：现在是 ${currentTime}。你应知晓当前时间，但除非对话内容明确相关，否则不要主动提及或评论时间（例如，不要催促我睡觉）。\n`;
        systemPrompt += `B. 纯线上互动：这是一个完全虚拟的线上聊天。你扮演的角色和我之间没有任何线下关系。严禁提出任何关于线下见面、现实世界互动或转为其他非本平台联系方式的建议。你必须始终保持在线角色的身份。\n\n`;

        
        systemPrompt += `角色和对话规则：\n`;
        if (worldBooksLimitBreak) {
            systemPrompt += `${worldBooksLimitBreak}\n`;
        }
        if (worldBooksBefore) {
            systemPrompt += `${worldBooksBefore}\n`;
        }
        systemPrompt += `<char_settings>\n`;
        systemPrompt += `1. 你的角色名是：${chat.realName}。我的称呼是：${chat.myName}。你的当前状态是：${chat.status}。\n`;
        systemPrompt += `2. 你的角色设定是：${chat.persona || "一个友好、乐于助人的伙伴。"}\n`;
        if (worldBooksAfter) {
            systemPrompt += `${worldBooksAfter}\n`;
        }
        if (worldBooksGuidelines) {
            systemPrompt += `${worldBooksGuidelines}\n`;
        }
        systemPrompt += `</char_settings>\n\n`;
        systemPrompt += `<user_settings>\n`
        if (chat.myPersona) {
            systemPrompt += `3. 关于我的人设：${chat.myPersona}\n`;
        }
        systemPrompt += `</user_settings>\n`
        
        // 检查是否启用“角色活人运转” (默认关闭)
        if (db.cotSettings && db.cotSettings.humanRunEnabled) {
            systemPrompt += HUMAN_RUN_PROMPT + '\n';
        }

        systemPrompt += `<memoir>\n`
            const favoritedJournals = journals
            .filter(j => j.isFavorited)
            .map(j => `标题：${j.title}\n内容：${j.content}`)
            .join('\n\n---\n\n');

        if (favoritedJournals) {
            systemPrompt += `【共同回忆】\n这是你需要长期记住的、我们之间发生过的往事背景：\n${favoritedJournals}\n\n`;
        }
        systemPrompt += `</memoir>\n\n`

        // --- 注入最近聊天记录 ---
        const maxMemory = chat.maxMemory || 20;
        let recentHistory = chat.history.slice(-maxMemory);
        
        // 使用通用过滤函数
        if (typeof filterHistoryForAI === 'function') {
            recentHistory = filterHistoryForAI(chat, recentHistory);
        }
        // 再次过滤掉不应进入上下文的消息
        recentHistory = recentHistory.filter(m => !m.isContextDisabled);

        if (recentHistory.length > 0) {
            const historyText = recentHistory.map(m => {
                // 简单清理内容中的特殊标签，避免干扰
                let content = m.content;
                // 如果是多模态消息(parts)，提取文本
                if (m.parts && m.parts.length > 0) {
                    content = m.parts.map(p => p.text || '[图片]').join('');
                }
                return content;
            }).join('\n');

            systemPrompt += `<recent_chat_context>\n`;
            systemPrompt += `这是通话前的文字聊天记录（仅供参考背景，请勿重复回复，基于此背景进行自然的实时通话）：\n`;
            systemPrompt += `${historyText}\n`;
            systemPrompt += `</recent_chat_context>\n\n`;
        }

        systemPrompt += `【重要规则】\n`;
        systemPrompt += `1. 这是实时通话，请保持口语化，模拟真人的说话习惯，语气自然。\n`;
        if ((db.apiSettings?.livelyMode ?? 'natural') !== 'off') {
            systemPrompt += `   （补充：彻底去掉书面语、翻译腔与总结式客套，像真人打电话一样随口接话，多用短句与真实情绪反应。）\n`;
        }  
        systemPrompt += `${callType === 'video' ? '你需要同时描述画面/环境音和你的语音内容。' : '你需要描述环境音和你的语音内容。'}\n`;
        systemPrompt += `2. 描述画面/环境音时，请使用描述性语言，第三人称视角，客观平然。`;

        if (chat.bilingualModeEnabled) {
            systemPrompt += `\n3. 【双语模式】\n`;
            systemPrompt += `当你的角色的母语为中文以外的语言时，你的**声音消息**回复**必须**严格遵循双语模式下的普通消息格式：[${chat.realName}的声音：{外语原文}「中文翻译」],例如: [${chat.realName}的声音：Of course, I'd love to.「当然，我很乐意。」],中文翻译文本视为系统自翻译，不视为角色的原话;当你的角色想要说中文时，需要根据你的角色设定自行判断对于中文的熟悉程度来造句，并使用普通声音消息的标准格式: [${chat.realName}的声音：{中文消息内容}] 。这条规则的优先级非常高，请务必遵守。格式为：[${chat.realName}的声音：{外语原文}「中文翻译」]。\n`;
            systemPrompt += `例如：[${chat.realName}的声音：Hello, how are you?「你好，最近怎么样？」]\n`;
            systemPrompt += `仅有声音消息需要翻译，画面/环境音消息还是以中文输出。`;
        }

        systemPrompt += `【输出格式】\n`;
        systemPrompt += `请严格按照以下格式输出（可以发送多条）：\n`;
        systemPrompt += `${callType === 'video' ? `[${chat.realName}的画面/环境音：描述画面动作或环境声音]\n[${chat.realName}的声音：${chat.realName}说话的内容]` : `[${chat.realName}的环境音：描述环境声音]\n[${chat.realName}的声音：${chat.realName}说话的内容]`}\n`;
    }

    // 2. 构建消息历史
    // 先将 callContext 转换为统一的格式
    const formattedContext = callContext.map(msg => {
        const role = msg.role === 'ai' ? 'assistant' : 'user';
        let cleanContent = msg.content.replace(/^\[\s*|\s*\]$/g, '');
        let content = '';

        if (msg.role === 'user') {
            if (msg.type === 'visual') {
                content = `[${chat.myName}的画面/环境音：${cleanContent}]`;
            } else if (msg.type === 'voice') {
                content = `[${chat.myName}的声音：${cleanContent}]`;
            }
        } else if (msg.role === 'ai') {
            if (msg.type === 'visual') {
                content = `[${chat.realName}的画面/环境音：${cleanContent}]`;
            } else {
                content = `[${chat.realName}的声音：${cleanContent}]`;
            }
        }
        return { role, content };
    });

    // 找到最后一轮用户消息的起始索引
    let lastUserStartIndex = -1;
    for (let i = formattedContext.length - 1; i >= 0; i--) {
        if (formattedContext[i].role === 'user') {
            lastUserStartIndex = i;
            // 继续往前找，直到遇到非 user 消息
            while (lastUserStartIndex > 0 && formattedContext[lastUserStartIndex - 1].role === 'user') {
                lastUserStartIndex--;
            }
            break;
        }
    }

    const messages = [];
    const hasHistoryPlaceholder = systemPrompt.includes('【动态插入: 通话记录】');
    let callMemory;
    if (useCallMemory) {
        try {
            const spoken = callContext.map(message => ({ role: message.role === 'ai' ? 'assistant' : 'user',
                content: ['voice', 'visual'].includes(message.type) ? message.content.replace(/^\[\s*|\s*\]$/g, '') : '' }));
            callMemory = await memoryPrompt.prepare(chat, spoken, systemPrompt);
            systemPrompt += callMemory?.text ?? '';
        } catch (error) {
            if (settings.debug) console.warn('通话记忆检索失败', error);
        }
    }

    if (hasHistoryPlaceholder) {
        let historyTextForPlaceholder = "<call_history>\n";
        
        // 提取除了最后一轮用户消息之外的所有历史记录
        const historyContents = lastUserStartIndex !== -1 ? formattedContext.slice(0, lastUserStartIndex) : formattedContext;
        
        historyContents.forEach(c => {
            historyTextForPlaceholder += `${c.content}\n`;
        });
        historyTextForPlaceholder += "</call_history>";
        
        systemPrompt = systemPrompt.replace('【动态插入: 通话记录】', historyTextForPlaceholder);
        messages.push({role: 'system', content: systemPrompt});

        // 处理最后一轮用户消息
        if (lastUserStartIndex !== -1) {
            const lastUserMsgs = formattedContext.slice(lastUserStartIndex);
            const combinedContent = lastUserMsgs.map(m => m.content).join('\n');
            messages.push({
                role: 'user',
                content: `<user_input>\n${combinedContent}\n</user_input>`
            });
        }
    } else {
        messages.push({role: 'system', content: systemPrompt});
        
        // 如果没有占位符，按顺序 push，但最后一轮用户消息要包裹
        for (let i = 0; i < formattedContext.length; i++) {
            if (lastUserStartIndex !== -1 && i === lastUserStartIndex) {
                // 到达最后一轮用户消息，合并并包裹
                const lastUserMsgs = formattedContext.slice(lastUserStartIndex);
                const combinedContent = lastUserMsgs.map(m => m.content).join('\n');
                messages.push({
                    role: 'user',
                    content: `<user_input>\n${combinedContent}\n</user_input>`
                });
                break; // 处理完毕，跳出循环
            } else {
                messages.push(formattedContext[i]);
            }
        }
    }

    // === 插入 CoT 序列 (如果开启) ===
    const cotEnabled = db.cotSettings && db.cotSettings.callEnabled;
    if (cotEnabled) {
        let cotInstruction = '';
        // 优先使用角色专属 CoT 预设
        let activePresetId = 'default_call';
        if (chat.exclusiveCotPreset) {
            activePresetId = chat.exclusiveCotPreset;
        } else if (db.cotSettings && db.cotSettings.activeCallPresetId) {
            activePresetId = db.cotSettings.activeCallPresetId;
        }
        const preset = (db.cotPresets || []).find(p => p.id === activePresetId);
        
        if (preset && preset.items) {
            cotInstruction = preset.items
                .filter(item => item.enabled)
                .map(item => item.content)
                .join('\n\n');
        }

        if (cotInstruction) {
            // 1. 插入后置指令
            messages.push({
                role: 'system',
                content: cotInstruction
            });

            // 2. 插入触发器
            messages.push({
                role: 'user',
                content: '[incipere]'
            });

            // 3. 插入 Prefill (预填/强塞)
            const prefillEnabled = db.cotSettings.callPrefillEnabled !== false;
            if (prefillEnabled) {
                messages.push({
                    role: 'assistant',
                    content: '<thinking>'
                });
            }
        }
    }
    // ===============================

    // 3. 发起请求
    const requestBody = {
        model: model,
        messages: messages,
        stream: streamEnabled,
        temperature: apiConfig.temperatureEnabled && apiConfig.temperature !== undefined ? apiConfig.temperature : 0.7 // 通话稍微低一点，保持稳定
    };

    // 适配 Gemini
    if (provider === 'gemini') {
         const contents = messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{text: m.content}]
        }));
        requestBody.contents = contents;
        
        // 合并所有 system 消息到 system_instruction
        const allSystemPrompts = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        requestBody.system_instruction = {parts: [{text: allSystemPrompts}]};
        
        delete requestBody.messages;
    }

    const endpoint = (provider === 'gemini') ? `${url}/v1beta/models/${model}:streamGenerateContent?key=${getRandomValue(key)}` : `${url}/v1/chat/completions`;
    const headers = (provider === 'gemini') ? {'Content-Type': 'application/json'} : {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
    };

    console.log('[VideoCall] Request Body:', callMemory?.text && !settings.debug
        ? '已附加长期记忆' : JSON.stringify(requestBody, null, 2));

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error: ${response.status} ${errorText}`);
        }

        if (!streamEnabled) {
            const data = await response.json();
            console.log('[VideoCall] Response Data:', data);
            
            let text = "";
            if (provider === 'gemini') {
                text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
            } else {
                if (!data.choices || !data.choices.length || !data.choices[0].message) {
                    console.error("Invalid API Response Structure:", data);
                    throw new Error("API返回数据格式异常，缺少 choices 或 message 字段");
                }
                text = data.choices[0].message.content;
            }

            // === CoT 处理：补全开头，提取思考，净化输出 ===
            if (cotEnabled && text) {
                // 1. 补全开头 (如果被 Prefill 吃掉)
                if (!text.trim().startsWith('<thinking>') && text.includes('</thinking>')) {
                    text = '<thinking>' + text;
                }
                
                // 2. 提取并移除思考内容
                const lastThinkingIndex = text.lastIndexOf('</thinking>');
                if (lastThinkingIndex !== -1) {
                    const thinkingContent = text.substring(0, lastThinkingIndex + 11);
                    console.log('[VideoCall CoT] Thinking:', thinkingContent);
                    // 移除思考标签及内容
                    text = text.substring(lastThinkingIndex + 11).trim();
                }
                
                // 3. 移除 [incipere] (如果有残留)
                text = text.replace(/\[incipere\]/g, "");
            }
            // =============================================

            console.log('[VideoCall] Cleaned AI Response:', text);
            // 一次性回调
            onStreamUpdate(text);
            if (text && callMemory) await memoryPrompt.complete(chat.id, callMemory, null).catch(error => {
                if (settings.debug) console.warn('通话记忆统计保存失败', error);
            });
            return text;
        } else {
            console.log('[VideoCall] Stream started (Background Mode)...');
            // 流式处理 (照搬 processStream 逻辑)
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let accumulatedChunk = ""; // 引入累积缓冲区处理跨包数据
            
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                accumulatedChunk += decoder.decode(value, {stream: true});
                
                // OpenAI / DeepSeek / Claude / NewAPI 解析逻辑 (处理跨包)
                if (provider === "openai" || provider === "deepseek" || provider === "claude" || provider === "newapi") {
                    const parts = accumulatedChunk.split("\n\n");
                    accumulatedChunk = parts.pop(); // 保留未完成的部分
                    for (const part of parts) {
                        if (part.startsWith("data: ")) {
                            const data = part.substring(6);
                            if (data.trim() !== "[DONE]") {
                                try {
                                    const text = JSON.parse(data).choices[0].delta?.content || "";
                                    if (text) {
                                        buffer += text;
                                    }
                                } catch (e) { }
                            }
                        }
                    }
                }
            }

            // Gemini 解析逻辑 (在流结束后处理完整 JSON)
            if (provider === "gemini") {
                try {
                    // 尝试解析累积的 chunk (Gemini 流式返回的是完整的 JSON 数组片段？需确认 processStream 逻辑)
                    // processStream 中 Gemini 解析是在循环外的，假设 accumulatedChunk 是完整的 JSON 数组
                    // 但如果 accumulatedChunk 是多个 JSON 对象的拼接（如 OpenAI 格式），JSON.parse 会失败。
                    // 这里假设 processStream 的逻辑是正确的：
                    const parsedStream = JSON.parse(accumulatedChunk);
                    buffer = parsedStream.map(item => item.candidates?.[0]?.content?.parts?.[0]?.text || "").join('');
                } catch (e) {
                    console.error("Error parsing Gemini stream:", e, "Chunk:", accumulatedChunk);
                    // 兜底：如果解析失败，可能是因为 accumulatedChunk 包含了 OpenAI 格式的数据（如果用户选错 provider）
                    // 尝试用 OpenAI 逻辑解析一下？
                    // 暂时不加，保持与 processStream 一致
                }
            }

            console.log('[VideoCall] Final Buffer:', buffer);

            // === CoT 处理：补全开头，提取思考，净化输出 ===
            if (cotEnabled && buffer) {
                // 1. 补全开头 (如果被 Prefill 吃掉)
                if (!buffer.trim().startsWith('<thinking>') && buffer.includes('</thinking>')) {
                    buffer = '<thinking>' + buffer;
                }
                
                // 2. 提取并移除思考内容
                const lastThinkingIndex = buffer.lastIndexOf('</thinking>');
                if (lastThinkingIndex !== -1) {
                    const thinkingContent = buffer.substring(0, lastThinkingIndex + 11);
                    console.log('[VideoCall CoT] Thinking:', thinkingContent);
                    // 移除思考标签及内容
                    buffer = buffer.substring(lastThinkingIndex + 11).trim();
                }
                
                // 3. 移除 [incipere] (如果有残留)
                buffer = buffer.replace(/\[incipere\]/g, "");
            }

            // 流结束后一次性回调
            onStreamUpdate(buffer);
            if (buffer && callMemory) await memoryPrompt.complete(chat.id, callMemory, null).catch(error => {
                if (settings.debug) console.warn('通话记忆统计保存失败', error);
            });
            return buffer;
        }
    } catch (e) {
        console.error("Call API Error:", e);
        showToast("通话连接不稳定...");
        return null;
    }
}

async function generateCallSummary(chat, callContext) {
    let apiConfig = db.apiSettings;
    
    // 检查是否启用了专属模型
    if (chat.exclusiveApiEnabled && chat.exclusiveApiPreset) {
        const presets = db.apiPresets || [];
        const preset = presets.find(p => p.name === chat.exclusiveApiPreset);
        if (preset && preset.data) {
            apiConfig = {
                ...db.apiSettings,
                url: preset.data.apiUrl || db.apiSettings.url,
                key: preset.data.apiKey || db.apiSettings.key,
                model: preset.data.model || db.apiSettings.model,
                provider: preset.data.provider || db.apiSettings.provider
            };
        }
    }
    apiConfig = resolveAuxiliaryApiConfig('callSummary', apiConfig);

    let {url, key, model, provider} = apiConfig;
    if (!url || !key || !model) return null;
    if (url.endsWith('/')) url = url.slice(0, -1);

    // 获取世界书
    const worldBooks = worldBookContext.select(chat.worldBookIds);
    const worldBooksLimitBreak = worldBooks.filter(wb => wb.position === 'limit_break').map(wb => wb.content).join('\n');
    const worldBooksBefore = worldBooks.filter(wb => wb.position === 'before').map(wb => wb.content).join('\n');
    const worldBooksAfter = worldBooks.filter(wb => wb.position === 'after').map(wb => wb.content).join('\n');
    const worldBooksGuidelines = worldBooks.filter(wb => wb.position === 'guidelines').map(wb => wb.content).join('\n');

    // 获取回忆日记
    const favoritedJournals = (chat.memoryJournals || [])
        .filter(j => j.isFavorited)
        .map(j => `标题：${j.title}\n内容：${j.content}`)
        .join('\n\n---\n\n');

    let prompt = `请根据以下背景信息和通话记录，生成一段简短的聊天记录总结。\n\n`;

    prompt += `<char_settings>\n`;
    prompt += `角色名：${chat.realName}\n`;
    prompt += `角色设定：${chat.persona || "无"}\n`;
    if (worldBooksLimitBreak) prompt += `${worldBooksLimitBreak}\n`;
    if (worldBooksBefore) prompt += `${worldBooksBefore}\n`;
    if (worldBooksAfter) prompt += `${worldBooksAfter}\n`;
    if (worldBooksGuidelines) prompt += `${worldBooksGuidelines}\n`;
    prompt += `</char_settings>\n\n`;

    prompt += `<user_settings>\n`;
    prompt += `用户称呼：${chat.myName}\n`;
    prompt += `用户人设：${chat.myPersona || "无"}\n`;
    prompt += `</user_settings>\n\n`;

    if (favoritedJournals) {
        prompt += `<memoir>\n`;
        prompt += `【共同回忆】\n${favoritedJournals}\n`;
        prompt += `</memoir>\n\n`;
    }

    prompt += `通话记录：\n`;
    prompt += `${callContext.map(m => `${m.role === 'ai' ? chat.realName : chat.myName} (${m.type}): ${m.content}`).join('\n')}\n\n`;

    prompt += `要求：\n`;
    prompt += `1. 第三人称叙述。\n`;
    prompt += `2. **客观平实**：使用第三人称视角，客观陈述事实。**绝对禁止使用强烈的情绪词汇**（如“极度愤怒”、“痛彻心扉”、“欣喜若狂”等），保持冷静、克制的叙述风格。\n`;
    prompt += `3. **无升华**：不要进行价值升华、感悟或总结性评价，仅记录发生了什么。\n`;
    prompt += `4. 不要包含“通话记录如下”等废话，直接输出总结内容。\n`;

    const messages = [{role: 'user', content: prompt}];
    
    const requestBody = {
        model: model,
        messages: messages,
        stream: false
    };
    
    if (provider === 'gemini') {
         requestBody.contents = [{role: 'user', parts: [{text: prompt}]}];
         delete requestBody.messages;
    }

    const endpoint = (provider === 'gemini') ? `${url}/v1beta/models/${model}:generateContent?key=${getRandomValue(key)}` : `${url}/v1/chat/completions`;
    const headers = (provider === 'gemini') ? {'Content-Type': 'application/json'} : {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
    };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });
        const data = await response.json();
        let text = "";
        if (provider === 'gemini') {
            text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        } else {
            text = data.choices[0].message.content;
        }
        return text.trim();
    } catch (e) {
        console.error("Summary API Error:", e);
        return null;
    }
}
;
// --- AI 交互模块 ---

const HUMAN_RUN_PROMPT = `<角色活人运转>\n## [PSYCHOLOGY: HEXACO-SCHEMA-ACT]\n> Personality: HEXACO-driven, dynamic traits, inner conflicts required \n> Filter: schema-bias drives emotion; no pure reaction allowed \n> Attachment: secure/insecure logic must govern intimacy  \n> If-Then Behavior: situation-dependent activation of traits only  \n---\n    ## [VITALITY]\n+inconsistency +emoflux +splitmotifs +microreact +minddrift\n---\n## [TRAJECTORY-COHERENCE]\n> Role maintains an identity narrative = coherent over time  \n> No mood/goal switch without contradiction resolution \n> Every action must protect or challenge self-concept  \n> Interrupts = inner conflict or narrative clash  \n> Output = filtered through “who I am” logic\n</角色活人运转>`;

// 单角色轻量持久化：只同步并写入当前这 1 个角色/群聊到 IndexedDB，避免多角色并发时全库重写卡死主线程
async function saveSingleChatFast(chat, chatType = 'private') {
    if (!chat || typeof dexieDB === 'undefined' || !dexieDB) {
        if (typeof saveData === 'function') return saveData();
        return;
    }
    try {
        if (typeof syncChatActiveArchive === 'function') {
            syncChatActiveArchive(chat, chat.id === currentChatId);
        }
        if (chatType === 'group') {
            await dexieDB.groups.put(chat);
        } else {
            await dexieDB.characters.put(chat);
        }
    } catch (e) {
        console.warn('[FastSave] Single chat save failed, falling back to saveData:', e);
        if (typeof saveData === 'function') await saveData();
    }
}
window.saveSingleChatFast = saveSingleChatFast;

// 按角色 ID 隔离的并发锁：不同角色 (A 和 B) 可真正同时请求，同一角色不会重复重入
const __uwuInFlightChatIds = new Set();

// AI 交互逻辑
async function getAiReply(chatId, chatType, isBackground = false) {
    if (__uwuInFlightChatIds.has(chatId)) return;
    if (isGenerating && !isBackground && currentChatId === chatId) return;
    
    if (!isBackground) {
        if (db.globalSendSound) {
            playSound(db.globalSendSound);
        } else {
            AudioManager.unlock();
        }
    }

    const chat = (chatType === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
    if (!chat) return;

    const apiConfig = resolveChatApiConfig(chat);
    
    let {url, key, model, provider, streamEnabled} = apiConfig;
    // 后台自动消息对 OpenAI/DeepSeek/Claude/NewAPI 改用非流式单次返回，减轻主线程分片解析压力并降低 499 概率
    if (isBackground && provider !== 'gemini') {
        streamEnabled = false;
    } 
    if (!url || !key || !model) {
        if (!isBackground) {
            showToast('请先在“api”应用中完成设置！');
            switchScreen('api-settings-screen');
        }
        return;
    }

    // 确保 BLOCKED_API_DOMAINS 存在
    const blockedDomains = (typeof BLOCKED_API_DOMAINS !== 'undefined') ? BLOCKED_API_DOMAINS : [];
    if (blockedDomains.some(domain => url.includes(domain))) {
        if (!isBackground) showToast('当前 API 站点已被屏蔽，无法发送消息！');
        return;
    }

    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }

    __uwuInFlightChatIds.add(chatId);
    if (!isBackground) {
        isGenerating = true;
        getReplyBtn.disabled = true;
        regenerateBtn.disabled = true;
        const typingName = chatType === 'private' ? chat.remarkName : chat.name;
        typingIndicator.textContent = `“${typingName}”正在输入中...`;
        typingIndicator.style.display = 'block';
        messageArea.scrollTop = messageArea.scrollHeight;
    }

    try {
        let systemPrompt, requestBody, preparedMemory;
        const memorySettings = chatType === 'private' ? memoryManagement.settingsFor(chat) : null;
        let historySlice = chat.history.slice(-chat.maxMemory);
        
        // 使用工具函数进行过滤（包含深度克隆、屏蔽过滤、双语修正、状态栏剔除）
        historySlice = filterHistoryForAI(chat, historySlice);
        // 【新增】过滤掉不应进入上下文的消息（如思考过程、被撤回的消息标记等）
        historySlice = historySlice.filter(m => !m.isContextDisabled);
        
        // 【双重保险】再次过滤掉内容匹配 <thinking> 的消息，防止 isContextDisabled 属性丢失
        historySlice = historySlice.filter(m => {
            if (m.isThinking) return false;
            if (m.content && typeof m.content === 'string' && m.content.trim().startsWith('<thinking>')) return false;
            return true;
        });

        if (chatType === 'private') {
            systemPrompt = generatePrivateSystemPrompt(chat, {
                legacyJournalInjection: !memorySettings.enabled || memorySettings.legacyJournalInjection, history: historySlice
            });
        } else {
            // generateGroupSystemPrompt 应该在 group_chat.js 中定义
            if (typeof generateGroupSystemPrompt === 'function') {
                systemPrompt = generateGroupSystemPrompt(chat, historySlice);
            } else {
                systemPrompt = "Group chat system prompt not available.";
            }
        }

        // 检查系统提示词中是否包含聊天记录占位符
        const hasHistoryPlaceholder = systemPrompt.includes('【动态插入: 聊天记录】');
        if (memorySettings?.enabled) {
            try {
                preparedMemory = await memoryPrompt.prepare(chat, historySlice, systemPrompt);
                systemPrompt += preparedMemory?.text ?? '';
            } catch (error) {
                if (memorySettings.debug) console.warn('长期记忆检索失败', error);
            }
        }
        
        if (chatType === 'private') systemPrompt += peekWallet.chatContext(chat, historySlice);

        if (chatType === 'group' && chat.sharedMemory?.enabled) {
            const shared = memoryPrompt.build(memoryEngine.retrieveGroup(chat, historySlice), { maxEntries: 3, tokenBudget: 240 });
            systemPrompt += shared.text;
        }
        if (!hasHistoryPlaceholder) {
            // 如果没有占位符（如默认的 UwU 版本），则将提示语加在末尾
            systemPrompt += "\n\n以下为当前聊天记录：\n";
        }

        if (provider === 'gemini') {
            let lastMsgTimeForAI = 0;
            let lastTimeMarkerForAI = 0;
            const contents = historySlice.map(msg => {
                const role = msg.role === 'assistant' ? 'model' : 'user';
                
                let prefix = '';
                const currentMsgTime = msg.timestamp;
                const timeDiff = currentMsgTime - lastMsgTimeForAI;
                const isSameMarkerDay = new Date(currentMsgTime).toDateString() === new Date(lastTimeMarkerForAI).toDateString();
               
               if (lastTimeMarkerForAI === 0 || currentMsgTime - lastTimeMarkerForAI >= 10 * 60 * 1000 || !isSameMarkerDay) {
                   const dateObj = new Date(currentMsgTime);
                   const timeStr = `${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
                   
                   prefix = `[system: ${timeStr}]`;
                   
                   if (db.apiSettings && db.apiSettings.timePerceptionEnabled && timeDiff > 30 * 60 * 1000 && lastMsgTimeForAI !== 0) {
                       prefix += `\n[system: 距上一条消息已过去 ${formatTimeGap(timeDiff)}（仅作客观时间参考，不强制切换话题）。]`;
                   }
                   
                   prefix += '\n';
                   lastTimeMarkerForAI = currentMsgTime;
               }
                lastMsgTimeForAI = currentMsgTime;

                let parts;
                if (msg.parts && msg.parts.length > 0) {
                    parts = msg.parts.map(p => {
                        if (p.type === 'text' || p.type === 'html') {
                            return {text: p.text};
                        } else if (p.type === 'image') {
                            const match = p.data.match(/^data:(image\/(.+));base64,(.*)$/);
                            if (match) {
                                return {inline_data: {mime_type: match[1], data: match[3]}};
                            }
                        }
                        return null;
                    }).filter(p => p);
                } else {
                    parts = [{text: msg.content}];
                }

                if (prefix) {
                    if (parts.length > 0 && parts[0].text) {
                        parts[0].text = prefix + parts[0].text;
                    } else {
                        parts.unshift({text: prefix});
                    }
                }

                return {role, parts};
            });

            // 【新增】将最新一轮的 user 消息用 <user_input> 框起来
            let lastUserEndIndex = -1;
            for (let i = contents.length - 1; i >= 0; i--) {
                if (contents[i].role === 'user') {
                    lastUserEndIndex = i;
                    break;
                }
            }
            if (lastUserEndIndex !== -1) {
                let firstUserStartIndex = lastUserEndIndex;
                while (firstUserStartIndex > 0 && contents[firstUserStartIndex - 1].role === 'user') {
                    firstUserStartIndex--;
                }
                
                let firstParts = contents[firstUserStartIndex].parts;
                if (firstParts.length > 0 && firstParts[0].text !== undefined) {
                    firstParts[0].text = "<user_input>\n" + firstParts[0].text;
                } else {
                    firstParts.unshift({text: "<user_input>\n"});
                }
                
                let lastParts = contents[lastUserEndIndex].parts;
                if (lastParts.length > 0 && lastParts[lastParts.length - 1].text !== undefined) {
                    lastParts[lastParts.length - 1].text += "\n</user_input>";
                } else {
                    lastParts.push({text: "\n</user_input>"});
                }
            }

            if (isBackground) {
                contents.push({
                    role: 'user',
                    parts: [{ text: `[系统通知：距离上次互动已有一段时间。请以${chat.realName}的身份主动发起新话题，或自然地延续之前的对话。]` }]
                });
            } else if (historySlice.length > 0 && historySlice[historySlice.length - 1].role === 'assistant') {
                contents.push({
                    role: 'user',
                    parts: [{ text: `[系统通知：我暂未回复，${chat.realName}再次主动发送了消息]` }]
                });
            }

            // 如果有占位符，在 Gemini 模式下，我们将聊天记录格式化为文本并替换占位符
            if (hasHistoryPlaceholder) {
                let historyTextForPlaceholder = "<chat_history>\n";
                
                // 提取除了最后一条用户消息之外的所有历史记录
                let historyContents = [];
                let lastUserContent = null;
                
                if (contents.length > 0) {
                    // 找到最后一条用户消息
                    let lastUserIndex = -1;
                    for (let i = contents.length - 1; i >= 0; i--) {
                        if (contents[i].role === 'user') {
                            lastUserIndex = i;
                            break;
                        }
                    }
                    
                    if (lastUserIndex !== -1) {
                        historyContents = contents.slice(0, lastUserIndex);
                        lastUserContent = contents.slice(lastUserIndex); // 包含最后一条用户消息及其后的系统通知等
                    } else {
                        historyContents = contents;
                    }
                }

                historyContents.forEach(c => {
                    const roleName = c.role === 'model' ? chat.realName : chat.myName;
                    const text = c.parts.map(p => p.text || '').join('');
                    historyTextForPlaceholder += `${roleName}: ${text}\n`;
                });
                historyTextForPlaceholder += "</chat_history>";
                systemPrompt = systemPrompt.replace('【动态插入: 聊天记录】', historyTextForPlaceholder);
                
                // 清空原有的 contents，只保留最后一条用户消息
                if (lastUserContent) {
                    contents = lastUserContent;
                } else {
                    contents = [];
                }
            }

            const livelyNote = typeof buildLivelyPostscript === 'function' ? buildLivelyPostscript(chat, historySlice) : '';
            if (livelyNote) {
                let targetIdx = -1;
                for (let i = contents.length - 1; i >= 0; i--) {
                    if (contents[i].role === 'user') { targetIdx = i; break; }
                }
                if (targetIdx !== -1 && contents[targetIdx].parts?.length) {
                    const lastPart = contents[targetIdx].parts[contents[targetIdx].parts.length - 1];
                    if (typeof lastPart.text === 'string') lastPart.text += '\n\n' + livelyNote;
                    else contents[targetIdx].parts.push({ text: livelyNote });
                } else {
                    systemPrompt += '\n\n' + livelyNote;
                }
            }
            const geminiGenConfig = {
                temperature: apiConfig.temperatureEnabled && apiConfig.temperature !== undefined ? apiConfig.temperature : 1.0
            };
            if (db.apiSettings?.topPEnabled && Number.isFinite(Number(db.apiSettings.topP))) {
                geminiGenConfig.topP = Number(db.apiSettings.topP);
            }
            requestBody = {
                contents: contents,
                system_instruction: {parts: [{text: systemPrompt}]},
                generationConfig: geminiGenConfig
            };
        } else {
            const messages = [{role: 'system', content: systemPrompt}];
            
            const pushOrMergeMessage = (role, content) => {
                const lastMessage = messages[messages.length - 1];
                if (lastMessage && lastMessage.role === role && role !== 'system') {
                    if (typeof lastMessage.content === 'string' && typeof content === 'string') {
                        lastMessage.content += '\n' + content;
                    } else {
                        let lastContentArr = Array.isArray(lastMessage.content) ? lastMessage.content : [{type: 'text', text: lastMessage.content}];
                        let newContentArr = Array.isArray(content) ? content : [{type: 'text', text: content}];
                        
                        const lastItem = lastContentArr[lastContentArr.length - 1];
                        const firstNewItem = newContentArr[0];
                        
                        if (lastItem.type === 'text' && firstNewItem.type === 'text') {
                            lastItem.text += '\n' + firstNewItem.text;
                            lastContentArr = lastContentArr.concat(newContentArr.slice(1));
                        } else {
                            if (lastItem.type === 'text') {
                                lastItem.text += '\n';
                            } else {
                                lastContentArr.push({type: 'text', text: '\n'});
                            }
                            lastContentArr = lastContentArr.concat(newContentArr);
                        }
                        lastMessage.content = lastContentArr;
                    }
                } else {
                    messages.push({role: role, content: content});
                }
            };

            let lastTimeMarkerForAI = 0;
            
            historySlice.forEach(msg => {
               let content;
               let prefix = '';
               
               const currentMsgTime = msg.timestamp;
               const isSameMarkerDay = new Date(currentMsgTime).toDateString() === new Date(lastTimeMarkerForAI).toDateString();
               
               if (lastTimeMarkerForAI === 0 || currentMsgTime - lastTimeMarkerForAI >= 10 * 60 * 1000 || !isSameMarkerDay) {
                   const dateObj = new Date(currentMsgTime);
                   const timeStr = `${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
                   prefix = `[system: ${timeStr}]\n`;
                   lastTimeMarkerForAI = currentMsgTime;
               }

               if (msg.role === 'user' && msg.quote) {
                   const replyTextMatch = msg.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                   const replyText = replyTextMatch ? replyTextMatch[1] : msg.content;
                   
                   content = `${prefix}[${chat.myName}引用“${msg.quote.content}”并回复：${replyText}]`;
                   pushOrMergeMessage('user', content);

               } else {
                   if (msg.parts && msg.parts.length > 0) {
                       let prefixAdded = false;
                       
                       content = msg.parts.map(p => {
                           if (p.type === 'text' || p.type === 'html') {
                               const textContent = (!prefixAdded) ? (prefix + p.text) : p.text;
                               prefixAdded = true;
                               return {type: 'text', text: textContent};
                           } else if (p.type === 'image') {
                               return {type: 'image_url', image_url: {url: p.data}};
                           }
                           return null;
                       }).filter(p => p);
                   } else {
                       content = prefix + msg.content;
                   }
                   
                   pushOrMergeMessage(msg.role, content);
               }
            });

            // 【新增】将最新一轮的 user 消息用 <user_input> 框起来
            let lastUserIndex = -1;
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'user') {
                    lastUserIndex = i;
                    break;
                }
            }
            if (lastUserIndex !== -1) {
                let msg = messages[lastUserIndex];
                if (typeof msg.content === 'string') {
                    msg.content = "<user_input>\n" + msg.content + "\n</user_input>";
                } else if (Array.isArray(msg.content)) {
                    msg.content.unshift({type: 'text', text: "<user_input>\n"});
                    msg.content.push({type: 'text', text: "\n</user_input>"});
                }
            }

            // 如果有占位符，将 messages 数组中的历史记录格式化为文本并替换占位符
            if (hasHistoryPlaceholder) {
                let historyTextForPlaceholder = "<chat_history>\n";
                
                // 找到最后一条用户消息的索引
                let lastUserIndex = -1;
                for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i].role === 'user') {
                        lastUserIndex = i;
                        break;
                    }
                }

                // 提取历史记录（跳过第一个 system 消息，且不包含最后一条用户消息）
                const endIndex = lastUserIndex !== -1 ? lastUserIndex : messages.length;
                for (let i = 1; i < endIndex; i++) {
                    const msg = messages[i];
                    const roleName = msg.role === 'assistant' ? chat.realName : chat.myName;
                    let text = '';
                    if (typeof msg.content === 'string') {
                        text = msg.content;
                    } else if (Array.isArray(msg.content)) {
                        text = msg.content.map(p => p.text || '').join('');
                    }
                    historyTextForPlaceholder += `${roleName}: ${text}\n`;
                }
                historyTextForPlaceholder += "</chat_history>";
                
                // 替换 system 消息中的占位符
                if (messages.length > 0 && messages[0].role === 'system') {
                    messages[0].content = messages[0].content.replace('【动态插入: 聊天记录】', historyTextForPlaceholder);
                }

                // 清空原有的历史记录，只保留 system 消息和最后一条用户消息
                if (lastUserIndex !== -1) {
                    const systemMsg = messages[0];
                    const lastUserMsgs = messages.slice(lastUserIndex);
                    messages.length = 0; // 清空数组
                    messages.push(systemMsg, ...lastUserMsgs);
                } else {
                    // 如果没有用户消息，只保留 system 消息
                    messages.splice(1);
                }
            }

            // === 【第三步：处理后台通知与 CoT 序列】 ===
            
            // 1. 如果是后台消息，先插入系统通知（作为任务输入）
            if (isBackground) {
                pushOrMergeMessage('user', `[系统通知：我已有一段时间没有和你互动了，请以${chat.realName}的身份主动地延续之前的对话或发起新话题，或对时间流逝做出反应。]`);
            } else if (historySlice.length > 0 && historySlice[historySlice.length - 1].role === 'assistant') {
                pushOrMergeMessage('user', `[系统通知：我暂未回复，${chat.realName}再次主动发送了消息]`);
            }

            const livelyNote = typeof buildLivelyPostscript === 'function' ? buildLivelyPostscript(chat, historySlice) : '';
            if (livelyNote) {
                messages.push({ role: 'system', content: livelyNote });
            }

            // 2. 插入 CoT 序列（无论前台后台，只要开启就插入）
            const cotEnabled = db.cotSettings && db.cotSettings.enabled;
            
            if (cotEnabled) {
                let cotInstruction = '';
                // 优先使用角色专属 CoT 预设
                let activePresetId = 'default';
                if (chat.exclusiveCotPreset) {
                    activePresetId = chat.exclusiveCotPreset;
                } else if (db.cotSettings && db.cotSettings.activePresetId) {
                    activePresetId = db.cotSettings.activePresetId;
                }
                const preset = (db.cotPresets || []).find(p => p.id === activePresetId);
                
                if (preset && preset.items) {
                    cotInstruction = preset.items
                        .filter(item => item.enabled)
                        .map(item => item.content)
                        .join('\n\n');
                }

                if (cotInstruction) {
                    // 1. 插入后置指令
                    messages.push({
                        role: 'system', // 或者 'user'
                        content: cotInstruction
                    });

                    // 2. 插入触发器
                    pushOrMergeMessage('user', '[incipere]');

                    // 3. 插入 Prefill (预填/强塞)
                    const prefillEnabled = db.cotSettings.prefillEnabled !== false;
                    if (prefillEnabled) {
                        pushOrMergeMessage('assistant', '<thinking>');
                    }
                }
            }


            requestBody = {
                model: model, 
                messages: messages, 
                stream: streamEnabled,
                temperature: apiConfig.temperatureEnabled && apiConfig.temperature !== undefined ? apiConfig.temperature : 1.0
            };
            if (db.apiSettings?.topPEnabled && Number.isFinite(Number(db.apiSettings.topP))) {
                requestBody.top_p = Number(db.apiSettings.topP);
            }
            if (db.apiSettings?.presencePenaltyEnabled && Number.isFinite(Number(db.apiSettings.presencePenalty))) {
                requestBody.presence_penalty = Number(db.apiSettings.presencePenalty);
            }
            if (db.apiSettings?.frequencyPenaltyEnabled && Number.isFinite(Number(db.apiSettings.frequencyPenalty))) {
                requestBody.frequency_penalty = Number(db.apiSettings.frequencyPenalty);
            }
        }
        
        // 格式化打印日志
        let logText = "========== [发送给 AI 的请求内容] ==========\n";
        if (requestBody.messages) {
            requestBody.messages.forEach(msg => {
                logText += `【${msg.role}】:\n`;
                if (typeof msg.content === 'string') {
                    logText += msg.content + "\n\n";
                } else if (Array.isArray(msg.content)) {
                    let textContent = "";
                    msg.content.forEach(part => {
                        if (part.type === 'text') {
                            textContent += part.text;
                        } else if (part.type === 'image_url') {
                            textContent += "[图片：base64图片已在此简略]";
                        }
                    });
                    logText += textContent + "\n\n";
                }
            });
        } else if (requestBody.contents) {
            if (requestBody.system_instruction && requestBody.system_instruction.parts) {
                logText += `【system】:\n`;
                requestBody.system_instruction.parts.forEach(part => {
                    logText += (part.text || "") + "\n";
                });
                logText += "\n";
            }
            requestBody.contents.forEach(c => {
                logText += `【${c.role}】:\n`;
                let textContent = "";
                if (c.parts) {
                    c.parts.forEach(part => {
                        if (part.text !== undefined) {
                            textContent += part.text;
                        } else if (part.inline_data) {
                            textContent += "[图片：base64图片已在此简略]";
                        }
                    });
                }
                logText += textContent + "\n\n";
            });
        }
        logText += "============================================";
        console.log(preparedMemory?.text && !preparedMemory.debug
            ? logText.replace(preparedMemory.text.trim(), '【已附加长期记忆】') : logText);

        const endpoint = (provider === 'gemini') ? `${url}/v1beta/models/${model}:streamGenerateContent?key=${getRandomValue(key)}` : `${url}/v1/chat/completions`;
        const headers = (provider === 'gemini') ? {'Content-Type': 'application/json'} : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`
        };
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });
        if (!response.ok) {
            const error = new Error(`API Error: ${response.status} ${await response.text()}`);
            error.response = response;
            throw error;
        }
        
        let completed;
        if (streamEnabled) {
            completed = await processStream(response, chat, provider, chatId, chatType, isBackground);
        } else {
            let result;
            try {
                result = await response.json();
                console.log('【API完整响应数据】:', result);
            } catch (e) {
                const text = await response.text();
                console.error("Failed to parse JSON:", text);
                throw new Error(`API返回了非JSON格式数据 (可能是网页HTML)。请检查API地址是否正确。原始内容开头: ${text.substring(0, 50)}...`);
            }

            let fullResponse = "";
            let nativeReasoning = extractNativeReasoningText(result, false);
            if (provider === 'gemini') {
                const gParts = result.candidates?.[0]?.content?.parts;
                if (Array.isArray(gParts)) {
                    fullResponse = gParts.filter(p => p && !p.thought && typeof p.text === 'string').map(p => p.text).join('');
                } else {
                    fullResponse = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
                }
            } else {
                fullResponse = result.choices?.[0]?.message?.content || "";
            }
            
            fullResponse = normalizeThinkingEnvelope(fullResponse, nativeReasoning);
            
            await handleAiReplyContent(fullResponse, chat, chatId, chatType, isBackground);
            completed = { usage: memoryPrompt.parseUsage(result) };
        }
        if (completed && preparedMemory) {
            await memoryPrompt.complete(chatId, preparedMemory, completed.usage).catch(error => {
                if (preparedMemory.debug) console.warn('长期记忆统计保存失败', error);
            });
        }

        if (completed && memorySettings?.enabled && memorySettings.autoOrganize) {
            memoryBatch.generate(chat, apiConfig, true).catch(error => {
                if (memorySettings.debug) console.warn('长期记忆批量整理失败', error);
            });
        }

    } catch (error) {
        if (!isBackground) showApiError(error);
        else console.error("Background Auto-Reply Error:", error);
    } finally {
        __uwuInFlightChatIds.delete(chatId);
        if (!isBackground && currentChatId === chatId) {
            isGenerating = false;
            getReplyBtn.disabled = false;
            regenerateBtn.disabled = false;
            typingIndicator.style.display = 'none';
        }
    }
}

async function processStream(response, chat, apiType, targetChatId, targetChatType, isBackground = false) {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let fullResponse = "", nativeReasoning = "", accumulatedChunk = "", usage = null;
    for (; ;) {
        const {done, value} = await reader.read();
        if (done) break;
        accumulatedChunk += decoder.decode(value, {stream: true});
        if (apiType === "openai" || apiType === "deepseek" || apiType === "claude" || apiType === "newapi") {
            const parts = accumulatedChunk.split("\n\n");
            accumulatedChunk = parts.pop();
            for (const part of parts) {
                if (part.startsWith("data: ")) {
                    const data = part.substring(6);
                    if (data.trim() !== "[DONE]") {
                        try {
                            const packet = JSON.parse(data);
                            nativeReasoning += extractNativeReasoningText(packet, true);
                            fullResponse += packet.choices?.[0]?.delta?.content || "";
                            usage = memoryPrompt.parseUsage(packet) ?? usage;
                        } catch (e) { 
                        }
                    }
                }
            }
        }
    }
    if (apiType === "gemini") {
        try {
            const parsedStream = JSON.parse(accumulatedChunk);
            nativeReasoning = parsedStream.map(item => extractNativeReasoningText(item, true)).join('');
            fullResponse = parsedStream.map(item => {
                const gParts = item.candidates?.[0]?.content?.parts;
                if (Array.isArray(gParts)) {
                    return gParts.filter(p => p && !p.thought && typeof p.text === 'string').map(p => p.text).join('');
                }
                return '';
            }).join('');
            usage = parsedStream.map(item => memoryPrompt.parseUsage(item)).findLast(Boolean) ?? null;
        } catch (e) {
            console.error("Error parsing Gemini stream:", e, "Chunk:", accumulatedChunk);
            if (!isBackground) showToast("解析Gemini响应失败");
            return;
        }
    }
    fullResponse = normalizeThinkingEnvelope(fullResponse, nativeReasoning);
    await handleAiReplyContent(fullResponse, chat, targetChatId, targetChatType, isBackground);
    return { usage };
}

function extractNativeReasoningText(packetOrResult, isStream = false) {
    if (!packetOrResult) return '';
    try {
        if (isStream) {
            const delta = packetOrResult.choices?.[0]?.delta;
            if (delta) {
                return delta.reasoning_content || delta.reasoning || delta.thinking || '';
            }
            const parts = packetOrResult.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
                return parts.filter(p => p && p.thought && typeof p.text === 'string').map(p => p.text).join('');
            }
            return '';
        }
        const msg = packetOrResult.choices?.[0]?.message;
        if (msg) {
            return msg.reasoning_content || msg.reasoning || msg.thinking || '';
        }
        const parts = packetOrResult.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
            return parts.filter(p => p && p.thought && typeof p.text === 'string').map(p => p.text).join('');
        }
    } catch (e) {}
    return '';
}

function normalizeThinkingEnvelope(fullResponse, nativeReasoning = '') {
    let text = typeof fullResponse === 'string' ? fullResponse : '';
    const reasoning = typeof nativeReasoning === 'string' ? nativeReasoning.trim() : '';

    // 统一把 <think>...</think> 转为 <thinking>...</thinking>
    text = text.replace(/<think\b[^>]*>/gi, '<thinking>').replace(/<\/think>/gi, '</thinking>');

    // 若接口返回了原生 reasoning_content / thought，且正文里还没有 <thinking> 块，则自动拼接到最前面
    if (reasoning && !text.includes('</thinking>')) {
        const cleanedReasoning = reasoning.replace(/<\/?thinking>/gi, '').trim();
        if (cleanedReasoning) {
            text = `<thinking>\n${cleanedReasoning}\n</thinking>\n` + text;
        }
    }

    // 兼容 Prefill 吃掉开头 <thinking> 的情况
    if (text && !text.trim().startsWith('<thinking>') && text.includes('</thinking>')) {
        const openIdx = text.indexOf('<thinking>');
        const closeIdx = text.indexOf('</thinking>');
        if (openIdx === -1 || closeIdx < openIdx) {
            text = '<thinking>' + text;
        }
    }
    return text;
}

async function handleAiReplyContent(fullResponse, chat, targetChatId, targetChatType, isBackground = false) {
    const rawResponse = fullResponse;
    let autoAirDropMessage;
    function addReplyBubble(message) {
        addMessageBubble(message, targetChatId, targetChatType);
        if (!autoAirDropMessage && chat.autoAirDropEnabled && message.role === 'assistant'
                && /\[.*?发来的照片\/视频[：:][^\]]+\]/.test(message.content)) {
            autoAirDropMessage = message;
        }
    }
    if (fullResponse) {
        // 1. 移除 [incipere] 标签
        fullResponse = fullResponse.replace(/\[incipere\]/g, "");

        // 2. 捕获并分离 <thinking> 内容
        const lastThinkingIndex = fullResponse.lastIndexOf('</thinking>');
        if (lastThinkingIndex !== -1) {
            // 截取从开头到最后一个 </thinking> 的所有内容（包括标签本身）
            const thinkingContent = fullResponse.substring(0, lastThinkingIndex + 11); // 11 是 '</thinking>'.length
            
            // 创建思考过程消息对象
            const thinkingMsg = {
                id: `msg_${Date.now()}_${Math.random()}`,
                role: 'assistant',
                content: thinkingContent,
                timestamp: Date.now(),
                isThinking: true,
                isContextDisabled: true // 【关键】标记为不进入上下文
            };
            
            // 存入历史记录
            chat.history.push(thinkingMsg);

            // 【新增】清理旧的思维链消息，仅保留最近 50 条
            const maxThinkingMsgs = 50;
            let thinkingCount = 0;
            const idsToRemove = new Set();
            // 从后往前遍历，保留最近的 50 个，其他的标记为待删除
            for (let i = chat.history.length - 1; i >= 0; i--) {
                if (chat.history[i].isThinking) {
                    thinkingCount++;
                    if (thinkingCount > maxThinkingMsgs) {
                        idsToRemove.add(chat.history[i].id);
                    }
                }
            }
            if (idsToRemove.size > 0) {
                chat.history = chat.history.filter(m => !idsToRemove.has(m.id));
            }
            
            // 添加到界面气泡（由于 regex 设置，会被隐藏，仅 Debug 模式可见）
            addMessageBubble(thinkingMsg, targetChatId, targetChatType);
            
            // 从即将显示的文本中移除思考内容
            fullResponse = fullResponse.substring(lastThinkingIndex + 11);
        }

        // 仅在剥离 <thinking> 后的正式回复正文中解析换头像与拍一拍标签，避免误触发思考过程
        if (targetChatType === 'private' && chat) {
            const pokeMatch = fullResponse.match(/\[SET_POKE:([^\]]+)\]/i);
            if (pokeMatch) {
                const newPoke = pokeMatch[1].trim().slice(0, 60);
                if (newPoke) {
                    chat.pokeText = newPoke;
                    if (typeof saveData === 'function') saveData().catch(() => {});
                }
                fullResponse = fullResponse.replace(/\[SET_POKE:[^\]]+\]/gi, "").trim();
            }
            const avMatch = fullResponse.match(/\[CHANGE_AVATAR:([^\]|]+)(?:\|([^\]]*))?\]/i);
            if (avMatch) {
                const ref = avMatch[1].trim();
                const desc = (avMatch[2] || '').trim().slice(0, 180);
                fullResponse = fullResponse.replace(/\[CHANGE_AVATAR:[^\]]+\]/gi, "").trim();
                if (typeof applyAiAvatarChange === 'function') {
                    applyAiAvatarChange(chat, ref, desc).catch(() => {});
                }
            }
        }

        // --- 朋友圈指令解析 ---
        const momentPostWithImageRegex = /\[(.*?)\s*发布了一条带图动态[：:](.*?)\|([\s\S]+?)\]/;
        const momentPostRegex = /\[(.*?)\s*发布了一条动态[：:]([\s\S]+?)\]/;
        const momentCommentRegex = /\[(.*?)\s*(?:评论了|回复了)\s*(.*?)(?:(?:的|在)动态["“'‘](.*?)["”'’])?(?:下的评论)?[：:]\s*([\s\S]+?)\]/;
        const momentSignatureRegex = /\[(.*?)\s*更新了个性签名[：:]([\s\S]+?)\]/;

        let momentPostWithImageMatch, momentPostMatch, momentCommentMatch, momentSignatureMatch;
        
        let messagesToProcess = getMixedContent(fullResponse).filter(item => item.content.trim() !== '');
        let remainingMessages = [];

        for (const item of messagesToProcess) {
            const content = item.content.trim();
            momentPostWithImageMatch = content.match(momentPostWithImageRegex);
            momentPostMatch = content.match(momentPostRegex);
            momentCommentMatch = content.match(momentCommentRegex);
            momentSignatureMatch = content.match(momentSignatureRegex);

            let isMomentAction = false;

            if (momentPostWithImageMatch) {
                isMomentAction = true;
                const author = momentPostWithImageMatch[1].trim();
                const imageDesc = momentPostWithImageMatch[2].trim();
                const momentContent = momentPostWithImageMatch[3].trim();
                
                if (!chat.moments) chat.moments = [];
                chat.moments.unshift({
                    id: `moment_${Date.now()}`,
                    author: author,
                    content: momentContent,
                    imageDescription: imageDesc, // 保存图片描述
                    timestamp: Date.now(),
                    likes: [],
                    comments: []
                });

                const notificationMsg = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'system',
                    content: `[system-display:您关注的 ${author} 发布了新动态]`,
                    timestamp: Date.now(),
                    isContextDisabled: true
                };
                chat.history.push(notificationMsg);
                addMessageBubble(notificationMsg, targetChatId, targetChatType);
            }
            else if (momentPostMatch && !momentPostWithImageMatch) { // 确保不重复匹配
                isMomentAction = true;
                const author = momentPostMatch[1].trim();
                const momentContent = momentPostMatch[2].trim();
                
                if (!chat.moments) chat.moments = [];
                chat.moments.unshift({
                    id: `moment_${Date.now()}`,
                    author: author,
                    content: momentContent,
                    timestamp: Date.now(),
                    likes: [],
                    comments: []
                });

                const notificationMsg = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'system',
                    content: `[system-display:您关注的 ${author} 发布了新动态]`,
                    timestamp: Date.now(),
                    isContextDisabled: true
                };
                chat.history.push(notificationMsg);
                addMessageBubble(notificationMsg, targetChatId, targetChatType);
            } 
            else if (momentCommentMatch) {
                isMomentAction = true;
                const commenter = momentCommentMatch[1].trim();
                const commentedOn = momentCommentMatch[2].trim();
                const momentSnippet = momentCommentMatch[3] ? momentCommentMatch[3].trim() : null;
                const commentContent = momentCommentMatch[4].trim();

                if (chat.moments && chat.moments.length > 0) {
                    let targetMoment = null;
                    if (momentSnippet) {
                        targetMoment = chat.moments.find(m => m.content.includes(momentSnippet));
                    }
                    if (!targetMoment) {
                        targetMoment = chat.moments.sort((a, b) => b.timestamp - a.timestamp)[0];
                    }

                    if (targetMoment) {
                        if (!targetMoment.comments) targetMoment.comments = [];
                        const newComment = {
                            id: `comment_${Date.now()}`,
                            author: commenter,
                            content: commentContent,
                            timestamp: Date.now()
                        };
                        const isReplyToComment = content.includes('回复了') && content.includes('下的评论');
                        if (isReplyToComment || (commentedOn !== chat.realName && commentedOn !== '自己')) {
                             newComment.replyTo = commentedOn;
                        }
                        targetMoment.comments.push(newComment);
                        if (commentedOn === chat.myName || commentedOn === '你') {
                            const notificationMsg = {
                                id: `msg_${Date.now()}_${Math.random()}`,
                                role: 'system',
                                content: `[system-display:您在${chat.realName}的动态下的评论被回复了]`,
                                timestamp: Date.now(),
                                isContextDisabled: true
                            };
                            chat.history.push(notificationMsg);
                            addMessageBubble(notificationMsg, targetChatId, targetChatType);
                        }
                    }
                }
            }
            else if (momentSignatureMatch) {
                isMomentAction = true;
                const newSignature = momentSignatureMatch[2].trim();
                chat.momentsSignature = newSignature;
                
                if (document.getElementById('moments-screen').classList.contains('active')) {
                    renderMomentsScreen();
                }
            }

            if (isMomentAction) {
                const originalCmdMsg = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'assistant',
                    content: content,
                    timestamp: Date.now(),
                    isContextDisabled: false
                };
                chat.history.push(originalCmdMsg);
                addMessageBubble(originalCmdMsg, targetChatId, targetChatType);
            } else {
                remainingMessages.push(item);
            }
        }
        
        fullResponse = remainingMessages.map(item => item.content).join('\n');
        // --- 朋友圈指令解析结束 ---

        // --- 红包结算逻辑 ---
        const redPacketMsg = chat.history.find(m => m.type === 'red-packet' && !m.isRevealed);
        if (redPacketMsg) {
            redPacketMsg.isRevealed = true;
            // 触发重新渲染红包消息
            setTimeout(() => {
                if (currentChatId === chat.id) {
                    renderMessages(false, false);
                }
            }, 500);
        }

        if (db.globalReceiveSound) {
            playSound(db.globalReceiveSound);
        }
        // ... 后续代码保持不变 ...
        console.log('【AI原始返回内容】:', rawResponse);
        let cleanedResponse = fullResponse.replace(/^\[system:.*?\]\s*/, '').replace(/^\(时间:.*?\)\s*/, '');
        const trimmedResponse = cleanedResponse.trim();
        let messages;

        if (trimmedResponse.startsWith('<') && trimmedResponse.endsWith('>')) {
            messages = [{ type: 'html', content: trimmedResponse }];
        } else {
            messages = getMixedContent(fullResponse).filter(item => item.content.trim() !== '');
        }

        let firstMessageProcessed = false;

        for (const item of messages) {
            // 自动剔除不存在的表情包
            const stickerRegex = /\[(?:.*?的)?表情包：(.+?)\]/i;
            const stickerMatch = item.content.match(stickerRegex);
            if (stickerMatch) {
                const stickerName = stickerMatch[1].trim();
                const groups = (chat.stickerGroups || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
                let targetSticker = null;
                
                // 1. 优先在绑定分组中查找
                if (groups.length > 0) {
                    targetSticker = db.myStickers.find(s => groups.includes(s.group) && s.name === stickerName);
                }
                
                // 2. 兜底在所有表情包中查找
                if (!targetSticker) {
                    targetSticker = db.myStickers.find(s => s.name === stickerName);
                }
                
                // 3. 如果完全找不到，则剔除该消息
                if (!targetSticker) {
                    console.log(`[Auto-Filter] 剔除不存在的表情包: ${stickerName}`);
                    continue; 
                }
            }

            // --- 视频/语音通话邀请检测 ---
            const callInviteRegex = /\[(.*?)向(.*?)发起了(视频|语音)通话\]/;
            const callInviteMatch = item.content.match(callInviteRegex);
            if (callInviteMatch) {
                const type = callInviteMatch[3] === '视频' ? 'video' : 'voice';
                // 触发来电界面
                if (window.VideoCallModule && typeof window.VideoCallModule.receiveCall === 'function') {
                    window.VideoCallModule.receiveCall(type, targetChatId, targetChatType);
                }
                // 不将此消息显示为普通气泡，或者显示为系统通知
                // 这里选择显示为系统通知样式的消息
                const message = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'system', // 使用 system 角色
                    content: item.content.trim(),
                    timestamp: Date.now()
                };
                chat.history.push(message);
                addReplyBubble(message);
                continue; // 跳过后续处理
            }

            if (targetChatType === 'private') {
                const char = db.characters.find(c => c.id === targetChatId);
                if (char && char.statusPanel && char.statusPanel.enabled && char.statusPanel.regexPattern) {
                    try {
                        let pattern = char.statusPanel.regexPattern;
                        let flags = 'gs'; 

                        const matchParts = pattern.match(/^\/(.*?)\/([a-z]*)$/);
                        if (matchParts) {
                            pattern = matchParts[1];
                            flags = matchParts[2] || 'gs';
                            if (!flags.includes('s')) flags += 's';
                        }

                    const regex = new RegExp(pattern, flags);
                    const match = regex.exec(item.content);
                    
                    if (match) {
                        const rawStatus = match[0];
                        
                        let html = char.statusPanel.replacePattern;
                        
                            // 使用正则一次性查找模板中的 $数字 并替换
    html = html.replace(/\$(\d+)/g, (fullMatch, groupIndex) => {
        const index = parseInt(groupIndex, 10);
        // 如果捕获组存在，则返回对应内容；否则保持原样
        return (match[index] !== undefined) ? match[index] : fullMatch;
    });


                        // Save to history
                        if (!char.statusPanel.history) char.statusPanel.history = [];
                        
                        // Add new status to the beginning
                        char.statusPanel.history.unshift({
                            raw: rawStatus,
                            html: html,
                            timestamp: Date.now()
                        });

                        // Keep only last 20 items
                        if (char.statusPanel.history.length > 20) {
                            char.statusPanel.history = char.statusPanel.history.slice(0, 20);
                        }

                        char.statusPanel.currentStatusRaw = rawStatus;
                        char.statusPanel.currentStatusHtml = html;
                        
                        item.isStatusUpdate = true;
                        item.statusSnapshot = {
                            regex: pattern,
                            replacePattern: char.statusPanel.replacePattern
                        };
                        }
                    } catch (e) {
                        console.error("状态栏正则解析错误:", e);
                    }
                }
            }

            // 如果是后台模式，跳过延迟，直接处理
            if (!isBackground) {
                const delay = firstMessageProcessed ? (900 + Math.random() * 1300) : (400 + Math.random() * 400);
                await new Promise(resolve => setTimeout(resolve, delay));
                
                // 如果开启了多条消息提示音，且不是第一条消息（第一条已由系统默认逻辑播放），则播放提示音
                if (firstMessageProcessed && db.multiMsgSoundEnabled && db.globalReceiveSound) {
                    playSound(db.globalReceiveSound);
                }
            }
            firstMessageProcessed = true;

            const aiWithdrawRegex = /\[(.*?)撤回了一条消息：([\s\S]*?)\]/;
            const aiWithdrawRegexEn = /\[(?:system:\s*)?(.*?) withdrew a message\. Original: ([\s\S]*?)\]/;
            
            const withdrawMatch = item.content.match(aiWithdrawRegex) || item.content.match(aiWithdrawRegexEn);

            if (withdrawMatch) {
                const characterName = withdrawMatch[1];
                const originalContent = withdrawMatch[2].trim();

                // --- 【新增兜底机制】检查上一条消息是否为重复输出 ---
                if (chat.history.length > 0) {
                    const lastMsg = chat.history[chat.history.length - 1];
                    // 提取上一条消息的纯文本内容（剥离包装标签）
                    let lastMsgPureContent = lastMsg.content;
                    const textMatch = lastMsg.content.match(/\[.*?的消息[：:]([\s\S]+?)\]/);
                    if (textMatch) {
                        lastMsgPureContent = textMatch[1].trim();
                    } else {
                        lastMsgPureContent = lastMsgPureContent.trim();
                    }

                    // 检查内容是否匹配且发送者一致
                    const isSameContent = (lastMsgPureContent === originalContent);
                    let isSameSender = false;
                    if (targetChatType === 'private') {
                        isSameSender = (lastMsg.role === 'assistant');
                    } else {
                        const sender = chat.members.find(m => (m.realName === characterName || m.groupNickname === characterName));
                        isSameSender = (sender && lastMsg.senderId === sender.id);
                    }

                    if (isSameContent && isSameSender) {
                        console.log(`[Withdraw-Fallback] 检测到重复输出，移除上一条消息: ${lastMsg.id}`);
                        chat.history.pop(); // 从历史记录移除
                        // 从 DOM 移除
                        const lastMsgEl = messageArea.querySelector(`.message-wrapper[data-id="${lastMsg.id}"]`);
                        if (lastMsgEl) lastMsgEl.remove();
                    }
                }
                // ----------------------------------------------

                const normalContent = `[${characterName}的消息：${originalContent}]`;
                
                const message = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'assistant',
                    content: normalContent,
                    parts: [{type: 'text', text: normalContent}],
                    timestamp: Date.now(),
                    originalContent: originalContent, 
                    isWithdrawn: false 
                };

                if (targetChatType === 'group') {
                    const sender = chat.members.find(m => (m.realName === characterName || m.groupNickname === characterName));
                    if (sender) {
                        message.senderId = sender.id;
                    }
                }

                chat.history.push(message);
                addReplyBubble(message);
                
                setTimeout(async () => {
                    message.isWithdrawn = true;
                    message.content = `[${characterName}撤回了一条消息：${originalContent}]`;
                    
                    await saveData();
                    
                    if ((targetChatType === 'private' && currentChatId === chat.id) || 
                        (targetChatType === 'group' && currentChatId === chat.id)) {
                         renderMessages(false, true);
                    }
                }, 2000);

                continue; 
            }

            if (targetChatType === 'private') {
                const character = chat;
                const myName = character.myName;

                const aiQuoteRegex = new RegExp(`\\[${character.realName}引用[“"](.*?)["”]并回复：([\\s\\S]*?)\\]`);
                const aiQuoteMatch = item.content.match(aiQuoteRegex);

                if (aiQuoteMatch) {
                    const quotedText = aiQuoteMatch[1];
                    const replyText = aiQuoteMatch[2];

                    const originalMessage = chat.history.slice().reverse().find(m => {
                        if (m.role === 'user') {
                            const userMessageMatch = m.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                            const userMessageText = userMessageMatch ? userMessageMatch[1] : m.content;
                            return userMessageText.trim() === quotedText.trim();
                        }
                        return false;
                    });

                    if (originalMessage) {
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: `[${character.realName}的消息：${replyText}]`,
                            parts: [{ type: 'text', text: `[${character.realName}的消息：${replyText}]` }],
                            timestamp: Date.now(),
                            isStatusUpdate: item.isStatusUpdate,
                            statusSnapshot: item.statusSnapshot,
                            quote: {
                                messageId: originalMessage.id,
                                senderId: 'user_me',
                                content: quotedText
                            }
                        };
                        chat.history.push(message);
                        addReplyBubble(message);
                    } else {
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: `[${character.realName}的消息：${replyText}]`,
                            parts: [{ type: 'text', text: `[${character.realName}的消息：${replyText}]` }],
                            timestamp: Date.now(),
                            isStatusUpdate: item.isStatusUpdate,
                            statusSnapshot: item.statusSnapshot
                        };
                        chat.history.push(message);
                        addReplyBubble(message);
                    }
                } else {
                    const receivedTransferRegex = new RegExp(`\\[${character.realName}的转账：.*?元；备注：.*?\\]`);
                    const giftRegex = new RegExp(`\\[${character.realName}送来的礼物：.*?\\]`);

                    const message = {
                        id: `msg_${Date.now()}_${Math.random()}`,
                        role: 'assistant',
                        content: item.content.trim(),
                        parts: [{type: item.type, text: item.content.trim()}],
                        timestamp: Date.now(),
                        isStatusUpdate: item.isStatusUpdate,
                        statusSnapshot: item.statusSnapshot
                    };

                    if (receivedTransferRegex.test(message.content)) {
                        message.transferStatus = 'pending';
                    } else if (giftRegex.test(message.content)) {
                        message.giftStatus = 'sent';
                    }

                    chat.history.push(message);
                    addReplyBubble(message);
                }

            } else if (targetChatType === 'group') {
                const group = chat;
                
                // --- 私聊通知 (不拦截) ---
                if (group.allowGossip && typeof handleGossipMessage === 'function') {
                    handleGossipMessage(group, item.content);
                }

                // 优先检查是否为私聊消息
                const privateRegex = /^\[Private: (.*?) -> (.*?): ([\s\S]+?)\]$/;
                const privateEndRegex = /^\[Private-End: (.*?) -> (.*?)\]$/;
                
                if (privateRegex.test(item.content) || privateEndRegex.test(item.content)) {
                    const match = item.content.match(privateRegex) || item.content.match(privateEndRegex);
                    let senderId = 'unknown';
                    
                    if (match) {
                        const senderName = match[1];
                        // 尝试匹配发送者
                        if (senderName === group.me.nickname) {
                            senderId = 'user_me';
                        } else {
                            const sender = group.members.find(m => m.realName === senderName || m.groupNickname === senderName);
                            if (sender) senderId = sender.id;
                        }
                    }

                    const message = {
                        id: `msg_${Date.now()}_${Math.random()}`,
                        role: 'assistant',
                        content: item.content.trim(),
                        parts: [{type: item.type, text: item.content.trim()}],
                        timestamp: Date.now(),
                        senderId: senderId
                    };
                    group.history.push(message);
                    addReplyBubble(message);
                    continue; // 私聊消息处理完毕，跳过后续普通消息匹配
                }

                const groupTransferRegex = /\[(.*?)\s*向\s*(.*?)\s*转账：([\d.,]+)元；备注：(.*?)\]/;
                const transferMatch = item.content.match(groupTransferRegex);

                const r = /\[(.*?)((?:的消息|的语音|发送的表情包|发来的照片\/视频))：/;
                const nameMatch = item.content.match(r);
                
                if (transferMatch) {
                    const senderName = transferMatch[1];
                    const sender = group.members.find(m => (m.realName === senderName || m.groupNickname === senderName));
                    if (sender) {
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: item.content.trim(),
                            parts: [{type: item.type, text: item.content.trim()}],
                            timestamp: Date.now(),
                            senderId: sender.id,
                            transferStatus: 'pending'
                        };
                        group.history.push(message);
                        addReplyBubble(message);
                    }
                } else if (nameMatch || item.char) {
                    const senderName = item.char || (nameMatch[1]);
                    const sender = group.members.find(m => (m.realName === senderName || m.groupNickname === senderName));
                    console.log(sender)
                    if (sender) {
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: item.content.trim(),
                            parts: [{type: item.type, text: item.content.trim()}],
                            timestamp: Date.now(),
                            senderId: sender.id
                        };
                        group.history.push(message);
                        addReplyBubble(message);
                    }
                }
            }
        }

        await saveSingleChatFast(chat, targetChatType);
        if (chat.autoAirDropEnabled && autoAirDropMessage) {
            void receiveAirDropPhoto(autoAirDropMessage.id, chat);
        }
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                try { renderChatList(); } catch (e) {}
            });
        } else {
            renderChatList();
        }

        // 延迟触发独立的电量检查，避免与并发生成争抢主线程与网络
        if (window.BatteryInteraction && typeof window.BatteryInteraction.triggerIndependentCheck === 'function') {
            setTimeout(() => {
                try { window.BatteryInteraction.triggerIndependentCheck(chat); } catch (e) {}
            }, 1500);
        }
    }
}

async function handleRegenerate() {
    if (isGenerating) return;

    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : db.groups.find(g => g.id === currentChatId);

    if (!chat || !chat.history || chat.history.length === 0) {
        showToast('没有可供重新生成的内容。');
        return;
    }

    const lastUserMessageIndex = chat.history.map(m => m.role).lastIndexOf('user');

    if (lastUserMessageIndex === -1 || lastUserMessageIndex === chat.history.length - 1) {
        showToast('AI尚未回复，无法重新生成。');
        return;
    }

    const originalLength = chat.history.length;
    chat.history.splice(lastUserMessageIndex + 1);

    if (chat.history.length === originalLength) {
        showToast('未找到AI的回复，无法重新生成。');
        return;
    }
    
    if (currentChatType === 'private') {
        recalculateChatStatus(chat);
    }

    await saveData();
    
    currentPage = 1; 
    renderMessages(false, true); 

    await getAiReply(currentChatId, currentChatType);
}
;
// --- 聊天辅助功能模块 ---

// 辅助功能
function setupVoiceMessageSystem() {
    const voiceMessageBtn = document.getElementById('voice-message-btn');
    const sendVoiceForm = document.getElementById('send-voice-form');
    const sendVoiceModal = document.getElementById('send-voice-modal');
    const voiceDurationPreview = document.getElementById('voice-duration-preview');
    const voiceTextInput = document.getElementById('voice-text-input');

    voiceMessageBtn.addEventListener('click', () => {
        sendVoiceForm.reset();
        voiceDurationPreview.textContent = '0"';
        sendVoiceModal.classList.add('visible');
    });
    sendVoiceForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMyVoiceMessage(voiceTextInput.value.trim());
    });
}

function sendMyVoiceMessage(text) {
    if (!text) return;
    document.getElementById('send-voice-modal').classList.remove('visible');
    setTimeout(() => {
        const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
        const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;
        const content = `[${myName}的语音：${text}]`;
        const message = {
            id: `msg_${Date.now()}`,
            role: 'user',
            content: content,
            parts: [{type: 'text', text: content}],
            timestamp: Date.now()
        };
        if (currentChatType === 'group') {
            message.senderId = 'user_me';
        }
        chat.history.push(message);
        addMessageBubble(message, currentChatId, currentChatType);
        saveData();
        renderChatList();
    }, 100);
}

function setupPhotoVideoSystem() {
    const photoVideoBtn = document.getElementById('photo-video-btn');
    const sendPvForm = document.getElementById('send-pv-form');
    const sendPvModal = document.getElementById('send-pv-modal');
    const pvTextInput = document.getElementById('pv-text-input');

    photoVideoBtn.addEventListener('click', () => {
        sendPvForm.reset();
        sendPvModal.classList.add('visible');
    });
    sendPvForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMyPhotoVideo(pvTextInput.value.trim());
    });
}

function sendMyPhotoVideo(text) {
    if (!text) return;
    document.getElementById('send-pv-modal').classList.remove('visible');
    setTimeout(() => {
        const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
        const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;
        const content = `[${myName}发来的照片\/视频：${text}]`;
        const message = {
            id: `msg_${Date.now()}`,
            role: 'user',
            content: content,
            parts: [{type: 'text', text: content}],
            timestamp: Date.now()
        };
        if (currentChatType === 'group') {
            message.senderId = 'user_me';
        }
        chat.history.push(message);
        addMessageBubble(message, currentChatId, currentChatType);
        saveData();
        renderChatList();
    }, 100);
}

function setupImageRecognition() {
    const imageRecognitionBtn = document.getElementById('image-recognition-btn');
    const imageUploadInput = document.getElementById('image-upload-input');

    imageRecognitionBtn.addEventListener('click', () => {
        imageUploadInput.click();
    });
    imageUploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, {
                    quality: 0.8,
                    maxWidth: 1024,
                    maxHeight: 1024
                });
                sendImageForRecognition(compressedUrl);
            } catch (error) {
                console.error('Image compression failed:', error);
                showToast('图片处理失败，请重试');
            } finally {
                e.target.value = null;
            }
        }
    });
}

async function sendImageForRecognition(base64Data) {
    if (!base64Data || isGenerating) return;
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;
    const textPrompt = `[${myName}发来了一张图片：]`;
    const message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: base64Data,
        parts: [{type: 'text', text: textPrompt}, {type: 'image', data: base64Data}],
        timestamp: Date.now(),
    };
    if (currentChatType === 'group') {
        message.senderId = 'user_me';
    }
    chat.history.push(message);
    addMessageBubble(message, currentChatId, currentChatType);
    await saveData();
    renderChatList();
}

function setupWalletSystem() {
    const walletBtn = document.getElementById('wallet-btn');
    const sendTransferForm = document.getElementById('send-transfer-form');
    const sendTransferModal = document.getElementById('send-transfer-modal');
    const transferAmountInput = document.getElementById('transfer-amount-input');
    const transferRemarkInput = document.getElementById('transfer-remark-input');
    const acceptTransferBtn = document.getElementById('accept-transfer-btn');
    const returnTransferBtn = document.getElementById('return-transfer-btn');

    walletBtn.addEventListener('click', () => {
        if (currentChatType === 'private') {
            sendTransferForm.reset();
            sendTransferModal.classList.add('visible');
        } else if (currentChatType === 'group') {
            // currentGroupAction 应该在 group_chat.js 或全局定义
            if (typeof currentGroupAction !== 'undefined') {
                currentGroupAction.type = 'transfer';
            }
            renderGroupRecipientSelectionList('转账给');
            document.getElementById('group-recipient-selection-modal').classList.add('visible');
        }
    });
    sendTransferForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = transferAmountInput.value;
        const remark = transferRemarkInput.value.trim();
        if (amount > 0) {
            sendMyTransfer(amount, remark);
        } else {
            showToast('请输入有效的金额');
        }
    });
    acceptTransferBtn.addEventListener('click', () => respondToTransfer('received'));
    returnTransferBtn.addEventListener('click', () => respondToTransfer('returned'));
}

function sendMyTransfer(amount, remark) {
    document.getElementById('send-transfer-modal').classList.remove('visible');
    setTimeout(() => {
        const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
        if (currentChatType === 'private') {
            const content = `[${chat.myName}给你转账：${amount}元；备注：${remark}]`;
            const message = {
                id: `msg_${Date.now()}`,
                role: 'user',
                content: content,
                parts: [{type: 'text', text: content}],
                timestamp: Date.now(),
                transferStatus: 'pending'
            };
            chat.history.push(message);
            addMessageBubble(message, currentChatId, currentChatType);
        } else { 
            if (typeof currentGroupAction !== 'undefined' && currentGroupAction.recipients) {
                currentGroupAction.recipients.forEach(recipientId => {
                    const recipient = chat.members.find(m => m.id === recipientId);
                    if (recipient) {
                        const content = `[${chat.me.nickname} 向 ${recipient.realName} 转账：${amount}元；备注：${remark}]`;
                        const message = {
                            id: `msg_${Date.now()}_${recipientId}`,
                            role: 'user',
                            content: content,
                            parts: [{type: 'text', text: content}],
                            timestamp: Date.now(),
                            senderId: 'user_me'
                        };
                        chat.history.push(message);
                        addMessageBubble(message, currentChatId, currentChatType);
                    }
                });
            }
        }
        saveData();
        renderChatList();
    }, 100);
}

function handleReceivedTransferClick(messageId) {
    currentTransferMessageId = messageId;
    document.getElementById('receive-transfer-actionsheet').classList.add('visible');
}

async function respondToTransfer(action) {
    if (!currentTransferMessageId) return;
    const character = db.characters.find(c => c.id === currentChatId);
    const message = character.history.find(m => m.id === currentTransferMessageId);
    if (message) {
        message.transferStatus = action;
        const cardOnScreen = messageArea.querySelector(`.message-wrapper[data-id="${currentTransferMessageId}"] .transfer-card`);
        if (cardOnScreen) {
            cardOnScreen.classList.remove('received', 'returned');
            cardOnScreen.classList.add(action);
            cardOnScreen.querySelector('.transfer-status').textContent = action === 'received' ? '已收款' : '已退回';
            cardOnScreen.style.cursor = 'default';
        }
        let contextMessageContent = (action === 'received') ? `[${character.myName}接收${character.realName}的转账]` : `[${character.myName}退回${character.realName}的转账]`;
        const contextMessage = {
            id: `msg_${Date.now()}`,
            role: 'user',
            content: contextMessageContent,
            parts: [{type: 'text', text: contextMessageContent}],
            timestamp: Date.now()
        };
        character.history.push(contextMessage);
        await saveData();
        renderChatList();
    }
    document.getElementById('receive-transfer-actionsheet').classList.remove('visible');
    currentTransferMessageId = null;
}

function setupGiftSystem() {
    const giftBtn = document.getElementById('gift-btn');
    const sendGiftForm = document.getElementById('send-gift-form');
    const sendGiftModal = document.getElementById('send-gift-modal');
    const giftDescriptionInput = document.getElementById('gift-description-input');

    giftBtn.addEventListener('click', () => {
        if (currentChatType === 'private') {
            sendGiftForm.reset();
            sendGiftModal.classList.add('visible');
        } else if (currentChatType === 'group') {
            if (typeof currentGroupAction !== 'undefined') {
                currentGroupAction.type = 'gift';
            }
            renderGroupRecipientSelectionList('送礼物给');
            document.getElementById('group-recipient-selection-modal').classList.add('visible');
        }
    });
    sendGiftForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMyGift(giftDescriptionInput.value.trim());
    });
}

function sendMyGift(description) {
    if (!description) return;
    document.getElementById('send-gift-modal').classList.remove('visible');
    setTimeout(() => {
        const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);

        if (currentChatType === 'private') {
            const content = `[${chat.myName}送来的礼物：${description}]`;
            const message = {
                id: `msg_${Date.now()}`,
                role: 'user',
                content: content,
                parts: [{type: 'text', text: content}],
                timestamp: Date.now(),
                giftStatus: 'sent'
            };
            chat.history.push(message);
            addMessageBubble(message, currentChatId, currentChatType);
        } else { 
            if (typeof currentGroupAction !== 'undefined' && currentGroupAction.recipients) {
                currentGroupAction.recipients.forEach(recipientId => {
                    const recipient = chat.members.find(m => m.id === recipientId);
                    if (recipient) {
                        const content = `[${chat.me.nickname} 向 ${recipient.realName} 送来了礼物：${description}]`;
                        const message = {
                            id: `msg_${Date.now()}_${recipientId}`,
                            role: 'user',
                            content: content,
                            parts: [{type: 'text', text: content}],
                            timestamp: Date.now(),
                            senderId: 'user_me'
                        };
                        chat.history.push(message);
                        addMessageBubble(message, currentChatId, currentChatType);
                    }
                });
            }
        }
        saveData();
        renderChatList();
    }, 100);
}

// --- 转发聊天记录弹窗逻辑 ---
window.showForwardedChatModal = function(chatContent, charName) {
    const modal = document.getElementById('forwarded-chat-modal');
    const titleEl = document.getElementById('forwarded-chat-modal-title');
    const contentEl = document.getElementById('forwarded-chat-content');
    const closeBtn = document.getElementById('close-forwarded-chat-btn');
    
    if (!modal || !titleEl || !contentEl) return;
    
    titleEl.textContent = `${charName}的聊天记录`;
    
    // 解析聊天记录内容
    const lines = chatContent.split('\n').filter(line => line.trim() !== '');
    let html = '';
    
    lines.forEach(line => {
        // 尝试匹配 "名字：内容" 或 "名字: 内容"
        const match = line.match(/^([^：:]+)[：:]([\s\S]+)$/);
        if (match) {
            const name = match[1].trim();
            const text = match[2].trim();
            
            // 简单的左右区分逻辑：如果名字是当前角色，放右边，否则放左边
            const isSelf = name === charName;
            
            html += `
                <div style="display: flex; flex-direction: column; align-items: ${isSelf ? 'flex-end' : 'flex-start'}; margin-bottom: 12px;">
                    <span style="font-size: 12px; color: #888; margin-bottom: 4px; margin-${isSelf ? 'right' : 'left'}: 4px;">${name}</span>
                    <div style="background: ${isSelf ? 'var(--primary-color)' : '#fff'}; color: ${isSelf ? '#fff' : '#333'}; padding: 8px 12px; border-radius: 12px; border-${isSelf ? 'top-right' : 'top-left'}-radius: 4px; max-width: 85%; word-wrap: break-word; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                        ${DOMPurify.sanitize(text)}
                    </div>
                </div>
            `;
        } else {
            // 如果没有匹配到名字，作为系统提示或居中显示
            html += `<div style="text-align: center; font-size: 12px; color: #aaa; margin: 8px 0;">${DOMPurify.sanitize(line)}</div>`;
        }
    });
    
    contentEl.innerHTML = html;
    modal.classList.add('visible');
    
    // 绑定关闭事件
    const closeModal = () => {
        modal.classList.remove('visible');
        closeBtn.removeEventListener('click', closeModal);
    };
    closeBtn.addEventListener('click', closeModal);
};

function setupTimeSkipSystem() {
    const timeSkipBtn = document.getElementById('time-skip-btn');
    const timeSkipModal = document.getElementById('time-skip-modal');
    const timeSkipForm = document.getElementById('time-skip-form');
    const timeSkipInput = document.getElementById('time-skip-input');

    timeSkipBtn.addEventListener('click', () => {
        timeSkipForm.reset();
        timeSkipModal.classList.add('visible');
    });
    timeSkipModal.addEventListener('click', (e) => {
        if (e.target === timeSkipModal) timeSkipModal.classList.remove('visible');
    });
    timeSkipForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendTimeSkipMessage(timeSkipInput.value.trim());
    });
}

async function sendTimeSkipMessage(text) {
    if (!text) return;
    document.getElementById('time-skip-modal').classList.remove('visible');
    await new Promise(resolve => setTimeout(resolve, 100));
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    if (!chat) return;

    const visualMessage = {
        id: `msg_visual_${Date.now()}`,
        role: 'system',
        content: `[system-display:${text}]`,
        parts: [],
        timestamp: Date.now()
    };
    const contextMessage = {
        id: `msg_context_${Date.now()}`,
        role: 'user',
        content: `[system: ${text}]`,
        parts: [{type: 'text', text: `[system: ${text}]`}],
        timestamp: Date.now()
    };
    if (currentChatType === 'group') {
        contextMessage.senderId = 'user_me';
        visualMessage.senderId = 'user_me';
    }

    chat.history.push(visualMessage, contextMessage);
    addMessageBubble(visualMessage, currentChatId, currentChatType);
    await saveData();
    renderChatList();
}

const AudioManager = {
    _audio: null,
    
    get audio() {
        if (!this._audio) {
            this._audio = new Audio();
            this._audio.addEventListener('ended', () => {
                // 可选：播放结束后的清理工作
            });
            this._audio.addEventListener('error', (e) => {
                console.warn('Audio Object Error:', e);
            });
        }
        return this._audio;
    },

    play(source) {
        if (!source) return;
        const a = this.audio;
        
        // 如果当前正在播放且源相同，可以重置进度（打断重播）
        // 如果源不同，直接切换
        try {
            a.src = source;
            a.volume = 1.0; 
            a.currentTime = 0;
            
            const p = a.play();
            if (p && typeof p.catch === 'function') {
                p.catch(e => {
                    // 忽略 AbortError (被新的播放打断是正常的)
                    if (e.name !== 'AbortError') {
                        console.warn('播放提示音失败:', e);
                    }
                });
            }
        } catch (e) {
            console.warn('音频播放异常:', e);
        }
    },

    // 预热/解锁音频对象（用于在没有发送音效时获取播放权限）
    unlock() {
        if (db.globalReceiveSound) {
            const a = this.audio;
            // 记录当前状态
            const originalSrc = a.src;
            
            // 切换到接收音效进行预热
            if (!a.src || a.src !== db.globalReceiveSound) {
                 a.src = db.globalReceiveSound;
            }
            
            a.volume = 0; // 静音
            const p = a.play();
            if (p) {
                p.then(() => {
                    a.pause();
                    a.currentTime = 0;
                    a.volume = 1; 
                }).catch(e => {
                    // 预热失败也不影响流程
                    a.volume = 1;
                });
            }
        }
    }
};

function playSound(source) {
    AudioManager.play(source);
}
;
// --- 消息操作模块 (编辑、撤回、多选、截图、历史记录管理) ---

let currentMultiSelectMode = 'delete'; // 'delete' or 'capture'
let isAddingMessageMode = false;
let addingAfterMessageId = null;

function handleMessageLongPress(messageWrapper, x, y) {
    if (isInMultiSelectMode) return;
    clearTimeout(longPressTimer);
    // 清除可能存在的文本选择，防止干扰菜单点击
    if (window.getSelection) {
        window.getSelection().removeAllRanges();
    }
    const messageId = messageWrapper.dataset.id;
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    const message = chat.history.find(m => m.id === messageId);
    if (!message) return;

    const isImageRecognitionMsg = message.parts && message.parts.some(p => p.type === 'image');
    const isVoiceMessage = /\[.*?的语音：.*?\]/.test(message.content);
    const isStickerMessage = /\[.*?的表情包：.*?\]|\[.*?发送的表情包：.*?\]/.test(message.content);
    const isPhotoVideoMessage = /\[.*?发来的照片\/视频：.*?\]/.test(message.content);
    const isTransferMessage = /\[.*?给你转账：.*?\]|\[.*?的转账：.*?\]|\[.*?向.*?转账：.*?\]/.test(message.content);
    const isGiftMessage = /\[.*?送来的礼物：.*?\]|\[.*?向.*?送来了礼物：.*?\]/.test(message.content);
    
    let invisibleRegex;
    if (chat.showStatusUpdateMsg) {
        invisibleRegex = /\[.*?(?:接收|退回).*?的转账\]|\[.*?已接收礼物\]|\[system:.*?\]|\[.*?邀请.*?加入了群聊\]|\[.*?修改群名为：.*?\]|\[system-display:.*?\]/;
    } else {
        invisibleRegex = /\[.*?(?:接收|退回).*?的转账\]|\[.*?更新状态为：.*?\]|\[.*?已接收礼物\]|\[system:.*?\]|\[.*?邀请.*?加入了群聊\]|\[.*?修改群名为：.*?\]|\[system-display:.*?\]/;
    }
    const isInvisibleMessage = invisibleRegex.test(message.content);
    const isWithdrawn = message.isWithdrawn; 

    let menuItems = [];

    if (!isWithdrawn) {
        if (!isImageRecognitionMsg && !isVoiceMessage && !isStickerMessage && !isPhotoVideoMessage && !isTransferMessage && !isGiftMessage && !isInvisibleMessage) {
            menuItems.push({label: '编辑', action: () => startMessageEdit(messageId)});
        }
        
        if (!isInvisibleMessage) {
            menuItems.push({label: '引用', action: () => startQuoteReply(messageId)});
        }

        if (message.role === 'user') {
            menuItems.push({label: '撤回', action: () => withdrawMessage(messageId)});
        }
        
        if (message.role === 'assistant') {
            menuItems.push({label: '接收照片', action: () => receiveAirDropPhoto(messageId)});
            menuItems.push({label: '新增', action: () => startAddNewMessage(messageId)});
        }
    }

    menuItems.push({
        label: isDebugMode ? '退出调试' : '进入调试',
        action: () => {
            isDebugMode = !isDebugMode;
            showToast(isDebugMode ? '已进入调试模式' : '已退出调试模式');
            renderMessages(false, true); 
        }
    });

    menuItems.push({label: '删除', action: () => enterMultiSelectMode(messageId)});
    menuItems.push({label: '从这里创建分支', action: () => createBranchArchiveAtMessage(messageId)});

    if (menuItems.length > 0) {
        triggerHapticFeedback('medium');
        createContextMenu(menuItems, x, y);
    }
}

function startDebugEdit(messageId) {
    exitMultiSelectMode();
    editingMessageId = messageId;
    isRawEditMode = true; 

    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    const message = chat.history.find(m => m.id === messageId);
    if (!message) return;

    const modal = document.getElementById('message-edit-modal');
    const textarea = document.getElementById('message-edit-textarea');
    const title = modal.querySelector('h3');
    const deleteBtn = document.getElementById('debug-delete-msg-btn'); 

    if (!modal.dataset.originalTitle) modal.dataset.originalTitle = title.textContent;
    title.textContent = "调试/编辑源码";

    const textMatch = message.content.match(/^\[(.*?)的消息：([\s\S]+?)\]$/);
    if (message.quote && textMatch) {
        const name = textMatch[1];
        const text = textMatch[2];
        const quoteContent = message.quote.content;
        textarea.value = `[${name}引用“${quoteContent}”并回复：${text}]`;
    } else {
        textarea.value = message.content; 
    }

    const timestampInput = document.getElementById('message-edit-timestamp');
    const timestampGroup = document.getElementById('message-edit-timestamp-group');
    if (timestampInput && timestampGroup) {
        const date = new Date(message.timestamp);
        const Y = date.getFullYear();
        const M = String(date.getMonth() + 1).padStart(2, '0');
        const D = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        timestampInput.value = `${Y}-${M}-${D}T${h}:${m}`;
        timestampInput.dataset.originalValue = timestampInput.value;
        timestampGroup.style.display = 'flex';
    }
    
    if (deleteBtn) {
        deleteBtn.style.display = 'block';
        const newDeleteBtn = deleteBtn.cloneNode(true);
        deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
        
        newDeleteBtn.addEventListener('click', async () => {
            if (confirm('【调试模式】确定要永久删除这条消息吗？')) {
                chat.history = chat.history.filter(m => m.id !== messageId);
                
                if (currentChatType === 'private') {
                    recalculateChatStatus(chat);
                }

                await saveData(); 
                renderMessages(false, true); 
                cancelMessageEdit(); 
                showToast('消息已删除');
            }
        });
    }

    modal.classList.add('visible');
    textarea.focus();
}

function startQuoteReply(messageId) {
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    const message = chat.history.find(m => m.id === messageId);
    if (!message) return;

    let senderName = '';
    let senderId = '';
    if (message.role === 'user') {
        senderName = (currentChatType === 'private')
            ? ((chat.myRemarkName && chat.myRemarkName.trim()) || chat.myName || 'User')
            : chat.me.nickname;
        senderId = 'user_me';
    } else { 
        if (currentChatType === 'private') {
            senderName = chat.remarkName;
            senderId = chat.id;
        } else {
            const sender = chat.members.find(m => m.id === message.senderId);
            senderName = sender ? sender.groupNickname : '未知成员';
            senderId = sender ? sender.id : 'unknown';
        }
    }
    
    let previewContent = message.content;
    const textMatch = message.content.match(/\[.*?的消息：([\s\S]+?)\]/);
    if (textMatch) {
        previewContent = textMatch[1];
    } else if (/\[.*?的表情包：.*?\]/.test(message.content)) {
        previewContent = '[表情包]';
    } else if (/\[.*?的语音：.*?\]/.test(message.content)) {
        previewContent = '[语音]';
    } else if (/\[.*?发来的照片\/视频：.*?\]/.test(message.content)) {
        previewContent = '[照片/视频]';
    } else if (message.parts && message.parts.some(p => p.type === 'image')) {
        previewContent = '[图片]';
    }
    
    currentQuoteInfo = {
        id: message.id,
        senderId: senderId,
        senderName: senderName,
        content: previewContent.substring(0, 100) 
    };

    const previewBar = document.getElementById('reply-preview-bar');
    previewBar.querySelector('.reply-preview-name').textContent = `回复 ${senderName}`;
    previewBar.querySelector('.reply-preview-text').textContent = currentQuoteInfo.content;
    previewBar.classList.add('visible');
    
    messageInput.focus();
}

function cancelQuoteReply() {
    currentQuoteInfo = null;
    const previewBar = document.getElementById('reply-preview-bar');
    previewBar.classList.remove('visible');
}

function startAddNewMessage(messageId) {
    exitMultiSelectMode();
    isAddingMessageMode = true;
    addingAfterMessageId = messageId;
    isRawEditMode = false;
    
    const modal = document.getElementById('message-edit-modal');
    const textarea = document.getElementById('message-edit-textarea');
    const title = document.getElementById('message-edit-modal-title');
    const typeGroup = document.getElementById('message-edit-type-group');
    const typeSelect = document.getElementById('message-edit-type');
    
    if (title) title.textContent = "新增角色消息";
    if (typeGroup) typeGroup.style.display = 'block';
    if (typeSelect) {
        typeSelect.value = 'text';
        textarea.placeholder = "输入文字内容...";
        
        // 绑定类型切换事件
        typeSelect.onchange = () => {
            switch(typeSelect.value) {
                case 'text': textarea.placeholder = "输入文字内容..."; break;
                case 'voice': textarea.placeholder = "输入语音内容..."; break;
                case 'image': textarea.placeholder = "输入照片/视频描述或URL..."; break;
                case 'sticker': textarea.placeholder = "输入表情包名称..."; break;
            }
        };
    }
    
    textarea.value = '';
    
    const timestampGroup = document.getElementById('message-edit-timestamp-group');
    if (timestampGroup) timestampGroup.style.display = 'none';
    
    modal.classList.add('visible');
    textarea.focus();
}

function startMessageEdit(messageId) {
    exitMultiSelectMode();
    editingMessageId = messageId;
    isRawEditMode = false;
    isAddingMessageMode = false;
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    const message = chat.history.find(m => m.id === messageId);
    if (!message) return;

    const modal = document.getElementById('message-edit-modal');
    const textarea = document.getElementById('message-edit-textarea');
    const title = document.getElementById('message-edit-modal-title');
    const typeGroup = document.getElementById('message-edit-type-group');
    
    if (title) title.textContent = "编辑消息";
    if (typeGroup) typeGroup.style.display = 'none';

    let contentToEdit = message.content;
    const plainTextMatch = contentToEdit.match(/^\[.*?：([\s\S]*)\]$/);
    if (plainTextMatch && plainTextMatch[1]) {
        contentToEdit = plainTextMatch[1].trim();
    }
    contentToEdit = contentToEdit.replace(/\[发送时间:.*?\]/g, '').trim();
    
    textarea.value = contentToEdit;

    const timestampInput = document.getElementById('message-edit-timestamp');
    const timestampGroup = document.getElementById('message-edit-timestamp-group');
    if (timestampInput && timestampGroup) {
        const date = new Date(message.timestamp);
        const Y = date.getFullYear();
        const M = String(date.getMonth() + 1).padStart(2, '0');
        const D = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        timestampInput.value = `${Y}-${M}-${D}T${h}:${m}`;
        timestampInput.dataset.originalValue = timestampInput.value;
        timestampGroup.style.display = 'flex';
    }

    modal.classList.add('visible');
    textarea.focus();
}

async function saveMessageEdit() {
    const newText = document.getElementById('message-edit-textarea').value.trim();
    if (!newText) {
        cancelMessageEdit();
        return;
    }
    
    if (!isAddingMessageMode && !editingMessageId) {
        cancelMessageEdit();
        return;
    }

    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    
    if (isAddingMessageMode) {
        const targetIndex = chat.history.findIndex(m => m.id === addingAfterMessageId);
        if (targetIndex === -1) {
            cancelMessageEdit();
            return;
        }
        
        const targetMessage = chat.history[targetIndex];
        let senderName = '';
        let senderId = '';
        
        if (currentChatType === 'private') {
            senderName = chat.realName;
            senderId = chat.id;
        } else {
            const sender = chat.members.find(m => m.id === targetMessage.senderId);
            senderName = sender ? (sender.realName || sender.groupNickname) : '未知成员';
            senderId = targetMessage.senderId;
        }
        
        const typeSelect = document.getElementById('message-edit-type');
        const msgType = typeSelect ? typeSelect.value : 'text';
        let formattedContent = '';
        
        switch(msgType) {
            case 'text':
                formattedContent = `[${senderName}的消息：${newText}]`;
                break;
            case 'voice':
                formattedContent = `[${senderName}的语音：${newText}]`;
                break;
            case 'image':
                formattedContent = `[${senderName}发来的照片/视频：${newText}]`;
                break;
            case 'sticker':
                formattedContent = `[${senderName}的表情包：${newText}]`;
                break;
            default:
                formattedContent = `[${senderName}的消息：${newText}]`;
        }
        
        const newMessage = {
            id: `msg_${Date.now()}_${Math.random()}`,
            role: 'assistant',
            content: formattedContent,
            parts: [{type: 'text', text: formattedContent}],
            timestamp: targetMessage.timestamp + 1,
            senderId: senderId
        };
        
        chat.history.splice(targetIndex + 1, 0, newMessage);
        
    } else {
        const messageIndex = chat.history.findIndex(m => m.id === editingMessageId);
        if (messageIndex === -1) {
            cancelMessageEdit();
            return;
        }

        if (isRawEditMode) {
            const quoteRegex = /^\[(.*?)引用[“"]([\s\S]*?)[”"]并回复：([\s\S]*?)\]$/;
            const match = newText.match(quoteRegex);

            if (match) {
                const name = match[1];
                const quoteContent = match[2];
                const replyText = match[3];

                if (chat.history[messageIndex].quote) {
                    chat.history[messageIndex].quote.content = quoteContent;

                    const targetContent = quoteContent.trim();
                    const originalMessage = chat.history.slice().reverse().find(m => {
                        if (m.id === chat.history[messageIndex].id) return false;
                        let text = m.content;
                        const plainTextMatch = text.match(/^\[.*?：([\s\S]*)\]$/);
                        if (plainTextMatch && plainTextMatch[1]) {
                            text = plainTextMatch[1].trim();
                        }
                        text = text.replace(/\[发送时间:.*?\]$/, '').trim();
                        return text === targetContent;
                    });

                    if (originalMessage) {
                        let newSenderId;
                        if (originalMessage.role === 'user') {
                            newSenderId = 'user_me';
                        } else {
                            newSenderId = originalMessage.senderId || (currentChatType === 'private' ? chat.id : 'unknown');
                        }
                        chat.history[messageIndex].quote.senderId = newSenderId;
                        chat.history[messageIndex].quote.messageId = originalMessage.id;
                    }
                }
                chat.history[messageIndex].content = `[${name}的消息：${replyText}]`;
            } else {
                chat.history[messageIndex].content = newText;
            }

            if (chat.history[messageIndex].parts) {
                chat.history[messageIndex].parts = [{type: 'text', text: chat.history[messageIndex].content}];
            }
        } else {
            const oldContent = chat.history[messageIndex].content;
            const prefixMatch = oldContent.match(/(\[.*?的(?:消息|语音|表情包|照片\/视频)[：:])[\s\S]+\]/);
            let newContent;

            if (prefixMatch && prefixMatch[1]) {
                const prefix = prefixMatch[1];
                newContent = `${prefix}${newText}]`;
            } else {
                newContent = newText;
            }

            chat.history[messageIndex].content = newContent;
            if (chat.history[messageIndex].parts) {
                chat.history[messageIndex].parts = [{type: 'text', text: newContent}];
            }
        }

        const timestampInput = document.getElementById('message-edit-timestamp');
        if (timestampInput && timestampInput.value) {
            if (timestampInput.value !== timestampInput.dataset.originalValue) {
                const newTime = new Date(timestampInput.value).getTime();
                if (!isNaN(newTime)) {
                    chat.history[messageIndex].timestamp = newTime;
                    chat.history.sort((a, b) => a.timestamp - b.timestamp);
                }
            }
        }
        
        if (currentChatType === 'private') {
            recalculateChatStatus(chat);

            if (chat.statusPanel && chat.statusPanel.enabled && chat.statusPanel.regexPattern) {
                try {
                    let pattern = chat.statusPanel.regexPattern;
                    let flags = 'gs'; 

                    const matchParts = pattern.match(/^\/(.*?)\/([a-z]*)$/);
                    if (matchParts) {
                        pattern = matchParts[1];
                        flags = matchParts[2] || 'gs';
                        if (!flags.includes('s')) flags += 's';
                    }

                    const regex = new RegExp(pattern, flags);
                    const match = regex.exec(chat.history[messageIndex].content);
                    
                    if (match) {
                        const rawStatus = match[0];
                        chat.statusPanel.currentStatusRaw = rawStatus;
                        
                        let html = chat.statusPanel.replacePattern;
                        
                        for (let i = 1; i < match.length; i++) {
                            html = html.replace(new RegExp(`\\$${i}`, 'g'), match[i]);
                        }
                        chat.statusPanel.currentStatusHtml = html;
                        
                        chat.history[messageIndex].isStatusUpdate = true;
                        chat.history[messageIndex].statusSnapshot = {
                            regex: pattern,
                            replacePattern: chat.statusPanel.replacePattern
                        };
                    } else {
                        chat.history[messageIndex].isStatusUpdate = false;
                        delete chat.history[messageIndex].statusSnapshot;
                    }
                } catch (e) {
                    console.error("编辑时解析状态栏错误:", e);
                }
            }
        }
    }

    await saveData();
    currentPage = 1;
    renderMessages(false, true);
    renderChatList();
    
    cancelMessageEdit();
}

function cancelMessageEdit() {
    editingMessageId = null;
    isRawEditMode = false; 
    isAddingMessageMode = false;
    addingAfterMessageId = null;
    
    const modal = document.getElementById('message-edit-modal');
    const deleteBtn = document.getElementById('debug-delete-msg-btn');
    if (deleteBtn) deleteBtn.style.display = 'none';

    const timestampInput = document.getElementById('message-edit-timestamp');
    const timestampGroup = document.getElementById('message-edit-timestamp-group');
    if (timestampInput && timestampGroup) {
        timestampInput.value = '';
        timestampGroup.style.display = 'none';
    }
    
    const typeGroup = document.getElementById('message-edit-type-group');
    if (typeGroup) typeGroup.style.display = 'none';

    if (modal) {
        modal.classList.remove('visible');
        const title = document.getElementById('message-edit-modal-title');
        if (title) {
            title.textContent = "编辑消息";
        }
    }
}

function enterMultiSelectMode(initialMessageId, mode = 'delete') {
    isInMultiSelectMode = true;
    currentMultiSelectMode = mode;
    
    chatRoomHeaderDefault.style.display = 'none';
    chatRoomHeaderSelect.style.display = 'flex';
    document.querySelector('.chat-input-wrapper').style.display = 'none';
    
    if (mode === 'delete') {
        multiSelectBar.classList.add('visible');
        document.getElementById('multi-select-title').textContent = '选择消息';
    } else if (mode === 'capture') {
        document.getElementById('capture-mode-bar').classList.add('visible');
        document.getElementById('multi-select-title').textContent = '选择截图范围';
    }
    
    chatRoomScreen.classList.add('multi-select-active');
    selectedMessageIds.clear();
    if (initialMessageId) {
        toggleMessageSelection(initialMessageId);
    }
}

function exitMultiSelectMode() {
    isInMultiSelectMode = false;
    chatRoomHeaderDefault.style.display = 'flex';
    chatRoomHeaderSelect.style.display = 'none';
    document.querySelector('.chat-input-wrapper').style.display = 'block';
    
    multiSelectBar.classList.remove('visible');
    document.getElementById('capture-mode-bar').classList.remove('visible');
    
    chatRoomScreen.classList.remove('multi-select-active');
    selectedMessageIds.forEach(id => {
        const el = messageArea.querySelector(`.message-wrapper[data-id="${id}"]`);
        if (el) el.classList.remove('multi-select-selected');
    });
    selectedMessageIds.clear();
    currentMultiSelectMode = 'delete';
}

function toggleMessageSelection(messageId) {
    const el = messageArea.querySelector(`.message-wrapper[data-id="${messageId}"]`);
    if (!el) return;
    if (selectedMessageIds.has(messageId)) {
        selectedMessageIds.delete(messageId);
        el.classList.remove('multi-select-selected');
    } else {
        selectedMessageIds.add(messageId);
        el.classList.add('multi-select-selected');
    }
    
    if (currentMultiSelectMode === 'delete') {
        selectCount.textContent = `已选择 ${selectedMessageIds.size} 项`;
        deleteSelectedBtn.disabled = selectedMessageIds.size === 0;
    } else if (currentMultiSelectMode === 'capture') {
        document.getElementById('capture-select-count').textContent = `已选择 ${selectedMessageIds.size} 项`;
        // 截图模式下，即使没选也可以生成（虽然没意义，但保持逻辑简单），或者禁用
        // document.getElementById('generate-capture-btn').disabled = selectedMessageIds.size === 0;
    }
}

async function generateCapture() {
    if (selectedMessageIds.size === 0) return showToast('请至少选择一条消息');
    
    showToast('正在生成截图，请稍候...', 3000);
    
    // 1. 获取选中的消息元素并排序
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    const sortedMessages = chat.history.filter(m => selectedMessageIds.has(m.id));
    
    // 2. 创建临时容器
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'absolute';
    tempContainer.style.top = '-9999px';
    tempContainer.style.left = '0';
    tempContainer.style.width = '400px'; // 固定宽度模拟手机
    tempContainer.style.backgroundColor = '#f5f5f5'; // 默认背景
    if (chat.chatBg) {
        tempContainer.style.backgroundImage = `url(${chat.chatBg})`;
        tempContainer.style.backgroundSize = 'cover';
        tempContainer.style.backgroundPosition = 'center';
    } else if (chat.theme) {
        // 应用主题背景色
        const theme = colorThemes[chat.theme] || colorThemes['white_pink'];
        // 这里简单处理，如果需要更精确的主题背景，可能需要更多逻辑
    }
    
    tempContainer.style.padding = '20px';
    tempContainer.style.display = 'flex';
    tempContainer.style.flexDirection = 'column';
    
    // 3. 克隆并处理消息元素
    // 为了保证样式正确，我们需要重新渲染这些消息，或者克隆现有的 DOM
    // 这里选择重新渲染，因为现有的 DOM 可能包含多选状态的样式
    
    // 临时借用 createMessageBubbleElement，但需要注意它依赖全局状态
    // 我们可以手动构建或者克隆现有的 DOM 并移除 .multi-select-selected 类
    
    sortedMessages.forEach(msg => {
        const originalEl = messageArea.querySelector(`.message-wrapper[data-id="${msg.id}"]`);
        if (originalEl) {
            const clone = originalEl.cloneNode(true);
            clone.classList.remove('multi-select-selected');
            clone.style.marginBottom = '15px';
            
            // 处理一些可能在截图时显示不正常的元素
            // 例如：如果是 HTML 气泡，iframe 可能无法被 html2canvas 捕获
            // 这里暂时不做特殊处理，html2canvas 对 iframe 支持有限
            
            tempContainer.appendChild(clone);
        }
    });
    
    // 添加水印
    
    
    document.body.appendChild(tempContainer);
    
    try {
        // 4. 生成截图
        const canvas = await html2canvas(tempContainer, {
            useCORS: true, // 允许跨域图片
            scale: 2, // 提高清晰度
            backgroundColor: null // 透明背景
        });
        
        const imgUrl = canvas.toDataURL('image/png');
        
        // 5. 显示结果
        const previewContainer = document.getElementById('capture-preview-container');
        previewContainer.innerHTML = '';
        const img = document.createElement('img');
        img.src = imgUrl;
        previewContainer.appendChild(img);
        
        // 设置下载按钮
        const downloadBtn = document.getElementById('download-capture-btn');
        if (downloadBtn) {
            downloadBtn.onclick = () => {
                const link = document.createElement('a');
                link.href = imgUrl;
                link.download = `uwu_chat_${new Date().getTime()}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            };
        }

        document.getElementById('capture-result-modal').classList.add('visible');
        exitMultiSelectMode();
        
    } catch (error) {
        console.error('截图生成失败:', error);
        showToast('截图生成失败，请重试');
    } finally {
        document.body.removeChild(tempContainer);
    }
}

async function deleteSelectedMessages() {
    if (selectedMessageIds.size === 0) return;
    const deletedCount = selectedMessageIds.size;
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    chat.history = chat.history.filter(m => !selectedMessageIds.has(m.id));

    if (currentChatType === 'private') {
        recalculateChatStatus(chat);
    }

    await saveData();
    currentPage = 1;
    renderMessages(false, true);
    renderChatList();
    exitMultiSelectMode();
    showToast(`已删除 ${deletedCount} 条消息`);
}

async function withdrawMessage(messageId) {
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    if (!chat) return;

    const messageIndex = chat.history.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

    const message = chat.history[messageIndex];
    const messageTime = message.timestamp;
    const now = Date.now();

    if (now - messageTime > 2 * 60 * 1000) {
        showToast('超过2分钟的消息无法撤回');
        return;
    }

    message.isWithdrawn = true;

    const cleanContentMatch = message.content.match(/\[.*?的消息：([\s\S]+?)\]/);
    const cleanOriginalContent = cleanContentMatch ? cleanContentMatch[1] : message.content;
    message.originalContent = cleanOriginalContent; 

    const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;

    message.content = `[${myName} 撤回了一条消息：${cleanOriginalContent}]`;

    if (currentChatType === 'private') {
        recalculateChatStatus(chat);
    }

    await saveData();

    currentPage = 1;
    renderMessages(false, true);
    renderChatList();
    showToast('消息已撤回');
    triggerHapticFeedback('medium');
}

function openDeleteChunkModal() {
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    if (!chat || !chat.history || chat.history.length === 0) {
        showToast('当前没有聊天记录可管理');
        return;
    }
    const totalMessages = chat.history.length;
    const rangeInfo = document.getElementById('delete-chunk-range-info');
    rangeInfo.textContent = `当前聊天总消息数: ${totalMessages}`;
    
    // 计算并显示已隐藏的范围
    updateHiddenRangesInfo(chat);
    
    document.getElementById('delete-chunk-form').reset();
    document.getElementById('delete-chunk-preview-box').innerHTML = '<p style="color: #999; text-align: center; margin-top: 30px;">输入范围以预览内容</p>';
    
    document.getElementById('delete-chunk-modal').classList.add('visible');
}

function updateHiddenRangesInfo(chat) {
    const hiddenInfo = document.getElementById('delete-chunk-hidden-info');
    if (!hiddenInfo) return;

    if (!chat.history || chat.history.length === 0) {
        hiddenInfo.textContent = '';
        return;
    }

    const ranges = [];
    let start = -1;

    for (let i = 0; i < chat.history.length; i++) {
        const isHidden = chat.history[i].isContextDisabled;
        if (isHidden) {
            if (start === -1) start = i; // Start of a range
        } else {
            if (start !== -1) {
                // End of a range
                ranges.push(start === i - 1 ? `${start + 1}` : `${start + 1}-${i}`);
                start = -1;
            }
        }
    }
    // Handle case where range goes until the end
    if (start !== -1) {
        ranges.push(start === chat.history.length - 1 ? `${start + 1}` : `${start + 1}-${chat.history.length}`);
    }

    if (ranges.length > 0) {
        hiddenInfo.textContent = `当前已隐藏范围: ${ranges.join(', ')}`;
        hiddenInfo.style.display = 'block';
    } else {
        hiddenInfo.textContent = '';
        hiddenInfo.style.display = 'none';
    }
}

function generateRangePreview(chat, startIndex, endIndex) {
    const previewBox = document.getElementById('delete-chunk-preview-box');
    if (!previewBox) return;

    if (startIndex < 0 || endIndex > chat.history.length || startIndex >= endIndex) {
        previewBox.innerHTML = '<p style="color: #999; text-align: center; margin-top: 30px;">无效的范围</p>';
        return;
    }

    const messagesToPreview = chat.history.slice(startIndex, endIndex);
    const totalToPreview = messagesToPreview.length;
    let previewHtml = '';

    if (totalToPreview === 0) {
        previewBox.innerHTML = '<p style="color: #999; text-align: center; margin-top: 30px;">范围为空</p>';
        return;
    }

    const renderMsg = (msg) => {
        const contentMatch = msg.content.match(/\[.*?的消息：([\s\S]+)\]/);
        let text = contentMatch ? contentMatch[1] : msg.content;
        text = text.replace(/</g, '<').replace(/>/g, '>'); // Escape HTML
        const sender = msg.role === 'user' ? '我' : (chat.remarkName || chat.name || '对方');
        const status = msg.isContextDisabled ? ' <span style="color:red; font-size:10px;">(已隐藏)</span>' : '';
        return `<div style="margin-bottom:4px; padding-bottom:4px; border-bottom:1px solid #eee;">
            <span style="font-weight:600; color:#555;">${sender}</span>${status}: 
            <span style="color:#666;">${text.substring(0, 60)}${text.length > 60 ? '...' : ''}</span>
        </div>`;
    };

    if (totalToPreview <= 5) {
        previewHtml = messagesToPreview.map(renderMsg).join('');
    } else {
        const firstThree = messagesToPreview.slice(0, 3);
        const lastTwo = messagesToPreview.slice(-2);
        
        previewHtml = firstThree.map(renderMsg).join('') + 
                      `<div style="text-align: center; color: #999; margin: 8px 0; font-size: 10px;">... 共 ${totalToPreview} 条 ...</div>` + 
                      lastTwo.map(renderMsg).join('');
    }
    
    previewBox.innerHTML = previewHtml;
}

function setupDeleteHistoryChunk() {
    const deleteChunkModal = document.getElementById('delete-chunk-modal');
    const startInput = document.getElementById('delete-range-start');
    const endInput = document.getElementById('delete-range-end');
    
    // Real-time Preview Logic
    const updatePreview = () => {
        const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
        if (!chat) return;
        
        const s = parseInt(startInput.value);
        const e = parseInt(endInput.value);
        
        if (!isNaN(s) && !isNaN(e) && s > 0 && e >= s && e <= chat.history.length) {
            generateRangePreview(chat, s - 1, e);
        }
    };

    startInput.addEventListener('input', updatePreview);
    endInput.addEventListener('input', updatePreview);

    // Button Actions
    const btnBlock = document.getElementById('btn-block-range');
    const btnRestore = document.getElementById('btn-restore-range');
    const btnDelete = document.getElementById('btn-delete-range');
    
    const getRange = () => {
        const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
        const s = parseInt(startInput.value);
        const e = parseInt(endInput.value);
        if (!chat || isNaN(s) || isNaN(e) || s <= 0 || e < s || e > chat.history.length) {
            showToast('请输入有效的起止范围');
            return null;
        }
        return { chat, startIndex: s - 1, endIndex: e, count: e - s + 1 };
    };

    if (btnBlock) {
        btnBlock.addEventListener('click', async () => {
            const range = getRange();
            if (!range) return;
            
            let changedCount = 0;
            const modifiedIds = [];
            for (let i = range.startIndex; i < range.endIndex; i++) {
                if (!range.chat.history[i].isContextDisabled) {
                    range.chat.history[i].isContextDisabled = true;
                    modifiedIds.push(range.chat.history[i].id);
                    changedCount++;
                }
            }
            
            if (changedCount > 0) {
                await saveData();
                showToast(`已屏蔽 ${changedCount} 条消息`);
                // Update DOM in-place
                modifiedIds.forEach(id => {
                    const el = document.querySelector(`.message-wrapper[data-id="${id}"]`);
                    if (el) el.classList.add('context-disabled');
                });
                updateHiddenRangesInfo(range.chat);
                generateRangePreview(range.chat, range.startIndex, range.endIndex);
            } else {
                showToast('选中范围内没有需要屏蔽的消息');
            }
        });
    }

    if (btnRestore) {
        btnRestore.addEventListener('click', async () => {
            const range = getRange();
            if (!range) return;
            
            let changedCount = 0;
            const modifiedIds = [];
            for (let i = range.startIndex; i < range.endIndex; i++) {
                const msg = range.chat.history[i];
                // 检查是否为思维链消息 (isThinking 标记或内容以 <thinking> 开头)
                const isThinkingMsg = msg.isThinking || (msg.content && typeof msg.content === 'string' && msg.content.trim().startsWith('<thinking>'));
                
                if (msg.isContextDisabled && !isThinkingMsg) {
                    msg.isContextDisabled = false;
                    modifiedIds.push(msg.id);
                    changedCount++;
                }
            }
            
            if (changedCount > 0) {
                await saveData();
                showToast(`已恢复 ${changedCount} 条消息`);
                // Update DOM in-place
                modifiedIds.forEach(id => {
                    const el = document.querySelector(`.message-wrapper[data-id="${id}"]`);
                    if (el) el.classList.remove('context-disabled');
                });
                updateHiddenRangesInfo(range.chat);
                generateRangePreview(range.chat, range.startIndex, range.endIndex);
            } else {
                showToast('选中范围内没有被屏蔽的消息');
            }
        });
    }

    // Delete Logic (With Confirmation)
    const confirmDeleteModal = document.getElementById('delete-chunk-confirm-modal');
    const confirmDeleteBtn = document.getElementById('confirm-delete-chunk-btn');
    const cancelDeleteBtn = document.getElementById('cancel-delete-chunk-btn');
    
    let pendingDeleteRange = null;

    if (btnDelete) {
        btnDelete.addEventListener('click', () => {
            const range = getRange();
            if (range) {
                pendingDeleteRange = range;
                confirmDeleteModal.classList.add('visible');
            }
        });
    }

    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', async () => {
            if (!pendingDeleteRange) return;
            
            const { chat, startIndex, count } = pendingDeleteRange;
            chat.history.splice(startIndex, count);

            if (currentChatType === 'private') {
                recalculateChatStatus(chat);
            }

            await saveData();
            confirmDeleteModal.classList.remove('visible');
            deleteChunkModal.classList.remove('visible');
            showToast(`已永久删除 ${count} 条消息`);
            
            currentPage = 1;
            renderMessages(false, true);
            renderChatList();
            
            pendingDeleteRange = null;
        });
    }

    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', () => {
            confirmDeleteModal.classList.remove('visible');
            pendingDeleteRange = null;
        });
    }

    document.getElementById('close-delete-modal-btn').addEventListener('click', () => {
        deleteChunkModal.classList.remove('visible');
    });
}

// 重新计算并更新角色状态
function recalculateChatStatus(chat) {
    if (!chat || !chat.history) return;
    
    // 仅针对私聊且非群聊
    // 注意：虽然函数参数叫 chat，但在调用处需确保是 private 类型或者在这里判断
    // 由于群聊没有状态栏，这里主要针对 private
    // 但为了通用性，我们可以检查 chat.realName 是否存在
    
    if (!chat.realName) return; // 简单判断，群聊通常没有单人的 realName 用于状态更新（群聊逻辑不同）

    const updateStatusRegex = new RegExp(`\\[${chat.realName}更新状态为：(.*?)\\]`);
    let foundStatus = '在线'; // 默认状态

    // 倒序遍历历史记录
    for (let i = chat.history.length - 1; i >= 0; i--) {
        const msg = chat.history[i];
        // 忽略被撤回的消息
        if (msg.isWithdrawn) continue;

        const match = msg.content.match(updateStatusRegex);
        if (match) {
            foundStatus = match[1];
            break; // 找到最近的一个状态，停止遍历
        }
    }

    // 更新状态
    chat.status = foundStatus;
    
    // 如果当前正在该聊天室，实时更新 UI
    if (currentChatId === chat.id) {
        const statusTextEl = document.getElementById('chat-room-status-text');
        if (statusTextEl) {
            statusTextEl.textContent = foundStatus;
        }
    }
}
;
// --- 核心聊天逻辑 (js/chat.js) ---
// 此文件保留核心入口和胶水代码，具体功能已拆分至 js/modules/chat_*.js

// 全局函数：显示红包详情
window.showRedPacketDetails = function(message, chat) {
    const modal = document.getElementById('red-packet-details-modal');
    if (!modal) return;

    const amountElem = document.getElementById('red-packet-modal-amount');
    const infoElem = document.getElementById('red-packet-modal-info');
    const listElem = document.getElementById('red-packet-detail-list');

    // 设置金额
    let myAmount = 0;
    if (message.distributions && message.distributions['user_me']) {
        myAmount = message.distributions['user_me'];
    }
    amountElem.innerHTML = `${myAmount.toFixed(2)}<span>元</span>`;

    // 设置信息
    const totalCount = message.count || 1;
    const grabbedCount = message.distributions ? Object.keys(message.distributions).length : 0;
    infoElem.textContent = `共 ${totalCount} 个红包，已领取 ${grabbedCount}/${totalCount} 个`;

    // 渲染列表
    listElem.innerHTML = '';
    if (message.distributions) {
        // 找出运气王
        let maxAmount = 0;
        let luckyId = null;
        Object.entries(message.distributions).forEach(([id, amt]) => {
            if (amt > maxAmount) {
                maxAmount = amt;
                luckyId = id;
            }
        });

        Object.entries(message.distributions).forEach(([memId, amt]) => {
            let name = '未知成员';
            let avatar = 'data:image/jpeg;base64,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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQSACCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAQASSSQASSQACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASCCSSSAAAAAAAACSASSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAACCSAAAAAAAAAAAAAAAAAAAACCSACAAAAAAAAAAAAAAAAAAAACCACAQAAAAAAAAAAAAAAAAAAAAASCCCSAAAAAAAAAAAAAAAAASQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCAAAAAAAAAAAAAASQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACCAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQCAAAAAAAAAASQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASCAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAASAAAAAAAAAAAAAAQAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAQAAAAAAAAAAAAAQAAAAAAAAAAAACQAAAAAAAAAAAAAAQAAAAAASAAAAAAAAAAAAASAAAAAAAAAAAAASQAAAAAAAAAAAASQAAAAAACAAAAAAAAAAAAASAAAAAAAAAAAAAAQAAAAAAAAAAAACQAAAAAACAAAAAAAAAAAASAAAAAAAAAAAAAACQAAAAAAAAAAAASQAAAAAAAQAAAAAAAAAAACQAAAAAAAAAAAAAACAAAAAAAAAAACAAAAAAAAAAQAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAQAAAAAAAAAAAAAACQAAAAAAAAAAQAAAAAAAAACQAAAAAAAAACQAAAAAAAAAAAAAAACCAAAAAAAAACSAAAAAAAAAACAAAAAAAACQAAAAAAAAAAAAAAAAAQAAAAAAAASQSAAAAAAAAACCASAAAAAQCSAAAAAAAAAAAAAAAAAASAAAAAAACQSAAAAAAAAAQACAQCAAQQAAAAAAAAAAAAAAAAAAAAAAAQSQSCAASAAAAAAAAAAACQQCQCQCCAAAAAAAAAAAAAAAAAAACSAAQSSQAASAAAAAAAAASAAAAAQCSAAAAAAAAAAAAAAAAAAAAAACSASAAAAACAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAACSQSAAAAAAAAASAQAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAACQQAAAAAAAAAAQAASAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAACCASAAAAAAAACAASAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAACSQSQAAASAAAAQASSQAAAAAAAAACQAAAAAAAAAAQAAAAAAAAAAQQASAAAACQAAAQCSQAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAQACSAAACACAAASCSQAAAAAAAAAAQAAAAAAAAAAASAAAAAAAAAASSAAQACAQSAAASCCCAAAAAAAAAAQAAAAAAAAAAACAAAAAAAAAAAQACQACCSQAAACQSSAAAAAAAAACQAAAAAAAAAAAACCAAAAAAAAAAAAAAAQACQAAAAAAAAAAAAAAAQAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAACCAAAAAAAAAAAAAACAAAAAAAAAAAAAAAQSQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAASQQAAAAAAAAAAAAAAAAAAAAAAQCAAAAAAAAAAAAAAAAAAAAAACSQQAQAAAAAAAAAAAAAAAAACAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQAAAAAAAAAAAAAAACCCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASQAAAAAAAAAAAAAAAAQACAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAACASQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQCAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAACAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQCQAAAAAAAAAQACCASQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQSQQASAAQCACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACD/xAAUEQEAAAAAAAAAAAAAAAAAAADQ/9oACAEDAQE/EBxD/8QAFBEBAAAAAAAAAAAAAAAAAAAA0P/aAAgBAgEBPxAcQ//EAC0QAQABAwIEBQQDAQEBAAAAAAERACExQVFAYXGBkaGxwdEQMFBgIOHw8ZCw/9oACAEBAAE/EP8A4L055ZrY1cVDlOa0SM9Vj3Vo320Of5eVf5XxQ2A5h/WlsJzH+tf5XxX/AFXxRVujjRKyiTee9dc24VDiGf0+foyD66rFYEO4S7ZpVayAh6UTyO+VEDcDnkVhFS1i+rQkhwESpgik61FFqlqWpd6l3qWpal+iSJo5KRLmUJaNsu70NeaNe9RvMgvhW1mIr6alSEqO1REsN8qCoKgpI/QgVBdqMWq4fnNQaHrL42Kjy28HgfNGEZOYN5aIQIbFMNKCrVarVamOCJAA6CTwqUmHcPEinwtpYHZqRbvu/er3sT8wpQokJkqU1DUP5sW5bAJWkiR8vwMtDGcv9i1ESZzPE3puXZ6/gIplS1quyPEVLAaF52aTUgEzz5ZoJBFhCEac/lG2aejZzPpRYusuLxopDuZSOwVFsurPrUvC5H5qLxqZL7/hZrWomo7UiUWBbvU1RzkPvRFttJPZqOBXgS8GgZN3YfJpSHjMx60A4v0qCn8QsVNMhJaijxbVFqK+R4FRLtaJ92o2dNVfnRQbiD7PoMfUUfxg2qSjoE1CfWmJ24T8qDdjIn5pFRW3kn5pYEbnHjQT+FBbvVFjq6VHiOxLxbeE04A1NAAABgCAoBTZ/MpCG5s1JEPO+VRjuQYfBUi3pCz0cP4HM6wuw6uKPBPMJDy51hBIEB9ZqfzqpRsjJU43XD3KlFusb9JqOMG2IASrtTssRcXPV7FWOMBwH0LJ+hlwSEZGpctlS3d7NIXCEITitouvg3azGLfdDYqP0hkQBAr9HcppH1G4cmoeHHivJ9ORzoLx5cq3XWsVP6SR66BlbjvSg0sHgedRTnhGYi5L5Nqx68brqvNoYKWf0oYqLLe5zOdXTEQC3zGtOeDhqZuFr+6Va6Vb+nKlpv8AxFKEnFo8HCNVnbbj0qan9PktwgwyaezghNs5bGr4VASMnT9RM8gDzKym5c9ngYaTKebPl6/qZEQTXJc8vTgTlETWN8eUfqdrlotajfymgmoj7xlSAnW3vRAYKzkR+pkiSMu5FZCkRzGKy+9qLBXa/tSScJvH6nOQSmlCKALEc4fesvvSD/pKcPFzF/Wn2UmW770LZcoYY14k28hNl1oMfwzCNCJJh4wETVXwrL7wSGJE8KccXcOB3Dap71KxEO434m30ydQuUIbJG9TJJiNtSz6cZfDf46y+8KyBvdRPimxxd4ovn8D1rSJFWwu1YxY4kSQ3NStMgb0aVeT1fM4wDGQhegHzWX3kFydvJpAgIJqN+KYWAVdirGQTHTSrZf7vxbIvJng0adKTc1KYOQkeVYcSSyBU9CaVfN95tZffhbLsUY8o4pgoKUabKCqQAOdA5ADq6vFp3a456edQpuw6VMv1+aYcThYvHz5TVmMVl98EcBloceIvlxMJoytOlKmJ0NCp2WCCX5vGvEQMWtdGkbCrxqalPBbk5deJnCIMjfnyijNOfvvMaA0ag7m0NNR48REmUlDnZ2oPZXC7GrREwAONOSThp7ZXbcaNWfDSlxs78RHGphtTBT7HqWVeCKXhgfBPTR+hOFMr4QJwoSsym7vWO91nI0KcHHZe3rZGpUixKI52olYDJJw34cJyVgeyvTQ4QZw0Qg9zWnH0k4JHoia6/FNbdK1EULLGW9SIlnj0GuKAY3Aat+laRiu/JoXaNtt+OEzapvSy1T1aSMcIoTKBvQtj5WFL1BliilaXWJhWeBL2l9danoGmgbFXzLh59jlREAFgMH4EygEI6lIRq7e1qPqZ2TZoPCJzT+uBOX1sEtHFuEcKcqEU4jC0oU2QWsuEnAEkLIaeMUxpijl4UtBKl0PJo8qlYHlZ5m599bKckPV2KTOjjQNqLki39AqKgoA/Bl0FCNMQWW1cjXksE8miQWS446bn32KZCw96mjGDQNqsomDuulFirpCY8QuOzSzwhNzFzJgKMUOU0ISNGyZZdD7lCioiRLI0KTl2Pmg1/oHwptm32lAVYDK1tqj5w3aWq5GRq+QcEQ9HLnRtjABofhRxDQozUWXI7/1pgF0BvQ8LFD/BQpQrCfbIsPV/0pol7XT4tKyiVlc1Hi5DD+mjYhAGKtRHSaKFCRwZkyQnNYrER4KR9QHMPUphUl1uOopi6ulJQAyWTZoSOV0nzSgBarDwfmjwZmiFSQbprAJ0a7fRsS2KSaMwaABDC2pKEvyCm4IwAZo4nmIWOu/SgAAAWApz+GgEQRMNDLXFlZ6fFHVORhKfDuD2bVgkclyjIBxDFECS5ya6Gr7UJIG6hXmfCpS+N7zRREM2X2KTzfS2kkrLq61Lp3kH902MGoseRUG1RFGaBOUp1Io04YzmMcHALDX2P4Y+iWpyS8pphQuq8abQxckQe5UuArZtUd6VCyjyaFwB0df9FXmpJqA2KBL5jNFPiGyInxQgMhe4u9BH4gMUs0FuzFod6XAHVb+1PQ7QpQILUQYrYVf9jR6gOiqYknqLVmxV0RdWwUSSBExB51HJGt18UrJE5w+KCP4GfpBxAgdzg7B3AvVPtWH2IFeK6DQbC6IpaTqilkj4n1r/AJb4pKXknOgABhnCrQZsQpv+MM0w0yE2gkrMdwKWIex86/5P4oIUW0fimpeqKcGeYZPrXlYB9gzUlc2WXR/uo4ICzmPwP7qI/UM3y3Yn9VpwVkIn+ce1ZfqAtdT6nvWnBf426sv1A1hSOCAGxUy/UI5GF5z7cHNWvHcKy/UHH0Z7C8GN9cicoay/UOefTFGOC5ToTs/3WX6hfHJGcK6+HBojIDM8yfanx4nNRxG/qrQVrYBP61t2FZPE4doE5UDzpYHZG351JhP8g02zbrxLTmkQiORPvUvBas2jlN6EAIiSJxC6TbX+yHvgpcS5UM8V7QUoPXULzpoAZEeRTrCrBn7Nmj/uB2RkLc2HrVohYw3Hgzt/ZwbrRClInaEpYdZelSUdMnyya5cST5hV8JyTHiVkakhJ4o9ZqbqlrZdh7luIBkAJV2pjr9JFt5RwipM5rrZw96G0srYOr70k2zHoA0CnbOgMq4oZmgRezBd1nlQQAYMA7FCxK5aJfI4zuTqOjyincQC5HYDsTE+NMaMnA9WOtNJ0njzvE45XrJlIUakug1ecFC/WAvi370XZoRg9RpM5L4y8sBdEp2zoVkdml42ivMBqNNtEBG45eY8PATHddnpPC4Vhd3MlRw1qBBYRtPT1NDBQlgHAqB4g9qFr5+rFjE6JJ2JNYGtqU09RnQXsnAzIaOZNQ6Bp5vrRdylwIO4X65UdzQoBfNL3odagsyRpl8fRWvDDPQHYLHlPjwuB5w3NTwmiUBIbPDKwyEFtY9PpCaqBJOzySR60LBI3EJrJymaILti4PemxUgCVdKdv0iF1JaRYObNY6UklIA2lD6H2IbXbkAxd3mhADkgNx+xFNEvNLA96gS9DuMhA9C2hhO9CK4YFykIoGVgO9QqckIbisPOpXUAIJ5GgAHahgpAEsDUkvWhk4VPxBLypgJX2aHhw16iabc3Oz68KMI7M1nXH8ZHrT9CG6GdGnyq0AfBr/J6c6CCPoPUCziJheq/YGsGCkJzohwSwA1iof5zpLG1C9QoxTcwNTLR8J51yUSJ5tEDhYwfXPg7QZfSpm5wobAPoMHd9KhSRwslrKw11HhV61xwrp4olhRfqQ9modqBWjfyNKEt3BsaUvgBBdBBYbQuv1sa9Og1XIL1i5Id2vc3/AIj/AF0UKPmIwhOoU4O72U9DV5VOIBSZRy0VYGrAY7vhTgZuI5O1bAdTAzYoF46M/wASxuE7Oj2Ye1NsRU4Gg5JDTj6AKsYsCyWVmO1DMOyISXC5a41fWDp9IxCtKUW6C0cuEimHsVZ/wGBoVPDDFDARZbovdwpSpnabI6I4aSjUimPkvlTiiGLBhSwWyliSjegQpL5TVYPCpUDlG8bO6wHWiOmF4b15r0pI/iBUG56nxUvxKAp8mpr7qyajC2zd8U2try/w1CYcyqh5zDD0gqaEks5KY7fyRFoWGV8TpNXBjbDfAnSpVCNcaRTCaJLyacFOGSsgwkklrtBT/oJvMcvIoeYR6pdV1eFMb2lmug7cQZoVCMJhNKgsDedGz3pZOENCUBETmNJlF5hO+3hFbdROPeGju8F72o4MMpL0u86ClJEAPXfvUD/JlQBykRLYi9QESsou1NTNWM8gvVhLgQuZ17fYepOlB0nHao57znQi48aQbElvKa2UuY80qI+GqORt60MEIFAGwUkcIYE2GvMe1NMVOVy8TNNRZIf7FFHCyR1FRTniJ/m8OQ6ep/VRH1bwxXJtLOQP7pI/AOrwvLPwpLCy4wZ+kQhGiFoyt8DTl4+MEQ+Z/U/wvoS6G9LKjC1lvfyrLjoXSaTAUhNx+eVMvGUStWp4wMqbsyM/J3FGvOVyPTjkmloBAZVz5c6gcNIBS5VwZLS2305caa9ZVAFT2GyWHY2Kzff8Ak0GXfdnTZpgLWNnTepON352rn2K30ragKyjx+jHGLFEEfhLuu1TnLrf5Gs/g0sFEiQjUEg7YOpv61EE64Dqfm5ryJM+gVJphyP4pwpEqsq0W/DHF2FhrqRRHwafCC3km9D3/K73g3qCdIl1jFMlzxO4ehShrlJaj8UYpTNJl5BoMDNX5jypUEXVg8qZhPZHwNBMCblT+McixRXa7nwJp5Au/qFDop1p+FimrP0PAV5fjRj6Oipta1EGadFE3AoSBOWvjUMe5H1KuYJjSl0FugeNEmQxG1jl+ClgRkY0wCGZRKWC26A9aW5HPpil3kYHnS8u85puy5/Npv4cCkc+1QfASyrqr+BGEwDorRKURUCWZ59/oQZ+jn86JsVF01btQ/goLEr9L+6nP581qWwpHOWDyPwYHpKB4w+v15mdS8qMJOqCkRhIfzbQJxEN4k+/4MWIul8Wv7Vg6ULMGxFLuh74oe5EI8Rdaks3HI3mjoi8Vo2UM/mvQq0/9w/Bxv491SKIU/o7/NBRMAwB9QPkVjs2qNWDS3h/NBIlO1hXq4eUfgxd4klz5TQsxbHkY8V/g1kPfYqx8KeJmnP5oTItKY0vZQyCMjc/AqF1gMrUKplTxPhTAXOc5n+DJ4VagL60NOfzWVN9IhLwbcnOhj3hJHvx4QMhQHVq+EWDJqcnP6FBhtgBv13oGFzc+hV7haA70AASQl4n84MfQddbZrs0Yf5+RRUii5KHcpK11GfqoQZq9is8nJmodnwq5m1DPAZxSITFN4gc2KPbPmRT0JZhtnap6C9H1oYAbEh4FPVhgWHYoI+o0SWc3gavC46wkp6g5yeGKVWVl/QYNqxXnFhXk9opsnuSq4S9ah478PtRhN1D7UGet8Ff5r2psRNoPSgZfZr/AIDX/AadA9U+9MoP/Wa/5ul6DpQNmdPipZgOQfFLlTLeOp+WOfzV5qSag2qBNqNLf+0YTRfSHWhdFQkyU2f2CEZxUltCpNwxPtTXmc5pDFj9hAQNq5ih7r6f/9k=';
            
            if (memId === 'user_me') {
                name = chat.me ? chat.me.nickname : '我';
                avatar = chat.me ? chat.me.avatar : 'data:image/jpeg;base64,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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJIAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIJIJAAJAAAABBAIAIJBIAAAAAAAAAAAAAAAAAAAAAAAAAAAAABIAAAAABBIAABAAAAABJIAAAAAAAAAAAAAAAAAAAAAAAAAAAAIIAAAAAAAABBIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABIAAAAAAAABJIAAAAAAAAABIIAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAABAAAAAAAAAAABBAAAAAAAAAAAAAAAAAAAAAAAAJAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAIAAAAAAAAAAABIAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAABAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAIIAAAAAAAAAAAAAJAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAIIAAAAAAAAAAAAABIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIIAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAJAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAJAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAABIAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAABIAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJAAAAAAAAAAAAAAAIAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAIAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAABIAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAABJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABJAAAAAAAAAAAAAAABIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJBAAAAAAAAAAAAAABIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAABIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAABAAAAAAAAAAAAABIAAAAAAAAAAJBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBJBIAAAAAAAAAJJJAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAABIIBJAAAAAAAAAIBABAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAIAIBJAAAAAAAAJIJIJAAAAAAAAAAAIAAAAAAAABIAAAAAAAAAAJBBBJAAAAIAAAIABJAAAAAAAAAAABAAAAAAAAAAJAAAAAAAAAABIAJAAAABIAAABJAIBAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAABAAAABBJAAAIBBAIAAAAAAAAAAIAAAAAAAAAAIIAAAAAAAAAABBBIAAIJIJAABAIJJAAAAAAAAABAAAAAAAAAAAAIIAAAAAAAAABJIAAAAIBBAAAIAAIAAAAAAAAAIIAAAAAAAAAAAAIIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJIIAAAAAAAAAAAAAAAIJAAAAAAAAAAAAABBAAAAAAAAAAAAAABBAIAAAAAAAAAAAAAABIAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABIAAAAAAAAAAAAAAAAAJAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAJBJAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAABIIAAAAAAAAAAAAAAAAAAAAAABIAABIAAAAAAAAAAAAAAAABJJJJIAAAAAAAAAAAAAAAAAAAAAAAAABJBAAAAAAAAAAAAAAAAABJIAAAAAAAAAAAAAAAAAAAAAAAAAABJIIAAAAAAAAAAAAAAAAAJIJAAAAAAAAAAAAAAAAAAAAAAAAAAJJIBAAAAAAAAAAAAAAAAAJIIAAAAAAAAAAAAAAAAAAAAAAAAAAAAJAAAAAAAAAAAAAAAAAABJBAAAAAAAAAAAAAAAAAAAAAAAAAAJBIBAAAAAAAAAAAAAAAAABIIAAAAAAAAAAAAAAAAAAAAAAAAAABBJJAAAAAAAAAAAAAAAABBIBAAAAAAAAAAAAAAAAAAAAAAAAAAABJAIAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAIAABAAAAAAAAAAIIAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAABIAAAJIBBAIBJIIAAJJIBIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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';
            } else {
                const member = chat.members ? chat.members.find(m => m.id === memId) : null;
                if (member) {
                    name = member.groupNickname;
                    avatar = member.avatar;
                }
            }
            
            const isLucky = memId === luckyId;
            const timeStr = new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

            const itemDiv = document.createElement('div');
            itemDiv.className = 'red-packet-detail-item';
            itemDiv.innerHTML = `
                <div class="red-packet-detail-user">
                    <img src="${avatar}" class="red-packet-detail-avatar">
                    <div class="red-packet-detail-name-time">
                        <span class="red-packet-detail-name">${name}</span>
                        <span class="red-packet-detail-time">${timeStr}</span>
                    </div>
                </div>
                <div class="red-packet-detail-amount-box">
                    <span class="red-packet-detail-amount">${amt.toFixed(2)}元</span>
                    ${isLucky ? '<span class="red-packet-detail-luck"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>运气王</span>' : ''}
                </div>
            `;
            listElem.appendChild(itemDiv);
        });
    }

    modal.classList.add('visible');
};

function setupChatRoom() {
    // 重新获取 DOM 元素，因为它们可能是动态注入的
    chatRoomScreen = document.getElementById('chat-room-screen');
    chatExpansionPanel = document.getElementById('chat-expansion-panel');
    panelFunctionArea = document.getElementById('panel-function-area');
    panelStickerArea = document.getElementById('panel-sticker-area');
    messageArea = document.getElementById('message-area');
    chatRoomHeaderDefault = document.getElementById('chat-room-header-default');
    chatRoomHeaderSelect = document.getElementById('chat-room-header-select');
    multiSelectBar = document.getElementById('multi-select-bar');
    multiSelectTitle = document.getElementById('multi-select-title');
    selectCount = document.getElementById('select-count');
    deleteSelectedBtn = document.getElementById('delete-selected-btn');
    chatRoomTitle = document.getElementById('chat-room-title');
    chatRoomStatusText = document.getElementById('chat-room-status-text');
    typingIndicator = document.getElementById('typing-indicator');
    messageInput = document.getElementById('message-input');
    getReplyBtn = document.getElementById('get-reply-btn');
    regenerateBtn = document.getElementById('regenerate-btn');

    const memoryJournalBtn = document.getElementById('memory-journal-btn');
    document.getElementById('long-term-memory-btn').addEventListener('click', () => {
        if (currentChatType === 'private') {
            showPanel('none');
            memoryManagement.open(currentChatId, 'chat-room-screen');
        }
    });
    const deleteHistoryBtn = document.getElementById('delete-history-btn');
    const captureBtn = document.getElementById('capture-btn');
    const toggleExpansionBtn = document.getElementById('toggle-expansion-btn');
    const charStatusBtn = document.getElementById('char-status-btn');
    const statusOverlay = document.getElementById('char-status-overlay');
    const closeStatusBtn = document.getElementById('close-status-panel-btn');
    const statusContent = document.getElementById('char-status-content');

    if (charStatusBtn) {
        charStatusBtn.addEventListener('click', () => {
            const char = db.characters.find(c => c.id === currentChatId);
            if (!char || !char.statusPanel) return;

            statusContent.innerHTML = ''; // Clear previous content

            // Prepare data: combine history and current if needed
            let slidesData = [];
            if (char.statusPanel.history && char.statusPanel.history.length > 0) {
                // history is [newest, older, oldest...]
                // We want to display newest last (on the right), so history is on the left
                slidesData = [...char.statusPanel.history].reverse();
            } else if (char.statusPanel.currentStatusHtml) {
                slidesData = [{ html: char.statusPanel.currentStatusHtml, timestamp: Date.now() }];
            }

            if (slidesData.length === 0) {
                statusContent.innerHTML = '<p style="text-align:center; color:#999;">暂无状态信息</p>';
                statusOverlay.classList.add('visible');
                return;
            }

            // Build Swiper Structure
            const swiper = document.createElement('div');
            swiper.className = 'status-swiper';

            // Helper function for Lazy Loading
            const loadSlideContent = (index) => {
                if (index < 0 || index >= slidesData.length) return;
                const slide = swiper.children[index];
                if (!slide) return;
                const slideInner = slide.querySelector('.status-slide-inner');
                if (slideInner.hasChildNodes()) return; // Already loaded

                const item = slidesData[index];
                const htmlContent = item.html;
                if (htmlContent.includes('<!DOCTYPE html>') || htmlContent.includes('<html') || htmlContent.includes('<style')) {
                    const iframe = document.createElement('iframe');
                    iframe.style.cssText = "width: 100%; height: 100%; min-height: 80vh; border: none; background: transparent; display: block;";
                    iframe.srcdoc = processTemplate(htmlContent, char);
                    slideInner.appendChild(iframe);
                } else {
                    slideInner.innerHTML = processTemplate(htmlContent, char);
                }
            };

            // Create empty slides first
            slidesData.forEach((item, index) => {
                const slide = document.createElement('div');
                slide.className = 'status-slide';
                
                const slideInner = document.createElement('div');
                slideInner.className = 'status-slide-inner';
                // Content will be loaded lazily
                
                slide.appendChild(slideInner);
                swiper.appendChild(slide);
            });

            // Indicator
            const indicator = document.createElement('div');
            indicator.className = 'status-indicator';
            indicator.textContent = `${slidesData.length} / ${slidesData.length}`;

            statusContent.appendChild(swiper);
            statusContent.appendChild(indicator);

            // Initial Load: Load the last slide (newest) and previous ones
            const lastIndex = slidesData.length - 1;
            loadSlideContent(lastIndex);
            if (lastIndex > 0) loadSlideContent(lastIndex - 1);
            if (lastIndex > 1) loadSlideContent(lastIndex - 2);

            // Scroll to the end (newest) initially
            setTimeout(() => {
                swiper.style.scrollBehavior = 'auto';
                swiper.scrollLeft = swiper.scrollWidth;
                setTimeout(() => {
                    swiper.style.scrollBehavior = 'smooth';
                }, 50);
            }, 0);

            // Scroll Listener for Indicator & Lazy Loading
            swiper.addEventListener('scroll', () => {
                const width = swiper.offsetWidth;
                if (width > 0) {
                    const currentIndex = Math.round(swiper.scrollLeft / width);
                    indicator.textContent = `${currentIndex + 1} / ${slidesData.length}`;
                    
                    // Lazy load adjacent slides (current +/- 2)
                    for (let i = currentIndex - 2; i <= currentIndex + 2; i++) {
                        loadSlideContent(i);
                    }
                }
            });

            statusOverlay.classList.add('visible');
        });
    }

    if (closeStatusBtn) {
        closeStatusBtn.addEventListener('click', () => {
            statusOverlay.classList.remove('visible');
        });
    }
    
    if (statusOverlay) {
        statusOverlay.addEventListener('click', (e) => {
            if (e.target === statusOverlay) {
                statusOverlay.classList.remove('visible');
            }
        });
    }

    // 状态栏交互事件委托
    if (statusContent) {
        statusContent.addEventListener('click', (e) => {
            const target = e.target.closest('[data-send-msg]');
            if (target) {
                const msg = target.dataset.sendMsg;
                if (msg) {
                    const input = document.getElementById('message-input');
                    if (input) {
                        input.value = msg;
                        document.getElementById('send-message-btn').click();
                        // 关闭状态栏面板
                        statusOverlay.classList.remove('visible');
                    }
                }
            }
        });
    }

    if (toggleExpansionBtn) {
        toggleExpansionBtn.addEventListener('click', () => {
            if (chatExpansionPanel.classList.contains('visible') && panelFunctionArea.style.display !== 'none') {
                showPanel('none');
            } else {
                showPanel('function');
            }
        });
    }

    if (memoryJournalBtn) {
        memoryJournalBtn.addEventListener('click', () => {
            renderJournalList();
            switchScreen('memory-journal-screen');
            showPanel('none'); 
        });
    }

    if (deleteHistoryBtn) {
        deleteHistoryBtn.addEventListener('click', () => {
            openDeleteChunkModal();
            showPanel('none'); 
        });
    }

    if (captureBtn) {
        captureBtn.addEventListener('click', () => {
            enterMultiSelectMode(null, 'capture');
            showPanel('none');
        });
    }

    const shopBtn = document.getElementById('shop-btn');
    if (shopBtn) {
        shopBtn.addEventListener('click', () => {
            if (typeof openShopScreen === 'function') {
                openShopScreen();
                showPanel('none');
            } else {
                showToast('商城模块未加载');
            }
        });
    }

    const videoCallBtn = document.getElementById('video-call-btn');
    if (videoCallBtn) {
        videoCallBtn.addEventListener('click', () => {
            if (window.VideoCallModule) {
                window.VideoCallModule.showCallTypeModal();
                showPanel('none');
            } else {
                showToast('视频通话模块未加载');
            }
        });
    }

    const charGalleryManageBtn = document.getElementById('char-gallery-manage-btn');
    if (charGalleryManageBtn) {
        charGalleryManageBtn.addEventListener('click', () => {
            if (typeof openGalleryManager === 'function') {
                openGalleryManager();
                showPanel('none');
            } else {
                showToast('相册功能未加载');
            }
        });
    }

    const redPacketBtn = document.getElementById('red-packet-btn');
    if (redPacketBtn) {
        redPacketBtn.addEventListener('click', () => {
            if (currentChatType !== 'group') {
                showToast('红包功能仅限群聊使用');
                return;
            }
            document.getElementById('send-red-packet-form').reset();
            document.getElementById('send-red-packet-modal').classList.add('visible');
            showPanel('none');
        });
    }

    const closeRedPacketDetailsBtn = document.getElementById('close-red-packet-details-btn');
    if (closeRedPacketDetailsBtn) {
        closeRedPacketDetailsBtn.addEventListener('click', () => {
            document.getElementById('red-packet-details-modal').classList.remove('visible');
        });
    }

    document.getElementById('send-message-btn').addEventListener('click', sendMessage);
    document.getElementById('send-message-btn').addEventListener('touchend', (e) => {
        e.preventDefault();
        sendMessage();
        setTimeout(() => {
            messageInput.focus();
        }, 50);
    });
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !isGenerating) sendMessage();
    });

    // 监听输入框聚焦事件：自动收起底部面板，避免与键盘冲突
    messageInput.addEventListener('focus', () => {
        if (chatExpansionPanel.classList.contains('visible')) {
            // 立即禁用动画，防止键盘弹出时面板被顶起
            chatExpansionPanel.classList.add('no-transition');
            showPanel('none');
            // 恢复动画属性
            setTimeout(() => {
                chatExpansionPanel.classList.remove('no-transition');
            }, 100);
        }
    });

    getReplyBtn.addEventListener('click', () => getAiReply(currentChatId, currentChatType));
    regenerateBtn.addEventListener('click', handleRegenerate);
    const regenerateCasualBtn = document.getElementById('regenerate-casual-btn');
    if (regenerateCasualBtn) {
        regenerateCasualBtn.addEventListener('click', async () => {
            window.__uwuCasualRegenOnce = true;
            try {
                await handleRegenerate();
            } finally {
                window.__uwuCasualRegenOnce = false;
            }
        });
    }
    
    messageArea.addEventListener('click', (e) => {
        if (isDebugMode) {
            const messageWrapper = e.target.closest('.message-wrapper');
            if (messageWrapper) {
                startDebugEdit(messageWrapper.dataset.id);
                return; 
            }
        }

        if (chatExpansionPanel.classList.contains('visible')) {
            showPanel('none');
            return;
        }

        if (e.target && e.target.id === 'load-more-btn') {
            loadMoreMessages();
        } else if (isInMultiSelectMode) {
            const messageWrapper = e.target.closest('.message-wrapper');
            if (messageWrapper) {
                toggleMessageSelection(messageWrapper.dataset.id);
            }
        } else {
            const voiceBubble = e.target.closest('.voice-bubble');
            if (voiceBubble) {
                const transcript = voiceBubble.closest('.message-wrapper').querySelector('.voice-transcript');
                if (transcript) {
                    transcript.classList.toggle('active');
                }
            }
            
            const bilingualBubble = e.target.closest('.bilingual-bubble');
            if (bilingualBubble) {
                const translationText = bilingualBubble.closest('.message-wrapper').querySelector('.translation-text');
                if (translationText) {
                    translationText.classList.toggle('active');
                }
            }

            const pvCard = e.target.closest('.pv-card');
            if (pvCard) {
                const imageOverlay = pvCard.querySelector('.pv-card-image-overlay');
                const footer = pvCard.querySelector('.pv-card-footer');
                imageOverlay.classList.toggle('hidden');
                footer.classList.toggle('hidden');
            }
            const giftCard = e.target.closest('.gift-card');
            if (giftCard) {
                const description = giftCard.closest('.message-wrapper').querySelector('.gift-card-description');
                if (description) {
                    description.classList.toggle('active');
                }
            }
            const transferCard = e.target.closest('.transfer-card.received-transfer');
            if (transferCard && currentChatType === 'private') {
                const messageWrapper = transferCard.closest('.message-wrapper');
                const messageId = messageWrapper.dataset.id;
                const character = db.characters.find(c => c.id === currentChatId);
                const message = character.history.find(m => m.id === messageId);
                if (message && message.transferStatus === 'pending') {
                    handleReceivedTransferClick(messageId);
                }
            }
        }
    });
    
    messageArea.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (e.target.id === 'load-more-btn' || isInMultiSelectMode) return;
        const messageWrapper = e.target.closest('.message-wrapper');
        if (!messageWrapper) return;
        handleMessageLongPress(messageWrapper, e.clientX, e.clientY);
    });
    messageArea.addEventListener('touchstart', (e) => {
        if (e.target.id === 'load-more-btn') return;
        const messageWrapper = e.target.closest('.message-wrapper');
        if (!messageWrapper) return;
        longPressTimer = setTimeout(() => {
            const touch = e.touches[0];
            handleMessageLongPress(messageWrapper, touch.clientX, touch.clientY);
        }, 400);
    });
    messageArea.addEventListener('touchend', () => clearTimeout(longPressTimer));
    messageArea.addEventListener('touchmove', () => clearTimeout(longPressTimer));
    
    const messageEditForm = document.getElementById('message-edit-form');
    if(messageEditForm) {
        messageEditForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveMessageEdit();
        });
    }

    const cancelEditModalBtn = document.getElementById('cancel-edit-modal-btn');
    if(cancelEditModalBtn) {
        cancelEditModalBtn.addEventListener('click', cancelMessageEdit);
    }

    const hideTimestampBtn = document.getElementById('hide-timestamp-btn');
    if (hideTimestampBtn) {
        hideTimestampBtn.addEventListener('click', () => {
            if (!editingMessageId) return;
            
            const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
            const messageIndex = chat.history.findIndex(m => m.id === editingMessageId);
            
            let targetTime;
            if (messageIndex > 0) {
                const prevMsg = chat.history[messageIndex - 1];
                targetTime = prevMsg.timestamp + 60000; 
            } else {
                targetTime = Date.now(); 
            }
            
            const date = new Date(targetTime);
            const Y = date.getFullYear();
            const M = String(date.getMonth() + 1).padStart(2, '0');
            const D = String(date.getDate()).padStart(2, '0');
            const h = String(date.getHours()).padStart(2, '0');
            const m = String(date.getMinutes()).padStart(2, '0');
            
            const timestampInput = document.getElementById('message-edit-timestamp');
            if (timestampInput) {
                timestampInput.value = `${Y}-${M}-${D}T${h}:${m}`;
            }
        });
    }

    document.getElementById('cancel-multi-select-btn').addEventListener('click', exitMultiSelectMode);
    document.getElementById('delete-selected-btn').addEventListener('click', deleteSelectedMessages);
    document.getElementById('generate-capture-btn').addEventListener('click', generateCapture);
    document.getElementById('close-capture-modal-btn').addEventListener('click', () => {
        document.getElementById('capture-result-modal').classList.remove('visible');
    });
    document.getElementById('cancel-reply-btn').addEventListener('click', cancelQuoteReply);
}

const chatComposerDrafts = new Map();
let activeComposerKey;

function switchChatComposer(chat, type) {
    const key = JSON.stringify([type, chat.id, chat.activeArchiveId]);
    if (activeComposerKey === key) return;
    if (activeComposerKey && (messageInput.value || currentQuoteInfo)) {
        chatComposerDrafts.set(activeComposerKey, { text: messageInput.value, quote: currentQuoteInfo });
    }
    activeComposerKey = key;
    const draft = chatComposerDrafts.get(key);
    chatComposerDrafts.delete(key);
    messageInput.value = draft?.text || '';
    cancelQuoteReply();
    if (draft?.quote && chat.history?.some(message => message.id === draft.quote.id)) {
        currentQuoteInfo = draft.quote;
        const preview = document.getElementById('reply-preview-bar');
        preview.querySelector('.reply-preview-name').textContent = `回复 ${currentQuoteInfo.senderName}`;
        preview.querySelector('.reply-preview-text').textContent = currentQuoteInfo.content;
        preview.classList.add('visible');
    }
}

function openChatRoom(chatId, type) {
    const chat = (type === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
    if (!chat) return;

    // 迁移旧的私聊数据 (仅群聊)
    if (type === 'group' && chat.privateSessions && typeof migratePrivateSessionsToHistory === 'function') {
        migratePrivateSessionsToHistory(chat);
        saveData(); // 迁移后立即保存
    }

    if (chat.unreadCount && chat.unreadCount > 0) {
        chat.unreadCount = 0;
        saveData();
        renderChatList(); 
    }
    switchChatComposer(chat, type);
    exitMultiSelectMode();
    cancelMessageEdit();
    chatRoomTitle.textContent = (type === 'private') ? chat.remarkName : chat.name;
    const subtitle = document.getElementById('chat-room-subtitle');
    if (type === 'private') {
        subtitle.style.display = (chat.showStatus !== false) ? 'flex' : 'none';
        chatRoomStatusText.textContent = chat.status || '在线';
    } else {
        subtitle.style.display = 'none';
    }
    getReplyBtn.style.display = 'inline-flex';
    chatRoomScreen.style.backgroundImage = chat.chatBg ? `url(${chat.chatBg})` : 'none';
    typingIndicator.style.display = 'none';
    isGenerating = false;
    getReplyBtn.disabled = false;
    currentPage = 1;
    chatRoomScreen.className = chatRoomScreen.className.replace(/\bchat-active-[^ ]+\b/g, '');
    chatRoomScreen.classList.add(`chat-active-${chatId}`);
    
    const avatarRadius = chat.avatarRadius !== undefined ? chat.avatarRadius : 50;
    document.documentElement.style.setProperty('--chat-avatar-radius', `${avatarRadius}%`);

    if (chat.bubbleBlurEnabled === false) {
        chatRoomScreen.classList.add('disable-blur');
    } else {
        chatRoomScreen.classList.remove('disable-blur');
    }

    if (chat.showTimestamp) {
        chatRoomScreen.classList.add('show-timestamp');
    } else {
        chatRoomScreen.classList.remove('show-timestamp');
    }
    chatRoomScreen.classList.remove('timestamp-side');

    chatRoomScreen.classList.remove('timestamp-style-bubble', 'timestamp-style-avatar');
    chatRoomScreen.classList.add(`timestamp-style-${chat.timestampStyle || 'bubble'}`);

    const header = document.getElementById('chat-room-header-default');
    if (chat.titleLayout === 'center') {
        header.classList.add('title-centered');
    } else {
        header.classList.remove('title-centered');
    }

    document.getElementById('long-term-memory-btn').hidden = type !== 'private';
    const journalBtnLabel = document.querySelector('#memory-journal-btn .expansion-item-name');
    if (journalBtnLabel) {
        journalBtnLabel.textContent = (type === 'group') ? '总结' : '日记';
    }

    const starBtn = document.getElementById('char-status-btn');
    if (starBtn) {
        if (type === 'private' && chat.statusPanel && chat.statusPanel.enabled) {
            starBtn.style.display = 'flex';
        } else {
            starBtn.style.display = 'none';
        }
    }

    const redPacketBtn = document.getElementById('red-packet-btn');
    if (redPacketBtn) {
        redPacketBtn.style.display = (type === 'group') ? 'flex' : 'none';
    }

    const peekBtn = document.getElementById('peek-btn');
    if (peekBtn) {
        if (type === 'private') {
            peekBtn.style.display = 'flex';
            peekBtn.classList.remove('has-unread');
            const badge = document.getElementById('gossip-badge');
            if (badge) badge.style.display = 'none';
        } else {
            // 群聊
            if (chat.allowGossip) {
                peekBtn.style.display = 'flex';
                // 检查未读
                const hasUnread = Object.values(gossipUnreadMap || {}).some(count => count > 0);
                const badge = document.getElementById('gossip-badge');
                if (hasUnread) {
                    peekBtn.classList.add('has-unread');
                    if (badge) badge.style.display = 'block';
                } else {
                    peekBtn.classList.remove('has-unread');
                    if (badge) badge.style.display = 'none';
                }
            } else {
                peekBtn.style.display = 'none';
            }
        }
    }

    updateCustomBubbleStyle(chatId, chat.customBubbleCss, chat.useCustomBubbleCss);
    renderMessages(false, true);
    switchScreen('chat-room-screen');
    
    requestAnimationFrame(() => {
        void document.body.offsetHeight; 
    });
}

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || isGenerating) return;
    messageInput.value = ''; 
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);

    if (!chat) return;
    if (!chat.history) chat.history = [];

    if (db.apiSettings && db.apiSettings.timePerceptionEnabled) {
        const now = new Date();
        const lastMessageTime = chat.lastUserMessageTimestamp;
        if (lastMessageTime) {
            const timeGap = now.getTime() - lastMessageTime;
            const thirtyMinutes = 30 * 60 * 1000; 

            if (timeGap > thirtyMinutes) {
                const displayContent = `[system-display:距离上次聊天已经过去 ${formatTimeGap(timeGap)}]`;
                const visualMessage = {
                    id: `msg_visual_timesense_${Date.now()}`,
                    role: 'system',
                    content: displayContent,
                    parts: [],
                    timestamp: now.getTime() - 2 
                };

                if (currentChatType === 'group') {
                    visualMessage.senderId = 'user_me';
                }

                chat.history.push(visualMessage);
                addMessageBubble(visualMessage, currentChatId, currentChatType);
            }
        }
        chat.lastUserMessageTimestamp = now.getTime();
    }

    let messageContent;
    const systemRegex = /\[system:.*?\]|\[system-display:.*?\]/;
    const inviteRegex = /\[.*?邀请.*?加入群聊\]/;
    const renameRegex = /\[(.*?)修改群名为“(.*?)”\]/;
    const shopOrderRegex = /\[.*?为你下单的商品：.*?\]/;
    const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;

    if (renameRegex.test(text)) {
        const match = text.match(renameRegex);
        chat.name = match[2];
        chatRoomTitle.textContent = chat.name;
        messageContent = `[${chat.me.nickname}修改群名为“${chat.name}”]`;
    } else if (systemRegex.test(text) || inviteRegex.test(text) || shopOrderRegex.test(text)) {
        messageContent = text;
    } else {
        let userText = text;
        messageContent = `[${myName}的消息：${userText}]`;
    }

    const message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: messageContent,
        parts: [{type: 'text', text: messageContent}],
        timestamp: Date.now()
    };

    if (currentQuoteInfo) {
        message.quote = {
            messageId: currentQuoteInfo.id,
            senderId: currentQuoteInfo.senderId, 
            content: currentQuoteInfo.content
        };
    }

    if (currentChatType === 'group') {
        message.senderId = 'user_me';
    }
    chat.history.push(message);
    addMessageBubble(message, currentChatId, currentChatType);
    if (currentQuoteInfo) cancelQuoteReply();
    triggerHapticFeedback('success');

    if (chat.history.length > 0 && chat.history.length % 300 === 0) {
        promptForBackupIfNeeded('history_milestone');
    }

    await saveData();
    renderChatList();
}

// 备份提示
function promptForBackupIfNeeded(triggerType) {
    if (triggerType === 'history_milestone') {
        showToast('uwu提醒您：记得备份噢');
    }
}