// === Chat Settings, API/Lively, Presets/Global CSS, Stickers, WorldBook ===
// --- 聊天设置与管理逻辑 ---

function setupChatSettings() {
    if (typeof injectChatSettingsHtml === 'function') {
        injectChatSettingsHtml();
    }
    for (const field of ['nationality', 'residence']) {
        walletProfiles.fillRegion(document.getElementById('setting-char-' + field));
    }

    const themeSelect = document.getElementById('setting-theme-color');
    themeSelect.innerHTML = '';
    Object.keys(colorThemes).forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = colorThemes[key].name;
        themeSelect.appendChild(option);
    });
    
    document.getElementById('chat-settings-btn').addEventListener('click', () => {
        if (currentChatType === 'private') {
            loadSettingsToSidebar();
            switchScreen('chat-settings-screen');
        } else if (currentChatType === 'group') {
            loadGroupSettingsToSidebar();
            switchScreen('group-settings-screen');
        }
    });

    const moreSettingsBtn = document.getElementById('more-settings-btn');
    if (moreSettingsBtn) {
        moreSettingsBtn.addEventListener('click', () => {
            switchScreen('api-settings-screen');
        });
    }
    
    document.querySelector('.phone-screen').addEventListener('click', e => {
        const openSidebar = document.querySelector('.settings-sidebar.open');
        if (openSidebar && !openSidebar.contains(e.target) && !e.target.closest('.action-btn') && !e.target.closest('.modal-overlay') && !e.target.closest('.action-sheet-overlay')) {
            openSidebar.classList.remove('open');
        }
    });

    document.getElementById('chat-settings-memory').addEventListener('click', () => memoryManagement.open(currentChatId));
    document.getElementById('chat-settings-card-export').addEventListener('click', () => {
        const character = db.characters.find(item => item.id === currentChatId);
        if (character) showCharacterCardExport(character);
    });

    document.getElementById('chat-settings-form').addEventListener('submit', e => {
        e.preventDefault();
        saveSettingsFromSidebar();
    });

    // --- Tab 切换逻辑 ---
    // 仅选择聊天设置和群聊设置中的 Tab，排除 CoT 设置
    const tabs = document.querySelectorAll('#chat-settings-screen .settings-tab-item, #group-settings-screen .settings-tab-item');
    const contents = document.querySelectorAll('.settings-tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // 移除所有 active 类
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));

            // 添加当前 active 类
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-tab');
            if (targetId) {
                const targetEl = document.getElementById(targetId);
                if (targetEl) targetEl.classList.add('active');
            }
        });
    });
    
    const useCustomCssCheckbox = document.getElementById('setting-use-custom-css'),
        customCssTextarea = document.getElementById('setting-custom-bubble-css'),
        resetCustomCssBtn = document.getElementById('reset-custom-bubble-css-btn'),
        privatePreviewBox = document.getElementById('private-bubble-css-preview');

    // 初始化私聊 CSS 搜索替换工具栏
    initTextareaSearchReplace('private-css-toolbar', 'setting-custom-bubble-css');
        
    useCustomCssCheckbox.addEventListener('change', (e) => {
        triggerHapticFeedback('light');
        customCssTextarea.disabled = !e.target.checked;
        const char = db.characters.find(c => c.id === currentChatId);
        if (char) {
            const themeKey = char.theme || 'white_pink';
            const theme = colorThemes[themeKey];
            updateBubbleCssPreview(privatePreviewBox, customCssTextarea.value, !e.target.checked, theme);
        }
    });
    
    customCssTextarea.addEventListener('input', (e) => {
        const char = db.characters.find(c => c.id === currentChatId);
        if (char && useCustomCssCheckbox.checked) {
            const themeKey = char.theme || 'white_pink';
            const theme = colorThemes[themeKey];
            updateBubbleCssPreview(privatePreviewBox, e.target.value, false, theme);
        }
    });
    
    resetCustomCssBtn.addEventListener('click', () => {
        const char = db.characters.find(c => c.id === currentChatId);
        if (char) {
            customCssTextarea.value = '';
            useCustomCssCheckbox.checked = false;
            customCssTextarea.disabled = true;
            const themeKey = char.theme || 'white_pink';
            const theme = colorThemes[themeKey];
            updateBubbleCssPreview(privatePreviewBox, '', true, theme);
            showToast('样式已重置为默认');
        }
    });
    
    document.getElementById('setting-char-avatar-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, {quality: 0.8, maxWidth: 400, maxHeight: 400});
                document.getElementById('setting-char-avatar-preview').src = compressedUrl;
            } catch (error) {
                showToast('头像压缩失败，请重试');
            }
        }
    });
    
    document.getElementById('setting-my-avatar-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, {quality: 0.8, maxWidth: 400, maxHeight: 400});
                document.getElementById('setting-my-avatar-preview').src = compressedUrl;
            } catch (error) {
                showToast('头像压缩失败，请重试');
            }
        }
    });
    
    document.getElementById('setting-chat-bg-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const char = db.characters.find(c => c.id === currentChatId);
            if (char) {
                try {
                    const compressedUrl = await compressImage(file, {
                        quality: 0.85,
                        maxWidth: 1080,
                        maxHeight: 1920
                    });
                    char.chatBg = compressedUrl;
                    chatRoomScreen.style.backgroundImage = `url(${compressedUrl})`;
                    await saveData();
                    showToast('聊天背景已更换');
                } catch (error) {
                    showToast('背景压缩失败，请重试');
                }
            }
        }
    });

    const resetChatBgBtn = document.getElementById('reset-chat-bg-btn');
    if (resetChatBgBtn) {
        resetChatBgBtn.addEventListener('click', async () => {
            const char = db.characters.find(c => c.id === currentChatId);
            if (char) {
                char.chatBg = '';
                const chatRoomScreen = document.getElementById('chat-room-screen');
                if (chatRoomScreen) chatRoomScreen.style.backgroundImage = '';
                await saveData();
                showToast('聊天背景已恢复默认');
            }
        });
    }
    
    document.getElementById('clear-chat-history-btn').addEventListener('click', async () => {
        const character = db.characters.find(c => c.id === currentChatId);
        if (!character) return;
        if (confirm(`你确定要清空与“${character.remarkName}”的所有聊天记录吗？这个操作是不可恢复的！`)) {
            character.history = [];
            character.status = '在线'; 
            await saveData();
            renderMessages(false, true);
            renderChatList();
            if (currentChatId === character.id) {
                document.getElementById('chat-room-status-text').textContent = '在线';
            }
            showToast('聊天记录已清空');
        }
    });
    
    document.getElementById('link-world-book-btn').addEventListener('click', () => {
        const character = db.characters.find(c => c.id === currentChatId);
        if (!character) return;
        openWorldBookSelector(character.worldBookIds || []);
    });

    document.getElementById('link-group-world-book-btn').addEventListener('click', () => {
        const group = db.groups.find(g => g.id === currentChatId);
        if (!group) return;
        openWorldBookSelector(group.worldBookIds || []);
    });

    document.getElementById('save-world-book-selection-btn').addEventListener('click', async () => {
        const selectedIds = Array.from(tempSelectedWbIds);
        if (currentChatType === 'private') {
            const character = db.characters.find(c => c.id === currentChatId);
            if (character) character.worldBookIds = selectedIds;
            renderBoundWorldBooks('private', character.worldBookIds);
        } else if (currentChatType === 'group') {
            const group = db.groups.find(g => g.id === currentChatId);
            if (group) group.worldBookIds = selectedIds;
            renderBoundWorldBooks('group', group.worldBookIds);
        }
        await saveData();
        closeWorldBookSelector();
        showToast('世界书关联已更新');
    });

    const replyCountSwitch = document.getElementById('setting-reply-count-enabled');
    if (replyCountSwitch) {
        replyCountSwitch.addEventListener('change', (e) => {
            triggerHapticFeedback('light');
            const container = document.getElementById('setting-reply-count-container');
            if (container) {
                container.style.display = e.target.checked ? 'flex' : 'none';
            }
        });
    }

    // 专属模型开关逻辑 (私聊)
    const exclusiveApiSwitch = document.getElementById('setting-exclusive-api-enabled');
    if (exclusiveApiSwitch) {
        exclusiveApiSwitch.addEventListener('change', (e) => {
            triggerHapticFeedback('light');
            const container = document.getElementById('setting-exclusive-api-container');
            if (container) {
                container.style.display = e.target.checked ? 'flex' : 'none';
            }
        });
    }

    // 专属模型开关逻辑 (群聊)
    const groupExclusiveApiSwitch = document.getElementById('setting-group-exclusive-api-enabled');
    if (groupExclusiveApiSwitch) {
        groupExclusiveApiSwitch.addEventListener('change', (e) => {
            triggerHapticFeedback('light');
            const container = document.getElementById('setting-group-exclusive-api-container');
            if (container) {
                container.style.display = e.target.checked ? 'flex' : 'none';
            }
        });
    }

    // --- Feature Control Center Logic ---
    const featureCards = document.querySelectorAll('.feature-card');
    featureCards.forEach(card => {
        const checkbox = card.querySelector('input[type="checkbox"]');
        const featureId = card.dataset.feature;
        
        // Handle card click to toggle checkbox
        card.addEventListener('click', (e) => {
            // Prevent double toggling if clicking directly on the switch
            if (e.target.tagName !== 'INPUT' && !e.target.classList.contains('kkt-slider')) {
                checkbox.checked = !checkbox.checked;
                // Manually dispatch change event
                checkbox.dispatchEvent(new Event('change'));
            }
        });

        // Handle checkbox change
        checkbox.addEventListener('change', (e) => {
            triggerHapticFeedback('light');
            const isChecked = e.target.checked;
            
            // Update card visual state
            if (isChecked) {
                card.classList.add('is-on');
            } else {
                card.classList.remove('is-on');
            }

            // Handle specific feature panels
            if (featureId === 'status') {
                const panel = document.getElementById('status-panel-settings-container');
                if (panel) {
                    if (isChecked) {
                        panel.classList.add('open');
                    } else {
                        panel.classList.remove('open');
                    }
                }
            } else if (featureId === 'auto-reply') {
                const panel = document.getElementById('auto-reply-settings-container');
                if (panel) {
                    if (isChecked) {
                        panel.classList.add('open');
                    } else {
                        panel.classList.remove('open');
                    }
                }
            }
        });
    });
}

function renderBoundWorldBooks(type, worldBookIds) {
    const wrapperId = type === 'private' ? 'private-bound-worldbooks-wrapper' : 'group-bound-worldbooks-wrapper';
    const toggleId = type === 'private' ? 'private-bound-worldbooks-toggle' : 'group-bound-worldbooks-toggle';
    const containerId = type === 'private' ? 'private-bound-worldbooks-container' : 'group-bound-worldbooks-container';
    const listId = type === 'private' ? 'private-bound-worldbooks-list' : 'group-bound-worldbooks-list';
    const countId = type === 'private' ? 'private-bound-count' : 'group-bound-count';
    
    const wrapper = document.getElementById(wrapperId);
    const toggle = document.getElementById(toggleId);
    const container = document.getElementById(containerId);
    const list = document.getElementById(listId);
    const countSpan = document.getElementById(countId);
    
    if (!wrapper || !list) return;

    if (!worldBookIds || worldBookIds.length === 0) {
        wrapper.style.display = 'none';
        return;
    }

    wrapper.style.display = 'block';
    if (countSpan) countSpan.textContent = worldBookIds.length;
    list.innerHTML = '';

    // 绑定折叠/展开事件 (确保只绑定一次)
    if (toggle && !toggle.dataset.bound) {
        toggle.dataset.bound = 'true';
        toggle.addEventListener('click', () => {
            const isHidden = container.style.display === 'none';
            container.style.display = isHidden ? 'block' : 'none';
            const svg = toggle.querySelector('svg');
            if (svg) {
                svg.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
            }
        });
    }

    worldBookIds.forEach(id => {
        const wb = db.worldBooks.find(b => b.id === id);
        if (wb) {
            const card = document.createElement('div');
            // 使用内联样式实现下划线、紧凑、灰色文字
            card.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid #eee; font-size: 13px; color: #666;';
            card.innerHTML = `
                <span style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${wb.name}</span>
                <button class="bound-wb-unbind-btn" data-id="${id}" style="background: none; border: none; color: #999; font-size: 12px; padding: 2px 6px; cursor: pointer;">解绑</button>
            `;
            
            card.querySelector('.bound-wb-unbind-btn').addEventListener('click', async (e) => {
                e.preventDefault();
                const targetId = e.target.dataset.id;
                if (type === 'private') {
                    const char = db.characters.find(c => c.id === currentChatId);
                    if (char) {
                        char.worldBookIds = char.worldBookIds.filter(i => i !== targetId);
                        renderBoundWorldBooks('private', char.worldBookIds);
                    }
                } else {
                    const group = db.groups.find(g => g.id === currentChatId);
                    if (group) {
                        group.worldBookIds = group.worldBookIds.filter(i => i !== targetId);
                        renderBoundWorldBooks('group', group.worldBookIds);
                    }
                }
                await saveData();
                showToast('已解绑世界书');
            });
            
            list.appendChild(card);
        }
    });
}

function loadSettingsToSidebar() {
    const e = db.characters.find(e => e.id === currentChatId);
    if (e) {
        document.getElementById('setting-char-avatar-preview').src = e.avatar;
        renderBoundWorldBooks('private', e.worldBookIds || []);
        const nameDisplay = document.getElementById('setting-char-name-display');
        if(nameDisplay) nameDisplay.textContent = e.remarkName;
        document.getElementById('setting-char-realname').value = e.realName || '';
        document.getElementById('setting-char-remark').value = e.remarkName;
        document.getElementById('setting-char-persona').value = e.persona;
        const region = walletProfiles.profile(e);
        document.getElementById('setting-char-nationality').value = region.nation;
        document.getElementById('setting-char-residence').value = region.region;
        
        const stickerGroupsContainer = document.getElementById('setting-char-sticker-groups-container');
        stickerGroupsContainer.innerHTML = '';
        
        const allGroups = [...new Set(db.myStickers.map(s => s.group || '未分类'))].filter(g => g);
        const charGroups = (e.stickerGroups || '').split(/[,，]/).map(s => s.trim());

        if (allGroups.length === 0) {
            stickerGroupsContainer.innerHTML = '<span style="color:#999; font-size:12px;">暂无表情包分组，请先在表情包管理中添加。</span>';
        } else {
            allGroups.forEach(group => {
                const tag = document.createElement('div');
                tag.className = 'sticker-group-tag';
                if (charGroups.includes(group)) {
                    tag.classList.add('selected');
                }
                tag.textContent = group;
                tag.dataset.group = group;
                
                tag.addEventListener('click', () => {
                    tag.classList.toggle('selected');
                });
                
                stickerGroupsContainer.appendChild(tag);
            });
        }
        
        document.getElementById('setting-my-avatar-preview').src = e.myAvatar;
        document.getElementById('setting-my-name').value = e.myName;
        document.getElementById('setting-my-remark-name').value = e.myRemarkName || '';
        document.getElementById('setting-my-persona').value = e.myPersona;
        document.getElementById('setting-theme-color').value = e.theme || 'white_pink';
        document.getElementById('setting-max-memory').value = e.maxMemory;
        
        document.getElementById('setting-reply-count-enabled').checked = e.replyCountEnabled || false;
        const replyCountContainer = document.getElementById('setting-reply-count-container');
        if (replyCountContainer) {
            replyCountContainer.style.display = e.replyCountEnabled ? 'flex' : 'none';
        }
        document.getElementById('setting-reply-count-min').value = e.replyCountMin || 3;
        document.getElementById('setting-reply-count-max').value = e.replyCountMax || 8;

        // 专属模型
        const exclusiveApiSwitch = document.getElementById('setting-exclusive-api-enabled');
        const exclusiveApiContainer = document.getElementById('setting-exclusive-api-container');
        const exclusiveApiPresetSelect = document.getElementById('setting-exclusive-api-preset-select');
        
        if (exclusiveApiSwitch && exclusiveApiContainer && exclusiveApiPresetSelect) {
            exclusiveApiSwitch.checked = e.exclusiveApiEnabled || false;
            exclusiveApiContainer.style.display = e.exclusiveApiEnabled ? 'flex' : 'none';
            
            // 填充预设列表
            exclusiveApiPresetSelect.innerHTML = '<option value="">请选择预设</option>';
            const presets = db.apiPresets || [];
            presets.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.name;
                opt.textContent = p.name;
                exclusiveApiPresetSelect.appendChild(opt);
            });
            
            exclusiveApiPresetSelect.value = e.exclusiveApiPreset || '';
        }

        // 专属提示词版本
        const exclusivePromptVersionSelect = document.getElementById('setting-exclusive-prompt-version');
        if (exclusivePromptVersionSelect) {
            exclusivePromptVersionSelect.value = e.exclusivePromptVersion || '';
        }

        // 专属思维链预设
        const exclusiveCotPresetSelect = document.getElementById('setting-exclusive-cot-preset');
        if (exclusiveCotPresetSelect) {
            exclusiveCotPresetSelect.innerHTML = '<option value="">跟随全局</option>';
            if (db.cotPresets && db.cotPresets.length > 0) {
                db.cotPresets.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    exclusiveCotPresetSelect.appendChild(opt);
                });
            }
            exclusiveCotPresetSelect.value = e.exclusiveCotPreset || '';
        }

        // 专属绘图提示词预设
        const exclusiveWorkshopPresetSelect = document.getElementById('setting-exclusive-workshop-preset');
        if (exclusiveWorkshopPresetSelect) {
            exclusiveWorkshopPresetSelect.innerHTML = '<option value="">跟随全局</option>';
            if (db.workshopPromptPresets && db.workshopPromptPresets.length > 0) {
                db.workshopPromptPresets.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    exclusiveWorkshopPresetSelect.appendChild(opt);
                });
            }
            exclusiveWorkshopPresetSelect.value = e.exclusiveWorkshopPromptPreset || '';
        }

        document.getElementById('setting-bilingual-mode').checked = e.bilingualModeEnabled || false;
        document.getElementById('setting-bilingual-style').value = e.bilingualBubbleStyle || 'under';
        
        document.getElementById('setting-avatar-mode').value = e.avatarMode || 'full';
        const avatarRadius = e.avatarRadius !== undefined ? e.avatarRadius : 50;
        document.getElementById('setting-avatar-radius').value = avatarRadius;
        document.getElementById('setting-avatar-radius-value').textContent = `${avatarRadius}%`;
        
        const radiusSlider = document.getElementById('setting-avatar-radius');
        const radiusValue = document.getElementById('setting-avatar-radius-value');
        radiusSlider.oninput = () => {
            radiusValue.textContent = `${radiusSlider.value}%`;
        };

        document.getElementById('setting-bubble-blur').checked = e.bubbleBlurEnabled !== false; 

        document.getElementById('setting-title-layout').value = e.titleLayout || 'left';
        document.getElementById('setting-show-timestamp').checked = e.showTimestamp || false;
        document.getElementById('setting-timestamp-style').value = e.timestampStyle || 'bubble';
        document.getElementById('setting-show-status').checked = e.showStatus !== false;
        document.getElementById('setting-show-status-update-msg').checked = e.showStatusUpdateMsg || false;

        const sp = e.statusPanel || {};
        const statusCheckbox = document.getElementById('setting-status-panel-enabled');
        statusCheckbox.checked = sp.enabled || false;
        document.getElementById('setting-status-prompt-suffix').value = sp.promptSuffix || '';
        document.getElementById('setting-status-regex').value = sp.regexPattern || '';
        document.getElementById('setting-status-replace').value = sp.replacePattern || '';
        document.getElementById('setting-status-history-limit').value = sp.historyLimit !== undefined ? sp.historyLimit : 3;
        
        // Trigger change to update card UI and panel
        statusCheckbox.dispatchEvent(new Event('change'));

        const shopCheckbox = document.getElementById('setting-shop-interaction-enabled');
        shopCheckbox.checked = e.shopInteractionEnabled !== false;
        shopCheckbox.dispatchEvent(new Event('change'));

        const momentsCheckbox = document.getElementById('setting-moments-enabled');
        momentsCheckbox.checked = e.momentsEnabled !== false;
        momentsCheckbox.dispatchEvent(new Event('change'));

        const callCheckbox = document.getElementById('setting-video-call-enabled');
        callCheckbox.checked = e.videoCallEnabled || false;
        callCheckbox.dispatchEvent(new Event('change'));

        const ar = e.autoReply || {};
        const autoReplyCheckbox = document.getElementById('setting-auto-reply-enabled');
        autoReplyCheckbox.checked = ar.enabled || false;
        document.getElementById('setting-auto-reply-interval').value = ar.interval || 60;
        autoReplyCheckbox.dispatchEvent(new Event('change'));

        const autoAirdropCheckbox = document.getElementById('setting-auto-airdrop-enabled');
        if (autoAirdropCheckbox) {
            autoAirdropCheckbox.checked = e.autoAirDropEnabled || false;
            autoAirdropCheckbox.dispatchEvent(new Event('change'));
        }

        const galleryCheckbox = document.getElementById('setting-use-real-gallery');
        galleryCheckbox.checked = e.useRealGallery || false;
        galleryCheckbox.dispatchEvent(new Event('change'));

        const useCustomCssCheckbox = document.getElementById('setting-use-custom-css'),
            customCssTextarea = document.getElementById('setting-custom-bubble-css'),
            privatePreviewBox = document.getElementById('private-bubble-css-preview');
        useCustomCssCheckbox.checked = e.useCustomBubbleCss || false;
        customCssTextarea.value = e.customBubbleCss || '';
        customCssTextarea.disabled = !useCustomCssCheckbox.checked;
        const theme = colorThemes[e.theme || 'white_pink'];
        updateBubbleCssPreview(privatePreviewBox, e.customBubbleCss, !e.useCustomBubbleCss, theme);
        populateBubblePresetSelect('bubble-preset-select');
        populateMyPersonaSelect();
        if (typeof populateStatusBarPresetSelect === 'function') {
            populateStatusBarPresetSelect();
        }
    }
}

