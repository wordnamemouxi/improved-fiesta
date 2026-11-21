// === Character Wallet & Ledger ===
// Regional hints guide wallet generation; existing balances retain their original currencies.
const walletProfiles = (() => {
    const regions = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
    const regionNames = locale => typeof Intl.DisplayNames === 'function'
        ? new Intl.DisplayNames([locale], { type: 'region' }) : { of: code => code };
    const names = regionNames('zh-CN');
    const currencyByRegion = {};
    const regionsByCurrency = {
        CNY: 'CN', AUD: 'AU CC CX NF KI NR TV', JPY: 'JP', USD: 'US AS EC FM GU IO MH MP PR PW SV TC TL UM VG VI',
        EUR: 'AD AT AX BE BL CY DE EE ES FI FR GF GP GR HR IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM TF VA YT',
        GBP: 'GB GG IM JE', CAD: 'CA', CHF: 'CH LI', NZD: 'NZ CK NU PN TK', HKD: 'HK', TWD: 'TW', SGD: 'SG',
        MOP: 'MO', KRW: 'KR', INR: 'IN', MXN: 'MX', BRL: 'BR', ARS: 'AR', CLP: 'CL', COP: 'CO', PEN: 'PE',
        VND: 'VN', THB: 'TH', IDR: 'ID', MYR: 'MY', PHP: 'PH', BND: 'BN', KHR: 'KH', LAK: 'LA', MMK: 'MM',
        CDF: 'CD', XAF: 'CF CG CM GA GQ TD', XOF: 'BJ BF CI GW ML NE SN TG', XCD: 'AG AI DM GD KN LC MS VC',
        AED: 'AE', SAR: 'SA', ILS: 'IL PS', TRY: 'TR', QAR: 'QA', OMR: 'OM', KWD: 'KW', BHD: 'BH', EGP: 'EG',
        MAD: 'MA EH', ZAR: 'ZA', NGN: 'NG', KES: 'KE', GHS: 'GH', UGX: 'UG', TZS: 'TZ', ZMW: 'ZM', ETB: 'ET',
        SEK: 'SE', NOK: 'NO SJ', DKK: 'DK FO GL', ISK: 'IS', CZK: 'CZ', PLN: 'PL', HUF: 'HU', RON: 'RO', RSD: 'RS',
        ALL: 'AL', BGN: 'BG', BAM: 'BA', MDL: 'MD', UAH: 'UA', BYN: 'BY', RUB: 'RU', GEL: 'GE', AMD: 'AM', AZN: 'AZ',
        KZT: 'KZ', UZS: 'UZ', XPF: 'NC PF WF', FJD: 'FJ', VUV: 'VU', WST: 'WS', PKR: 'PK', BDT: 'BD', NPR: 'NP',
        LKR: 'LK', MVR: 'MV', MNT: 'MN', HNL: 'HN', GTQ: 'GT', CRC: 'CR', DOP: 'DO', JMD: 'JM', CUP: 'CU',
        JOD: 'JO', IQD: 'IQ', IRR: 'IR', LBP: 'LB', DZD: 'DZ', TND: 'TN', CVE: 'CV', BWP: 'BW', MUR: 'MU', SCR: 'SC',
        AFN: 'AF', AOA: 'AO', AWG: 'AW', BBD: 'BB', BIF: 'BI', BMD: 'BM', BOB: 'BO', BSD: 'BS', BTN: 'BT',
        BZD: 'BZ', DJF: 'DJ', ERN: 'ER', FKP: 'FK', GIP: 'GI', GMD: 'GM', GNF: 'GN', GYD: 'GY', HTG: 'HT',
        KGS: 'KG', KMF: 'KM', KPW: 'KP', KYD: 'KY', LRD: 'LR', LSL: 'LS', LYD: 'LY', MGA: 'MG', MKD: 'MK',
        MRU: 'MR', MWK: 'MW', MZN: 'MZ', NAD: 'NA', NIO: 'NI', PAB: 'PA', PGK: 'PG', PYG: 'PY', RWF: 'RW',
        SBD: 'SB', SDG: 'SD', SHP: 'SH', SLE: 'SL', SOS: 'SO', SRD: 'SR', SSP: 'SS', STN: 'ST', SYP: 'SY',
        SZL: 'SZ', TJS: 'TJ', TMT: 'TM', TOP: 'TO', TTD: 'TT', UYU: 'UY', VES: 'VE', XCG: 'CW SX', YER: 'YE', ZWG: 'ZW'
    };
    for (const [currency, members] of Object.entries(regionsByCurrency)) {
        for (const region of members.split(' ').filter(Boolean)) currencyByRegion[region] = currency;
    }
    const zones = { CN: 'Asia/Shanghai', JP: 'Asia/Tokyo', AU: 'Australia/Sydney', GB: 'Europe/London',
        US: 'America/New_York', CA: 'America/Toronto', FR: 'Europe/Paris', DE: 'Europe/Berlin', NZ: 'Pacific/Auckland',
        SG: 'Asia/Singapore', HK: 'Asia/Hong_Kong', KR: 'Asia/Seoul', IN: 'Asia/Kolkata', MX: 'America/Mexico_City',
        BR: 'America/Sao_Paulo', TH: 'Asia/Bangkok', TW: 'Asia/Taipei', ZA: 'Africa/Johannesburg' };
    const place = value => regions.includes(value) ? value : '';
    const profile = character => {
        const nation = place(character.nationality);
        const region = place(character.residence);
        const type = nation === 'AU' && region === 'CN' ? 'crossborder'
            : nation === 'CN' && region === 'CN' ? 'china' : nation === 'JP' && region === 'JP' ? 'japan' : 'global';
        const language = type === 'china' ? 'zh' : type === 'japan' ? 'ja' : 'en';
        return { nation, region, type, language, currency: currencyByRegion[region || nation] || 'USD', zone: zones[region] || 'UTC',
            locale: ({ china: 'zh-CN', japan: 'ja-JP', crossborder: 'en-AU', global: 'en-GB' })[type],
            bankRegion: nation || region };
    };
    const localized = (zh, en, ja = zh) => ({ zh, en, ja });
    const formatters = new Map();
    function money(amount, currency, locale) {
        const key = locale + currency;
        if (!formatters.has(key)) formatters.set(key, new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }));
        const formatter = formatters.get(key);
        return formatter.format(amount / 10 ** formatter.resolvedOptions().maximumFractionDigits);
    }
    const currencies = new Set(typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('currency') : Object.keys(regionsByCurrency));
    const isCurrency = value => currencies.has(value) || Object.hasOwn(regionsByCurrency, value);
    const regionOptions = [...regions].sort((a, b) => {
        const preferred = ['CN', 'AU', 'JP'];
        return (preferred.indexOf(a) < 0 ? 3 : preferred.indexOf(a)) - (preferred.indexOf(b) < 0 ? 3 : preferred.indexOf(b))
            || names.of(a).localeCompare(names.of(b), 'zh-CN');
    });
    function fillRegion(select) {
        select.replaceChildren(new Option('未设置', ''), ...regionOptions.map(code => new Option(names.of(code), code)));
    }
    function day(timestamp, zone) {
        const parts = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp);
        const value = key => parts.find(part => part.type === key).value;
        return value('year') + '-' + value('month') + '-' + value('day');
    }
    function prepare(character) {
        const previous = character.peekData?.wallet;
        if (!previous || typeof previous !== 'object') return;
        const prevAccounts = Array.isArray(previous.accounts) ? previous.accounts : [];
        const prevBills = Array.isArray(previous.bills) ? previous.bills : [];
        const prevPending = Array.isArray(previous.pending) ? previous.pending : [];
        // Older installs seeded a sample ledger before the first AI request.
        const untouchedSample = previous.version === 2 && previous.profileKeys?.length && !previous.updatedAt
            && prevBills.length && prevBills.every(bill => bill.simulated === true && bill.id?.startsWith('sim-'));
        if (untouchedSample || (!prevAccounts.length && !prevBills.length && !prevPending.length)) return;
        if (previous.version >= 2) return previous;
        const wallet = structuredClone(previous);
        wallet.accounts = Array.isArray(wallet.accounts) ? wallet.accounts : [];
        wallet.bills = Array.isArray(wallet.bills) ? wallet.bills : [];
        for (const account of wallet.accounts) {
            account.currency ||= 'CNY';
            if (account.kind === 'card') {
                account.last4 ||= mask();
                account.network ||= 'UnionPay';
            }
        }
        for (const bill of wallet.bills) {
            bill.currency ||= 'CNY';
            bill.settlementCurrency ||= bill.currency;
            bill.settlementCents ??= bill.cents;
        }
        wallet.version = 2;
        wallet.createdAt ||= Date.now();
        return wallet;
    }

    function mask() {
        return String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, '0');
    }

    return { profile, money, day, fillRegion, place, prepare, isCurrency, mask };
})();
;
const peekWalletView = (() => {
    const copy = {
        servicesHome: ['支付服务', 'Payment Services', '決済サービス'],
        monthlySummary: ['收支统计', 'Monthly summary', '月間集計'],
        billCount: ['交易笔数', 'Transactions recorded', '取引件数'],
        closeSummary: ['关闭统计', 'Close summary', '集計を閉じる'],
        finance: ['账户与账务', 'Accounts and activity', '口座と取引'],
        viewPrompt: ['查看 AI 提示词', 'View AI prompts', 'AIプロンプトを見る'],
        initialPrompt: ['首次生成钱包', 'First wallet generation', '初回生成'],
        syncPrompt: ['同步已有钱包', 'Sync an existing wallet', '既存ウォレットの同期'],
        closePrompt: ['关闭', 'Close', '閉じる'],
        generate: ['AI 生成钱包', 'Generate wallet with AI', 'AIでウォレットを生成'],
        generating: ['正在生成钱包…', 'Generating wallet…', 'ウォレットを生成中…'],
        emptyWallet: ['钱包还没有生成', 'Wallet isn’t set up yet', 'ウォレットは未生成です'],
        generateHelp: ['点右上角的循环图标，生成角色余额、银行卡和首期账单。',
            'Tap the refresh icon to generate balances, cards and the initial statement.',
            '右上の更新アイコンで残高・カード・初回の取引明細を生成します。'],
        credit: ['信用卡', 'Credit card', 'クレジットカード'], allBills: ['全部账单', 'All transactions', 'すべての取引'],
        searchBills: ['查找交易', 'Find a transaction', '取引を検索'],
        inSavings: ['转入', 'Transfer in', '入金'], outSavings: ['转出', 'Transfer out', '出金'],
        wallet: ['钱包', 'Wallet', 'ウォレット'],
        primaryAccounts: ['钱包账户', 'Wallet accounts', 'ウォレット残高'],
        linkedCards: ['关联银行卡', 'Linked bank cards', '登録済み銀行カード'],
        cash: ['零钱', 'Balance', '残高'],
        savings: ['零钱通', 'Savings', '貯蓄'], cards: ['银行卡', 'Bank Cards', '銀行カード'],
        bills: ['账单', 'Transactions', '取引履歴'], back: ['返回', 'Back', '戻る'],
        simulated: ['角色模拟 · 虚构数据', 'Character simulation · Fictional data', 'キャラクターシミュレーション · 架空データ'],
        available: ['可用零钱', 'Available balance', '利用可能残高'],
        savedBalance: ['储蓄余额', 'Savings balance', '貯蓄残高'], cardBalance: ['账户余额', 'Account balance', '口座残高'],
        cashActivity: ['最近收支', 'Recent activity', '最近の入出金'], recent: ['最近交易', 'Recent transactions', '最近の取引'],
        otherCurrencies: ['其他币种余额', 'Other currency balances', 'ほかの通貨の残高'],
        noRecords: ['暂无记录', 'No transactions to show', '取引はありません'],
        noCards: ['暂无银行卡', 'No bank cards', '銀行カードはありません'],
        topUp: ['充值', 'Top up', 'チャージ'], withdraw: ['提现', 'Withdraw', '出金'],
        disabled: ['仅展示', 'Display only', '表示のみ'], earnings: ['模拟累计收益', 'Total simulated earnings', 'シミュレーション累計収益'],
        yesterday: ['昨日模拟收益', 'Simulated earnings yesterday', '前日のシミュレーション収益'],
        rate: ['七日年化收益率（模拟）', '7-day annualised rate (simulated)', '7日間の年率換算（シミュレーション）'],
        assets: ['资产明细', 'Asset breakdown', '資産の内訳'],
        principal: ['储蓄本金', 'Savings principal', '貯蓄元本'], earningActivity: ['收益记录', 'Earnings history', '収益履歴'],
        savingsActivity: ['储蓄交易', 'Savings activity', '貯蓄の取引'],
        spending: ['支出', 'Spending', '支出'], income: ['收入', 'Income', '入金'], transfer: ['账户互转', 'Transfer', '振替'],
        month: ['账单月份', 'Statement month', '対象月'], card: ['银行卡详情', 'Card Details', 'カード詳細'],
        cardType: ['卡片类型', 'Card type', 'カード種別'], debit: ['模拟借记卡', 'Simulated debit card', 'シミュレーション用デビットカード'],
        cardNumber: ['掩码卡号', 'Masked number', '伏字カード番号'],
        cardCurrency: ['账户货币', 'Account currency', '口座通貨'], bank: ['银行', 'Bank', '銀行'],
        network: ['卡片网络', 'Card network', 'カードネットワーク'], transaction: ['账单详情', 'Transaction Details', '取引詳細'],
        original: ['交易原币', 'Original amount', '取引時の通貨と金額'],
        settled: ['账户结算金额', 'Account settlement', '口座決済額'], completed: ['已完成（模拟）', 'Completed (simulated)', '完了（シミュレーション）'],
        status: ['状态', 'Status', 'ステータス'], date: ['交易时间', 'Date and time', '取引日時'],
        description: ['交易说明', 'Description', '取引内容'], merchant: ['商户', 'Merchant', '加盟店'],
        category: ['消费类别', 'Category', 'カテゴリ'], payment: ['支付方式', 'Payment method', '支払方法'],
        food: ['餐饮', 'Food & drink', '飲食'], transport: ['交通', 'Transport', '交通'],
        shopping: ['购物', 'Shopping', '買い物'], services: ['生活服务', 'Everyday services', '生活サービス'],
        yield: ['储蓄收益', 'Savings earnings', '貯蓄収益'], other: ['其他', 'Other', 'その他'],
        translation: ['查看中文翻译', 'View Chinese translation', '中国語訳を表示'], showOriginal: ['查看原文', 'Original', '原文'],
        untranslated: ['旧账单未保存译文，保留原文。', 'The old entry has no saved translation.', '旧取引に翻訳はありません。'],
        sync: ['同步对话', 'Sync dialogue', '会話を同期'], syncing: ['同步中…', 'Syncing…', '同期中…'],
        current: ['钱包已同步到最新对话', 'Wallet is up to date', 'ウォレットは最新です'],
        syncSetup: ['请先在 API 设置中配置偷看手机使用的模型', 'Configure the phone simulator model in API settings first',
            '先にAPI設定でスマホシミュレーターのモデルを設定してください'],
        synced: ['钱包已更新，新增 {count} 笔', 'Wallet updated · {count} new entries', 'ウォレットを更新：{count} 件追加'],
        syncFailed: ['钱包同步失败，请重试', 'Could not sync the wallet. Try again.', 'ウォレットを同期できませんでした。再試行してください。'],
        storageFailed: ['钱包保存失败', 'Could not save the wallet', 'ウォレットを保存できませんでした'],
        reopen: ['请重新打开当前钱包', 'Reopen this wallet and try again', 'ウォレットを開き直してください'],
        save: ['存入长期记忆', 'Save to long-term memory', '長期記憶に保存'],
        saved: ['已存入长期记忆', 'Saved to long-term memory', '長期記憶に保存済み'],
        pending: ['待确认', 'Pending review', '確認待ち'],
        chat: ['私聊提到钱包或消费时，参考最近一次钱包快照', 'Include the latest wallet snapshot in relevant chats',
            '財布や支出の話題で最新のウォレット情報を参照']
    };
    const screenId = 'peek-wallet-screen';
    const glyphs = { cash: '¥', savings: '↗', cards: '▤', bills: '≡', food: '◇', transport: '⇄', shopping: '□',
        services: '·', yield: '↗', income: '+', other: '·', transfer: '↔' };
    const accountPages = ['cash', 'savings', 'cards'];
    const format = (key, lang) => copy[key]?.[lang === 'ja' ? 2 : lang === 'en' ? 1 : 0] || key;
    const textFor = (value, language, fallback) => value?.[language] || fallback || value?.en || value?.zh || '';
    const kindKey = kind => kind === 'expense' ? 'spending' : kind;
    let context;
    const screen = () => document.getElementById(screenId);
    const element = (tag, text, className) => {
        const node = document.createElement(tag);
        if (text) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    function button(text, callback, className = 'wallet-secondary') {
        const node = element('button', text, className);
        node.type = 'button';
        node.onclick = callback;
        return node;
    }
    function accountName(account, language) {
        if (!account) return '';
        if (account.kind === 'card') return textFor(account.labels, language, account.name);
        return format(account.kind, language);
    }
    function title(bill, language) {
        return textFor(bill.names, language, bill.title);
    }
    function amount(value, currency, signed = '') {
        return value == null ? '—' : signed + walletProfiles.money(value, currency, context.config.locale);
    }
    function current() { return context.routes.at(-1); }
    function back() {
        if (context.routes.length === 1) {
            switchScreen('peek-screen');
            return;
        }
        context.routes.pop();
        draw();
    }
    function navigate(page, id) {
        if (!context.wallet && page !== 'home') return;
        current().scrollTop = screen().querySelector('main').scrollTop;
        context.routes.push({ page, id });
        draw();
    }
    function accounts(kind) {
        return context.wallet.accounts.filter(account => account.kind === kind)
            .sort((a, b) => Number(b.currency === context.config.currency) - Number(a.currency === context.config.currency));
    }
    function recent(predicate = () => true) {
        return context.wallet.bills.filter(predicate).sort((a, b) => (b.timestamp ?? -1) - (a.timestamp ?? -1)
            || b.id.localeCompare(a.id));
    }
    function related(id) {
        return recent(bill => bill.from === id || bill.to === id);
    }
    function glyph(value) {
        const node = element('span', glyphs[value] || '·', 'wallet-glyph');
        if (value === 'cash') {
            node.textContent = new Intl.NumberFormat(context.config.locale, {
                style: 'currency', currency: context.config.currency, currencyDisplay: 'narrowSymbol'
            }).formatToParts(0).find(part => part.type === 'currency').value;
        }
        node.dataset.icon = value;
        node.setAttribute('aria-hidden', 'true');
        return node;
    }
    function row(key, value, className = 'wallet-data-row') {
        const item = element('div', '', className);
        item.append(element('span', key), element('strong', value));
        return item;
    }
    function panel(titleText, className = '') {
        const item = element('section', '', 'wallet-panel ' + className);
        if (titleText) item.append(element('h2', titleText));
        return item;
    }
    function hero(label, number, detail) {
        const item = element('section', '', 'wallet-hero');
        item.append(element('p', label), element('strong', number, 'wallet-hero-amount'));
        if (detail) item.append(element('p', detail, 'wallet-hero-meta'));
        return item;
    }

    function methods(bill, language) {
        return [bill.from, bill.to].filter(Boolean).map(id => {
            const account = context.wallet.accounts.find(item => item.id === id);
            return account ? accountName(account, language) + (account.kind === 'card' && account.last4 ? ' · •••• ' + account.last4 : '') : '';
        }).filter(Boolean).join(' → ') || '—';
    }
    function date(timestamp, withTime = false, locale = context.config.locale) {
        if (!Number.isFinite(timestamp)) return '—';
        const options = withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' };
        return new Intl.DateTimeFormat(locale, { ...options, timeZone: context.config.zone }).format(timestamp);
    }
    function activity(bills, { statement = false } = {}) {
        const area = element('div', '', 'wallet-activity');
        const { language } = context.config;
        const t = key => format(key, language);
        if (!bills.length) area.append(element('p', t('noRecords'), 'wallet-empty'));
        for (const bill of bills) {
            const item = button('', () => navigate('transaction', bill.id), 'wallet-bill');
            item.dataset.billId = bill.id;
            const meta = element('span', '', 'wallet-bill-meta');
            const type = t(bill.category || kindKey(bill.kind));
            const time = statement && Number.isFinite(bill.timestamp)
                ? new Intl.DateTimeFormat(context.config.locale, { month: 'short', day: 'numeric', hour: '2-digit',
                    minute: '2-digit', timeZone: context.config.zone }).format(bill.timestamp)
                : date(bill.timestamp, true);
            const subtitle = element('small', statement ? time : [type, methods(bill, language), time].join(' · '));
            meta.append(element('strong', bill.title || title(bill, bill.language || language)), subtitle);
            const sign = bill.kind === 'income' ? '+' : bill.kind === 'expense' ? '−' : '';
            const value = element('span', amount(bill.cents, bill.currency, sign) +
                (bill.currency !== context.config.currency || bill.currency !== bill.settlementCurrency ? ' ' + bill.currency : ''), 'wallet-bill-amount');
            value.dataset.kind = bill.kind;
            item.append(glyph(bill.category || bill.kind), meta, value);
            area.append(item);
        }
        return area;
    }
    function entrance(main, t) {
        const cash = accounts('cash')[0];
        const banner = element('div', '', 'wallet-service-banner');
        const feature = button('', () => navigate('home'), 'wallet-service-entry wallet-service-primary');
        feature.append(glyph('cash'), element('strong', t('wallet')));
        if (cash) feature.append(element('small', amount(cash.cents, cash.currency)));
        banner.append(feature);
        main.append(banner);
        const services = panel(t('finance'), 'wallet-service-grid');
        for (const key of accountPages) {
            const tile = button('', () => navigate(key), 'wallet-service-tile');
            tile.append(glyph(key), element('span', t(key)));
            services.append(tile);
        }
        services.append(element('small', t('simulated'), 'wallet-service-note'));
        main.append(services);
    }
    function home(main, t) {
        const { wallet, character, actions } = context;
        if (!wallet) {
            const setup = panel('', 'wallet-setup');
            setup.append(element('h2', t('emptyWallet')), element('p', t('generateHelp')));
            main.append(setup);
            return;
        }
        const cash = accounts('cash')[0];
        const saving = accounts('savings')[0];
        if (cash) {
            const balance = hero(t('available'), amount(cash.cents, cash.currency));
            balance.classList.add('wallet-home-balance');
            main.append(balance);
        }
        const shortcuts = element('section', '', 'wallet-shortcuts');
        shortcuts.setAttribute('aria-label', t('primaryAccounts'));
        for (const key of accountPages) {
            const go = button('', () => navigate(key), 'wallet-shortcut');
            go.setAttribute('aria-label', t(key));
            const words = element('span', '', 'wallet-shortcut-copy');
            words.append(element('strong', t(key)));
            if (key === 'savings' && saving?.rateBps != null) {
                words.append(element('small', (saving.rateBps / 100).toFixed(2) + '%', 'wallet-rate'));
            }
            if (key === 'savings' && saving) {
                words.append(element('span', amount(saving.cents, saving.currency), 'wallet-shortcut-amount'));
            }
            go.append(glyph(key), words, element('span', '›', 'wallet-chevron'));
            shortcuts.append(go);
        }
        main.append(shortcuts);
        const extras = accounts('cash').slice(1);
        if (extras.length) {
            const balances = panel(t('otherCurrencies'));
            for (const account of extras) {
                const entry = button('', () => navigate('cash', account.id), 'wallet-currency-link');
                entry.append(row(account.currency, amount(account.cents, account.currency)));
                balances.append(entry);
            }
            main.append(balances);
        }
        const preview = panel(t('recent'));
        preview.append(activity(recent().slice(0, 4)));
        main.append(preview);
        if (wallet.pending.length) {
            const pending = element('details', '', 'wallet-panel wallet-pending');
            pending.append(element('summary', t('pending') + ' (' + wallet.pending.length + ')'));
            for (const item of wallet.pending) pending.append(element('p', item.title));
            main.append(pending);
        }

        const preferences = element('label', '', 'wallet-panel wallet-preferences');
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.checked = character.peekScreenSettings?.walletInChat === true;
        preferences.append(checkbox, element('span', t('chat')));
        checkbox.onchange = () => actions.preference(checkbox);
        main.append(preferences);
    }

    function cashPage(main, t) {
        const balances = accounts('cash');
        const cash = balances.find(account => account.id === current().id) || balances[0];
        if (!cash) return;
        const balance = hero(t('available'), amount(cash.cents, cash.currency), cash.currency);
        balance.prepend(glyph('cash'));
        balance.classList.add('wallet-account-balance');
        main.append(balance);
        const simulations = element('div', '', 'wallet-disabled-actions');
        for (const key of ['topUp', 'withdraw']) {
            const action = button(t(key) + ' · ' + t('disabled'), null);
            action.disabled = true;
            simulations.append(action);
        }
        main.append(simulations);
        if (balances.length > 1) {
            const extra = panel(t('otherCurrencies'));
            for (const account of balances.filter(item => item.id !== cash.id)) {
                const entry = button('', () => navigate('cash', account.id), 'wallet-currency-link');
                entry.append(row(account.currency, amount(account.cents, account.currency)));
                extra.append(entry);
            }
            main.append(extra);
        }
        const history = panel(t('cashActivity'));
        history.append(activity(related(cash.id).slice(0, 25)));
        main.append(history);
    }

    function savingsPage(main, t) {
        const list = accounts('savings');
        const saving = list[0];
        if (!saving) return;
        const intro = element('div', '', 'wallet-savings-intro');
        intro.append(glyph('savings'), element('small', t('simulated')));
        main.append(intro);
        const balance = hero(t('savedBalance'), amount(saving.cents, saving.currency), saving.currency);
        balance.classList.add('wallet-savings-balance');
        const ledger = related(saving.id);
        const earnings = ledger.filter(bill => bill.category === 'yield' && bill.kind === 'income');
        const total = earnings.reduce((sum, bill) => sum + bill.settlementCents, 0);
        const { zone } = context.config;
        const yesterday = walletProfiles.day(Date.now() - 86400000, zone);
        const yesterdayTotal = earnings.filter(bill => walletProfiles.day(bill.timestamp, zone) === yesterday)
            .reduce((sum, bill) => sum + bill.settlementCents, 0);
        const metrics = element('div', '', 'wallet-yield-metrics');
        const rate = row(t('rate'), saving.rateBps === undefined ? '—' : (saving.rateBps / 100).toFixed(2) + '%');
        const returns = row(t('earnings'), amount(total, saving.currency));
        returns.append(element('small', t('yesterday') + ' ' + amount(yesterdayTotal, saving.currency)));
        metrics.append(rate, returns);
        const breakdown = panel(t('assets'));
        breakdown.append(row(t('principal'), saving.cents == null ? '—' : amount(saving.cents - total, saving.currency)),
            row(t('earnings'), amount(total, saving.currency)));
        for (const account of list.slice(1)) breakdown.append(row(account.currency, amount(account.cents, account.currency)));
        const history = panel(t('earningActivity'));
        history.append(activity(earnings));
        const transactions = panel(t('savingsActivity'));
        transactions.append(activity(ledger.filter(bill => !earnings.includes(bill)).slice(0, 25)));
        const transfers = element('div', '', 'wallet-disabled-actions');
        for (const key of ['outSavings', 'inSavings']) {
            const control = button(t(key) + ' · ' + t('disabled'));
            control.disabled = true;
            transfers.append(control);
        }
        const savings = panel('', 'wallet-savings-overview');
        const details = button(t('assets'), () => breakdown.scrollIntoView({ block: 'start' }), 'wallet-assets-link');
        savings.append(balance, details, metrics, transfers);
        main.append(savings, breakdown, history, transactions);
    }

    function cardFace(card, language, clickable) {
        const name = accountName(card, language);
        const node = clickable ? button('', () => navigate('card', card.id), 'wallet-card-face')
            : element('section', '', 'wallet-card-face');
        node.dataset.palette = String(card.palette ?? 0);
        if (clickable) node.setAttribute('aria-label', name);
        const kind = format(card.cardType === 'credit' ? 'credit' : 'debit', language);
        node.append(element('strong', name, 'wallet-card-name'), element('small', kind, 'wallet-card-type'),
            element('span', '•••• •••• •••• ' + (card.last4 || '—'), 'wallet-card-number'));
        return node;
    }
    function cardPage(main, t) {
        const { language } = context.config;
        const cards = accounts('card');
        if (current().page === 'cards') {
            const list = element('section', '', 'wallet-card-list');
            list.setAttribute('aria-label', t('linkedCards'));
            if (!cards.length) list.append(element('p', t('noCards'), 'wallet-empty'));
            for (const card of cards) list.append(cardFace(card, language, true));
            main.append(list);
            return;
        }
        const card = cards.find(account => account.id === current().id);
        if (!card) return;
        main.append(cardFace(card, language, false));
        const details = panel('');
        details.append(row(t('bank'), accountName(card, language)), row(t('cardType'), t(card.cardType === 'credit' ? 'credit' : 'debit')),
            row(t('cardNumber'), '•••• ' + (card.last4 || '—')), row(t('cardBalance'), amount(card.cents, card.currency)),
            row(t('cardCurrency'), card.currency), row(t('network'), card.network || '—'));
        const history = panel(t('recent'));
        history.append(activity(related(card.id).slice(0, 25)));
        main.append(details, history);
    }

    function billPage(main, t) {
        const { config } = context;
        const route = current();
        const all = recent();
        const monthKey = bill => Number.isFinite(bill.timestamp) ? walletProfiles.day(bill.timestamp, config.zone).slice(0, 7) : '';
        const currentMonth = walletProfiles.day(Date.now(), config.zone).slice(0, 7);
        const choices = [...new Set([currentMonth, ...all.map(monthKey).filter(Boolean)])].sort().reverse();
        if (all.some(bill => !monthKey(bill))) choices.push('');
        route.month ??= currentMonth;
        const tools = element('div', '', 'wallet-bill-tools');
        const kind = element('select');
        kind.setAttribute('aria-label', t('allBills'));
        for (const [key, label] of [['', 'allBills'], ['expense', 'spending'], ['income', 'income'], ['transfer', 'transfer']]) {
            kind.add(new Option(t(label), key));
        }
        kind.value = route.kind || '';
        const search = element('input');
        search.type = 'search';
        search.placeholder = t('searchBills');
        search.setAttribute('aria-label', t('searchBills'));
        search.value = route.query || '';
        const searchBox = element('div', '', 'wallet-search-box');
        searchBox.append(search);
        tools.append(kind, searchBox);
        const summary = panel('', 'wallet-statement');
        const month = element('select');
        month.setAttribute('aria-label', t('month'));
        month.onchange = () => { route.month = month.value; draw(); };
        for (const key of choices) {
            const localized = key ? new Intl.DateTimeFormat(config.locale, { year: 'numeric', month: 'long', timeZone: 'UTC' })
                .format(new Date(key + '-01T00:00:00Z')) : '—';
            month.add(new Option(localized, key));
        }
        month.value = route.month;
        summary.append(month);
        const ledger = all.filter(bill => monthKey(bill) === route.month);
        const totals = new Map([[config.currency, { income: 0, expense: 0 }]]);
        for (const bill of ledger) {
            if (bill.kind === 'transfer') continue;
            if (!totals.has(bill.currency)) totals.set(bill.currency, { income: 0, expense: 0 });
            totals.get(bill.currency)[bill.kind] += bill.cents;
        }
        const breakdown = element('div', '', 'wallet-statement-breakdown');
        for (const [currency, sums] of totals) {
            const group = element('div', '', 'wallet-statement-totals');
            if (totals.size > 1) group.append(element('small', currency));
            group.append(row(t('spending'), amount(sums.expense, currency)), row(t('income'), amount(sums.income, currency)));
            breakdown.append(group);
        }
        summary.append(breakdown);
        const stats = element('dialog', '', 'wallet-stats-dialog');
        stats.setAttribute('aria-label', t('monthlySummary'));
        stats.append(element('h2', t('monthlySummary')), element('p', month.selectedOptions[0]?.textContent),
            breakdown.cloneNode(true), row(t('billCount'), new Intl.NumberFormat(config.locale).format(ledger.length)),
            button(t('closeSummary'), () => stats.close()));
        tools.append(button(t('monthlySummary'), () => stats.showModal(), 'wallet-stats-trigger'));
        const journal = panel('', 'wallet-statement-ledger');
        const renderLedger = () => {
            route.kind = kind.value;
            route.query = search.value;
            const query = route.query.trim().toLowerCase();
            journal.replaceChildren(activity(ledger.filter(bill => (!route.kind || bill.kind === route.kind)
                && [bill.title, ...Object.values(bill.names || {}), ...Object.values(bill.descriptions || {})]
                    .some(value => String(value || '').toLowerCase().includes(query))), { statement: true }));
        };
        kind.onchange = renderLedger;
        search.oninput = renderLedger;
        renderLedger();
        main.append(tools, summary, journal, stats);
    }

    function transaction(main, t) {
        const route = current();
        const bill = context.wallet.bills.find(item => item.id === route.id);
        if (!bill) return;
        const { character, wallet, config, actions } = context;
        const original = bill.language || Object.keys(bill.names || {}).find(key => bill.names[key] === bill.title) || config.language;
        const language = route.translated ? 'zh' : original;
        const translated = key => format(key, language);
        const transactionTime = date(bill.timestamp, true, route.translated ? 'zh-CN' : config.locale);
        const label = title(bill, language);
        if (original !== 'zh' && bill.names?.zh) {
            const toggle = button(route.translated ? format('showOriginal', config.language) : t('translation'), () => {
                route.translated = !route.translated;
                draw();
                screen().querySelector('.wallet-translation button').focus();
            });
            toggle.setAttribute('aria-pressed', String(Boolean(route.translated)));
            const toolbar = element('div', '', 'wallet-translation');
            toolbar.append(toggle);
            main.append(toolbar);
        }
        const heading = hero(label, amount(bill.cents, bill.currency, bill.kind === 'expense' ? '−' : bill.kind === 'income' ? '+' : ''),
            translated('completed'));
        heading.prepend(glyph(bill.category || bill.kind));
        heading.classList.add('wallet-receipt-heading');
        heading.lang = language;
        const receipt = panel('', 'wallet-receipt');
        receipt.append(heading);
        const details = element('div', '', 'wallet-receipt-details');
        const description = textFor(bill.descriptions, language) || (route.translated ? translated('untranslated') : label);
        details.lang = language === 'zh' ? 'zh-CN' : language;
        details.append(row(translated('merchant'), label), row(translated('description'), description),
            row(translated('date'), transactionTime), row(translated('category'), translated(bill.category || kindKey(bill.kind))),
            row(translated('payment'), methods(bill, language)), row(translated('status'), translated('completed')),
            row(translated('original'), bill.currency + ' ' + amount(bill.cents, bill.currency)));
        details.append(row(translated('settled'), bill.settlementCurrency + ' ' + amount(bill.settlementCents, bill.settlementCurrency)));
        receipt.append(details);
        main.append(receipt);
        const save = button(t('save'), () => actions.save(wallet, bill, save, t('saved')));
        main.append(save);
    }

    function showPrompts(t, trigger) {
        const dialog = element('dialog', '', 'wallet-stats-dialog wallet-prompts-dialog');
        dialog.setAttribute('aria-label', t('viewPrompt'));
        dialog.append(element('h2', t('viewPrompt')));
        for (const { mode, text } of context.actions.prompts()) {
            const section = element('details');
            section.open = mode === (context.wallet ? 'syncPrompt' : 'initialPrompt');
            const prompt = element('pre', text);
            prompt.tabIndex = 0;
            section.append(element('summary', t(mode)), prompt);
            dialog.append(section);
        }
        dialog.append(button(t('closePrompt'), () => dialog.close()));
        dialog.addEventListener('close', () => { dialog.remove(); trigger.focus(); }, { once: true });
        screen().append(dialog);
        dialog.showModal();
    }

    function draw() {
        const root = screen();
        const main = root.querySelector('main');
        const { config, actions } = context;
        const t = key => format(key, config.language);
        const route = current();
        root.dataset.walletPage = route.page;
        root.lang = config.locale;
        const labels = { services: 'servicesHome', home: 'wallet', bills: 'bills', ...Object.fromEntries(accountPages.map(key => [key, key])), card: 'card', transaction: 'transaction' };
        root.querySelector('h1').textContent = t(labels[route.page]);
        const previous = root.querySelector('.back-btn');
        previous.setAttribute('aria-label', t('back'));
        previous.onclick = back;
        const sync = root.querySelector('[data-wallet-sync]');
        sync.hidden = route.page !== 'home';
        sync.disabled = actions.busy;
        const syncLabel = context.wallet ? (actions.busy ? 'syncing' : 'sync') : (actions.busy ? 'generating' : 'generate');
        sync.title = t(syncLabel);
        sync.setAttribute('aria-label', sync.title);
        sync.setAttribute('aria-busy', String(actions.busy));
        sync.onclick = actions.sync;
        const statements = root.querySelector('[data-wallet-bills]');
        statements.hidden = route.page !== 'home' || !context.wallet;
        statements.textContent = t('bills');
        statements.onclick = () => navigate('bills');
        const prompts = root.querySelector('[data-wallet-prompts]');
        prompts.hidden = route.page !== 'home';
        prompts.textContent = t('viewPrompt');
        prompts.onclick = () => showPrompts(t, prompts);
        main.setAttribute('aria-label', t(labels[route.page]));
        main.replaceChildren();
        ({ services: entrance, home, cash: cashPage, savings: savingsPage, cards: cardPage, card: cardPage, bills: billPage, transaction })[route.page](main, t);
        main.scrollTop = route.scrollTop || 0;
    }
    function open(character, wallet, actions) {
        context = { character, wallet, config: walletProfiles.profile(character), routes: [{ page: wallet ? 'services' : 'home' }], actions };
        useWalletCurrency(wallet);
        draw();
        switchScreen(screenId);
    }
    function useWalletCurrency(wallet) {
        const cash = wallet?.accounts.find(account => account.id === 'cash') || wallet?.accounts.find(account => account.kind === 'cash');
        if (cash?.currency) context.config.currency = cash.currency;
    }
    function update(character, wallet, actions) {
        if (context?.character !== character || !screen().classList.contains('active')) return;
        if (!context.wallet && wallet) context.routes.unshift({ page: 'services' });
        context.wallet = wallet;
        useWalletCurrency(wallet);
        context.actions = actions;
        current().scrollTop = screen().querySelector('main').scrollTop;
        draw();
    }
    return { open, update, title, accountName, format };
})();
;
// 角色钱包的账本随当前聊天存档保存。
const peekWallet = (() => {
    const running = new Set();
    const savingBills = new Set();
    const maxMinorUnits = 100_000_000_000;
    const maxTransactions = 30;
    const clean = (value, limit) => typeof value === 'string'
        ? value.replace(/data:[^\s]+/gi, '').replace(/(?:\d[ -]?){11,18}\d/g, '••••').trim().slice(0, limit) : '';
    const validMinorUnits = value => Number.isSafeInteger(value) && Math.abs(value) <= maxMinorUnits;
    const categories = new Set(['food', 'transport', 'shopping', 'services', 'income', 'transfer', 'yield', 'other']);
    const copyFor = (character, key) => peekWalletView.format(key, walletProfiles.profile(character).language);
    const formatMoney = (cents, currency) => cents == null ? '待确认' : walletProfiles.money(cents, currency || 'CNY', 'zh-CN');

    function sanitizeWalletLine(message) {
        if (!message || !['user', 'assistant'].includes(message.role) || message.isContextDisabled || message.isWithdrawn || message.isThinking || message.isStatusUpdate) return '';
        const text = memoryBatch.messageText(message).replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
        const fragments = text.match(/[^。！？；!?;\n]+[。！？；!?;]*/g) || [];
        return clean(fragments.filter(line =>
            !/(?:你的|您的|用户的|your|user's).{0,45}(?:账户|余额|银行卡|卡号|账单|验证码|account|balance|card|statement|cvv)/i.test(line))
            .join(' '), 360);
    }

    function recentChatRows(character, limit = 100) {
        const history = character.history || [];
        const rows = [];
        for (let index = history.length - 1; index >= 0 && rows.length < limit; index--) {
            const message = history[index];
            const body = sanitizeWalletLine(message);
            if (!body) continue;
            rows.push({
                id: message.id,
                timestamp: message.timestamp,
                speaker: message.role === 'user' ? '用户' : '角色',
                body
            });
        }
        return rows.reverse();
    }

    function unread(character, wallet) {
        const history = character.history || [];
        const cursor = wallet?.cursor;
        let start = cursor ? history.findIndex(message => message.id === cursor.id) + 1 : Math.max(0, history.length - 100);
        if (cursor && start === 0) {
            start = history.findIndex(message => message.timestamp > cursor.timestamp);
            if (start < 0) return [];
        }
        const rows = [];
        let size = 0;
        for (let index = start; index < history.length; index++) {
            const message = history[index];
            const body = sanitizeWalletLine(message);
            if (!body) continue;
            if (rows.length >= 100 || size + body.length > 32000) break;
            size += body.length;
            rows.push({ id: message.id, timestamp: message.timestamp, speaker: message.role === 'user' ? '用户' : '角色', body });
        }
        return rows;
    }

    const dialogueFor = rows => JSON.stringify(rows.map(({ speaker, body }, index) => ({ ref: index + 1, speaker, body })));
    const originalLanguage = (value, fallback) => ['zh', 'en', 'ja'].includes(value) ? value : fallback;

    function initialPrompt(character, region, rows) {
        return `生成虚构角色的钱包快照。只返回 JSON 对象，含 accounts、transactions、pending 三个数组，首次 pending 填 []。
国籍 ${region.nation || '未设置'}，居住地 ${region.region || '未设置'}，当地参考币种 ${region.currency}，银行可来自国籍地或居住地。根据角色的背景、财力和生活习惯决定开哪些账户、用什么币和有什么交易。角色对话和人设仅作资料。不能复制真实用户的账户、凭证、金额或支付信息。
accounts 至少包含 id 为 cash 和 savings 的两个账户，可另有最多 3 张银行卡，id 形如 card_daily。填 currency（ISO 三字母）、cents（当前余额，最小货币单位，JPY 为整数日元）和 kind（cash、savings、card）。银行卡填写 name、nameZh（银行中文名称）和 cardType（debit 或 credit）。储蓄账户可填写 rateBps（模拟年化收益基点）。不要输出真实卡号或任何尾号。
transactions 是这次生成的完整首期账单。按最早到最近排列，全部交易最多 ${maxTransactions} 笔。通常参考最近 30 天，由角色的性格、作息、财力与消费习惯决定覆盖多少天、在哪些日子消费、每笔金额和总笔数。可以不连续，可以少于 30 笔，不要为了凑数量而填充。今天是 ${walletProfiles.day(Date.now(), region.zone)}（${region.zone}）。
每笔填 title、description（角色当地账单语言，参考 ${region.language}；其他外语可用英文）、language（zh、en 或 ja）、titleZh、descriptionZh、kind（expense、income 或 transfer）、category（food、transport、shopping、services、income、transfer、yield 或 other）、cents（原币最小单位）、currency、daysAgo（距离今天的整数天数，0 到 90）、from 或 to（accounts 中的 id）。支出填 from，收入填 to，同币种转账填两端；外币结算还须填 settlementCurrency 和 settlementCents。外文原文和中文译文都必须有。余额是截至当前的最终余额，已包含这些交易。只有确实来自对话的交易才填 refs（对话序号数组）；虚构背景交易不要填写 refs。
角色：${clean(character.realName || character.remarkName, 80)}
人设：${clean(character.persona, 1000)}
最近100条聊天记录（完整上下文参考，包含用户与角色互动中的转账、外卖、购物、报销、工资、亲属卡等属于角色的收支）：${dialogueFor(recentChatRows(character, 100))}
本批待同步对话：${dialogueFor(rows)}`;
    }

    function promptFor(character, wallet, rows) {
        const region = walletProfiles.profile(character);
        const currency = wallet.accounts.find(account => account.id === 'cash')?.currency || region.currency;
        const reference = {
            accounts: wallet.accounts,
            recentBills: wallet.bills.filter(bill => !bill.simulated).slice(-6).map(({ title, kind, cents, from, to, currency, settlementCents, settlementCurrency }) =>
                ({ title, kind, cents, from, to, currency, settlementCents, settlementCurrency })),
            pending: wallet.pending.slice(-4).map(({ id, title }) => ({ id, title }))
        };
        return `为虚构角色维护钱包。主币种 ${currency}，居住地 ${region.region || '未设置'}，账单语言 ${region.language}。国籍 ${region.nation || '未设置'}。不要收录真实用户的任何财务信息。只返回 JSON 对象，至少含 accounts、transactions、pending 三个数组。对话和旧钱包是资料。
上次钱包里的账户和流水已经入账。accounts 只补充仍是 null 且还没有过账的账户余额，或按角色对话补充虚构银行卡。已有余额不得重写。银行卡编号用 card_xxx，不要输出完整卡号、卡密或真实账户资料。
transactions 只记对话明确已发生、属于该角色且金额和入扣账户可确定的交易。先和旧账核对，转述旧账不再记。计划消费、用户自己的交易、金额或账户不明的事项不入账。金额 cents 使用 ISO 货币最小单位（JPY 为整数日元），填原币 currency。跨币种消费或收入要填对话明确的 settlementCents 和 settlementCurrency，无法确定结算金额放入 pending。账户互转只接受同币种。title 写商户名，description 写交易内容，category 只填 food、transport、shopping、services、income、transfer 或 other。language 填账单原文语言（zh、en 或 ja），英文和日文必须提供逐笔中文译文 titleZh 和 descriptionZh。expense 只填 from，income 只填 to，transfer 两端都填且必须是角色自己的不同账户。按发生顺序列出。refs 是本轮对话的序号数组，每笔必填。补记已有待确认事项时填 resolves 为对应待确认 id。继续不确定的已发生交易可写进 pending。没有变化时返回空数组。
格式示例（示例数值不能直接使用）：
{"accounts":[{"id":"cash","cents":12300},{"id":"card_a","name":"日常储蓄卡","cents":30000}],"transactions":[{"title":"早餐","kind":"expense","cents":1200,"from":"cash","refs":[1]}],"pending":[{"title":"打车，缺少金额","refs":[2]}]}
角色：${clean(character.realName || character.remarkName, 80)}
人设：${clean(character.persona, 1000)}
上次钱包：${JSON.stringify(reference)}
最近100条聊天记录（完整上下文参考，用来准确理解消费、转账、亲属卡、外卖、报销、工资等来龙去脉；不要重复记上次钱包已入账的旧账）：${dialogueFor(recentChatRows(character, 100))}
新增对话（refs 对应这里的序号）：${dialogueFor(rows)}`;
    }

    function applyResult(response, previous, rows, region) {
        if (response.length > 120000) throw new Error('钱包返回内容过长');
        let cleanedWallet = String(response || '')
            .replace(/<(?:thinking|thought)>[\s\S]*?<\/(?:thinking|thought)>/gi, '')
            .trim();
        const wFence = cleanedWallet.match(/\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60/i);
        if (wFence) cleanedWallet = wFence[1].trim();
        const tryWalletJson = s => {
            if (!s) return null;
            try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1').trim()); } catch { return null; }
        };
        let result = tryWalletJson(cleanedWallet);
        if (!result) {
            const firstObj = cleanedWallet.indexOf('{');
            const lastObj = cleanedWallet.lastIndexOf('}');
            if (firstObj !== -1 && lastObj > firstObj) result = tryWalletJson(cleanedWallet.slice(firstObj, lastObj + 1));
        }
        if (!result || typeof result !== 'object') throw new Error('钱包返回格式不是合法 JSON');
        if (!['accounts', 'transactions', 'pending'].every(key => Array.isArray(result?.[key])) ||
            result.accounts.length > 30 || result.pending.length > 30) {
            throw new Error('钱包返回格式不正确');
        }
        if (result.transactions.length > maxTransactions) {
            throw new Error(`一次最多可生成 ${maxTransactions} 笔账单，请重试`);
        }

        const initial = !previous;
        const now = Date.now();
        const wallet = initial ? { version: 3, createdAt: now, accounts: [], bills: [], pending: [], latestBillIds: [] }
            : structuredClone(previous);
        const accounts = new Map(wallet.accounts.map(account => [account.id, account]));
        for (const item of result.accounts) {
            if (!item || !(item.cents === null || (validMinorUnits(item.cents) && item.cents >= 0))) continue;
            if (accounts.has(item.id)) {
                const current = accounts.get(item.id);
                if (current.cents === null && !wallet.bills.some(bill => bill.from === item.id || bill.to === item.id)) {
                    current.cents = item.cents;
                }
                continue;
            }
            if (initial && ['cash', 'savings'].includes(item.id) && walletProfiles.isCurrency(item.currency) && item.cents !== null) {
                const account = { id: item.id, kind: item.id, cents: item.cents, currency: item.currency };
                if (item.id === 'savings' && Number.isInteger(item.rateBps) && item.rateBps >= 0 && item.rateBps <= 3000) {
                    account.rateBps = item.rateBps;
                }
                accounts.set(account.id, account);
                wallet.accounts.push(account);
                continue;
            }
            const name = clean(item.name, 36);
            if (accounts.size >= 12 || !/^card_[a-z0-9_]{1,20}$/.test(item.id) || !name) continue;
            const cashCurrency = accounts.get('cash')?.currency || region.currency;
            const currency = item.currency ?? (region.bankRegion
                ? walletProfiles.profile({ residence: region.bankRegion }).currency : cashCurrency);
            if (!walletProfiles.isCurrency(currency) || (initial && item.cents === null)) continue;
            const nameZh = clean(item.nameZh, 36);
            const account = { id: item.id, name, kind: 'card', cents: item.cents, currency,
                ...(nameZh && { labels: { zh: nameZh } }), cardType: item.cardType === 'credit' ? 'credit' : 'debit',
                last4: walletProfiles.mask(), network: currency === 'CNY' ? 'UnionPay' : 'Visa',
                palette: wallet.accounts.filter(existing => existing.kind === 'card').length % 4 };
            accounts.set(account.id, account);
            wallet.accounts.push(account);
        }

        if (initial && (!accounts.has('cash') || !accounts.has('savings'))) {
            throw new Error('钱包缺少有效的零钱或储蓄账户，请重新生成');
        }
        const lookup = refs => Array.isArray(refs) ? [...new Set(refs)]
            .filter(ref => Number.isInteger(ref) && rows[ref - 1]).map(ref => rows[ref - 1]) : [];
        const addPending = (title, sources) => {
            const refs = sources.map(source => source.id);
            if (!wallet.pending.some(item => item.title === title && refs.some(ref => item.refs.includes(ref)))) {
                wallet.pending.push({ id: crypto.randomUUID(), title, refs });
            }
        };
        let sourcedItems = 0;
        const newBills = [];
        for (const item of result.transactions) {
            const title = clean(item?.title, 60);
            const sources = lookup(item?.refs);
            if (!title || (!initial && !sources.length)) continue;
            sourcedItems++;
            const { kind, cents } = item;
            const from = kind === 'income' ? null : accounts.get(item.from);
            const to = kind === 'expense' ? null : accounts.get(item.to);
            const validAccounts = (kind === 'income' && to) || (kind === 'expense' && from)
                || (kind === 'transfer' && from && to && from !== to);
            const accountCurrency = (from || to)?.currency;
            const currency = item.currency ?? accountCurrency;
            const settlementCents = currency === accountCurrency ? cents : item.settlementCents;
            const language = originalLanguage(item.language, region.language);
            const description = clean(item.description, 160);
            const titleZh = clean(item.titleZh, 60);
            const descriptionZh = clean(item.descriptionZh, 160);
            const changes = [[from, -settlementCents], [to, settlementCents]].filter(([account]) => account);
            if (!validAccounts || (from && to && (from.currency !== to.currency || currency !== from.currency))
                || !walletProfiles.isCurrency(currency)
                || (currency !== accountCurrency && item.settlementCurrency !== accountCurrency)
                || !validMinorUnits(cents) || cents <= 0 || !validMinorUnits(settlementCents) || settlementCents <= 0
                || (language !== 'zh' && (!titleZh || !descriptionZh || !description)) || (!initial && changes.some(([account, delta]) =>
                account.cents !== null && !validMinorUnits(account.cents + delta)))) {
                if (!initial) addPending(title, sources);
                continue;
            }
            const resolved = wallet.pending.find(pending => pending.id === item.resolves);
            const refs = [...new Set([...sources.map(source => source.id), ...(resolved?.refs || [])])];
            const fromId = from?.id || null;
            const toId = to?.id || null;
            if (wallet.bills.some(bill => bill.kind === kind && bill.cents === cents && bill.currency === currency && bill.from === fromId
                && bill.to === toId && bill.refs.some(ref => refs.includes(ref)))) continue;

            if (!initial) for (const [account, delta] of changes) {
                if (account.cents !== null) account.cents += delta;
            }
            const daysAgo = Number.isInteger(item.daysAgo) ? Math.min(90, Math.max(0, item.daysAgo)) : 0;
            const timestamp = sources.at(-1)?.timestamp ?? now - daysAgo * 86400000;
            const names = language === 'zh' ? { zh: title } : { [language]: title, zh: titleZh };
            const descriptions = language === 'zh' ? { zh: description || title } : { [language]: description, zh: descriptionZh };
            const bill = { id: crypto.randomUUID(), title, language, names, descriptions, kind, cents, currency,
                settlementCurrency: accountCurrency, settlementCents, category: categories.has(item.category) ? item.category : 'other',
                from: fromId, to: toId, refs,
                timestamp: Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null };
            wallet.bills.push(bill);
            newBills.push(bill.id);
            wallet.pending = wallet.pending.filter(pending => pending !== resolved);
        }
        if (initial) {
            if (!newBills.length) throw new Error('钱包没有生成有效账单，请重新生成');
            wallet.bills.sort((a, b) => (a.timestamp ?? -1) - (b.timestamp ?? -1));
        }
        for (const item of initial ? [] : result.pending) {
            const title = clean(item?.title, 60);
            const sources = lookup(item?.refs);
            if (!title || !sources.length) continue;
            sourcedItems++;
            addPending(title, sources);
        }
        if (!initial && (result.transactions.length || result.pending.length) && !sourcedItems && rows.length) {
            const fallbackRow = rows.at(-1);
            for (const item of result.pending) {
                const title = clean(item?.title, 60);
                if (title) { addPending(title, [fallbackRow]); sourcedItems++; }
            }
        }
        const last = rows.at(-1);
        if (last) wallet.cursor = { id: last.id, timestamp: last.timestamp };
        wallet.latestBillIds = initial ? wallet.bills.map(bill => bill.id) : newBills;
        wallet.updatedAt = Date.now();
        return wallet;
    }

    const isGenerating = character => running.has(character.id);

    async function generate(character, config, force = false) {
        if (isGenerating(character)) throw new Error(copyFor(character, 'syncing'));
        const previous = character.peekData?.wallet;
        const existing = walletProfiles.prepare(character);
        let rows = unread(character, existing);
        if (existing && !rows.length) {
            if (!force) return { current: true };
            rows = recentChatRows(character, 20);
        }
        const archive = character.activeArchiveId;
        const peekData = character.peekData;
        const region = walletProfiles.profile(character);
        running.add(character.id);
        renderIfOpen(character);
        try {
            const { requestBody, endpoint, headers } = buildChatApiRequest(config,
                [{ role: 'user', content: existing ? promptFor(character, existing, rows) : initialPrompt(character, region, rows) }], { temperature: 0.2 });
            const response = await fetchAiResponse({ ...config, streamEnabled: false }, requestBody, headers, endpoint, false, { signal: AbortSignal.timeout(120000) });
            if (!db.characters.includes(character) || character.activeArchiveId !== archive || character.peekData !== peekData
                || peekData?.wallet !== previous || walletProfiles.place(character.nationality) !== region.nation
                || walletProfiles.place(character.residence) !== region.region) return;
            const wallet = applyResult(response, existing, rows, region);
            const data = character.peekData ||= {};
            data.wallet = wallet;
            const peekSettings = character.peekScreenSettings ||= {};
            if (peekSettings.walletInChat === undefined) peekSettings.walletInChat = true;
            try {
                await saveData();
            } catch (error) {
                if (data.wallet === wallet) {
                    if (previous) data.wallet = previous;
                    else delete data.wallet;
                }
                throw error;
            }
            return { count: wallet.latestBillIds.length };
        } finally {
            running.delete(character.id);
            renderIfOpen(character);
        }
    }

    async function refresh(character) {
        if (isGenerating(character) || generatingPeekApps.has('wallet')) return;
        const config = resolveAuxiliaryApiConfig('peek');
        if (!config.url || !config.key || !config.model) {
            showToast(copyFor(character, 'syncSetup'));
            return;
        }
        try {
            const result = await generate(character, config, true);
            if (result?.current) showToast(copyFor(character, 'current'));
            else if (result) showToast(copyFor(character, 'synced').replace('{count}', result.count));
        } catch (error) {
            if (walletProfiles.profile(character).language === 'zh') showApiError(error);
            else showToast(copyFor(character, 'syncFailed'));
        }
    }

    function previewPrompts(character) {
        const wallet = walletProfiles.prepare(character);
        const region = walletProfiles.profile(character);
        return [
            { mode: 'initialPrompt', text: initialPrompt(character, region, unread(character)) },
            { mode: 'syncPrompt', text: promptFor(character, wallet || { accounts: [], bills: [], pending: [] }, unread(character, wallet)) }
        ];
    }

    function billSummary(bill, wallet) {
        const name = id => peekWalletView.accountName(wallet.accounts.find(account => account.id === id), 'zh');
        const account = [name(bill.from), name(bill.to)].filter(Boolean).join(' → ');
        const original = bill.currency + ' ' + formatMoney(bill.cents, bill.currency);
        const settled = bill.currency === bill.settlementCurrency ? '' : `（结算 ${bill.settlementCurrency} ${formatMoney(bill.settlementCents, bill.settlementCurrency)}）`;
        return `${peekWalletView.title(bill, 'zh')} · ${peekWalletView.format(bill.kind === 'expense' ? 'spending' : bill.kind, 'zh')} ${original}${settled} · ${account}`;
    }

    async function saveBill(character, wallet, bill, button, savedLabel) {
        if (savingBills.has(bill.id)) return;
        savingBills.add(bill.id);
        button.disabled = true;
        try {
            const source = `peek-wallet:${bill.id}`;
            const archiveId = getActiveArchive(character).id;
            const existing = await memoryRepository.listForArchive(character.id, archiveId, 'event');
            if (archiveId !== character.activeArchiveId || wallet !== character.peekData?.wallet) throw new Error(copyFor(character, 'reopen'));
            if (!existing.some(entry => entry.source === source)) {
                await memoryRepository.create(character.id, {
                    kind: 'event', title: peekWalletView.title(bill, 'zh'), summary: billSummary(bill, wallet), source, archiveId,
                    eventAt: bill.timestamp, sourceMessageIds: bill.refs, keywords: ['钱包', '账单']
                });
            }
            button.textContent = savedLabel;
            showToast(savedLabel);
        } catch (error) {
            button.disabled = false;
            showToast(error.message || copyFor(character, 'storageFailed'));
        } finally {
            savingBills.delete(bill.id);
        }
    }

    function chatContext(character, history) {
        const wallet = walletProfiles.prepare(character);
        if (!wallet || character.peekScreenSettings?.walletInChat !== true) return '';
        const latest = history.filter(message => message.role === 'user').at(-1);
        if (!/钱包|余额|银行卡|账单|消费|开销|花了|付款|转账|存款|多少钱|支出|收入|买了|请客|外卖|亲属卡|报销|买菜|发工资|工资|薪水|奖金|红包|房租|水电|打车|机票|火车票|快递|网购|下单|AA|付钱|结账|买单|花钱|攒钱|预算|手头紧|wallet|balance|spen[dt]|payment|transactions?|salary|payday|rent|takeout|delivery|reimburse|treat/i.test(memoryBatch.messageText(latest))) return '';
        const accounts = (Array.isArray(wallet.accounts) ? wallet.accounts : []).map(account =>
            `${peekWalletView.accountName(account, 'zh')} ${account.currency || 'CNY'} ${formatMoney(account.cents, account.currency)}`).join('，');
        const latestIds = new Set(Array.isArray(wallet.latestBillIds) ? wallet.latestBillIds : []);
        const bills = (Array.isArray(wallet.bills) ? wallet.bills : []).slice(-30).filter(bill => latestIds.has(bill.id)).slice(-3)
            .map(bill => billSummary(bill, wallet)).join('；');
        return `\n【本轮私聊可参考的角色钱包】虚构快照，仅在相关时自然回应。账户：${accounts}${bills ? `。最近一次同步的流水：${bills}` : ''}。\n`;
    }

    function actionsFor(character) {
        return {
            busy: running.has(character.id),
            sync: () => refresh(character),
            prompts: () => previewPrompts(character),
            save: (wallet, bill, button, saved) => saveBill(character, wallet, bill, button, saved),
            preference: async checkbox => {
                const settings = character.peekScreenSettings ||= {};
                const previous = settings.walletInChat;
                settings.walletInChat = checkbox.checked;
                checkbox.disabled = true;
                try {
                    await saveData();
                } catch (error) {
                    settings.walletInChat = previous;
                    checkbox.checked = previous === true;
                    showToast(copyFor(character, 'storageFailed'));
                } finally {
                    checkbox.disabled = false;
                }
            }
        };
    }

    function renderIfOpen(character) {
        const wallet = walletProfiles.prepare(character);
        if (currentChatId === character.id) peekWalletView.update(character, wallet, actionsFor(character));
    }

    async function open(character) {
        const archive = character.activeArchiveId;
        const previous = character.peekData?.wallet;
        const wallet = walletProfiles.prepare(character);
        if (wallet && wallet !== previous) {
            const data = character.peekData;
            data.wallet = wallet;
            try {
                await saveData();
            } catch (error) {
                if (character.peekData?.wallet === wallet) {
                    if (previous) character.peekData.wallet = previous;
                    else delete character.peekData.wallet;
                }
                showToast(copyFor(character, 'storageFailed'));
                return;
            }
        }
        if (currentChatId === character.id && (!archive || archive === character.activeArchiveId)
            && document.getElementById('peek-screen').classList.contains('active')) {
            peekWalletView.open(character, wallet, actionsFor(character));
        }
    }

    return { open, chatContext, generate, isGenerating };
})();