/**
 * 初始化文本框搜索替换工具栏
 * @param {string} toolbarId 工具栏容器 ID
 * @param {string} textareaId 目标文本框 ID
 */
function initTextareaSearchReplace(toolbarId, textareaId) {
    const toolbar = document.getElementById(toolbarId);
    const textarea = document.getElementById(textareaId);
    if (!toolbar || !textarea) return;

    const toggleBtn = toolbar.querySelector('.toolbar-toggle-btn');
    const mainBox = toolbar.querySelector('.toolbar-main-box');
    const searchInput = toolbar.querySelector('.toolbar-search-input');
    const matchCountSpan = toolbar.querySelector('.toolbar-match-count');
    const prevBtn = toolbar.querySelector('.toolbar-prev-btn');
    const nextBtn = toolbar.querySelector('.toolbar-next-btn');
    const expandReplaceBtn = toolbar.querySelector('.toolbar-expand-replace-btn');
    const replaceRow = toolbar.querySelector('.toolbar-replace-row');
    const replaceInput = toolbar.querySelector('.toolbar-replace-input');
    const replaceBtn = toolbar.querySelector('.toolbar-replace-btn');
    const replaceAllBtn = toolbar.querySelector('.toolbar-replace-all-btn');

    let matches = [];
    let currentMatchIndex = -1;

    // 1. 折叠/展开逻辑
    toggleBtn.addEventListener('click', () => {
        const isHidden = mainBox.style.display === 'none';
        mainBox.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) {
            searchInput.focus();
            performSearch();
        }
    });

    expandReplaceBtn.addEventListener('click', () => {
        const isHidden = replaceRow.style.display === 'none';
        replaceRow.style.display = isHidden ? 'flex' : 'none';
        expandReplaceBtn.classList.toggle('open', isHidden);
        if (isHidden) replaceInput.focus();
    });

    // 2. 搜索逻辑
    function performSearch() {
        const query = searchInput.value;
        const content = textarea.value;
        matches = [];
        currentMatchIndex = -1;

        if (query) {
            let pos = content.indexOf(query);
            while (pos !== -1) {
                matches.push(pos);
                pos = content.indexOf(query, pos + 1);
            }
        }

        updateUI();
    }

    function updateUI() {
        if (matches.length > 0) {
            if (currentMatchIndex === -1) currentMatchIndex = 0;
            matchCountSpan.textContent = `${currentMatchIndex + 1}/${matches.length}`;
        } else {
            matchCountSpan.textContent = `0/0`;
        }
    }

    function scrollToMatch() {
        if (currentMatchIndex >= 0 && currentMatchIndex < matches.length) {
            const start = matches[currentMatchIndex];
            const end = start + searchInput.value.length;
            textarea.focus();
            textarea.setSelectionRange(start, end);
            
            // 简单的滚动定位：计算大概位置
            const lineHeight = 20; // 估算行高
            const textBefore = textarea.value.substring(0, start);
            const linesBefore = textBefore.split('\n').length;
            textarea.scrollTop = (linesBefore - 2) * lineHeight;
            
            updateUI();
        }
    }

    searchInput.addEventListener('input', performSearch);

    prevBtn.addEventListener('click', () => {
        if (matches.length === 0) return;
        currentMatchIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
        scrollToMatch();
    });

    nextBtn.addEventListener('click', () => {
        if (matches.length === 0) return;
        currentMatchIndex = (currentMatchIndex + 1) % matches.length;
        scrollToMatch();
    });

    // 3. 替换逻辑
    replaceBtn.addEventListener('click', () => {
        if (currentMatchIndex === -1 || matches.length === 0) return;
        
        const query = searchInput.value;
        const replacement = replaceInput.value;
        const start = matches[currentMatchIndex];
        const end = start + query.length;
        
        const content = textarea.value;
        textarea.value = content.substring(0, start) + replacement + content.substring(end);
        
        // 触发 input 事件以更新预览
        textarea.dispatchEvent(new Event('input'));
        
        performSearch(); // 重新搜索
        if (matches.length > 0) {
            currentMatchIndex = Math.min(currentMatchIndex, matches.length - 1);
            scrollToMatch();
        }
        triggerHapticFeedback('light');
    });

    replaceAllBtn.addEventListener('click', () => {
        const query = searchInput.value;
        if (!query) return;
        
        const replacement = replaceInput.value;
        const content = textarea.value;
        const newContent = content.split(query).join(replacement);
        
        if (content === newContent) {
            showToast('未找到匹配内容');
            return;
        }
        
        textarea.value = newContent;
        textarea.dispatchEvent(new Event('input'));
        performSearch();
        showToast('全部替换完成');
        triggerHapticFeedback('medium');
    });

    // 监听文本框手动修改
    textarea.addEventListener('input', () => {
        if (mainBox.style.display !== 'none') {
            performSearch();
        }
    });
}

async function saveSettingsFromSidebar() {
    const e = db.characters.find(e => e.id === currentChatId);
    if (e) {
        e.avatar = document.getElementById('setting-char-avatar-preview').src;
        
        const oldRealName = e.realName;
        const newRealName = document.getElementById('setting-char-realname').value.trim();
        
        if (oldRealName && newRealName && oldRealName !== newRealName) {
            // 清洗历史记录中的旧真名
            const nameRegex = new RegExp(oldRealName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            if (e.history && e.history.length > 0) {
                e.history.forEach(msg => {
                    if (msg.content) {
                        msg.content = msg.content.replace(nameRegex, newRealName);
                    }
                });
            }
            e.realName = newRealName;
            showToast(`真名已从“${oldRealName}”修改为“${newRealName}”，历史记录已同步清洗`);
        } else if (newRealName) {
            e.realName = newRealName;
        }

        e.remarkName = document.getElementById('setting-char-remark').value;
        e.persona = document.getElementById('setting-char-persona').value;
        e.nationality = walletProfiles.place(document.getElementById('setting-char-nationality').value);
        e.residence = walletProfiles.place(document.getElementById('setting-char-residence').value);
        
        const selectedGroups = Array.from(document.querySelectorAll('#setting-char-sticker-groups-container .sticker-group-tag.selected'))
            .map(tag => tag.dataset.group)
            .join(',');
        e.stickerGroups = selectedGroups;

        e.myAvatar = document.getElementById('setting-my-avatar-preview').src;
        e.myName = document.getElementById('setting-my-name').value;
        e.myRemarkName = document.getElementById('setting-my-remark-name').value.trim();
        e.myPersona = document.getElementById('setting-my-persona').value;
        e.theme = document.getElementById('setting-theme-color').value;
        e.maxMemory = document.getElementById('setting-max-memory').value;
        e.replyCountEnabled = document.getElementById('setting-reply-count-enabled').checked;
        e.replyCountMin = parseInt(document.getElementById('setting-reply-count-min').value, 10) || 3;
        e.replyCountMax = parseInt(document.getElementById('setting-reply-count-max').value, 10) || 8;
        
        const exclusiveApiSwitch = document.getElementById('setting-exclusive-api-enabled');
        if (exclusiveApiSwitch) {
            e.exclusiveApiEnabled = exclusiveApiSwitch.checked;
            e.exclusiveApiPreset = document.getElementById('setting-exclusive-api-preset-select').value;
        }

        const exclusivePromptVersionSelect = document.getElementById('setting-exclusive-prompt-version');
        if (exclusivePromptVersionSelect) {
            e.exclusivePromptVersion = exclusivePromptVersionSelect.value;
        }

        const exclusiveCotPresetSelect = document.getElementById('setting-exclusive-cot-preset');
        if (exclusiveCotPresetSelect) {
            e.exclusiveCotPreset = exclusiveCotPresetSelect.value;
        }

        const exclusiveWorkshopPresetSelect = document.getElementById('setting-exclusive-workshop-preset');
        if (exclusiveWorkshopPresetSelect) {
            e.exclusiveWorkshopPromptPreset = exclusiveWorkshopPresetSelect.value;
        }

        e.useCustomBubbleCss = document.getElementById('setting-use-custom-css').checked;
        e.customBubbleCss = document.getElementById('setting-custom-bubble-css').value;
        e.bilingualModeEnabled = document.getElementById('setting-bilingual-mode').checked;
        e.bilingualBubbleStyle = document.getElementById('setting-bilingual-style').value;
        
        e.avatarMode = document.getElementById('setting-avatar-mode').value;
        e.avatarRadius = parseInt(document.getElementById('setting-avatar-radius').value, 10);

        e.bubbleBlurEnabled = document.getElementById('setting-bubble-blur').checked;
        const chatScreen = document.getElementById('chat-room-screen');
        if (e.bubbleBlurEnabled) {
            chatScreen.classList.remove('disable-blur');
        } else {
            chatScreen.classList.add('disable-blur');
        }

        e.titleLayout = document.getElementById('setting-title-layout').value;
        const header = document.getElementById('chat-room-header-default');
        if (e.titleLayout === 'center') {
            header.classList.add('title-centered');
        } else {
            header.classList.remove('title-centered');
        }

        e.showTimestamp = document.getElementById('setting-show-timestamp').checked;
        
        if (e.showTimestamp) {
            chatScreen.classList.add('show-timestamp');
        } else {
            chatScreen.classList.remove('show-timestamp');
        }
        chatScreen.classList.remove('timestamp-side');

        e.timestampStyle = document.getElementById('setting-timestamp-style').value;
        chatScreen.classList.remove('timestamp-style-bubble', 'timestamp-style-avatar');
        chatScreen.classList.add(`timestamp-style-${e.timestampStyle || 'bubble'}`);

        e.showStatus = document.getElementById('setting-show-status').checked;
        const subtitle = document.getElementById('chat-room-subtitle');
        if (subtitle) {
            subtitle.style.display = e.showStatus ? 'flex' : 'none';
        }

        e.showStatusUpdateMsg = document.getElementById('setting-show-status-update-msg').checked;

        if (!e.statusPanel) e.statusPanel = {};
        e.statusPanel.enabled = document.getElementById('setting-status-panel-enabled').checked;
        e.statusPanel.promptSuffix = document.getElementById('setting-status-prompt-suffix').value;
        e.statusPanel.regexPattern = document.getElementById('setting-status-regex').value;
        e.statusPanel.replacePattern = document.getElementById('setting-status-replace').value;
        const historyLimitInput = parseInt(document.getElementById('setting-status-history-limit').value, 10);
        e.statusPanel.historyLimit = isNaN(historyLimitInput) ? 3 : historyLimitInput;

        e.shopInteractionEnabled = document.getElementById('setting-shop-interaction-enabled').checked;

        e.momentsEnabled = document.getElementById('setting-moments-enabled').checked;

        e.videoCallEnabled = document.getElementById('setting-video-call-enabled').checked;

        if (!e.autoReply) e.autoReply = {};
        e.autoReply.enabled = document.getElementById('setting-auto-reply-enabled').checked;
        const autoReplyIntervalInput = parseInt(document.getElementById('setting-auto-reply-interval').value, 10);
        e.autoReply.interval = isNaN(autoReplyIntervalInput) ? 60 : autoReplyIntervalInput;

        const autoAirdropCheckbox = document.getElementById('setting-auto-airdrop-enabled');
        if (autoAirdropCheckbox) {
            e.autoAirDropEnabled = autoAirdropCheckbox.checked;
        }

        e.useRealGallery = document.getElementById('setting-use-real-gallery').checked;

        await saveData();
        showToast('设置已保存！');
        chatRoomTitle.textContent = e.remarkName;
        renderChatList();
        // updateCustomBubbleStyle(currentChatId, e.customBubbleCss, e.useCustomBubbleCss); // 移除实时应用以防污染设置页
        currentPage = 1;
        renderMessages(false, true);
    }
}

// 备份提示
function promptForBackupIfNeeded(triggerType) {
    if (triggerType === 'history_milestone') {
        showToast('uwu提醒您：记得备份噢');
    }
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
// --- 跨平台持续运行增强 ---
// 浏览器仍可能被系统挂起；本模块负责提高存活率，并在恢复后补跑全局任务。
(function () {
    const HEARTBEAT_INTERVAL_MS = 15000;
    const RESUME_GAP_MS = 20000;
    const CHECKPOINT_KEY = 'uwu_keep_alive_checkpoint';

    let enabled = false;
    let audio = null;
    let audioUrl = '';
    let wakeLock = null;
    let heartbeatTimer = null;
    let lastHeartbeatAt = Date.now();
    let hiddenAt = 0;
    let gestureHandler = null;
    let listenersBound = false;
    let recoveryRunning = false;

    function getStatusElement() {
        return document.getElementById('keep-alive-status');
    }

    function setStatus(text, state) {
        const element = getStatusElement();
        if (!element) return;
        element.textContent = text;
        element.dataset.state = state || '';
    }

    // 生成低频、极低振幅的长音频。volume=0 的静音音频不会获得 Chrome 后台调度豁免。
    function createLowImpactWavUrl() {
        const sampleRate = 8000;
        const durationSeconds = 8;
        const sampleCount = sampleRate * durationSeconds;
        const buffer = new ArrayBuffer(44 + sampleCount * 2);
        const view = new DataView(buffer);

        function writeString(offset, value) {
            for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
        }

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + sampleCount * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, sampleCount * 2, true);

        for (let i = 0; i < sampleCount; i++) {
            // 55Hz 通常低于手机扬声器的有效频段，但数据并非全静音。
            const fade = Math.min(1, i / 160, (sampleCount - i) / 160);
            const sample = Math.round(Math.sin(2 * Math.PI * 55 * i / sampleRate) * 96 * fade);
            view.setInt16(44 + i * 2, sample, true);
        }

        return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    }

    function ensureAudio() {
        if (audio) return audio;
        audioUrl = createLowImpactWavUrl();
        audio = new Audio(audioUrl);
        audio.loop = true;
        audio.preload = 'auto';
        audio.volume = 1;
        audio.setAttribute('playsinline', '');
        audio.setAttribute('webkit-playsinline', '');
        audio.addEventListener('playing', updateRunningStatus);
        audio.addEventListener('pause', () => {
            if (enabled) setStatus('媒体通道已暂停，等待恢复', 'paused');
        });
        audio.addEventListener('stalled', () => setStatus('媒体通道受限，等待恢复', 'paused'));
        audio.addEventListener('error', () => setStatus('媒体通道不可用', 'error'));
        return audio;
    }

    function updateMediaSession(active) {
        if (!('mediaSession' in navigator)) return;
        try {
            navigator.mediaSession.playbackState = active ? 'playing' : 'none';
            if (active && 'MediaMetadata' in window) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: 'UwU 持续运行增强',
                    artist: '保持网页任务活跃'
                });
            } else if (!active) {
                navigator.mediaSession.metadata = null;
            }
        } catch (error) {
            console.debug('[KeepAlive] Media Session 不可用:', error);
        }
    }

    function removeGestureFallback() {
        if (!gestureHandler) return;
        document.removeEventListener('pointerdown', gestureHandler, true);
        document.removeEventListener('touchstart', gestureHandler, true);
        gestureHandler = null;
    }

    function installGestureFallback() {
        if (gestureHandler) return;
        gestureHandler = () => {
            removeGestureFallback();
            startAudio(true);
        };
        document.addEventListener('pointerdown', gestureHandler, { capture: true, once: true });
        document.addEventListener('touchstart', gestureHandler, { capture: true, once: true });
    }

    async function startAudio(fromUserGesture) {
        if (!enabled) return false;
        try {
            await ensureAudio().play();
            removeGestureFallback();
            updateMediaSession(true);
            updateRunningStatus();
            return true;
        } catch (error) {
            console.warn('[KeepAlive] 媒体通道启动失败:', error);
            setStatus(fromUserGesture ? '媒体通道被浏览器拒绝' : '点击页面以授权媒体通道', 'waiting');
            installGestureFallback();
            return false;
        }
    }

    async function requestWakeLock() {
        if (!enabled || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return false;
        if (wakeLock && !wakeLock.released) return true;
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                wakeLock = null;
                if (enabled && document.visibilityState === 'visible') {
                    setStatus('屏幕常亮被系统释放，媒体通道仍运行', 'partial');
                }
            }, { once: true });
            updateRunningStatus();
            return true;
        } catch (error) {
            console.debug('[KeepAlive] 屏幕常亮不可用:', error);
            updateRunningStatus();
            return false;
        }
    }

    function updateRunningStatus() {
        if (!enabled) {
            setStatus('未开启', 'off');
            return;
        }
        if (!audio || audio.paused) return;
        if (document.visibilityState === 'hidden') {
            setStatus('后台活跃增强运行中', 'running');
        } else if (wakeLock && !wakeLock.released) {
            setStatus('运行中：屏幕常亮与媒体通道已开启', 'running');
        } else {
            setStatus('运行中：媒体通道已开启', 'partial');
        }
    }

    function writeCheckpoint(reason) {
        const checkpoint = { timestamp: Date.now(), reason: reason || 'heartbeat' };
        try {
            localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint));
        } catch (error) {
            console.debug('[KeepAlive] 无法保存生命周期检查点:', error);
        }
    }

    function startHeartbeat() {
        if (heartbeatTimer) return;
        lastHeartbeatAt = Date.now();
        heartbeatTimer = setInterval(() => {
            lastHeartbeatAt = Date.now();
        }, HEARTBEAT_INTERVAL_MS);
    }

    function stopHeartbeat() {
        if (!heartbeatTimer) return;
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    async function runRecovery(reason) {
        if (!enabled || recoveryRunning) return;
        recoveryRunning = true;
        const now = Date.now();
        const inactiveSince = hiddenAt || lastHeartbeatAt;
        const elapsedMs = Math.max(0, now - inactiveSince);

        try {
            await startAudio(false);
            await requestWakeLock();
            lastHeartbeatAt = now;
            hiddenAt = 0;

            if (elapsedMs >= RESUME_GAP_MS) {
                if (typeof updateClock === 'function') updateClock();
                if (typeof checkAutoReply === 'function') await checkAutoReply();
                if (typeof checkBackupReminder === 'function') await checkBackupReminder();
                window.dispatchEvent(new CustomEvent('uwu:app-resume', {
                    detail: { reason, elapsedMs, resumedAt: now }
                }));
                console.log(`[KeepAlive] 页面恢复，已补跑任务；挂起约 ${Math.round(elapsedMs / 1000)} 秒`);
            }
            updateRunningStatus();
        } finally {
            recoveryRunning = false;
        }
    }

    function handleVisibilityChange() {
        if (!enabled) return;
        if (document.visibilityState === 'hidden') {
            hiddenAt = Date.now();
            writeCheckpoint('hidden');
            updateRunningStatus();
        } else {
            runRecovery('visibilitychange');
        }
    }

    function bindLifecycleListeners() {
        if (listenersBound) return;
        listenersBound = true;
        document.addEventListener('visibilitychange', handleVisibilityChange);
        document.addEventListener('freeze', () => {
            if (!enabled) return;
            hiddenAt = hiddenAt || Date.now();
            writeCheckpoint('freeze');
        });
        document.addEventListener('resume', () => runRecovery('resume'));
        window.addEventListener('pagehide', () => {
            if (!enabled) return;
            hiddenAt = hiddenAt || Date.now();
            writeCheckpoint('pagehide');
        });
        window.addEventListener('pageshow', event => {
            if (enabled && event.persisted) runRecovery('pageshow');
        });
        window.addEventListener('online', () => {
            if (enabled) runRecovery('online');
        });
    }

    async function enable(options) {
        enabled = true;
        bindLifecycleListeners();
        startHeartbeat();
        setStatus('正在启动持续运行增强…', 'starting');
        const audioStarted = await startAudio(Boolean(options && options.userInitiated));
        await requestWakeLock();
        updateRunningStatus();
        return audioStarted;
    }

    async function disable() {
        enabled = false;
        removeGestureFallback();
        stopHeartbeat();
        hiddenAt = 0;

        if (wakeLock && !wakeLock.released) {
            try { await wakeLock.release(); } catch (error) {}
        }
        wakeLock = null;

        if (audio) {
            audio.pause();
            audio.currentTime = 0;
            audio.removeAttribute('src');
            audio.load();
            audio = null;
        }
        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
            audioUrl = '';
        }
        updateMediaSession(false);
        setStatus('未开启', 'off');
        return true;
    }

    async function setEnabled(value, options) {
        return value ? enable(options) : disable();
    }

    window.KeepAliveManager = {
        init(value) {
            bindLifecycleListeners();
            return setEnabled(Boolean(value), { userInitiated: false });
        },
        setEnabled,
        recover: runRecovery,
        isEnabled() { return enabled; }
    };

    // 兼容旧调用入口。
    window.toggleKeepAlive = value => window.KeepAliveManager.setEnabled(Boolean(value), { userInitiated: true });
})();
;
// --- API 设置与预设管理逻辑 ---

function setupApiSettingsApp() {
    const e = document.getElementById('api-form'), t = document.getElementById('fetch-models-btn'),
        a = document.getElementById('api-model'), n = document.getElementById('api-provider'),
        r = document.getElementById('api-url'), s = document.getElementById('api-key'), c = {
            newapi: '',
            deepseek: 'https://api.deepseek.com',
            claude: 'https://api.anthropic.com',
            gemini: 'https://generativelanguage.googleapis.com'
        };
    db.apiSettings && (n.value = db.apiSettings.provider || 'newapi', r.value = db.apiSettings.url || '', s.value = db.apiSettings.key || '', db.apiSettings.model && (a.innerHTML = `<option value="${db.apiSettings.model}">${db.apiSettings.model}</option>`));
    if (db.apiSettings && typeof db.apiSettings.timePerceptionEnabled !== 'undefined') { document.getElementById('time-perception-switch').checked = db.apiSettings.timePerceptionEnabled; }
    if (db.apiSettings && typeof db.apiSettings.streamEnabled !== 'undefined') { document.getElementById('stream-switch').checked = db.apiSettings.streamEnabled; } else { document.getElementById('stream-switch').checked = true; } 
    
    const keepAliveSwitch = document.getElementById('keep-alive-switch');
    if (keepAliveSwitch) {
        if (db.apiSettings && typeof db.apiSettings.keepAliveEnabled !== 'undefined') {
            keepAliveSwitch.checked = db.apiSettings.keepAliveEnabled;
        } else {
            keepAliveSwitch.checked = false;
        }
        keepAliveSwitch.addEventListener('change', async (e) => {
            const desiredState = e.target.checked;
            if (window.KeepAliveManager) {
                await window.KeepAliveManager.setEnabled(desiredState, { userInitiated: true });
            }
            db.apiSettings = db.apiSettings || {};
            db.apiSettings.keepAliveEnabled = desiredState;
            await saveData();
            showToast(desiredState ? '持续运行增强已开启' : '持续运行增强已关闭');
        });
    }

    const tempEnabledSwitch = document.getElementById('temperature-enabled-switch');
    const tempSlider = document.getElementById('temperature-slider');
    const tempValue = document.getElementById('temperature-value');
    const bindLivelyControls = () => {
        const s = db.apiSettings || {};
        const lm = document.getElementById('lively-mode-select');
        if (lm) lm.value = s.livelyMode || 'natural';
        const bindSlider = (swId, slId, valId, enKey, valKey, defVal) => {
            const sw = document.getElementById(swId);
            const sl = document.getElementById(slId);
            const vl = document.getElementById(valId);
            if (!sw || !sl || !vl) return;
            sw.checked = s[enKey] === true;
            const v = s[valKey] !== undefined ? Number(s[valKey]) : defVal;
            sl.value = v;
            vl.textContent = v;
            const sync = () => {
                sl.disabled = !sw.checked;
                sl.style.opacity = sw.checked ? '1' : '0.45';
                vl.style.opacity = sw.checked ? '1' : '0.45';
            };
            sync();
            sw.addEventListener('change', sync);
            sl.addEventListener('input', () => { vl.textContent = sl.value; });
        };
        bindSlider('top-p-enabled-switch', 'top-p-slider', 'top-p-value', 'topPEnabled', 'topP', 0.95);
        bindSlider('presence-penalty-enabled-switch', 'presence-penalty-slider', 'presence-penalty-value', 'presencePenaltyEnabled', 'presencePenalty', 0.3);
        bindSlider('frequency-penalty-enabled-switch', 'frequency-penalty-slider', 'frequency-penalty-value', 'frequencyPenaltyEnabled', 'frequencyPenalty', 0.3);
    };
    bindLivelyControls();
    
    if (tempEnabledSwitch) {
        if (db.apiSettings && typeof db.apiSettings.temperatureEnabled !== 'undefined') {
            tempEnabledSwitch.checked = db.apiSettings.temperatureEnabled;
        } else {
            tempEnabledSwitch.checked = true; // 默认开启
        }
        if (tempSlider) tempSlider.disabled = !tempEnabledSwitch.checked;
        
        tempEnabledSwitch.addEventListener('change', (e) => {
            if (tempSlider) tempSlider.disabled = !e.target.checked;
        });
    }

    if (tempSlider && tempValue) {
        const savedTemp = (db.apiSettings && db.apiSettings.temperature !== undefined) ? db.apiSettings.temperature : 1.0;
        tempSlider.value = savedTemp;
        tempValue.textContent = savedTemp;

        tempSlider.addEventListener('input', (e) => {
            tempValue.textContent = e.target.value;
        });
    }

    populateApiSelect();
    setupSecondaryApiSettings();
    setupMemoryApiSettings();
    n.addEventListener('change', () => {
        r.value = c[n.value] || ''
    });

    // 提取为全局函数以便复用
    window.fetchAndPopulateModels = async (showToastFlag = true) => {
        const provider = n.value;
        let apiUrl = r.value.trim();
        const apiKey = s.value.trim();
        const modelSelect = a;
        const fetchBtn = t;

        if (!apiUrl || !apiKey) {
            if (showToastFlag) showToast('请先填写API地址和密钥！');
            return;
        }

        if (BLOCKED_API_DOMAINS.some(domain => apiUrl.includes(domain))) {
            if (showToastFlag) showToast('该 API 站点已被屏蔽，无法使用！');
            return;
        }

        if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
        
        const endpoint = provider === 'gemini' 
            ? `${apiUrl}/v1beta/models?key=${getRandomValue(apiKey)}` 
            : `${apiUrl}/v1/models`;

        if (fetchBtn) {
            fetchBtn.classList.add('loading');
            fetchBtn.disabled = true;
        }

        try {
            const headers = provider === 'gemini' ? {} : { Authorization: `Bearer ${apiKey}` };
            const response = await fetch(endpoint, { method: 'GET', headers });
            
            if (!response.ok) {
                const error = new Error(`网络响应错误: ${response.status}`);
                error.response = response;
                throw error;
            }

            const data = await response.json();
            let models = [];
            
            if (provider !== 'gemini' && data.data) {
                models = data.data.map(e => e.id);
            } else if (provider === 'gemini' && data.models) {
                models = data.models.map(e => e.name.replace('models/', ''));
            }

            // 保留当前选中的值（如果仍在列表中）
            const currentVal = modelSelect.value;
            
            modelSelect.innerHTML = '';
            if (models.length > 0) {
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m;
                    modelSelect.appendChild(opt);
                });
                
                // 尝试恢复之前的选择，或者使用设置中的值
                if (models.includes(currentVal)) {
                    modelSelect.value = currentVal;
                } else if (db.apiSettings && db.apiSettings.model && models.includes(db.apiSettings.model)) {
                    modelSelect.value = db.apiSettings.model;
                }
                
                if (showToastFlag) showToast('模型列表拉取成功！');
            } else {
                modelSelect.innerHTML = '<option value="">未找到任何模型</option>';
                if (showToastFlag) showToast('未找到任何模型');
            }
        } catch (err) {
            console.error(err);
            if (showToastFlag) {
                showApiError(err);
                modelSelect.innerHTML = '<option value="">拉取失败</option>';
            }
        } finally {
            if (fetchBtn) {
                fetchBtn.classList.remove('loading');
                fetchBtn.disabled = false;
            }
        }
    };

    t.addEventListener('click', () => window.fetchAndPopulateModels(true));
    e.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!a.value) return showToast('请选择模型后保存！');
        if (BLOCKED_API_DOMAINS.some(domain => r.value.includes(domain))) {
            return showToast('该 API 站点已被屏蔽，无法保存！');
        }
        const secondary = readSecondaryApiSettings();
        if (secondary.enabled && (!secondary.url || !secondary.key || !secondary.model)) {
            return showToast('请完整填写副 API 地址、密钥和模型！');
        }
        if (secondary.enabled && BLOCKED_API_DOMAINS.some(domain => secondary.url.includes(domain))) {
            return showToast('副 API 站点已被屏蔽，无法保存！');
        }
        db.apiSettings = {
            ...db.apiSettings,
            provider: n.value,
            url: r.value,
            key: s.value,
            model: a.value,
            timePerceptionEnabled: document.getElementById('time-perception-switch').checked,
            streamEnabled: document.getElementById('stream-switch').checked, 
            keepAliveEnabled: document.getElementById('keep-alive-switch') ? document.getElementById('keep-alive-switch').checked : false,
            temperatureEnabled: document.getElementById('temperature-enabled-switch').checked,
            temperature: parseFloat(document.getElementById('temperature-slider').value),
            livelyMode: document.getElementById('lively-mode-select')?.value || 'natural',
            topPEnabled: document.getElementById('top-p-enabled-switch')?.checked === true,
            topP: parseFloat(document.getElementById('top-p-slider')?.value ?? '0.95'),
            presencePenaltyEnabled: document.getElementById('presence-penalty-enabled-switch')?.checked === true,
            presencePenalty: parseFloat(document.getElementById('presence-penalty-slider')?.value ?? '0.3'),
            frequencyPenaltyEnabled: document.getElementById('frequency-penalty-enabled-switch')?.checked === true,
            frequencyPenalty: parseFloat(document.getElementById('frequency-penalty-slider')?.value ?? '0.3'),
            secondary
        };
        await saveData();
        showToast('API设置已保存！')
    })
}

function buildLivelyPostscript(chat, historySlice) {
    const s = db.apiSettings || {};
    const mode = s.livelyMode ?? 'natural';
    const timeEnabled = s.timePerceptionEnabled === true;
    const parts = [];
    if (mode === 'natural') {
        parts.push('[实时口语锚点] 你现在正用手机发微信聊天，请彻底去掉书面语、翻译腔和客服式总结（别用“总而言之/值得注意的是/我完全理解”等书面词）。像真人随手打字一样说话：先给真实情绪反应，再自然接话，多用口语短句、省主语和自然停顿。');
    } else if (mode === 'vivid') {
        parts.push('[极致微信活人锚点] 严禁写小作文、严禁书面语与公文腔！你正捧着手机秒回微信：把话拆成生活化的碎短句、带真实情绪起伏、随性口语词和自然吐槽，别端着架子讲道理，先有活生生的第一反应再说正事。');
    }
    if (timeEnabled) {
        const now = new Date();
        const h = now.getHours();
        const period = h < 6 ? '凌晨' : h < 12 ? '上午' : h < 18 ? '下午' : '晚上';
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const timeStr = `${String(h).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        let gapStr = '';
        const list = Array.isArray(historySlice) ? historySlice : [];
        let prevTs = null;
        for (let i = list.length - 2; i >= 0; i--) {
            if (list[i]?.timestamp) { prevTs = list[i].timestamp; break; }
        }
        if (prevTs) {
            const diffMin = Math.max(0, Math.round((now.getTime() - prevTs) / 60000));
            if (diffMin >= 10 && diffMin < 60) gapStr = `，距上一条消息约 ${diffMin} 分钟`;
            else if (diffMin >= 60 && diffMin < 1440) gapStr = `，距上一条消息约 ${Math.round(diffMin / 60)} 小时`;
            else if (diffMin >= 1440) gapStr = `，距上一条消息约 ${Math.round(diffMin / 1440)} 天`;
        }
        parts.push(`[客观时间参考] 当前时间：${dateStr} ${period} ${timeStr}${gapStr}。仅作为客观时间背景，不要强行提及时间、不要主动催促饮食或作息，也不要打断当前对话。`);
    }
    if (chat && typeof chat === 'object' && Array.isArray(historySlice)) {
        const recentUserMsgs = historySlice.filter(m => m && m.role === 'user').slice(-6);
        const lastUserText = recentUserMsgs.map(m => {
            if (Array.isArray(m.parts)) return m.parts.filter(p => p.type === 'text').map(p => p.text).join(' ');
            return String(m.content || '');
        }).join(' ');
        // Collect recent images sent by user (so AI can pick #1 or #2 when user sends couple avatars!)
        const recentImgs = [];
        for (const m of recentUserMsgs) {
            if (Array.isArray(m.parts)) {
                for (const p of m.parts) {
                    if (p.type === 'image' && p.data) recentImgs.push(p.data);
                }
            }
        }
        const mentionsAvatar = /头像|情头|换头|换个头|头像库|照片|图片|自拍|头顶小猫|avatar|pfp/i.test(lastUserText) || recentImgs.length > 0;
        if (mentionsAvatar) {
            const uName = (chat.myName || '对方').trim().slice(0, 20);
            const lib = Array.isArray(chat.avatarLibrary) ? chat.avatarLibrary : [];
            const curDesc = chat.currentAvatarDesc || '当前默认头像';
            const libList = lib.slice(0, 12).map((item, idx) => `lib:${item.id}(${item.desc || '头像' + (idx + 1)})`).join('、');
            const imgHint = recentImgs.length ? `；${uName}刚按顺序发了 ${recentImgs.length} 张图，编号为 img:1${recentImgs.length > 1 ? ` 到 img:${recentImgs.length}` : ''}（请核对顺序别选错张）` : '';
            parts.push(`[头像自主能力·仅相关时触发] 你当前头像是「${curDesc}」${libList ? `；头像库有：${libList}` : ''}${imgHint}。如果你决定换头像（例如答应一起换情头或换头像库里的某张），请在发给对方的正文末尾（不要写在思考过程里）附隐藏标签 [CHANGE_AVATAR:img:序号|描述] 或 [CHANGE_AVATAR:lib:ID|描述]：普通头像写清画面内容；若是和${uName}的情头，描述必须写明“和${uName}的情头｜我这张的画面内容，${uName}那边配对头像的画面内容”（例如：和${uName}的情头｜我这张是头顶趴着的模糊小猫，${uName}那边是戴耳机的小女孩）。系统会自动换上并完整存入头像库；不换则不写此标签。`);
        }

        // Poke text logic: auto-init ONCE when empty; once set, ZERO token cost unless user mentions 拍一拍
        const hasPoke = typeof chat.pokeText === 'string' && chat.pokeText.trim().length > 0;
        const mentionsPoke = /拍一拍|拍了拍|改拍一拍|poke/i.test(lastUserText);
        if (!hasPoke) {
            parts.push(`[首次设定拍一拍] 你目前还没有微信“拍一拍”文案。请在本次回复末尾附带一个隐藏标签 [SET_POKE:文案]（例如“拍了拍${chat.realName || '我'}的手臂肌肉”），以后不会每次修改。`);
        } else if (mentionsPoke) {
            parts.push(`[拍一拍参考] 你当前的拍一拍文案是「${chat.pokeText}」。只有当你此刻特地想改时，才在回复末尾附 [SET_POKE:新文案]，否则不用改。`);
        }
    }
    if (typeof window !== 'undefined' && window.__uwuCasualRegenOnce) {
        window.__uwuCasualRegenOnce = false;
        parts.push('[本次重说要求] 上一次回复太书面或不够自然，请立刻换用更口语、更简短随性、像真人捧着手机发微信的语气重新说一遍，彻底去掉书面语和小作文感。');
    }
    return parts.join('\n');
}

function getDefaultSecondaryApiRoutes() {
    return {
        callReply: false,
        callSummary: false,
        journal: false,
        peek: false,
        shop: false,
        batteryReminder: false
    };
}

function readSecondaryApiSettings() {
    const enabledEl = document.getElementById('secondary-api-enabled');
    const providerEl = document.getElementById('secondary-api-provider');
    const urlEl = document.getElementById('secondary-api-url');
    const keyEl = document.getElementById('secondary-api-key');
    const modelEl = document.getElementById('secondary-api-model');
    const routes = getDefaultSecondaryApiRoutes();

    document.querySelectorAll('[data-secondary-route]').forEach(input => {
        routes[input.dataset.secondaryRoute] = input.checked;
    });

    return {
        enabled: Boolean(enabledEl && enabledEl.checked),
        provider: providerEl ? providerEl.value : 'newapi',
        url: urlEl ? urlEl.value.trim().replace(/\/$/, '') : '',
        key: keyEl ? keyEl.value.trim() : '',
        model: modelEl ? modelEl.value : '',
        routes
    };
}

function setupSecondaryApiSettings() {
    const enabledEl = document.getElementById('secondary-api-enabled');
    const panel = document.getElementById('secondary-api-panel');
    const providerEl = document.getElementById('secondary-api-provider');
    const urlEl = document.getElementById('secondary-api-url');
    const keyEl = document.getElementById('secondary-api-key');
    const modelEl = document.getElementById('secondary-api-model');
    const fetchBtn = document.getElementById('secondary-fetch-models-btn');
    if (!enabledEl || !panel || !providerEl || !urlEl || !keyEl || !modelEl || !fetchBtn) return;

    const secondary = (db.apiSettings && db.apiSettings.secondary) || {};
    const providerUrls = {
        newapi: '',
        deepseek: 'https://api.deepseek.com',
        claude: 'https://api.anthropic.com',
        gemini: 'https://generativelanguage.googleapis.com'
    };

    enabledEl.checked = Boolean(secondary.enabled);
    providerEl.value = secondary.provider || 'newapi';
    urlEl.value = secondary.url || '';
    keyEl.value = secondary.key || '';
    if (secondary.model) {
        modelEl.innerHTML = '';
        const savedModelOption = document.createElement('option');
        savedModelOption.value = secondary.model;
        savedModelOption.textContent = secondary.model;
        modelEl.appendChild(savedModelOption);
    }
    const savedRoutes = { ...getDefaultSecondaryApiRoutes(), ...(secondary.routes || {}) };
    document.querySelectorAll('[data-secondary-route]').forEach(input => {
        input.checked = Boolean(savedRoutes[input.dataset.secondaryRoute]);
    });

    const updatePanelState = () => {
        panel.style.display = enabledEl.checked ? 'block' : 'none';
    };
    updatePanelState();

    if (enabledEl.dataset.listenerBound === 'true') return;
    enabledEl.dataset.listenerBound = 'true';
    enabledEl.addEventListener('change', updatePanelState);
    providerEl.addEventListener('change', () => {
        urlEl.value = providerUrls[providerEl.value] || '';
        modelEl.innerHTML = '<option value="">请重新拉取模型</option>';
    });
    fetchBtn.addEventListener('click', async () => {
        let apiUrl = urlEl.value.trim().replace(/\/$/, '');
        const apiKey = keyEl.value.trim();
        const provider = providerEl.value;
        if (!apiUrl || !apiKey) return showToast('请先填写副 API 地址和密钥！');
        if (BLOCKED_API_DOMAINS.some(domain => apiUrl.includes(domain))) {
            return showToast('副 API 站点已被屏蔽，无法使用！');
        }

        const endpoint = provider === 'gemini'
            ? `${apiUrl}/v1beta/models?key=${getRandomValue(apiKey)}`
            : `${apiUrl}/v1/models`;
        fetchBtn.disabled = true;
        fetchBtn.classList.add('loading');
        try {
            const headers = provider === 'gemini' ? {} : { Authorization: `Bearer ${apiKey}` };
            const response = await fetch(endpoint, { method: 'GET', headers });
            if (!response.ok) {
                const error = new Error(`网络响应错误: ${response.status}`);
                error.response = response;
                throw error;
            }
            const data = await response.json();
            const models = provider === 'gemini'
                ? (data.models || []).map(item => item.name.replace('models/', ''))
                : (data.data || []).map(item => item.id);
            modelEl.innerHTML = '';
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                modelEl.appendChild(option);
            });
            if (!models.length) modelEl.innerHTML = '<option value="">未找到任何模型</option>';
            showToast(models.length ? '副 API 模型列表拉取成功！' : '未找到任何模型');
        } catch (error) {
            showApiError(error);
            modelEl.innerHTML = '<option value="">拉取失败</option>';
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.classList.remove('loading');
        }
    });
}

function setupMemoryApiSettings() {
    const enabled = document.getElementById('memory-api-enabled');
    const panel = document.getElementById('memory-api-panel');
    const provider = document.getElementById('memory-api-provider');
    const url = document.getElementById('memory-api-url');
    const key = document.getElementById('memory-api-key');
    const model = document.getElementById('memory-api-model');
    const options = document.getElementById('memory-api-models');
    const modelSelectRow = document.getElementById('memory-api-model-select-row');
    const modelSelect = document.getElementById('memory-api-model-select');
    const fetchButton = document.getElementById('memory-fetch-models-btn');
    const save = document.getElementById('memory-save-api-btn');
    const config = db.apiSettings?.memoryOrganizer;
    enabled.checked = config?.enabled === true;
    provider.value = config?.provider || 'newapi';
    url.value = config?.url || '';
    key.value = config?.key || '';
    model.value = config?.model || '';

    function baseUrl() {
        const base = url.value.trim().replace(/\/+$/, '');
        return provider.value === 'gemini' ? base.replace(/\/v1beta$/, '') : base;
    }

    function readConfig() {
        return { enabled: enabled.checked, provider: provider.value,
            url: baseUrl(), key: key.value.trim(), model: model.value.trim() };
    }

    const updatePanel = () => { panel.hidden = !enabled.checked; };
    updatePanel();
    enabled.addEventListener('change', updatePanel);
    modelSelect.addEventListener('change', () => {
        if (modelSelect.value) model.value = modelSelect.value;
    });
    model.addEventListener('input', () => {
        if (Array.from(modelSelect.options).some(opt => opt.value === model.value.trim())) {
            modelSelect.value = model.value.trim();
        }
    });
    provider.addEventListener('change', () => {
        url.value = { gemini: 'https://generativelanguage.googleapis.com', deepseek: 'https://api.deepseek.com' }[provider.value] || '';
        model.value = '';
        options.replaceChildren();
        modelSelect.replaceChildren();
        modelSelectRow.hidden = true;
    });

    save.addEventListener('click', async () => {
        const next = readConfig();
        if (next.enabled && (!next.url || !next.key || !next.model)) {
            return showToast('请填写记忆 API 地址、密钥和模型');
        }
        if (next.enabled && BLOCKED_API_DOMAINS.some(domain => next.url.includes(domain))) {
            return showToast('该记忆 API 地址已被屏蔽');
        }
        save.disabled = true;
        db.apiSettings ||= {};
        const before = db.apiSettings.memoryOrganizer;
        db.apiSettings.memoryOrganizer = next;
        try {
            await saveData();
            showToast('记忆 API 已保存');
        } catch (error) {
            db.apiSettings.memoryOrganizer = before;
            showToast('记忆 API 保存失败');
        } finally {
            save.disabled = false;
        }
    });

    fetchButton.addEventListener('click', async () => {
        const config = readConfig();
        if (!config.url || !config.key) return showToast('请先填写记忆 API 地址和密钥');
        if (BLOCKED_API_DOMAINS.some(domain => config.url.includes(domain))) return showToast('该记忆 API 地址已被屏蔽');
        const gemini = config.provider === 'gemini';
        const request = buildChatApiRequest(config, []);
        const base = request.endpoint.replace(/\/v1(?:beta)?\/.*$/, '');
        const endpoint = gemini
            ? `${base}/v1beta/models?key=${encodeURIComponent(getRandomValue(config.key))}`
            : `${base}/v1/models`;
        fetchButton.disabled = true;
        try {
            const response = await fetch(endpoint, { headers: gemini ? {} : { Authorization: request.headers.Authorization } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const models = [...new Set((gemini ? (data.models || []).map(item => item.name?.replace(/^models\//, ''))
                : (data.data || []).map(item => item.id)).filter(Boolean))];
            options.replaceChildren(...models.map(value => new Option(value, value)));
            if (models.length) {
                modelSelect.replaceChildren(new Option(`请选择模型（共 ${models.length} 个）`, ''), ...models.map(value => new Option(value, value)));
                if (model.value && models.includes(model.value.trim())) {
                    modelSelect.value = model.value.trim();
                } else if (!model.value.trim()) {
                    model.value = models[0];
                    modelSelect.value = models[0];
                }
                modelSelectRow.hidden = false;
            } else {
                modelSelect.replaceChildren();
                modelSelectRow.hidden = true;
            }
            showToast(models.length ? `已拉取 ${models.length} 个模型，请直接在下方下拉框选择` : '未取得模型列表，可以手动填写模型 ID');
        } catch {
            showToast('模型列表拉取失败，可以手动填写模型 ID');
        } finally {
            fetchButton.disabled = false;
        }
    });
}

// --- 预设管理 ---
function _getApiPresets() {
    return db.apiPresets || [];
}

function _createApiPresetId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return 'api_preset_' + window.crypto.randomUUID();
    }
    return 'api_preset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

function _normalizeApiPresets(arr) {
    const usedIds = new Set();
    return (Array.isArray(arr) ? arr : []).map(preset => {
        const normalized = preset && typeof preset === 'object' ? preset : {};
        if (!normalized.id || usedIds.has(normalized.id)) {
            normalized.id = _createApiPresetId();
        }
        usedIds.add(normalized.id);
        return normalized;
    });
}

function _saveApiPresets(arr) {
    db.apiPresets = _normalizeApiPresets(arr);
    saveData();
    window.dispatchEvent(new CustomEvent('api-presets-updated'));
}

function populateApiSelect() {
    const sel = document.getElementById('api-preset-select');
    if (!sel) return;
    const needsMigration = _getApiPresets().some(p => !p || !p.id);
    const presets = _normalizeApiPresets(_getApiPresets());
    db.apiPresets = presets;
    if (needsMigration) saveData();
    sel.innerHTML = '<option value="">— 选择 API 预设 —</option>';
    presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    sel.appendChild(opt);
    });
}

function saveCurrentApiAsPreset() {
    const apiKeyEl = document.querySelector('#api-key');
    const apiUrlEl = document.querySelector('#api-url');
    const providerEl = document.querySelector('#api-provider');
    const modelEl = document.querySelector('#api-model');
    const tempEnabledSwitch = document.getElementById('temperature-enabled-switch');
    const tempSlider = document.getElementById('temperature-slider');

    const data = {
        apiKey: apiKeyEl ? apiKeyEl.value : '',
        apiUrl: apiUrlEl ? apiUrlEl.value : '',
        provider: providerEl ? providerEl.value : '',
        model: modelEl ? modelEl.value : '',
        temperatureEnabled: tempEnabledSwitch ? tempEnabledSwitch.checked : false,
        temperature: tempSlider ? parseFloat(tempSlider.value) : 1.0
    };
    
    let name = prompt('为该 API 预设填写名称（会覆盖同名预设）：');
    if (!name) return;
    const presets = _getApiPresets();
    const idx = presets.findIndex(p => p.name === name);
    const preset = {id: idx >= 0 ? presets[idx].id : _createApiPresetId(), name: name, data: data};
    if (idx >= 0) presets[idx] = preset; else presets.push(preset);
    _saveApiPresets(presets);
    populateApiSelect();
    showToast('API 预设已保存');
}

async function applyApiPreset(name) {
    const presets = _getApiPresets();
    const p = presets.find(x => x.name === name);
    if (!p) return showToast('未找到该预设');
    try {
        const apiKeyEl = document.querySelector('#api-key');
        const apiUrlEl = document.querySelector('#api-url');
        const providerEl = document.querySelector('#api-provider');
        const modelEl = document.querySelector('#api-model');
        const tempEnabledSwitch = document.getElementById('temperature-enabled-switch');
        const tempSlider = document.getElementById('temperature-slider');
        const tempValue = document.getElementById('temperature-value');

        if (apiKeyEl && p.data && typeof p.data.apiKey !== 'undefined') apiKeyEl.value = p.data.apiKey;
        if (apiUrlEl && p.data && typeof p.data.apiUrl !== 'undefined') apiUrlEl.value = p.data.apiUrl;
        if (providerEl && p.data && typeof p.data.provider !== 'undefined') providerEl.value = p.data.provider;
        if (modelEl && p.data && typeof p.data.model !== 'undefined') {
            modelEl.innerHTML = `<option value="${p.data.model}">${p.data.model}</option>`;
            modelEl.value = p.data.model;
        }
        if (tempEnabledSwitch && p.data && typeof p.data.temperatureEnabled !== 'undefined') {
            tempEnabledSwitch.checked = p.data.temperatureEnabled;
            if (tempSlider) tempSlider.disabled = !tempEnabledSwitch.checked;
        }
        if (tempSlider && p.data && typeof p.data.temperature !== 'undefined') {
            tempSlider.value = p.data.temperature;
            if (tempValue) tempValue.textContent = p.data.temperature;
        }

        showToast('已应用 API 预设');
    } catch(e) {
        console.error('applyApiPreset error', e);
    }
}

function openApiManageModal() {
    const modal = document.getElementById('api-presets-modal');
    const list = document.getElementById('api-presets-list');
    if (!modal || !list) return;
    list.innerHTML = '';
    const presets = _getApiPresets();
    if (!presets.length) {
        list.innerHTML = '<p style="color:#888;margin:6px 0;">暂无预设</p>';
    }
    presets.forEach((p, idx) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.padding = '8px 6px';
        row.style.borderBottom = '1px solid #f6f6f6';

        const left = document.createElement('div');
        left.style.flex = '1';
        left.style.minWidth = '0';
        left.innerHTML = '<div style="font-weight:600;">'+p.name+'</div><div style="font-size:12px;color:#666;margin-top:4px;">' + (p.data && p.data.provider ? ('提供者：'+p.data.provider) : '') + '</div>';

        const btns = document.createElement('div');
        btns.style.display = 'flex';
        btns.style.gap = '6px';

        const applyBtn = document.createElement('button');
        applyBtn.className = 'btn';
        applyBtn.textContent = '应用';
        applyBtn.onclick = function(){ applyApiPreset(p.name); modal.style.display='none'; };

        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn';
        renameBtn.textContent = '重命名';
        renameBtn.onclick = function(){
            const newName = prompt('输入新名称：', p.name);
            if (!newName) return;
            const all = _getApiPresets();
            all[idx].name = newName;
            _saveApiPresets(all);
            openApiManageModal();
            populateApiSelect();
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'btn';
        delBtn.textContent = '删除';
        delBtn.onclick = function(){ if(!confirm('确定删除 "'+p.name+'" ?')) return; const all=_getApiPresets(); all.splice(idx,1); _saveApiPresets(all); openApiManageModal(); populateApiSelect(); };

        btns.appendChild(applyBtn); btns.appendChild(renameBtn); btns.appendChild(delBtn);

        row.appendChild(left); row.appendChild(btns);
        list.appendChild(row);
    });
    modal.style.display = 'flex';
}

function exportApiPresets() {
    const presets = _getApiPresets();
    const blob = new Blob([JSON.stringify(presets, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'api_presets.json'; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}
function importApiPresets() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json';
    inp.onchange = function(e){
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = function(){ try { const data = JSON.parse(r.result); if (Array.isArray(data)) { _saveApiPresets(data); populateApiSelect(); openApiManageModal(); } else alert('文件格式不正确'); } catch(e){ alert('导入失败：'+e.message); } };
        r.readAsText(f);
    };
    inp.click();
}
;
// --- 预设管理逻辑 (气泡、人设、字体、提示音、全局CSS) ---

function _getBubblePresets() {
    return db.bubbleCssPresets || [];
}
function _saveBubblePresets(arr) {
    db.bubbleCssPresets = arr || [];
    saveData();
}

function populateBubblePresetSelect(selectId) { 
    const sel = document.getElementById(selectId); 
    if (!sel) return;
    const presets = _getBubblePresets();
    sel.innerHTML = '<option value="">— 选择预设 —</option>';
    presets.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

async function applyPresetToCurrentChat(presetName) {
    const presets = _getBubblePresets();
    const preset = presets.find(p => p.name === presetName);
    if (!preset) { showToast('未找到该预设'); return; }
    
    let textarea;
    let authorNoteDiv;
    if (currentChatType === 'private') {
        textarea = document.getElementById('setting-custom-bubble-css');
        authorNoteDiv = document.getElementById('private-bubble-author-note');
    } else {
        textarea = document.getElementById('setting-group-custom-bubble-css');
        authorNoteDiv = document.getElementById('group-bubble-author-note');
    }
    if (textarea) textarea.value = preset.css;
    
    if (authorNoteDiv) {
        if (preset.authorNote && preset.authorNote.trim() !== '') {
            authorNoteDiv.textContent = `作者注释：${preset.authorNote}`;
            authorNoteDiv.style.display = 'block';
        } else {
            authorNoteDiv.style.display = 'none';
            authorNoteDiv.textContent = '';
        }
    }

    try {
        const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
        if (chat) {
            chat.customBubbleCss = preset.css;
            chat.useCustomBubbleCss = true;
            if (currentChatType === 'private') {
                document.getElementById('setting-use-custom-css').checked = true;
                document.getElementById('setting-custom-bubble-css').disabled = false;
            } else {
                document.getElementById('setting-group-use-custom-css').checked = true;
                document.getElementById('setting-group-custom-bubble-css').disabled = false;
            }
            
            if (preset.settings) {
                if (preset.settings.theme !== undefined) chat.theme = preset.settings.theme;
                if (preset.settings.chatBg !== undefined) {
                    chat.chatBg = preset.settings.chatBg;
                    const chatRoomScreen = document.getElementById('chat-room-screen');
                    if (chatRoomScreen) {
                        if (chat.chatBg) {
                            chatRoomScreen.style.backgroundImage = `url(${chat.chatBg})`;
                        } else {
                            chatRoomScreen.style.backgroundImage = '';
                        }
                    }
                }
                if (preset.settings.bilingualModeEnabled !== undefined) chat.bilingualModeEnabled = preset.settings.bilingualModeEnabled;
                if (preset.settings.bilingualBubbleStyle !== undefined) chat.bilingualBubbleStyle = preset.settings.bilingualBubbleStyle;
                if (preset.settings.avatarMode !== undefined) chat.avatarMode = preset.settings.avatarMode;
                if (preset.settings.avatarRadius !== undefined) chat.avatarRadius = preset.settings.avatarRadius;
                if (preset.settings.bubbleBlurEnabled !== undefined) chat.bubbleBlurEnabled = preset.settings.bubbleBlurEnabled;
                if (preset.settings.titleLayout !== undefined) chat.titleLayout = preset.settings.titleLayout;
                if (preset.settings.showTimestamp !== undefined) chat.showTimestamp = preset.settings.showTimestamp;
                if (preset.settings.timestampStyle !== undefined) chat.timestampStyle = preset.settings.timestampStyle;
                
                if (currentChatType === 'private' && typeof loadSettingsToSidebar === 'function') {
                    loadSettingsToSidebar();
                } else if (currentChatType === 'group' && typeof loadGroupSettingsToSidebar === 'function') {
                    loadGroupSettingsToSidebar();
                }
                
                if (typeof renderMessages === 'function') {
                    renderMessages(false, true);
                }
            }
        }
    } catch(e){
        console.warn('applyPresetToCurrentChat: cannot write to db object', e);
    }

    try {
        // updateCustomBubbleStyle(window.currentChatId || null, preset.css, true);
        
        let previewBox;
        if (currentChatType === 'private') {
            previewBox = document.getElementById('private-bubble-css-preview');
        } else {
            previewBox = document.getElementById('group-bubble-css-preview');
        }

        if (previewBox) {
            const themeKey = (currentChatType === 'private' ? db.characters.find(c => c.id === currentChatId).theme : db.groups.find(g => g.id === currentChatId).theme) || 'white_pink';
            updateBubbleCssPreview(previewBox, preset.css, false, colorThemes[themeKey]);
        }
        showToast('预设已应用到当前聊天并保存');
        await saveData();
    } catch(e){
        console.error('applyPresetToCurrentChat error', e);
    }
}

function saveCurrentTextareaAsPreset() {
    const textarea = document.getElementById('setting-custom-bubble-css') || document.getElementById('setting-group-custom-bubble-css');
    if (!textarea) return showToast('找不到自定义 CSS 文本框');
    const css = textarea.value.trim();
    
    let name = prompt('请输入预设名称（将覆盖同名预设）:');
    if (!name) return;
    
    const includeSettings = confirm('是否连带当前的各项美化设置（主题、聊天背景、头像圆角、气泡模糊等）一起保存进预设？');
    
    let settings = null;
    if (includeSettings) {
        const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
        if (chat) {
            settings = {
                theme: document.getElementById('setting-theme-color') ? document.getElementById('setting-theme-color').value : chat.theme,
                chatBg: chat.chatBg,
                bilingualModeEnabled: document.getElementById('setting-bilingual-mode') ? document.getElementById('setting-bilingual-mode').checked : chat.bilingualModeEnabled,
                bilingualBubbleStyle: document.getElementById('setting-bilingual-style') ? document.getElementById('setting-bilingual-style').value : chat.bilingualBubbleStyle,
                avatarMode: document.getElementById('setting-avatar-mode') ? document.getElementById('setting-avatar-mode').value : chat.avatarMode,
                avatarRadius: document.getElementById('setting-avatar-radius') ? parseInt(document.getElementById('setting-avatar-radius').value, 10) : chat.avatarRadius,
                bubbleBlurEnabled: document.getElementById('setting-bubble-blur') ? document.getElementById('setting-bubble-blur').checked : chat.bubbleBlurEnabled,
                titleLayout: document.getElementById('setting-title-layout') ? document.getElementById('setting-title-layout').value : chat.titleLayout,
                showTimestamp: document.getElementById('setting-show-timestamp') ? document.getElementById('setting-show-timestamp').checked : chat.showTimestamp,
                timestampStyle: document.getElementById('setting-timestamp-style') ? document.getElementById('setting-timestamp-style').value : chat.timestampStyle
            };
        }
    }

    const presets = _getBubblePresets();
    const idx = presets.findIndex(p => p.name === name);
    
    const presetData = { name, css };
    if (settings) {
        presetData.settings = settings;
    }
    
    if (idx >= 0) {
        presets[idx].css = css;
        if (settings) presets[idx].settings = settings;
        else delete presets[idx].settings;
    } else {
        presets.push(presetData);
    }
    
    _saveBubblePresets(presets);
    populateBubblePresetSelect('bubble-preset-select'); 
    populateBubblePresetSelect('group-bubble-preset-select');
    showToast('预设已保存');
}

function openManagePresetsModal() {
    const modal = document.getElementById('bubble-presets-modal');
    const list = document.getElementById('bubble-presets-list');
    if (!modal || !list) return;
    list.innerHTML = '';
    const presets = _getBubblePresets();
    if (!presets.length) list.innerHTML = '<p style="color:#888;margin:6px 0;">暂无预设</p>';
    presets.forEach((p, idx) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.padding = '8px 0';
        row.style.borderBottom = '1px solid #f0f0f0';
        const nameDiv = document.createElement('div');
        nameDiv.style.flex = '1';
        nameDiv.style.whiteSpace = 'nowrap';
        nameDiv.style.overflow = 'hidden';
        nameDiv.style.textOverflow = 'ellipsis';
        nameDiv.textContent = p.name;
        row.appendChild(nameDiv);

        const btnWrap = document.createElement('div');
        btnWrap.style.display = 'flex';
        btnWrap.style.gap = '6px';

        const applyBtn = document.createElement('button');
        applyBtn.className = 'btn btn-primary';
        applyBtn.style.padding = '6px 8px;border-radius:8px';
        applyBtn.textContent = '应用';
        applyBtn.onclick = function(){ applyPresetToCurrentChat(p.name); modal.style.display = 'none'; };

        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn';
        renameBtn.style.padding = '6px 8px;border-radius:8px';
        renameBtn.textContent = '重命名';
        renameBtn.onclick = function(){
            const newName = prompt('输入新名称：', p.name);
            if (!newName) return;
            const presetsAll = _getBubblePresets();
            presetsAll[idx].name = newName;
            _saveBubblePresets(presetsAll);
            openManagePresetsModal(); 
            populateBubblePresetSelect('bubble-preset-select'); populateBubblePresetSelect('group-bubble-preset-select');
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger';
        delBtn.style.padding = '6px 8px;border-radius:8px';
        delBtn.textContent = '删除';
        delBtn.onclick = function(){
            if (!confirm('确定删除预设 \"' + p.name + '\" ?')) return;
            const presetsAll = _getBubblePresets();
            presetsAll.splice(idx, 1);
            _saveBubblePresets(presetsAll);
            openManagePresetsModal();
            populateBubblePresetSelect('bubble-preset-select'); populateBubblePresetSelect('group-bubble-preset-select');
        };

        btnWrap.appendChild(applyBtn);
        btnWrap.appendChild(renameBtn);
        btnWrap.appendChild(delBtn);
        row.appendChild(btnWrap);
        list.appendChild(row);
    });
    modal.style.display = 'flex';
}

function _getMyPersonaPresets() {
    return db.myPersonaPresets || [];
}
function _saveMyPersonaPresets(arr) {
    db.myPersonaPresets = arr || [];
    saveData();
}

function populateMyPersonaSelect() {
    const sel = document.getElementById('mypersona-preset-select');
    if (!sel) return;
    const presets = _getMyPersonaPresets();
    sel.innerHTML = '<option value="">— 选择预设 —</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

function saveCurrentMyPersonaAsPreset() {
    const personaEl = document.getElementById('setting-my-persona');
    const avatarEl = document.getElementById('setting-my-avatar-preview');
    if (!personaEl || !avatarEl) return showToast('找不到我的人设或头像控件');
    const persona = personaEl.value.trim();
    const avatar = avatarEl.src || '';
    if (!persona && !avatar) return showToast('人设和头像都为空，无法保存');
    const name = prompt('请输入预设名称（将覆盖同名预设）：');
    if (!name) return;
    const presets = _getMyPersonaPresets();
    const idx = presets.findIndex(p => p.name === name);
    const preset = { name, persona, avatar };
    if (idx >= 0) presets[idx] = preset; else presets.push(preset);
    _saveMyPersonaPresets(presets);
    populateMyPersonaSelect();
    showToast('我的人设预设已保存');
}

async function applyMyPersonaPresetToCurrentChat(presetName) {
    const presets = _getMyPersonaPresets();
    const p = presets.find(x => x.name === presetName);
    if (!p) { showToast('未找到该预设'); return; }

    const personaEl = document.getElementById('setting-my-persona');
    const avatarEl = document.getElementById('setting-my-avatar-preview');
    if (personaEl) personaEl.value = p.persona || '';
    if (avatarEl) avatarEl.src = p.avatar || '';

    try {
        if (currentChatType === 'private') {
            const e = db.characters.find(c => c.id === currentChatId);
            if (e) {
                e.myPersona = p.persona || '';
                e.myAvatar = p.avatar || '';
                await saveData();
                showToast('预设已应用并保存到当前聊天');
                if (typeof loadSettingsToSidebar === 'function') try{ loadSettingsToSidebar(); }catch(e){}
                if (typeof renderChatList === 'function') try{ renderChatList(); }catch(e){}
            }
        } else {
            showToast('预设已应用到界面（未检测到当前聊天保存入口）');
        }
    } catch(err) {
        console.error('applyMyPersonaPresetToCurrentChat error', err);
    }
}

function openManageMyPersonaModal() {
    const modal = document.getElementById('mypersona-presets-modal');
    const list = document.getElementById('mypersona-presets-list');
    if (!modal || !list) return;
    list.innerHTML = '';
    const presets = _getMyPersonaPresets();
    if (!presets.length) list.innerHTML = '<p style="color:#888;margin:6px 0;">暂无预设</p>';
    presets.forEach((p, idx) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.padding = '8px 0';
        row.style.borderBottom = '1px solid #f0f0f0';

        const nameDiv = document.createElement('div');
        nameDiv.style.flex = '1';
        nameDiv.style.whiteSpace = 'nowrap';
        nameDiv.style.overflow = 'hidden';
        nameDiv.style.textOverflow = 'ellipsis';
        nameDiv.textContent = p.name;
        row.appendChild(nameDiv);

        const btnWrap = document.createElement('div');
        btnWrap.style.display = 'flex';
        btnWrap.style.gap = '6px';

        const applyBtn = document.createElement('button');
        applyBtn.className = 'btn btn-primary';
        applyBtn.style.padding = '6px 8px;border-radius:8px';
        applyBtn.textContent = '应用';
        applyBtn.onclick = function(){ applyMyPersonaPresetToCurrentChat(p.name); modal.style.display = 'none'; };

        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn';
        renameBtn.style.padding = '6px 8px;border-radius:8px';
        renameBtn.textContent = '重命名';
        renameBtn.onclick = function(){
            const newName = prompt('输入新名称：', p.name);
            if (!newName) return;
            const all = _getMyPersonaPresets();
            all[idx].name = newName;
            _saveMyPersonaPresets(all);
            openManageMyPersonaModal();
            populateMyPersonaSelect();
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn';
        deleteBtn.style.padding = '6px 8px;border-radius:8px;color:#e53935';
        deleteBtn.textContent = '删除';
        deleteBtn.onclick = function(){
            if (!confirm('确认删除该预设？')) return;
            const all = _getMyPersonaPresets();
            all.splice(idx,1);
            _saveMyPersonaPresets(all);
            openManageMyPersonaModal();
            populateMyPersonaSelect();
        };

        btnWrap.appendChild(applyBtn);
        btnWrap.appendChild(renameBtn);
        btnWrap.appendChild(deleteBtn);
        row.appendChild(btnWrap);

        list.appendChild(row);
    });

    modal.style.display = 'flex';
}

function _getFontPresets() {
    return db.fontPresets || [];
}
function _saveFontPresets(arr) {
    db.fontPresets = arr || [];
    saveData();
}

function populateFontPresetSelect() {
    const sel = document.getElementById('font-preset-select');
    if (!sel) return;
    const presets = _getFontPresets();
    sel.innerHTML = '<option value="">— 选择预设 —</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        if (p.isCustom && p.fontFamily) {
            opt.style.fontFamily = p.fontFamily;
        }
        sel.appendChild(opt);
    });
}

function saveCurrentFontAsPreset() {
    const fontUrlInput = document.getElementById('customize-font-url');
    if (!fontUrlInput) return showToast('找不到字体 URL 输入框');
    const url = fontUrlInput.value.trim();
    if (!url) return showToast('字体 URL 为空，无法保存');
    
    let name = prompt('请输入预设名称（将覆盖同名预设）：');
    if (!name) return;
    
    const presets = _getFontPresets();
    const idx = presets.findIndex(p => p.name === name);
    const preset = { name, url, isCustom: false };
    
    if (idx >= 0) presets[idx] = preset; 
    else presets.push(preset);
    
    _saveFontPresets(presets);
    populateFontPresetSelect();
    showToast('字体预设已保存');
}

async function applyFontPreset(name) {
    const presets = _getFontPresets();
    const p = presets.find(x => x.name === name);
    if (!p) return showToast('未找到该预设');
    
    const fontUrlInput = document.getElementById('customize-font-url');
    if (fontUrlInput) {
        fontUrlInput.value = p.isCustom ? '[本地字体] ' + p.name : (p.url || '');
    }
    
    if (p.isCustom) {
        db.fontUrl = p.fontFamily;
        await saveData();
        applyGlobalFont(p.fontFamily, true);
    } else {
        db.fontUrl = p.url;
        await saveData();
        applyGlobalFont(p.url, false);
    }
    showToast('已应用字体预设');
}

function openFontManageModal() {
    const modal = document.getElementById('font-presets-modal');
    const list = document.getElementById('font-presets-list');
    if (!modal || !list) return;
    
    list.innerHTML = '';
    const presets = _getFontPresets();
    if (!presets.length) list.innerHTML = '<p style="color:#888;margin:6px 0;">暂无预设</p>';
    
    presets.forEach((p, idx) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.padding = '8px 0';
        row.style.borderBottom = '1px solid #f0f0f0';

        const nameDiv = document.createElement('div');
        nameDiv.style.flex = '1';
        nameDiv.style.whiteSpace = 'nowrap';
        nameDiv.style.overflow = 'hidden';
        nameDiv.style.textOverflow = 'ellipsis';
        nameDiv.textContent = p.name;
        if (p.isCustom && p.fontFamily) {
            nameDiv.style.fontFamily = p.fontFamily;
        }
        row.appendChild(nameDiv);

        const btnWrap = document.createElement('div');
        btnWrap.style.display = 'flex';
        btnWrap.style.gap = '6px';

        const applyBtn = document.createElement('button');
        applyBtn.className = 'btn btn-primary';
        applyBtn.style.padding = '6px 8px;border-radius:8px';
        applyBtn.textContent = '应用';
        applyBtn.onclick = function(){ applyFontPreset(p.name); modal.style.display = 'none'; };

        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn';
        renameBtn.style.padding = '6px 8px;border-radius:8px';
        renameBtn.textContent = '重命名';
        renameBtn.onclick = function(){
            const newName = prompt('输入新名称：', p.name);
            if (!newName) return;
            const all = _getFontPresets();
            all[idx].name = newName;
            _saveFontPresets(all);
            openFontManageModal();
            populateFontPresetSelect();
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn';
        deleteBtn.style.padding = '6px 8px;border-radius:8px;color:#e53935';
        deleteBtn.textContent = '删除';
        deleteBtn.onclick = async function(){
            if (!confirm('确认删除该预设？')) return;
            const all = _getFontPresets();
            const deletedPreset = all.splice(idx,1)[0];
            _saveFontPresets(all);
            
            if (deletedPreset.isCustom && deletedPreset.id) {
                try {
                    await dexieDB.customFonts.delete(deletedPreset.id);
                    document.fonts.forEach(font => {
                        if (font.family === deletedPreset.fontFamily) {
                            document.fonts.delete(font);
                        }
                    });
                } catch (e) {
                    console.error('Failed to delete custom font from DB:', e);
                }
            }
            
            openFontManageModal();
            populateFontPresetSelect();
        };

        btnWrap.appendChild(applyBtn);
        btnWrap.appendChild(renameBtn);
        btnWrap.appendChild(deleteBtn);
        row.appendChild(btnWrap);

        list.appendChild(row);
    });

    modal.style.display = 'flex';
}

function setupPresetFeatures() {
    const saveBtn = document.getElementById('api-save-preset');
    const manageBtn = document.getElementById('api-manage-presets');
    const applyBtn = document.getElementById('api-apply-preset');
    const select = document.getElementById('api-preset-select');
    const modalClose = document.getElementById('api-close-modal');
    const importBtn = document.getElementById('api-import-presets');
    const exportBtn = document.getElementById('api-export-presets');

    if (saveBtn) saveBtn.addEventListener('click', saveCurrentApiAsPreset);
    if (manageBtn) manageBtn.addEventListener('click', openApiManageModal);
    if (applyBtn) applyBtn.addEventListener('click', function(){ const v=select.value; if(!v) return showToast('请选择预设'); applyApiPreset(v); });
    if (modalClose) modalClose.addEventListener('click', function(){ document.getElementById('api-presets-modal').style.display='none'; });
    if (importBtn) importBtn.addEventListener('click', importApiPresets);
    if (exportBtn) exportBtn.addEventListener('click', exportApiPresets);
    
    const bubbleApplyBtn = document.getElementById('apply-preset-btn');
    const bubbleSaveBtn = document.getElementById('save-preset-btn');
    const bubbleManageBtn = document.getElementById('manage-presets-btn');
    const bubbleModalClose = document.getElementById('close-presets-modal');

    const groupBubbleApplyBtn = document.getElementById('group-apply-preset-btn');
    const groupBubbleSaveBtn = document.getElementById('group-save-preset-btn');
    const groupBubbleManageBtn = document.getElementById('group-manage-presets-btn');

    // 导出/导入相关元素
    const exportBubbleBtn = document.getElementById('export-preset-btn');
    const groupExportBubbleBtn = document.getElementById('group-export-preset-btn');
    const importBubbleBtn = document.getElementById('import-preset-btn');
    const groupImportBubbleBtn = document.getElementById('group-import-preset-btn');
    const bubbleImportInput = document.getElementById('bubble-preset-import-input');
    
    const exportModal = document.getElementById('export-bubble-preset-modal');
    const exportNameInput = document.getElementById('export-bubble-preset-name');
    const exportIncludeYes = document.getElementById('export-bubble-include-yes');
    const exportIncludeNo = document.getElementById('export-bubble-include-no');
    const exportAuthorNote = document.getElementById('export-bubble-author-note');
    const confirmExportBtn = document.getElementById('confirm-export-bubble-btn');
    const cancelExportBtn = document.getElementById('cancel-export-bubble-btn');
    
    let exportIncludeSettings = null; // null: 未选择, true: 是, false: 否

    function openExportModal() {
        exportNameInput.value = '';
        exportAuthorNote.value = '';
        exportIncludeSettings = null;
        exportIncludeYes.classList.remove('btn-primary');
        exportIncludeYes.classList.add('btn-neutral');
        exportIncludeNo.classList.remove('btn-primary');
        exportIncludeNo.classList.add('btn-neutral');
        confirmExportBtn.disabled = true;
        exportModal.style.display = 'flex';
    }

    if (exportIncludeYes) {
        exportIncludeYes.addEventListener('click', () => {
            exportIncludeSettings = true;
            exportIncludeYes.classList.remove('btn-neutral');
            exportIncludeYes.classList.add('btn-primary');
            exportIncludeNo.classList.remove('btn-primary');
            exportIncludeNo.classList.add('btn-neutral');
            confirmExportBtn.disabled = false;
        });
    }

    if (exportIncludeNo) {
        exportIncludeNo.addEventListener('click', () => {
            exportIncludeSettings = false;
            exportIncludeNo.classList.remove('btn-neutral');
            exportIncludeNo.classList.add('btn-primary');
            exportIncludeYes.classList.remove('btn-primary');
            exportIncludeYes.classList.add('btn-neutral');
            confirmExportBtn.disabled = false;
        });
    }

    if (cancelExportBtn) {
        cancelExportBtn.addEventListener('click', () => {
            exportModal.style.display = 'none';
        });
    }

    if (confirmExportBtn) {
        confirmExportBtn.addEventListener('click', () => {
            const name = exportNameInput.value.trim();
            if (!name) return showToast('请输入预设名称');
            
            const textarea = currentChatType === 'private' ? document.getElementById('setting-custom-bubble-css') : document.getElementById('setting-group-custom-bubble-css');
            const css = textarea ? textarea.value.trim() : '';
            
            const presetData = {
                name: name,
                css: css,
                authorNote: exportAuthorNote.value.trim()
            };

            if (exportIncludeSettings) {
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                if (chat) {
                    presetData.settings = {
                        theme: document.getElementById('setting-theme-color') ? document.getElementById('setting-theme-color').value : chat.theme,
                        chatBg: chat.chatBg,
                        bilingualModeEnabled: document.getElementById('setting-bilingual-mode') ? document.getElementById('setting-bilingual-mode').checked : chat.bilingualModeEnabled,
                        bilingualBubbleStyle: document.getElementById('setting-bilingual-style') ? document.getElementById('setting-bilingual-style').value : chat.bilingualBubbleStyle,
                        avatarMode: document.getElementById('setting-avatar-mode') ? document.getElementById('setting-avatar-mode').value : chat.avatarMode,
                        avatarRadius: document.getElementById('setting-avatar-radius') ? parseInt(document.getElementById('setting-avatar-radius').value, 10) : chat.avatarRadius,
                        bubbleBlurEnabled: document.getElementById('setting-bubble-blur') ? document.getElementById('setting-bubble-blur').checked : chat.bubbleBlurEnabled,
                        titleLayout: document.getElementById('setting-title-layout') ? document.getElementById('setting-title-layout').value : chat.titleLayout,
                        showTimestamp: document.getElementById('setting-show-timestamp') ? document.getElementById('setting-show-timestamp').checked : chat.showTimestamp,
                        timestampStyle: document.getElementById('setting-timestamp-style') ? document.getElementById('setting-timestamp-style').value : chat.timestampStyle
                    };
                }
            }

            const blob = new Blob([JSON.stringify(presetData, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; 
            a.download = `bubble_preset_${name}.json`; 
            document.body.appendChild(a); 
            a.click(); 
            a.remove();
            URL.revokeObjectURL(url);
            
            exportModal.style.display = 'none';
            showToast('预设已导出');
        });
    }

    if (exportBubbleBtn) exportBubbleBtn.addEventListener('click', openExportModal);
    if (groupExportBubbleBtn) groupExportBubbleBtn.addEventListener('click', openExportModal);

    if (importBubbleBtn) importBubbleBtn.addEventListener('click', () => bubbleImportInput.click());
    if (groupImportBubbleBtn) groupImportBubbleBtn.addEventListener('click', () => bubbleImportInput.click());

    if (bubbleImportInput) {
        bubbleImportInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const fileName = file.name;
            const fileExt = fileName.split('.').pop().toLowerCase();
            const presetName = fileName.substring(0, fileName.lastIndexOf('.'));

            const processImportData = (data) => {
                try {
                    const presets = _getBubblePresets();
                    const idx = presets.findIndex(p => p.name === data.name);
                    if (idx >= 0) {
                        if (confirm(`已存在名为 "${data.name}" 的预设，是否覆盖？`)) {
                            presets[idx] = data;
                        } else {
                            return;
                        }
                    } else {
                        presets.push(data);
                    }
                    
                    _saveBubblePresets(presets);
                    populateBubblePresetSelect('bubble-preset-select'); 
                    populateBubblePresetSelect('group-bubble-preset-select');
                    showToast('预设导入成功');
                } catch(err) {
                    showToast('导入失败：' + err.message);
                } finally {
                    bubbleImportInput.value = '';
                }
            };

            if (fileExt === 'json') {
                const reader = new FileReader();
                reader.onload = function() {
                    try {
                        const data = JSON.parse(reader.result);
                        if (!data.name || typeof data.css === 'undefined') {
                            throw new Error('无效的预设文件格式');
                        }
                        processImportData(data);
                    } catch(err) {
                        showToast('导入失败：' + err.message);
                        bubbleImportInput.value = '';
                    }
                };
                reader.readAsText(file);
            } else if (fileExt === 'txt') {
                const reader = new FileReader();
                reader.onload = function() {
                    const text = reader.result;
                    // 简单检测是否乱码 (包含大量不可见字符或替换字符)
                    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFD]/.test(text) && text.length > 10) {
                        showToast('检测到乱码，请确保文件编码为 UTF-8');
                        bubbleImportInput.value = '';
                        return;
                    }
                    processImportData({ name: presetName, css: text });
                };
                reader.readAsText(file);
            } else if (fileExt === 'docx') {
                if (typeof mammoth === 'undefined') {
                    showToast('缺少文档解析库，无法读取 docx');
                    bubbleImportInput.value = '';
                    return;
                }
                const reader = new FileReader();
                reader.onload = function(event) {
                    const arrayBuffer = event.target.result;
                    mammoth.extractRawText({arrayBuffer: arrayBuffer})
                        .then(function(result) {
                            const text = result.value;
                            processImportData({ name: presetName, css: text });
                        })
                        .catch(function(err) {
                            showToast('docx 解析失败：' + err.message);
                            bubbleImportInput.value = '';
                        });
                };
                reader.readAsArrayBuffer(file);
            } else if (fileExt === 'doc') {
                // 尝试强行读取旧版 doc
                const reader = new FileReader();
                reader.onload = function() {
                    const text = reader.result;
                    // 强行读取二进制文件通常会产生大量乱码
                    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFD]/.test(text)) {
                        alert('检测到 .doc 文件包含乱码。旧版 .doc 为二进制格式，无法直接提取文本。请将其另存为 .docx 或 .txt 后再导入。');
                        bubbleImportInput.value = '';
                        return;
                    }
                    processImportData({ name: presetName, css: text });
                };
                reader.readAsText(file);
            } else {
                showToast('不支持的文件格式');
                bubbleImportInput.value = '';
            }
        });
    }

    if (bubbleApplyBtn) bubbleApplyBtn.addEventListener('click', () => {
        const selVal = document.getElementById('bubble-preset-select').value;
        if (!selVal) return showToast('请选择要应用的预设');
        applyPresetToCurrentChat(selVal);
    });
    if (bubbleSaveBtn) bubbleSaveBtn.addEventListener('click', saveCurrentTextareaAsPreset);
    if (bubbleManageBtn) bubbleManageBtn.addEventListener('click', openManagePresetsModal);
    if (bubbleModalClose) bubbleModalClose.addEventListener('click', () => {
        document.getElementById('bubble-presets-modal').style.display = 'none';
    });

    if (groupBubbleApplyBtn) groupBubbleApplyBtn.addEventListener('click', () => {
        const selVal = document.getElementById('group-bubble-preset-select').value;
        if (!selVal) return showToast('请选择要应用的预设');
        applyPresetToCurrentChat(selVal);
    });
    if (groupBubbleSaveBtn) groupBubbleSaveBtn.addEventListener('click', saveCurrentTextareaAsPreset);
    if (groupBubbleManageBtn) groupBubbleManageBtn.addEventListener('click', openManagePresetsModal);

    const personaSaveBtn = document.getElementById('mypersona-save-btn');
    const personaManageBtn = document.getElementById('mypersona-manage-btn');
    const personaApplyBtn = document.getElementById('mypersona-apply-btn');
    const personaSelect = document.getElementById('mypersona-preset-select');
    const personaModalClose = document.getElementById('mypersona-close-modal');

    if (personaSaveBtn) personaSaveBtn.addEventListener('click', saveCurrentMyPersonaAsPreset);
    if (personaManageBtn) personaManageBtn.addEventListener('click', openManageMyPersonaModal);
    if (personaApplyBtn) personaApplyBtn.addEventListener('click', function(){ const v = personaSelect.value; if(!v) return showToast('请选择要应用的预设'); applyMyPersonaPresetToCurrentChat(v); });
    if (personaModalClose) personaModalClose.addEventListener('click', function(){ document.getElementById('mypersona-presets-modal').style.display='none'; });

    const globalCssModalClose = document.getElementById('global-css-close-modal');
    if (globalCssModalClose) globalCssModalClose.addEventListener('click', () => {
        document.getElementById('global-css-presets-modal').style.display = 'none';
    });

    const fontModalClose = document.getElementById('font-close-modal');
    if (fontModalClose) fontModalClose.addEventListener('click', () => {
        document.getElementById('font-presets-modal').style.display = 'none';
    });

    const soundModalClose = document.getElementById('sound-close-modal');
    if (soundModalClose) soundModalClose.addEventListener('click', () => {
        document.getElementById('sound-presets-modal').style.display = 'none';
    });
}

function populateGlobalCssPresetSelect() {
    const select = document.getElementById('global-css-preset-select');
    if (!select) return;
    select.innerHTML = '<option value="">— 选择预设 —</option>';
    (db.globalCssPresets || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        select.appendChild(opt);
    });
}

function openGlobalCssManageModal() {
    const modal = document.getElementById('global-css-presets-modal');
    const list = document.getElementById('global-css-presets-list');
    if (!modal || !list) return;
    list.innerHTML = '';
    const presets = db.globalCssPresets || [];
    if (!presets.length) list.innerHTML = '<p style="color:#888;margin:6px 0;">暂无预设</p>';
    
    presets.forEach((p, idx) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.padding = '8px 0';
        row.style.borderBottom = '1px solid #f0f0f0';
        
        const nameDiv = document.createElement('div');
        nameDiv.style.flex = '1';
        nameDiv.style.whiteSpace = 'nowrap';
        nameDiv.style.overflow = 'hidden';
        nameDiv.style.textOverflow = 'ellipsis';
        nameDiv.textContent = p.name;
        row.appendChild(nameDiv);

        const btnWrap = document.createElement('div');
        btnWrap.style.display = 'flex';
        btnWrap.style.gap = '6px';

        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn';
        renameBtn.style.padding = '6px 8px';
        renameBtn.textContent = '重命名';
        renameBtn.onclick = function() {
            const newName = prompt('输入新名称：', p.name);
            if (!newName || newName === p.name) return;
            db.globalCssPresets[idx].name = newName;
            saveData();
            openGlobalCssManageModal();
            populateGlobalCssPresetSelect();
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger';
        delBtn.style.padding = '6px 8px';
        delBtn.textContent = '删除';
        delBtn.onclick = function() {
            if (!confirm('确定删除预设 "' + p.name + '" ?')) return;
            db.globalCssPresets.splice(idx, 1);
            saveData();
            openGlobalCssManageModal();
            populateGlobalCssPresetSelect();
        };

        btnWrap.appendChild(renameBtn);
        btnWrap.appendChild(delBtn);
        row.appendChild(btnWrap);
        list.appendChild(row);
    });
    modal.style.display = 'flex';
}

function _getSoundPresets() {
    return db.soundPresets || [];
}
function _saveSoundPresets(arr) {
    db.soundPresets = arr || [];
    saveData();
}

function populateSoundPresetSelect() {
    const sel = document.getElementById('sound-preset-select');
    if (!sel) return;
    const presets = _getSoundPresets();
    sel.innerHTML = '<option value="">— 选择预设 —</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

function saveCurrentSoundAsPreset() {
    const sendUrl = document.getElementById('global-send-sound-url').value.trim();
    const receiveUrl = document.getElementById('global-receive-sound-url').value.trim();
    
    if (!sendUrl && !receiveUrl) return showToast('提示音配置为空，无法保存');
    
    let name = prompt('请输入预设名称（将覆盖同名预设）：');
    if (!name) return;
    
    const presets = _getSoundPresets();
    const idx = presets.findIndex(p => p.name === name);
    const preset = { name, sendSound: sendUrl, receiveSound: receiveUrl };
    
    if (idx >= 0) presets[idx] = preset; 
    else presets.push(preset);
    
    _saveSoundPresets(presets);
    populateSoundPresetSelect();
    showToast('提示音预设已保存');
}

function applySoundPreset(name) {
    const presets = _getSoundPresets();
    const p = presets.find(x => x.name === name);
    if (!p) return showToast('未找到该预设');
    
    const sendInput = document.getElementById('global-send-sound-url');
    const receiveInput = document.getElementById('global-receive-sound-url');
    
    if (sendInput) sendInput.value = p.sendSound || '';
    if (receiveInput) receiveInput.value = p.receiveSound || '';
    
    db.globalSendSound = p.sendSound || '';
    db.globalReceiveSound = p.receiveSound || '';
    saveData();
    
    showToast('已应用提示音预设');
}

function openSoundManageModal() {
    const modal = document.getElementById('sound-presets-modal');
    const list = document.getElementById('sound-presets-list');
    if (!modal || !list) return;
    
    list.innerHTML = '';
    const presets = _getSoundPresets();
    if (!presets.length) list.innerHTML = '<p style="color:#888;margin:6px 0;">暂无预设</p>';
    
    presets.forEach((p, idx) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.padding = '8px 0';
        row.style.borderBottom = '1px solid #f0f0f0';

        const nameDiv = document.createElement('div');
        nameDiv.style.flex = '1';
        nameDiv.style.whiteSpace = 'nowrap';
        nameDiv.style.overflow = 'hidden';
        nameDiv.style.textOverflow = 'ellipsis';
        nameDiv.textContent = p.name;
        row.appendChild(nameDiv);

        const btnWrap = document.createElement('div');
        btnWrap.style.display = 'flex';
        btnWrap.style.gap = '6px';

        const applyBtn = document.createElement('button');
        applyBtn.className = 'btn btn-primary';
        applyBtn.style.padding = '6px 8px;border-radius:8px';
        applyBtn.textContent = '应用';
        applyBtn.onclick = function(){ applySoundPreset(p.name); modal.style.display = 'none'; };

        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn';
        renameBtn.style.padding = '6px 8px;border-radius:8px';
        renameBtn.textContent = '重命名';
        renameBtn.onclick = function(){
            const newName = prompt('输入新名称：', p.name);
            if (!newName) return;
            const all = _getSoundPresets();
            all[idx].name = newName;
            _saveSoundPresets(all);
            openSoundManageModal();
            populateSoundPresetSelect();
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn';
        deleteBtn.style.padding = '6px 8px;border-radius:8px;color:#e53935';
        deleteBtn.textContent = '删除';
        deleteBtn.onclick = function(){
            if (!confirm('确认删除该预设？')) return;
            const all = _getSoundPresets();
            all.splice(idx,1);
            _saveSoundPresets(all);
            openSoundManageModal();
            populateSoundPresetSelect();
        };

        btnWrap.appendChild(applyBtn);
        btnWrap.appendChild(renameBtn);
        btnWrap.appendChild(deleteBtn);
        row.appendChild(btnWrap);

        list.appendChild(row);
    });

    modal.style.display = 'flex';
}
;
// --- 个性化与外观设置逻辑 ---

function setupWallpaperApp() {
    const e = document.getElementById('wallpaper-upload'), t = document.getElementById('wallpaper-preview');
    if (t) {
        t.style.backgroundImage = `url(${db.wallpaper})`;
        t.textContent = '';
    }
    if (e) {
        e.addEventListener('change', async (a) => {
            const n = a.target.files[0];
            if (n) {
                try {
                    const r = await compressImage(n, {quality: 0.85, maxWidth: 1080, maxHeight: 1920});
                    db.wallpaper = r;
                    applyWallpaper(r);
                    if (t) t.style.backgroundImage = `url(${r})`;
                    await saveData();
                    showToast('壁纸已更新');
                } catch (error) {
                    showToast('壁纸压缩失败');
                }
            }
        });
    }
}

function setupCustomizeApp() {
    const customizeForm = document.getElementById('customize-form');
    
    document.body.addEventListener('click', async (e) => {
        const target = e.target;

        const header = target.closest('.collapsible-header');
        if (header) {
            const section = header.closest('.collapsible-section');
            if (section) {
                section.classList.toggle('open');
                return; 
            }
        }

        if (target.matches('.reset-icon-btn')) {
            const iconId = target.dataset.id;
            if (db.customIcons) {
                delete db.customIcons[iconId];
            }
            await saveData();
            renderCustomizeForm();
            setupHomeScreen();
            showToast('图标已重置');
        }

        if (target.matches('#apply-global-css-now-btn')) {
            const textarea = document.getElementById('global-beautification-css');
            const newCss = textarea.value;
            db.globalCss = newCss;
            applyGlobalCss(newCss);
            await saveData();
            showToast('全局样式已应用');
        }
        
        if (target.matches('#global-css-apply-btn')) {
            const select = document.getElementById('global-css-preset-select');
            const presetName = select.value;
            if (!presetName) return showToast('请选择一个预设');
            const preset = db.globalCssPresets.find(p => p.name === presetName);
            if (preset) {
                const textarea = document.getElementById('global-beautification-css');
                textarea.value = preset.css;
                db.globalCss = preset.css;
                applyGlobalCss(preset.css);
                saveData();
                showToast('全局CSS预设已应用');
            }
        }
        
        if (target.matches('#global-css-save-btn')) {
            const textarea = document.getElementById('global-beautification-css');
            const css = textarea.value.trim();
            if (!css) return showToast('CSS内容为空，无法保存');
            const name = prompt('请输入此预设的名称（同名将覆盖）:');
            if (!name) return;
            if (!db.globalCssPresets) db.globalCssPresets = [];
            const existingIndex = db.globalCssPresets.findIndex(p => p.name === name);
            if (existingIndex > -1) {
                db.globalCssPresets[existingIndex].css = css;
            } else {
                db.globalCssPresets.push({ name, css });
            }
            saveData();
            populateGlobalCssPresetSelect();
            showToast('全局CSS预设已保存');
        }
        
        if (target.matches('#global-css-manage-btn')) {
            openGlobalCssManageModal();
        }
        
        if (target.matches('#apply-font-btn')) {
            const fontUrl = document.getElementById('customize-font-url').value.trim();
            if (fontUrl.startsWith('[本地字体] ')) {
                const presetName = fontUrl.replace('[本地字体] ', '');
                applyFontPreset(presetName);
            } else {
                db.fontUrl = fontUrl;
                await saveData();
                applyGlobalFont(fontUrl, false);
                showToast('新字体已应用！');
            }
        }
        
        if (target.matches('#restore-font-btn')) {
            document.getElementById('customize-font-url').value = '';
            db.fontUrl = '';
            await saveData();
            applyGlobalFont('', false);
            showToast('已恢复默认字体！');
        }

        if (target.matches('#font-apply-preset-btn')) {
            const select = document.getElementById('font-preset-select');
            const presetName = select.value;
            if (!presetName) return showToast('请选择一个预设');
            applyFontPreset(presetName);
        }
        
        if (target.matches('#font-save-preset-btn')) {
            saveCurrentFontAsPreset();
        }
        
        if (target.matches('#font-manage-presets-btn')) {
            openFontManageModal();
        }

        if (target.matches('#sound-apply-preset-btn')) {
            const select = document.getElementById('sound-preset-select');
            const presetName = select.value;
            if (!presetName) return showToast('请选择一个预设');
            applySoundPreset(presetName);
        }
        
        if (target.matches('#sound-save-preset-btn')) {
            saveCurrentSoundAsPreset();
        }
        
        if (target.matches('#sound-manage-presets-btn')) {
            openSoundManageModal();
        }

        if (target.matches('#test-send-sound-btn')) {
            const url = document.getElementById('global-send-sound-url').value;
            if (url) {
                try {
                    const audio = new Audio(url);
                    audio.play().catch(e => showToast('播放失败: ' + e.message));
                } catch (e) {
                    showToast('无效的音频地址');
                }
            } else {
                showToast('未设置提示音');
            }
        }
        if (target.matches('#reset-send-sound-btn')) {
            document.getElementById('global-send-sound-url').value = '';
            db.globalSendSound = '';
            saveData();
            showToast('已重置');
        }
        if (target.matches('#test-receive-sound-btn')) {
            const url = document.getElementById('global-receive-sound-url').value;
            if (url) {
                try {
                    const audio = new Audio(url);
                    audio.play().catch(e => showToast('播放失败: ' + e.message));
                } catch (e) {
                    showToast('无效的音频地址');
                }
            } else {
                showToast('未设置提示音');
            }
        }
        if (target.matches('#reset-receive-sound-btn')) {
            document.getElementById('global-receive-sound-url').value = '';
            db.globalReceiveSound = '';
            saveData();
            showToast('已重置');
        }
    });

    document.body.addEventListener('input', async (e) => {
        const target = e.target;

        if (target.dataset.iconId) { 
            const iconId = target.dataset.iconId;
            const newUrl = target.value.trim();
            const previewImg = document.getElementById(`icon-preview-${iconId}`);
            if (newUrl) {
                if (!db.customIcons) db.customIcons = {};
                db.customIcons[iconId] = newUrl;
                if(previewImg) previewImg.src = newUrl;
            }
            await saveData();
            setupHomeScreen();
        } 
        else if (target.dataset.widgetPart) {
            const part = target.dataset.widgetPart;
            const prop = target.dataset.widgetProp;
            const newValue = target.value.trim();

            if (prop) { 
                db.homeWidgetSettings[part][prop] = newValue;
            } else { 
                db.homeWidgetSettings[part] = newValue;
            }
            await saveData();
            setupHomeScreen();
        }
    });

    document.body.addEventListener('change', async (e) => {
        if (e.target.id === 'local-font-upload') {
            const file = e.target.files[0];
            if (!file) return;
            
            const validTypes = ['font/ttf', 'font/woff', 'font/woff2', 'font/otf'];
            const validExtensions = ['.ttf', '.woff', '.woff2', '.otf'];
            const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
            
            if (!validTypes.includes(file.type) && !validExtensions.includes(fileExt)) {
                showToast('不支持的字体格式，请上传 ttf, woff, woff2 或 otf 文件');
                e.target.value = '';
                return;
            }

            try {
                showToast('正在处理字体文件...');
                const presetId = 'font_' + Date.now();
                const fontFamily = 'CustomFont_' + Date.now();
                
                await dexieDB.customFonts.put({
                    id: presetId,
                    file: file,
                    timestamp: Date.now()
                });

                const presetName = file.name.substring(0, file.name.lastIndexOf('.'));
                const newPreset = {
                    id: presetId,
                    name: presetName,
                    isCustom: true,
                    fontFamily: fontFamily
                };

                const presets = _getFontPresets();
                presets.push(newPreset);
                _saveFontPresets(presets);
                
                await injectCustomFont(newPreset);
                populateFontPresetSelect();
                
                const select = document.getElementById('font-preset-select');
                if (select) {
                    select.value = presetName;
                    await applyFontPreset(presetName);
                }
                
                showToast('本地字体已上传并应用');
            } catch (error) {
                console.error('字体上传失败:', error);
                showToast('字体上传失败，请重试');
            } finally {
                e.target.value = '';
            }
        }

        if (e.target.matches('.icon-upload-input')) {
            const file = e.target.files[0];
            if (!file) return;
            const iconId = e.target.dataset.iconId;
            
            try {
                showToast('正在处理图片...');
                const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 200, maxHeight: 200 });
                
                if (!db.customIcons) db.customIcons = {};
                db.customIcons[iconId] = compressedUrl;
                
                const previewImg = document.getElementById(`icon-preview-${iconId}`);
                const urlInput = document.querySelector(`input[data-icon-id="${iconId}"][type="url"]`);
                
                if (previewImg) previewImg.src = compressedUrl;
                if (urlInput) urlInput.value = compressedUrl;
                
                await saveData();
                setupHomeScreen();
                showToast('图标已更新');
            } catch (error) {
                console.error('图标上传失败', error);
                showToast('图片处理失败，请重试');
            } finally {
                e.target.value = null;
            }
        }

        if (e.target.id === 'global-send-sound-url') {
            db.globalSendSound = e.target.value.trim();
            saveData();
        }
        if (e.target.id === 'global-receive-sound-url') {
            db.globalReceiveSound = e.target.value.trim();
            saveData();
        }
        if (e.target.id === 'multi-msg-sound-switch') {
            db.multiMsgSoundEnabled = e.target.checked;
            saveData();
        }
        if (e.target.id === 'global-send-sound-upload' || e.target.id === 'global-receive-sound-upload') {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
                showToast('文件过大，请限制在 2MB 以内');
                e.target.value = null;
                return;
            }
            const reader = new FileReader();
            reader.onload = async (evt) => {
                const base64 = evt.target.result;
                if (e.target.id === 'global-send-sound-upload') {
                    db.globalSendSound = base64;
                    document.getElementById('global-send-sound-url').value = base64;
                } else {
                    db.globalReceiveSound = base64;
                    document.getElementById('global-receive-sound-url').value = base64;
                }
                await saveData();
                showToast('提示音已上传');
            };
            reader.readAsDataURL(file);
            e.target.value = null;
        }
    });
}

function renderCustomizeForm() {
    const customizeForm = document.getElementById('customize-form');
    customizeForm.innerHTML = ''; 
    
    const container = document.createElement('div');
    container.className = 'kkt-settings-container';
    
    const iconOrder = [
        'chat-list-screen', 'api-settings-screen', 'wallpaper-screen',
        'world-book-screen', 'customize-screen', 'tutorial-screen',
        'day-mode-btn', 'night-mode-btn', 'forum-screen', 'music-screen', 'console-screen', 'pomodoro-screen', 'storage-analysis-screen', 'widget-market-screen', 'reader-bookshelf-screen', 'placeholder-app'
    ];

    let iconsContentHTML = '';
    iconOrder.forEach(id => {
        if (!defaultIcons[id]) return;
        const { name, url } = defaultIcons[id];
        const currentIcon = (db.customIcons && db.customIcons[id]) || url;
        iconsContentHTML += `
        <div class="kkt-item">
            <div class="kkt-item-label">
                <img src="${currentIcon}" alt="${name}" class="kkt-small-avatar" id="icon-preview-${id}" style="width: 40px; height: 40px; border-radius: 10px; margin-right: 10px; object-fit: cover;">
                <span>${name || '模式切换'}</span>
            </div>
            <div class="kkt-item-control" style="gap: 8px;">
                <input type="url" placeholder="URL" value="${(db.customIcons && db.customIcons[id]) || ''}" data-icon-id="${id}" style="text-align:right; border:none; background:transparent; width: 100px; font-size: 13px; color: #888;">
                <input type="file" id="upload-icon-${id}" data-icon-id="${id}" accept="image/*" style="display:none;" class="icon-upload-input">
                <label for="upload-icon-${id}" class="btn btn-small btn-neutral" style="padding: 4px 8px; font-size: 12px; margin: 0; cursor: pointer;">📷</label>
                <button type="button" class="reset-icon-btn btn btn-small" data-id="${id}" style="padding: 4px 8px; font-size: 12px; margin: 0; background-color: #f0f0f0; color: #666; border:none;">↺</button>
            </div>
        </div>`;
    });

    const appearanceSection = `
    <div class="kkt-group-title" style="margin-left: 15px; margin-bottom: 8px; font-size: 13px; color: #666;">界面与外观</div>
    <div class="kkt-group">
        <!-- 字体大小 -->
        <div class="kkt-item" style="flex-direction: column; align-items: stretch; padding-bottom: 15px;">
            <div style="display: flex; align-items: center; margin-bottom: 10px;">
                <div class="kkt-item-icon" style="background: transparent; color: #007AFF;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>
                </div>
                <div class="kkt-item-content">
                    <div class="kkt-item-title">全局字体大小</div>
                    <div class="kkt-item-subtitle">调整应用内文字的缩放比例</div>
                </div>
                <span id="font-size-value" style="color: var(--primary-color); font-weight: bold; font-size: 16px;">${(db.fontSizeScale || 1.0).toFixed(1)}x</span>
            </div>
            <input type="range" id="font-size-slider" min="0.8" max="1.5" step="0.1" value="${db.fontSizeScale || 1.0}" style="width: 100%; accent-color: var(--primary-color); margin-top: 8px;">
        </div>

        <!-- 字体设置 -->
        <div class="kkt-item" onclick="document.getElementById('font-settings-modal').classList.add('visible')" style="cursor: pointer;">
            <div class="kkt-item-icon" style="background: transparent; color: #FF9500;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
            </div>
            <div class="kkt-item-content">
                <div class="kkt-item-title">自定义字体</div>
                <div class="kkt-item-subtitle">上传或输入字体链接</div>
            </div>
            <span class="kkt-arrow">›</span>
        </div>

        <!-- 全局CSS -->
        <div class="kkt-item" onclick="document.getElementById('global-css-modal').classList.add('visible')" style="cursor: pointer;">
            <div class="kkt-item-icon" style="background: transparent; color: #AF52DE;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle></svg>
            </div>
            <div class="kkt-item-content">
                <div class="kkt-item-title">全局CSS美化</div>
                <div class="kkt-item-subtitle">自定义应用全局样式</div>
            </div>
            <span class="kkt-arrow">›</span>
        </div>
    </div>
    `;

    const soundSectionHTML = `
    <div class="kkt-group-title" style="margin-left: 15px; margin-bottom: 8px; font-size: 13px; color: #666; margin-top: 20px;">声音与振动</div>
    <div class="kkt-group">
        <div class="kkt-item" onclick="document.getElementById('sound-settings-modal').classList.add('visible')" style="cursor: pointer;">
            <div class="kkt-item-icon" style="background: transparent; color: #34C759;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
            </div>
            <div class="kkt-item-content">
                <div class="kkt-item-title">消息提示音</div>
                <div class="kkt-item-subtitle">发送与接收消息的音效</div>
            </div>
            <span class="kkt-arrow">›</span>
        </div>
    </div>
    `;

    const iconsSectionHTML = `
    <div class="kkt-group-title" style="margin-left: 15px; margin-bottom: 8px; font-size: 13px; color: #666; margin-top: 20px;">个性化</div>
    <div class="kkt-group">
        <div class="kkt-item" onclick="document.getElementById('icon-settings-modal').classList.add('visible')" style="cursor: pointer;">
            <div class="kkt-item-icon" style="background: transparent; color: #FF2D55;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            </div>
            <div class="kkt-item-content">
                <div class="kkt-item-title">自定义图标</div>
                <div class="kkt-item-subtitle">修改主页应用图标</div>
            </div>
            <span class="kkt-arrow">›</span>
        </div>
    </div>
    `;

    container.innerHTML = appearanceSection + soundSectionHTML + iconsSectionHTML;
    customizeForm.appendChild(container);

    // 注入模态框 HTML 到 body (如果不存在)
    if (!document.getElementById('font-settings-modal')) {
        const modalsHTML = `
        <!-- 字体设置模态框 -->
        <div id="font-settings-modal" class="modal-overlay">
            <div class="modal-window" style="max-height: 80vh; overflow-y: auto;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="margin: 0;">自定义字体</h3>
                    <button class="icon-btn-simple" onclick="document.getElementById('font-settings-modal').classList.remove('visible')">✕</button>
                </div>
                <div class="form-group" style="margin-top: 15px;">
                    <input type="text" id="customize-font-url" placeholder="例如：https://example.com/font.woff2" value="${db.fontUrl && db.fontUrl.startsWith('CustomFont_') ? '[本地字体] 已应用' : (db.fontUrl || '')}" style="width:100%; border:1px solid #eee; border-radius:8px; padding:10px; font-size: 14px;">
                </div>
                <div class="form-group" style="margin-top: 10px;">
                    <input type="file" id="local-font-upload" accept=".ttf,.woff,.woff2,.otf" style="display: none;">
                    <label for="local-font-upload" class="btn btn-secondary" style="display: block; text-align: center; cursor: pointer; padding: 10px; border-radius: 8px; border: 1px dashed #ccc; background: #fafafa; color: #666;">
                        <span style="font-size: 16px; margin-right: 5px;">📁</span> 从本地上传字体文件
                    </label>
                </div>
                <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-top:15px; border: 1px solid #f0f0f0;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                        <label for="font-preset-select" style="width:auto;color:#666;font-size:13px;">预设库</label>
                        <select id="font-preset-select" style="flex:1;padding:6px;border-radius:6px;border:1px solid #ddd;font-size:13px; background: transparent;"><option value="">— 选择 —</option></select>
                    </div>
                    <div style="display:flex;gap:8px;justify-content: flex-end;">
                        <button type="button" id="font-apply-preset-btn" class="btn btn-small btn-primary" style="padding:4px 8px;">应用</button>
                        <button type="button" id="font-save-preset-btn" class="btn btn-small" style="padding:4px 8px;">保存</button>
                        <button type="button" id="font-manage-presets-btn" class="btn btn-small" style="padding:4px 8px;">管理</button>
                    </div>
                </div>
                <div style="display:flex; gap:10px; justify-content: flex-end; margin-top: 15px;">
                    <button type="button" id="restore-font-btn" class="btn btn-neutral btn-small">恢复默认</button>
                    <button type="button" id="apply-font-btn" class="btn btn-primary btn-small">直接应用</button>
                </div>
            </div>
        </div>

        <!-- 全局CSS模态框 -->
        <div id="global-css-modal" class="modal-overlay">
            <div class="modal-window" style="max-height: 80vh; overflow-y: auto;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="margin: 0;">全局CSS美化</h3>
                    <button class="icon-btn-simple" onclick="document.getElementById('global-css-modal').classList.remove('visible')">✕</button>
                </div>
                <div class="form-group" style="margin-top: 15px; margin-bottom: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <label for="global-beautification-css" style="font-weight: bold; font-size: 14px; color: var(--primary-color); margin-bottom: 0;">CSS代码</label>
                        <button type="button" id="apply-global-css-now-btn" class="btn btn-primary btn-small" style="width:auto;">立即应用</button>
                    </div>
                    <textarea id="global-beautification-css" class="form-group" rows="8" placeholder="在此输入CSS代码..." style="width:100%; border:1px solid #eee; border-radius:8px; padding:10px; font-family: monospace; font-size: 12px;"></textarea>
                </div>
                <div style="background:#f9f9f9; padding:10px; border-radius:8px; border: 1px solid #f0f0f0;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                        <label for="global-css-preset-select" style="width:auto;color:#666;font-size:13px;">预设库</label>
                        <select id="global-css-preset-select" style="flex:1;padding:6px;border-radius:6px;border:1px solid #ddd;font-size:13px; background: transparent;"><option value="">-- 选择 --</option></select>
                    </div>
                    <div style="display:flex;gap:8px;justify-content: flex-end;">
                        <button type="button" id="global-css-apply-btn" class="btn btn-small btn-primary" style="padding:4px 8px;">应用</button>
                        <button type="button" id="global-css-save-btn" class="btn btn-small" style="padding:4px 8px;">保存</button>
                        <button type="button" id="global-css-manage-btn" class="btn btn-small" style="padding:4px 8px;">管理</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 提示音设置模态框 -->
        <div id="sound-settings-modal" class="modal-overlay">
            <div class="modal-window" style="max-height: 80vh; overflow-y: auto;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="margin: 0;">消息提示音</h3>
                    <button class="icon-btn-simple" onclick="document.getElementById('sound-settings-modal').classList.remove('visible')">✕</button>
                </div>
                <div class="form-group" style="margin-top: 15px; margin-bottom: 15px;">
                    <label style="font-weight: bold; font-size: 13px; color: #333;">开始生成提示音</label>
                    <div style="display: flex; gap: 8px; margin-top: 5px;">
                        <input type="url" id="global-send-sound-url" placeholder="音频URL" value="${db.globalSendSound || ''}" style="flex: 1; border: 1px solid #eee; border-radius: 8px; padding: 8px; font-size: 13px;">
                        <input type="file" id="global-send-sound-upload" accept="audio/*" style="display: none;">
                        <label for="global-send-sound-upload" class="btn btn-secondary btn-small" style="margin: 0; display: flex; align-items: center; cursor: pointer;">📂</label>
                        <button type="button" id="test-send-sound-btn" class="btn btn-primary btn-small" style="margin: 0;">▶</button>
                        <button type="button" id="reset-send-sound-btn" class="btn btn-danger btn-small" style="margin: 0;">×</button>
                    </div>
                </div>
                <div class="form-group">
                    <label style="font-weight: bold; font-size: 13px; color: #333;">收到回复提示音</label>
                    <div style="display: flex; gap: 8px; margin-top: 5px;">
                        <input type="url" id="global-receive-sound-url" placeholder="音频URL" value="${db.globalReceiveSound || ''}" style="flex: 1; border: 1px solid #eee; border-radius: 8px; padding: 8px; font-size: 13px;">
                        <input type="file" id="global-receive-sound-upload" accept="audio/*" style="display: none;">
                        <label for="global-receive-sound-upload" class="btn btn-secondary btn-small" style="margin: 0; display: flex; align-items: center; cursor: pointer;">📂</label>
                        <button type="button" id="test-receive-sound-btn" class="btn btn-primary btn-small" style="margin: 0;">▶</button>
                        <button type="button" id="reset-receive-sound-btn" class="btn btn-danger btn-small" style="margin: 0;">×</button>
                    </div>
                </div>
                
                <div class="form-group" style="margin-top: 15px; display: flex; justify-content: space-between; align-items: center;">
                    <label for="multi-msg-sound-switch" style="font-weight: bold; font-size: 13px; color: #333; margin-bottom: 0;">多条消息连续提示音</label>
                    <label class="kkt-switch">
                        <input type="checkbox" id="multi-msg-sound-switch" ${db.multiMsgSoundEnabled ? 'checked' : ''}>
                        <span class="kkt-slider"></span>
                    </label>
                </div>
                <p style="font-size: 12px; color: #999; margin-top: 5px;">开启后，AI 连续回复的多条消息都会触发提示音。</p>

                <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-top:15px; border: 1px solid #f0f0f0;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                        <label for="sound-preset-select" style="width:auto;color:#666;font-size:13px;">预设库</label>
                        <select id="sound-preset-select" style="flex:1;padding:6px;border-radius:6px;border:1px solid #ddd;font-size:13px; background: transparent;"><option value="">— 选择 —</option></select>
                    </div>
                    <div style="display:flex;gap:8px;justify-content: flex-end;">
                        <button type="button" id="sound-apply-preset-btn" class="btn btn-small btn-primary" style="padding:4px 8px;">应用</button>
                        <button type="button" id="sound-save-preset-btn" class="btn btn-small" style="padding:4px 8px;">保存</button>
                        <button type="button" id="sound-manage-presets-btn" class="btn btn-small" style="padding:4px 8px;">管理</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 自定义图标模态框 -->
        <div id="icon-settings-modal" class="modal-overlay">
            <div class="modal-window" style="max-height: 80vh; overflow-y: auto;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="margin: 0;">自定义图标</h3>
                    <button class="icon-btn-simple" onclick="document.getElementById('icon-settings-modal').classList.remove('visible')">✕</button>
                </div>
                <div style="border-top: 1px solid #f5f5f5; padding-top: 15px;">
                    ${iconsContentHTML}
                </div>
            </div>
        </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalsHTML);
    } else {
        // 更新模态框内容
        document.getElementById('icon-settings-modal').querySelector('.modal-window > div:last-child').innerHTML = iconsContentHTML;
        const globalCssTextarea = document.getElementById('global-beautification-css');
        if (globalCssTextarea) {
            globalCssTextarea.value = db.globalCss || '';
        }
    }

    populateGlobalCssPresetSelect();
    populateFontPresetSelect();
    populateSoundPresetSelect();

    const fontSizeSlider = document.getElementById('font-size-slider');
    const fontSizeValue = document.getElementById('font-size-value');
    if (fontSizeSlider) {
        fontSizeSlider.addEventListener('input', (e) => {
            const scale = parseFloat(e.target.value);
            fontSizeValue.textContent = `${scale.toFixed(1)}x`;
            applyFontSize(scale);
        });
        fontSizeSlider.addEventListener('change', async (e) => {
            const scale = parseFloat(e.target.value);
            db.fontSizeScale = scale;
            await saveData();
            showToast('字体大小已保存');
        });
    }

    const globalCssTextarea = document.getElementById('global-beautification-css');
    if (globalCssTextarea) {
        globalCssTextarea.value = db.globalCss || '';
    }
}
;
// --- 表情包管理 (js/modules/sticker.js) ---

async function setupStickerSystem() {
    const stickerMenuBtn = document.getElementById('sticker-menu-btn');
    const stickerMenuActionSheet = document.getElementById('sticker-menu-actionsheet');
    const stickerCategoryBar = document.getElementById('sticker-category-bar');
    
    const menuMultiSelectBtn = document.getElementById('menu-multi-select-btn');
    const menuBatchImportBtn = document.getElementById('menu-batch-import-btn');
    const menuAddNewBtn = document.getElementById('menu-add-new-btn');
    const menuCancelBtn = document.getElementById('menu-cancel-btn');

    const deleteSelectedStickersBtn = document.getElementById('delete-selected-stickers-btn');
    const moveStickerGroupBtn = document.getElementById('move-sticker-group-btn');
    const stickerManageBar = document.getElementById('sticker-manage-bar');
    const selectAllStickersBtn = document.getElementById('select-all-stickers-btn');

    const moveStickerModal = document.getElementById('move-sticker-modal');
    const moveTargetGroupInput = document.getElementById('move-target-group-input');
    const confirmMoveStickerBtn = document.getElementById('confirm-move-sticker-btn');
    const cancelMoveStickerBtn = document.getElementById('cancel-move-sticker-btn');
    const existingGroupsList = document.getElementById('existing-groups-list');

    const batchAddStickerModal = document.getElementById('batch-add-sticker-modal');
    const batchAddStickerForm = document.getElementById('batch-add-sticker-form');
    const stickerUrlsTextarea = document.getElementById('sticker-urls-textarea');
    const batchStickerGroupInput = document.getElementById('batch-sticker-group');
    const addStickerModal = document.getElementById('add-sticker-modal');
    const addStickerForm = document.getElementById('add-sticker-form');
    const stickerNameInput = document.getElementById('sticker-name');
    const stickerGroupInput = document.getElementById('sticker-group');
    const stickerEditIdInput = document.getElementById('sticker-edit-id');
    const stickerPreview = document.getElementById('sticker-preview');
    const stickerUrlInput = document.getElementById('sticker-url-input');
    const stickerFileUpload = document.getElementById('sticker-file-upload');
    const addStickerModalTitle = document.getElementById('add-sticker-modal-title');

    stickerMenuBtn.addEventListener('click', () => {
        if (isStickerManageMode) {
            exitStickerManageMode();
        } else {
            stickerMenuActionSheet.classList.add('visible');
        }
    });

    menuCancelBtn.addEventListener('click', () => stickerMenuActionSheet.classList.remove('visible'));

    menuMultiSelectBtn.addEventListener('click', () => {
        stickerMenuActionSheet.classList.remove('visible');
        enterStickerManageMode();
    });

    function enterStickerManageMode() {
        isStickerManageMode = true;
        stickerManageBar.style.display = 'block';
        
        stickerMenuBtn.innerHTML = '<span style="font-size:14px; font-weight:bold; color:var(--primary-color);">完成</span>';
        selectedStickerIds.clear();
        updateStickerSelectCount();
        renderStickerGrid(); 
    }

    function exitStickerManageMode() {
        isStickerManageMode = false;
        stickerManageBar.style.display = 'none';
        
        stickerMenuBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z" /></svg>';
        selectedStickerIds.clear();
        renderStickerGrid();
    }

    function updateStickerSelectCount() {
        const count = selectedStickerIds.size;
        document.getElementById('sticker-select-count').textContent = `已选 ${count} 项`;
        deleteSelectedStickersBtn.disabled = count === 0;
        moveStickerGroupBtn.disabled = count === 0;
    }

    menuBatchImportBtn.addEventListener('click', () => {
        stickerMenuActionSheet.classList.remove('visible');
        batchAddStickerModal.classList.add('visible');
        stickerUrlsTextarea.value = '';
        batchStickerGroupInput.value = '';
    });

    menuAddNewBtn.addEventListener('click', () => {
        stickerMenuActionSheet.classList.remove('visible');
        addStickerModalTitle.textContent = '添加新表情';
        addStickerForm.reset();
        stickerEditIdInput.value = '';
        stickerPreview.innerHTML = '<span>预览</span>';
        stickerUrlInput.disabled = false;
        addStickerModal.classList.add('visible');
    });

    selectAllStickersBtn.addEventListener('click', () => {
        let stickersToSelect = [];
        
        if (currentStickerCategory === 'recent') {
            stickersToSelect = [...db.myStickers]
                .sort((a, b) => (b.lastUsedTime || 0) - (a.lastUsedTime || 0))
                .slice(0, 20);
        } else if (currentStickerCategory === 'all') {
            stickersToSelect = [...db.myStickers];
        } else if (currentStickerCategory === 'ungrouped') {
            stickersToSelect = db.myStickers.filter(s => !s.group);
        } else {
            stickersToSelect = db.myStickers.filter(s => s.group === currentStickerCategory);
        }

        stickersToSelect.forEach(s => selectedStickerIds.add(s.id));
        
        updateStickerSelectCount();
        renderStickerGrid();
        showToast(`已全选当前分组 ${stickersToSelect.length} 个表情`);
    });

    deleteSelectedStickersBtn.addEventListener('click', async () => {
        if (selectedStickerIds.size === 0) return;
        if (confirm(`确定要删除这 ${selectedStickerIds.size} 个表情吗？`)) {
            const idsToDelete = Array.from(selectedStickerIds);

            await dexieDB.myStickers.bulkDelete(idsToDelete);

            db.myStickers = db.myStickers.filter(s => !selectedStickerIds.has(s.id));
            
            await saveData();
            
            showToast('表情已彻底删除');
            exitStickerManageMode();
        }
    });

    moveStickerGroupBtn.addEventListener('click', () => {
        existingGroupsList.innerHTML = '';
        const groups = [...new Set(db.myStickers.map(s => s.group).filter(g => g))];
        groups.forEach(g => {
            const option = document.createElement('option');
            option.value = g;
            existingGroupsList.appendChild(option);
        });
        
        moveTargetGroupInput.value = '';
        moveStickerModal.classList.add('visible');
    });

    cancelMoveStickerBtn.addEventListener('click', () => moveStickerModal.classList.remove('visible'));

    confirmMoveStickerBtn.addEventListener('click', async () => {
        const newGroup = moveTargetGroupInput.value.trim();
        
        db.myStickers.forEach(s => {
            if (selectedStickerIds.has(s.id)) {
                s.group = newGroup;
            }
        });
        
        await saveData();
        showToast('分组已更新');
        moveStickerModal.classList.remove('visible');
        exitStickerManageMode();
        renderStickerCategories(); 
        renderStickerGrid();
    });

    stickerCategoryBar.addEventListener('click', (e) => {
        const item = e.target.closest('.sticker-category-item');
        if (item) {
            currentStickerCategory = item.dataset.category;
            renderStickerCategories(); 
            renderStickerGrid(); 
        }
    });

    batchAddStickerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const textInput = stickerUrlsTextarea.value.trim();
        const groupName = batchStickerGroupInput.value.trim();
        if (!textInput) return showToast('请输入数据');
        const lines = textInput.split('\n');
        const newStickers = [];
        for (const line of lines) {
            let trimmedLine = line.trim().replace('：', ':');
            if (!trimmedLine) continue;
            const colonIndex = trimmedLine.indexOf(':');
            if (colonIndex <= 0) continue;
            const name = trimmedLine.substring(0, colonIndex).trim();
            const url = trimmedLine.substring(colonIndex + 1).trim();
            if (name && url.startsWith('http')) {
                newStickers.push({
                    id: `sticker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    name: name,
                    data: url,
                    group: groupName,
                    lastUsedTime: Date.now() 
                });
            }
        }
        if (newStickers.length > 0) {
            db.myStickers.push(...newStickers);
            await saveData();
            batchAddStickerModal.classList.remove('visible');
            showToast(`导入 ${newStickers.length} 个表情`);
            renderStickerCategories();
            renderStickerGrid();
        } else {
            showToast('格式错误');
        }
    });

    addStickerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = stickerNameInput.value.trim();
        const group = stickerGroupInput.value.trim();
        const id = stickerEditIdInput.value;
        const previewImg = stickerPreview.querySelector('img');
        const data = previewImg ? previewImg.src : null;
        if (!name || !data) return showToast('请填写完整');
        
        const stickerData = { name, data, group, lastUsedTime: Date.now() };
        
        if (id) {
            const index = db.myStickers.findIndex(s => s.id === id);
            if (index > -1) db.myStickers[index] = { ...db.myStickers[index], ...stickerData };
        } else {
            stickerData.id = `sticker_${Date.now()}`;
            db.myStickers.push(stickerData);
        }
        await saveData();
        addStickerModal.classList.remove('visible');
        showToast('保存成功');
        renderStickerCategories();
        renderStickerGrid();
    });
    
    stickerUrlInput.addEventListener('input', (e) => {
        stickerPreview.innerHTML = `<img src="${e.target.value}" alt="预览">`;
        stickerFileUpload.value = '';
    });
    stickerFileUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, {quality: 0.8, maxWidth: 200, maxHeight: 200});
                stickerPreview.innerHTML = `<img src="${compressedUrl}" alt="预览">`;
                stickerUrlInput.value = '';
                stickerUrlInput.disabled = true;
            } catch (error) {
                showToast('压缩失败');
            }
        }
    });

    const stickerToggleBtn = document.getElementById('sticker-toggle-btn');
    stickerToggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const msgInput = document.getElementById('message-input');
        const isKeyboardOpen = (document.activeElement === msgInput);
        
        if (msgInput) msgInput.blur(); // 强制收起键盘

        if (isKeyboardOpen) {
             // 键盘 -> 面板：无动画
             showPanel('sticker', true);
        } else {
            if (chatExpansionPanel.classList.contains('visible') && panelStickerArea.style.display !== 'none') {
                showPanel('none'); // 面板 -> 关闭：默认有动画
            } else {
                // 关闭 -> 面板 或 面板(功能) -> 面板(表情)：默认有动画
                showPanel('sticker');
            }
        }
    });
}

function renderStickerCategories() {
    const bar = document.getElementById('sticker-category-bar');
    bar.innerHTML = '';

    const groups = [...new Set(db.myStickers.map(s => s.group).filter(g => g))];
    
    const categories = [
        { id: 'recent', name: '最近使用' },
        { id: 'all', name: '全部' },
        ...groups.map(g => ({ id: g, name: g })),
        { id: 'ungrouped', name: '未分类' }
    ];

    categories.forEach(cat => {
        const item = document.createElement('div');
        item.className = `sticker-category-item ${currentStickerCategory === cat.id ? 'active' : ''}`;
        item.textContent = cat.name;
        item.dataset.category = cat.id;
        bar.appendChild(item);
    });
}

function renderStickerGrid() {
    const container = document.getElementById('sticker-grid-container');
    container.innerHTML = '';

    let stickersToShow = [];

    if (currentStickerCategory === 'recent') {
        stickersToShow = [...db.myStickers]
            .sort((a, b) => (b.lastUsedTime || 0) - (a.lastUsedTime || 0))
            .slice(0, 20);
        if (stickersToShow.length === 0) {
            container.innerHTML = '<p style="color:#aaa; text-align:center; grid-column:1/-1; padding:20px;">还没有使用过表情包哦</p>';
            return;
        }
    } else if (currentStickerCategory === 'all') {
        stickersToShow = [...db.myStickers];
    } else if (currentStickerCategory === 'ungrouped') {
        stickersToShow = db.myStickers.filter(s => !s.group);
    } else {
        stickersToShow = db.myStickers.filter(s => s.group === currentStickerCategory);
    }

    if (stickersToShow.length === 0) {
        container.innerHTML = '<p style="color:#aaa; text-align:center; grid-column:1/-1; padding:20px;">该分组下没有表情</p>';
        return;
    }

    stickersToShow.forEach(sticker => {
        const item = document.createElement('div');
        item.className = 'sticker-item';
        
        if (isStickerManageMode) {
            item.classList.add('is-managing');
            if (selectedStickerIds.has(sticker.id)) {
                item.classList.add('is-selected');
            }
        }
        
        item.innerHTML = `<img src="${sticker.data}" alt="${sticker.name}"><span style="font-size:10px; margin-top:4px; color:#888; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%; text-align:center;">${sticker.name}</span>`;

        item.addEventListener('click', () => {
            if (isStickerManageMode) {
                if (selectedStickerIds.has(sticker.id)) {
                    selectedStickerIds.delete(sticker.id);
                    item.classList.remove('is-selected');
                } else {
                    selectedStickerIds.add(sticker.id);
                    item.classList.add('is-selected');
                }
                const count = selectedStickerIds.size;
                document.getElementById('sticker-select-count').textContent = `已选 ${count} 项`;
                document.getElementById('delete-selected-stickers-btn').disabled = count === 0;
                document.getElementById('move-sticker-group-btn').disabled = count === 0;
            } else {
                sendSticker(sticker);
            }
        });

        container.appendChild(item);
    });
}

function handleStickerLongPress(stickerId) {
    if (isStickerManageMode) return;
    clearTimeout(longPressTimer);
    currentStickerActionTarget = stickerId;
    document.getElementById('sticker-actionsheet').classList.add('visible');
}

async function sendSticker(sticker) {
    const dbSticker = db.myStickers.find(s => s.id === sticker.id);
    if (dbSticker) {
        dbSticker.lastUsedTime = Date.now();
    }

    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    const myName = (currentChatType === 'private') ? chat.myName : chat.me.nickname;
    
    const messageContentForAI = `[${myName}发送的表情包：${sticker.name}]`;
    const message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: messageContentForAI,
        parts: [{type: 'text', text: messageContentForAI}],
        timestamp: Date.now(),
        stickerId: sticker.id,
        stickerData: sticker.data
    };
    if (currentChatType === 'group') {
        message.senderId = 'user_me';
    }
    chat.history.push(message);
    addMessageBubble(message, currentChatId, currentChatType);
    
    await saveData(); 
    renderChatList();
    
    showPanel('none');
}
;
const worldBookContext = (() => {
    const budget = 600;
    const modes = new Set(['always', 'keyword', 'off']);
    const positions = new Set(['before', 'after', 'limit_break', 'guidelines']);
    const norm = value => value.normalize('NFKC').trim().toLowerCase();
    const keys = value => [...new Set((Array.isArray(value) ? value : String(value || '').split(/[,，\n]+/))
        .filter(key => typeof key === 'string').map(norm).filter(Boolean))].slice(0, 50);
    const mode = entry => modes.has(entry.activation) ? entry.activation : 'always';
    const order = (a, b) => (a.depth || 100) - (b.depth || 100);

    function cardSettings(entry) {
        const embedded = entry.extensions?.uwu_worldbook;
        const triggerKeys = keys(entry.keys);
        const activation = entry.enabled === false ? 'off' : (modes.has(embedded?.activation)
            ? embedded.activation : entry.constant || !triggerKeys.length ? 'always' : 'keyword');
        const position = positions.has(embedded?.position) ? embedded.position
            : entry.position === 'before_char' ? 'before' : 'after';
        return { activation, triggerKeys, position };
    }

    function select(ids, history = []) {
        const entries = new Map(db.worldBooks.map(entry => [entry.id, entry]));
        const recent = history.filter(message => ['user', 'assistant'].includes(message.role)
            && !message.isContextDisabled && !message.isWithdrawn && !message.isThinking && !message.isStatusUpdate)
            .slice(-4).map(memoryBatch.messageText).map(norm);
        const selected = [];
        let spent = 0;
        for (const entry of [...new Set(ids || [])].map(id => entries.get(id)).filter(item => item?.type !== 'folder'
            && typeof item?.content === 'string').sort(order)) {
            const activation = mode(entry);
            if (activation === 'off') continue;
            if (activation === 'keyword') {
                const matches = keys(entry.triggerKeys).some(key => recent.some(text => {
                    if (!/^[a-z0-9 ]+$/.test(key)) return text.includes(key);
                    return (' ' + text.replace(/[^a-z0-9 ]/g, ' ') + ' ').includes(' ' + key + ' ');
                }));
                if (!matches) continue;
                const cost = countTextTokens(entry.content + '\n');
                if (spent + cost > budget) continue;
                spent += cost;
            }
            selected.push(entry);
        }
        return selected;
    }

    return { select, cardSettings, keys, mode };
})();

// --- 世界书功能 (js/modules/worldbook.js) ---

let wbViewMode = 'grid'; // 'grid' 或 'list'
let wbPathStack = [{ id: null, name: '世界书' }];

function enterWorldBookMultiSelectMode(initialId) {
    if (isWorldBookMultiSelectMode) return;
    isWorldBookMultiSelectMode = true;

    document.getElementById('add-world-book-btn').style.display = 'none';
    document.getElementById('world-book-view-toggle-btn').style.display = 'none';
    document.getElementById('cancel-wb-multi-select-btn').style.display = 'inline-block';
    document.getElementById('world-book-multi-select-bar').style.display = 'flex';
    document.querySelector('#world-book-screen .content').style.paddingBottom = '70px';

    selectedWorldBookIds.clear();
    if (initialId) {
        selectedWorldBookIds.add(initialId);
    }

    updateWorldBookSelectCount();
    renderWorldBookList(); 
}

function exitWorldBookMultiSelectMode() {
    isWorldBookMultiSelectMode = false;

    document.getElementById('add-world-book-btn').style.display = 'inline-block';
    document.getElementById('world-book-view-toggle-btn').style.display = 'inline-block';
    document.getElementById('cancel-wb-multi-select-btn').style.display = 'none';
    document.getElementById('world-book-multi-select-bar').style.display = 'none';
    document.querySelector('#world-book-screen .content').style.paddingBottom = '0';

    selectedWorldBookIds.clear();
    renderWorldBookList();
}

function toggleWorldBookSelection(bookId) {
    if (selectedWorldBookIds.has(bookId)) {
        selectedWorldBookIds.delete(bookId);
    } else {
        selectedWorldBookIds.add(bookId);
    }
    updateWorldBookSelectCount();
    renderWorldBookList();
}

function updateWorldBookSelectCount() {
    const count = selectedWorldBookIds.size;
    document.getElementById('world-book-select-count').textContent = `已选择 ${count} 项`;
    document.getElementById('delete-selected-world-books-btn').disabled = count === 0;
    
    const moveBtn = document.getElementById('move-selected-world-books-btn');
    if (moveBtn) {
        moveBtn.disabled = count === 0;
    }
}

async function deleteSelectedWorldBooks() {
    const count = selectedWorldBookIds.size;
    if (count === 0) return;

    if (confirm(`确定要删除这 ${count} 个项目吗？此操作不可恢复。`)) {
        const idsToDelete = Array.from(selectedWorldBookIds);
        
        // 递归删除文件夹及其内容
        const allIdsToDelete = new Set();
        const findChildren = (parentId) => {
            db.worldBooks.forEach(item => {
                if (item.parentId === parentId) {
                    allIdsToDelete.add(item.id);
                    if (item.type === 'folder') findChildren(item.id);
                }
            });
        };
        
        idsToDelete.forEach(id => {
            allIdsToDelete.add(id);
            const item = db.worldBooks.find(wb => wb.id === id);
            if (item && item.type === 'folder') findChildren(id);
        });

        const finalIds = Array.from(allIdsToDelete);
        await dexieDB.worldBooks.bulkDelete(finalIds);
        db.worldBooks = db.worldBooks.filter(book => !allIdsToDelete.has(book.id));
        
        db.characters.forEach(char => {
            if (char.worldBookIds) {
                char.worldBookIds = char.worldBookIds.filter(id => !allIdsToDelete.has(id));
            }
        });
        db.groups.forEach(group => {
            if (group.worldBookIds) {
                group.worldBookIds = group.worldBookIds.filter(id => !allIdsToDelete.has(id));
            }
        });

        await saveData();
        showToast(`已成功删除 ${finalIds.length} 个项目`);
        exitWorldBookMultiSelectMode();
    }
}

async function migrateWorldBookPositions() {
    let migrated = false;
    db.worldBooks.forEach(item => {
        if (item.type === 'entry' && (item.position === 'middle' || item.position === 'center')) {
            item.position = 'before';
            item.depth = 300;
            migrated = true;
        }
    });
    if (migrated) {
        await saveData();
        console.log('Worldbook positions migrated: middle -> before (depth 300)');
    }
}

async function migrateWorldBookCategories() {
    const entriesToMigrate = db.worldBooks.filter(item => item.type === 'entry' && item.category && !item.parentId);
    if (entriesToMigrate.length === 0) return;

    const categories = [...new Set(entriesToMigrate.map(item => item.category))];
    let migrated = false;

    for (const catName of categories) {
        // 查找是否已存在同名文件夹
        let folder = db.worldBooks.find(item => item.type === 'folder' && item.name === catName && !item.parentId);
        
        if (!folder) {
            folder = {
                id: `wb_f_migrated_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                parentId: null,
                type: 'folder',
                name: catName
            };
            db.worldBooks.push(folder);
            migrated = true;
        }

        // 迁移属于该分类的条目
        entriesToMigrate.forEach(item => {
            if (item.category === catName) {
                item.parentId = folder.id;
                migrated = true;
            }
        });
    }

    if (migrated) {
        await saveData();
        console.log('Worldbook categories migrated to folders.');
    }
}

async function moveSelectedWorldBooksToCurrent() {
    const count = selectedWorldBookIds.size;
    if (count === 0) return;

    const currentFolder = wbPathStack[wbPathStack.length - 1];
    const targetFolderId = currentFolder.id;
    const targetFolderName = currentFolder.name;

    if (confirm(`确定要将选中的 ${count} 个项目移动到 [${targetFolderName}] 吗？`)) {
        const idsToMove = Array.from(selectedWorldBookIds);
        
        // 循环引用检查：不能将文件夹移动到它自己或它的子文件夹中
        const isDescendant = (parentId, targetId) => {
            if (!parentId) return false;
            if (parentId === targetId) return true;
            const parent = db.worldBooks.find(wb => wb.id === parentId);
            if (parent && parent.parentId) {
                return isDescendant(parent.parentId, targetId);
            }
            return false;
        };

        let hasError = false;
        idsToMove.forEach(id => {
            const item = db.worldBooks.find(wb => wb.id === id);
            if (item && item.type === 'folder') {
                // 检查目标文件夹是否是该文件夹的子孙
                if (targetFolderId === id || isDescendant(targetFolderId, id)) {
                    showToast(`错误：不能将文件夹 [${item.name}] 移动到它自身或其子文件夹中`);
                    hasError = true;
                }
            }
        });

        if (hasError) return;

        // 执行移动
        idsToMove.forEach(id => {
            const item = db.worldBooks.find(wb => wb.id === id);
            if (item) {
                item.parentId = targetFolderId;
            }
        });

        await saveData();
        showToast(`已成功移动 ${count} 个项目`);
        exitWorldBookMultiSelectMode();
    }
}

async function setupWorldBookApp() {
    await migrateWorldBookPositions();
    await migrateWorldBookCategories();
    const addWorldBookBtn = document.getElementById('add-world-book-btn');
    const viewToggleBtn = document.getElementById('world-book-view-toggle-btn');
    const backBtn = document.getElementById('world-book-back-btn');
    const newMenu = document.getElementById('world-book-new-menu');
    
    const editWorldBookForm = document.getElementById('edit-world-book-form');
    const worldBookNameInput = document.getElementById('world-book-name');
    const worldBookContentInput = document.getElementById('world-book-content');
    const worldBookListContainer = document.getElementById('world-book-list-container');
    const worldBookIdInput = document.getElementById('world-book-id');
    const activationInput = document.getElementById('world-book-activation');
    const keysInput = document.getElementById('world-book-trigger-keys');
    const updateTriggerField = () => {
        keysInput.closest('.form-group').hidden = activationInput.value !== 'keyword';
    };
    activationInput.addEventListener('change', updateTriggerField);

    // 视图切换
    viewToggleBtn.addEventListener('click', () => {
        wbViewMode = wbViewMode === 'grid' ? 'list' : 'grid';
        document.getElementById('wb-grid-icon').style.display = wbViewMode === 'grid' ? 'block' : 'none';
        document.getElementById('wb-list-icon').style.display = wbViewMode === 'list' ? 'block' : 'none';
        worldBookListContainer.className = wbViewMode === 'grid' ? 'grid-view' : 'list-view';
        renderWorldBookList();
    });

    // 返回逻辑
    backBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // 阻止冒泡到 body 触发全局 back-btn 逻辑
        if (wbPathStack.length > 1) {
            wbPathStack.pop();
            renderWorldBookList();
        } else {
            switchScreen('home-screen');
        }
    });

    // 编辑界面的返回逻辑
    const editBackBtn = document.querySelector('#edit-world-book-screen .back-btn');
    if (editBackBtn) {
        // 移除可能存在的旧监听器（如果有的话）
        const newEditBackBtn = editBackBtn.cloneNode(true);
        editBackBtn.parentNode.replaceChild(newEditBackBtn, editBackBtn);
        
        newEditBackBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            switchScreen('world-book-screen');
        });
    }

    // 新建菜单切换
    addWorldBookBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        newMenu.style.display = newMenu.style.display === 'none' ? 'block' : 'none';
    });

    document.addEventListener('click', () => {
        newMenu.style.display = 'none';
    });

    // 新建文件夹
    document.getElementById('wb-menu-new-folder').addEventListener('click', async () => {
        const name = prompt('请输入文件夹名称：');
        if (name && name.trim()) {
            const currentFolderId = wbPathStack[wbPathStack.length - 1].id;
            const newFolder = {
                id: `wb_f_${Date.now()}`,
                parentId: currentFolderId,
                type: 'folder',
                name: name.trim()
            };
            db.worldBooks.push(newFolder);
            await saveData();
            renderWorldBookList();
        }
    });

    // 新建条目
    document.getElementById('wb-menu-new-entry').addEventListener('click', () => {
        currentEditingWorldBookId = null;
        editWorldBookForm.reset();
        updateTriggerField();
        document.getElementById('world-book-id').value = '';
        document.getElementById('world-book-category').value = '';
        document.getElementById('world-book-depth').value = '100';
        document.querySelector('input[name="world-book-position"][value="before"]').checked = true;
        switchScreen('edit-world-book-screen');
    });
    
    editWorldBookForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = worldBookNameInput.value.trim();
        const content = worldBookContentInput.value.trim();
        const category = document.getElementById('world-book-category').value.trim();
        const position = document.querySelector('input[name="world-book-position"]:checked').value;
        const depth = parseInt(document.getElementById('world-book-depth').value) || 100;
        const currentFolderId = wbPathStack[wbPathStack.length - 1].id;

        const activation = activationInput.value;
        const triggerKeys = worldBookContext.keys(keysInput.value);
        if (activation === 'keyword' && !triggerKeys.length) return showToast('请填写至少一个触发词');
        if (!name || !content) return showToast('名称和内容不能为空');
        
        if (currentEditingWorldBookId) {
            const book = db.worldBooks.find(wb => wb.id === currentEditingWorldBookId);
            if (book) {
                book.name = name;
                book.content = content;
                book.position = position;
                book.category = category;
                Object.assign(book, { depth, activation, triggerKeys });
            }
        } else {
            db.worldBooks.push({
                id: `wb_${Date.now()}`, 
                parentId: currentFolderId,
                type: 'entry',
                name, 
                content, 
                position, 
                category,
                depth, activation, triggerKeys
            });
        }
        await saveData();
        showToast('世界书条目已保存');
        renderWorldBookList();
        switchScreen('world-book-screen');
    });

    worldBookListContainer.addEventListener('click', e => {
        const itemCard = e.target.closest('.wb-item-card');
        if (!itemCard) return;

        const id = itemCard.dataset.id;
        const item = db.worldBooks.find(wb => wb.id === id);
        if (!item) return;

        if (isWorldBookMultiSelectMode) {
            // 在多选模式下：
            // 1. 如果点击的是图标区域，或者是条目，则切换选中状态
            // 2. 如果点击的是文件夹的其他区域（如名称），则进入文件夹进行导航
            if (e.target.closest('.wb-icon-wrapper') || item.type === 'entry') {
                toggleWorldBookSelection(id);
            } else if (item.type === 'folder') {
                wbPathStack.push({ id: item.id, name: item.name });
                renderWorldBookList();
            }
            return;
        }

        if (item.type === 'folder') {
            wbPathStack.push({ id: item.id, name: item.name });
            renderWorldBookList();
        } else {
            // 编辑条目
            currentEditingWorldBookId = item.id;
            worldBookIdInput.value = item.id;
            worldBookNameInput.value = item.name;
            worldBookContentInput.value = item.content;
            activationInput.value = worldBookContext.mode(item);
            keysInput.value = worldBookContext.keys(item.triggerKeys).join('，');
            updateTriggerField();
            document.getElementById('world-book-category').value = item.category || '';
            document.getElementById('world-book-depth').value = item.depth !== undefined ? item.depth : 100;
            
        // 安全地设置注入位置，如果不是 after 或 guidelines 或 limit_break 则默认为 before
        let positionValue = 'before';
        if (item.position === 'after') positionValue = 'after';
        else if (item.position === 'guidelines') positionValue = 'guidelines';
        else if (item.position === 'limit_break') positionValue = 'limit_break';
        
        const positionRadio = document.querySelector(`input[name="world-book-position"][value="${positionValue}"]`);
        if (positionRadio) positionRadio.checked = true;
            
            switchScreen('edit-world-book-screen');
        }
    });

    // 长按进入多选
    let wbLongPressTimer;
    worldBookListContainer.addEventListener('touchstart', (e) => {
        const item = e.target.closest('.wb-item-card');
        if (!item) return;
        wbLongPressTimer = setTimeout(() => {
            enterWorldBookMultiSelectMode(item.dataset.id);
        }, 600);
    });
    worldBookListContainer.addEventListener('touchend', () => clearTimeout(wbLongPressTimer));
    worldBookListContainer.addEventListener('touchmove', () => clearTimeout(wbLongPressTimer));

    document.getElementById('delete-selected-world-books-btn').addEventListener('click', deleteSelectedWorldBooks);
    document.getElementById('move-selected-world-books-btn').addEventListener('click', moveSelectedWorldBooksToCurrent);
    document.getElementById('cancel-wb-multi-select-btn').addEventListener('click', exitWorldBookMultiSelectMode);
}

function renderWorldBookList() {
    const container = document.getElementById('world-book-list-container');
    const currentFolder = wbPathStack[wbPathStack.length - 1];
    
    // 更新标题
    document.getElementById('world-book-title').textContent = currentFolder.name;
    
    // 过滤当前层级内容
    const currentItems = db.worldBooks.filter(item => {
        if (currentFolder.id === null) {
            return !item.parentId;
        }
        return item.parentId === currentFolder.id;
    });

    document.getElementById('no-world-books-placeholder').style.display = currentItems.length === 0 ? 'block' : 'none';
    container.innerHTML = '';

    currentItems.forEach(item => {
        const card = document.createElement('div');
        card.className = 'wb-item-card';
        card.dataset.id = item.id;
        if (isWorldBookMultiSelectMode) {
            card.classList.add('is-selecting');
            if (selectedWorldBookIds.has(item.id)) card.classList.add('selected');
        }

        const isFolder = item.type === 'folder';
        const iconHTML = isFolder 
            ? `<svg class="wb-folder-icon" viewBox="0 0 24 24" width="${wbViewMode === 'grid' ? 32 : 24}" height="${wbViewMode === 'grid' ? 32 : 24}"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`
            : `<svg class="wb-entry-icon" viewBox="0 0 24 24" width="${wbViewMode === 'grid' ? 32 : 24}" height="${wbViewMode === 'grid' ? 32 : 24}"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`;

        card.innerHTML = `
            <div class="wb-icon-wrapper">${iconHTML}</div>
            <div class="wb-item-name">${item.name}</div>
        `;
        
        container.appendChild(card);
    });
}

function renderCategorizedWorldBookList(container, books, selectedIds, idPrefix) {
    container.innerHTML = '';
    // 仅显示条目，不显示文件夹
    const entries = books.filter(b => b.type === 'entry');
    
    if (!entries || entries.length === 0) {
        container.innerHTML = '<li style="color: #888; text-align: center; padding: 15px;">暂无世界书条目</li>';
        return;
    }

    const groupedBooks = entries.reduce((acc, book) => {
        const category = book.category || '未分类';
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(book);
        return acc;
    }, {});

    const sortedCategories = Object.keys(groupedBooks).sort((a, b) => {
        if (a === '未分类') return 1;
        if (b === '未分类') return -1;
        return a.localeCompare(b);
    });

    sortedCategories.forEach(category => {
        const categoryBooks = groupedBooks[category];
        const allInCategorySelected = categoryBooks.every(book => selectedIds.includes(book.id));

        const groupEl = document.createElement('div');
        groupEl.className = 'world-book-category-group';

        groupEl.innerHTML = `
            <div class="world-book-category-header">
                <input type="checkbox" class="category-checkbox" ${allInCategorySelected ? 'checked' : ''}>
                <span class="category-name">${category}</span>
                <span class="category-arrow">▼</span>
            </div>
            <ul class="world-book-items-list">
                ${categoryBooks.map(book => {
                    const isChecked = selectedIds.includes(book.id);
                    return `
                        <li class="world-book-select-item">
                            <input type="checkbox" class="item-checkbox" id="${idPrefix}-${book.id}" value="${book.id}" ${isChecked ? 'checked' : ''}>
                            <label for="${idPrefix}-${book.id}">${book.name}</label>
                        </li>
                    `;
                }).join('')}
            </ul>
        `;
        container.appendChild(groupEl);
    });

    container.querySelectorAll('.world-book-category-header').forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox') return; 
            const group = header.closest('.world-book-category-group');
            group.classList.toggle('open');
        });
    });

    container.querySelectorAll('.category-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const group = e.target.closest('.world-book-category-group');
            const itemCheckboxes = group.querySelectorAll('.item-checkbox');
            itemCheckboxes.forEach(itemCb => {
                itemCb.checked = e.target.checked;
            });
        });
    });

    container.querySelectorAll('.item-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const group = e.target.closest('.world-book-category-group');
            const categoryCheckbox = group.querySelector('.category-checkbox');
            const allItems = group.querySelectorAll('.item-checkbox');
            const allChecked = Array.from(allItems).every(item => item.checked);
            categoryCheckbox.checked = allChecked;
        });
    });
}

// --- 全屏世界书选择器逻辑 ---
let selectorPathStack = [{ id: null, name: '根目录' }];
let tempSelectedWbIds = new Set();

function openWorldBookSelector(initialSelectedIds) {
    selectorPathStack = [{ id: null, name: '根目录' }];
    tempSelectedWbIds = new Set(initialSelectedIds || []);
    
    document.getElementById('world-book-selection-modal').classList.add('visible');
    renderWorldBookSelectorList();
}

function closeWorldBookSelector() {
    document.getElementById('world-book-selection-modal').classList.remove('visible');
}

function renderWorldBookSelectorList() {
    const container = document.getElementById('world-book-selection-list');
    const currentFolder = selectorPathStack[selectorPathStack.length - 1];
    
    // 更新面包屑
    const breadcrumb = document.getElementById('wb-selector-breadcrumb');
    const backBtn = document.getElementById('wb-selector-back-folder-btn');
    const currentName = document.getElementById('wb-selector-current-folder-name');
    
    if (selectorPathStack.length > 1) {
        backBtn.style.display = 'flex';
        currentName.textContent = currentFolder.name;
    } else {
        backBtn.style.display = 'none';
        currentName.textContent = '根目录';
    }

    // 过滤当前层级内容
    const currentItems = db.worldBooks.filter(item => {
        if (currentFolder.id === null) {
            return !item.parentId;
        }
        return item.parentId === currentFolder.id;
    });

    container.innerHTML = '';

    if (currentItems.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #888; font-size: 14px;">文件夹为空</div>';
        return;
    }

    currentItems.forEach(item => {
        const row = document.createElement('div');
        row.className = 'wb-selector-row';
        
        const isFolder = item.type === 'folder';
        
        let iconSvg = '';
        if (isFolder) {
            iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.826a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31zM2.19 4a1 1 0 0 0-.996 1.09l.637 7a1 1 0 0 0 .995.91h10.348a1 1 0 0 0 .995-.91l.637-7A1 1 0 0 0 13.81 4H2.19zm4.69-1.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139C1.72 3.042 1.95 3 2.19 3h5.396l-.707-.707z"/></svg>`;
        } else {
            iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/><path d="M6 11.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5z"/></svg>`;
        }

        let rightContent = '';
        if (isFolder) {
            // 检查文件夹内的所有条目是否都被选中
            const getAllChildEntries = (folderId) => {
                let entries = [];
                db.worldBooks.forEach(wb => {
                    if (wb.parentId === folderId) {
                        if (wb.type === 'entry') entries.push(wb.id);
                        else if (wb.type === 'folder') entries = entries.concat(getAllChildEntries(wb.id));
                    }
                });
                return entries;
            };
            const childEntryIds = getAllChildEntries(item.id);
            const isAllChecked = childEntryIds.length > 0 && childEntryIds.every(id => tempSelectedWbIds.has(id));
            
            rightContent = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="checkbox" class="wb-selector-checkbox folder-selector" ${isAllChecked ? 'checked' : ''} title="全选文件夹内容">
                    <div class="wb-selector-arrow"></div>
                </div>
            `;
        } else {
            const isChecked = tempSelectedWbIds.has(item.id);
            rightContent = `<input type="checkbox" class="wb-selector-checkbox" ${isChecked ? 'checked' : ''}>`;
        }

        row.innerHTML = `
            <div class="wb-selector-icon">${iconSvg}</div>
            <div class="wb-selector-name">${item.name}</div>
            ${rightContent}
        `;

        row.addEventListener('click', (e) => {
            if (isFolder) {
                const folderCheckbox = row.querySelector('.folder-selector');
                // 如果点击的是勾选框，执行全选/取消全选
                if (e.target === folderCheckbox) {
                    const getAllChildEntries = (folderId) => {
                        let entries = [];
                        db.worldBooks.forEach(wb => {
                            if (wb.parentId === folderId) {
                                if (wb.type === 'entry') entries.push(wb.id);
                                else if (wb.type === 'folder') entries = entries.concat(getAllChildEntries(wb.id));
                            }
                        });
                        return entries;
                    };
                    const childEntryIds = getAllChildEntries(item.id);
                    if (folderCheckbox.checked) {
                        childEntryIds.forEach(id => tempSelectedWbIds.add(id));
                    } else {
                        childEntryIds.forEach(id => tempSelectedWbIds.delete(id));
                    }
                    renderWorldBookSelectorList(); // 刷新显示状态
                } else {
                    // 点击其他区域进入文件夹
                    selectorPathStack.push({ id: item.id, name: item.name });
                    renderWorldBookSelectorList();
                }
            } else {
                // 切换选中状态
                const checkbox = row.querySelector('.wb-selector-checkbox');
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                }
                
                if (checkbox.checked) {
                    tempSelectedWbIds.add(item.id);
                } else {
                    tempSelectedWbIds.delete(item.id);
                }
            }
        });

        container.appendChild(row);
    });
}

// 绑定选择器事件
document.addEventListener('DOMContentLoaded', () => {
    const backBtn = document.getElementById('wb-selector-back-folder-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (selectorPathStack.length > 1) {
                selectorPathStack.pop();
                renderWorldBookSelectorList();
            }
        });
    }

    const cancelBtn = document.getElementById('cancel-world-book-selection-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeWorldBookSelector);
    }
});
