const Phone = {
    homePresses: 0,
    crackPresses: 0,
    available: true,
    subjectActive: false,
    eventTimer: null,
    notificationTimer: null,
    shutdownTimer: null,
    controlView: null,
    infoView: null,
    settingsView: null,
    coinView: null,
    slotView: null,
    stage: null,
    activeApp: null,
    slotMode: null,
    profileColor: null,
    returnApp: null,
    homeReturnApp: null,
    coinPhase: 'target',
    infoContext: null,
    selectedSuggestion: '',
    infoHistory: [],
    doNotDisturb: false,
    airplaneMode: false,

    init() {
        this.stage = document.getElementById('subjectPhoneStage');
        this.controlView = document.getElementById('phoneControlView');
        this.infoView = document.getElementById('phoneInfoView');
        this.settingsView = document.getElementById('phoneSettingsView');
        this.coinView = document.getElementById('phoneCoinView');
        this.slotView = document.getElementById('phoneSlotView');

        const app = document.querySelector('.app-container');
        if (app && this.stage && this.stage.parentElement !== app) {
            this.stage.classList.add('shared-phone-stage');
            app.appendChild(this.stage);
        }
        this.mountCoinPanels();

        document.querySelectorAll('[data-phone-control]').forEach(button => {
            button.addEventListener('click', () => this.pressControl(button));
        });

        [['phoneBrightness', 'brightness'], ['phoneVolume', 'volume']].forEach(([id, name]) => {
            const slider = document.getElementById(id);
            if (slider) {
                slider.addEventListener('input', () => this.adjustSlider(slider, name));
                if (name === 'brightness') this.applyBrightness(Number(slider.value) / 100);
            }
        });

        this.renderCracks();
        this.updateClock();
        window.setInterval(() => this.updateClock(), 30000);
    },

    mountCoinPanels() {
        const mounts = [
            {
                id: 'phoneCoinTargetPanel',
                source: 'scrCoinPhase1',
                selectors: ['.lobby-header', '#coinSubjectSelectionBox', '#coinNonSubjectWaitingBox']
            },
            {
                id: 'phoneCoinSidePanel',
                source: 'scrCoinPhase2',
                selectors: ['.brand-header', '#coinMatrixSubjectControls', '#coinMatrixWaitNotice']
            },
            {
                id: 'phoneCoinFlipPanel',
                source: 'scrCoinStage',
                selectors: [
                    '.lobby-header', '#coinTapInstruction', '.coin-stage',
                    '#coinOutcomeBanner', '#coinRevealedQuestionCard', '#coinNextRoundBtn'
                ]
            }
        ];
        mounts.forEach(({ id, source, selectors }) => {
            const target = document.getElementById(id);
            const screen = document.getElementById(source);
            if (!target || !screen) return;
            selectors.forEach(selector => {
                const element = screen.querySelector(selector);
                if (element) target.appendChild(element);
            });
        });
    },

    updateClock() {
        const clock = document.getElementById('phoneClock');
        if (!clock) return;
        const now = new Date();
        clock.textContent = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    },

    setView(view) {
        const views = {
            controls: this.controlView,
            info: this.infoView,
            settings: this.settingsView,
            coin: this.coinView,
            slots: this.slotView
        };
        Object.entries(views).forEach(([name, element]) => {
            if (element) element.hidden = name !== view;
        });
    },

    openForSubject() {
        this.subjectActive = true;
        this.activeApp = 'controls';
        this.slotMode = null;
        this.homeReturnApp = null;
        this.stage.classList.remove('can-wake');
        if (!this.available) {
            this.available = true;
            document.getElementById('phoneShutdown').hidden = true;
        }
        this.open();
        this.setView('controls');
        this.startEvents();
    },

    openForLobby() {
        if (!this.available) return;
        this.activeApp = 'controls';
        this.returnApp = null;
        this.homeReturnApp = null;
        this.slotMode = null;
        this.updateReturnToGame();
        this.open();
    },

    open() {
        if (!this.available || !this.stage) return;
        if (!this.activeApp) this.activeApp = 'controls';
        const device = document.getElementById('phoneDevice');
        const shouldAnimate = !device.classList.contains('is-open');
        this.stage.classList.remove('can-wake');
        this.stage.classList.add('is-phone-open');
        this.renderCracks();
        if (shouldAnimate) {
            device.classList.remove('is-open');
            void device.offsetWidth;
        }
        device.classList.add('is-open');
        device.setAttribute('aria-hidden', 'false');
        this.setView(this.activeApp);
    },

    wakeOrDismiss() {
        if (this.homePresses >= 100 &&
            this.stage && this.stage.classList.contains('is-phone-open')) {
            this.close();
            return;
        }
        this.open();
    },

    openApp(name) {
        if (name !== 'info') this.returnApp = null;
        this.activeApp = name;
        this.open();
    },

    openSettings() {
        if (!this.available) {
            this.available = true;
            const shutdown = document.getElementById('phoneShutdown');
            if (shutdown) shutdown.hidden = true;
        }
        if (this.activeApp !== 'settings') this.returnApp = this.activeApp || 'controls';
        this.activeApp = 'settings';
        this.setView('settings');
        this.open();
    },

    openSlot(mode) {
        this.slotMode = mode;
        this.returnApp = null;
        this.homeReturnApp = null;
        this.activeApp = 'slots';
        const rewardMode = mode === 'reward';
        document.getElementById('phoneSlotKicker').textContent =
            rewardMode ? 'CLASSIC MODE' : 'OPENSIGHT CASINO';
        document.getElementById('phoneSlotTitle').textContent =
            rewardMode ? 'Lucky Draw' : 'Slot Machine';
        document.getElementById('phoneSlotCaption').textContent = rewardMode
            ? 'Match three symbols to win a round reward.'
            : 'Spin the reels and see what you get.';
        const guide = document.getElementById('phoneSlotGuide');
        guide.hidden = !rewardMode;
        guide.open = false;
        document.getElementById('casinoAppSkip').hidden = !rewardMode;
        if (rewardMode) {
            const botResults = document.getElementById('casinoAppBotResults');
            botResults.hidden = true;
            botResults.replaceChildren();
        }
        this.open();
    },

    openLuckyDraw() {
        this.openSlot('reward');
    },

    openCasinoSlot() {
        this.openSlot('casino');
    },

    spinSlot() {
        if (this.slotMode === 'reward' && window.Gambling) {
            Gambling.requestSpin();
        } else if (this.slotMode === 'casino' && window.CasinoSlot) {
            CasinoSlot.spin();
        }
    },

    openCoinApp(phase) {
        this.returnApp = null;
        this.homeReturnApp = null;
        this.activeApp = 'coin';
        this.showCoinPhase(phase);
        const isSubject = typeof net !== 'undefined' && net.myName === coinState.subject;
        if (!isSubject && phase !== 'flip') {
            this.homeReturnApp = 'coin';
            this.activeApp = 'controls';
            this.updateReturnToGame();
            this.setView('controls');
        } else {
            this.homeReturnApp = null;
            this.updateReturnToGame();
        }
        this.open();
    },

    showCoinPhase(phase) {
        this.activeApp = 'coin';
        this.coinPhase = phase;
        const panels = {
            target: 'phoneCoinTargetPanel',
            side: 'phoneCoinSidePanel',
            flip: 'phoneCoinFlipPanel'
        };
        Object.values(panels).forEach(id => {
            const panel = document.getElementById(id);
            if (panel) panel.hidden = id !== panels[phase];
        });
        this.setView('coin');
        this.open();
    },

    close() {
        const device = document.getElementById('phoneDevice');
        if (!device || !this.stage) return;
        device.classList.remove('is-open');
        device.setAttribute('aria-hidden', 'true');
        this.stage.classList.remove('is-phone-open');
        this.renderCracks();
        const resumeApp = this.homeReturnApp;
        const canWake = this.subjectActive || this.activeApp === 'coin' ||
            resumeApp === 'coin' || resumeApp === 'slots';
        this.stage.classList.toggle('can-wake', canWake);
        if (resumeApp && canWake) {
            this.activeApp = resumeApp;
            this.homeReturnApp = null;
        } else if (!canWake) {
            this.activeApp = null;
            this.returnApp = null;
            this.slotMode = null;
            this.homeReturnApp = null;
        }
    },

    dismiss() {
        if (this.activeApp === 'slots' && this.slotMode === 'reward' && window.Gambling) {
            Gambling.skip();
            return;
        }
        if (this.activeApp === 'slots' && this.slotMode === 'casino' && window.CasinoSlot) {
            CasinoSlot.close();
            return;
        }
        this.close();
    },

    stopEvents() {
        this.subjectActive = false;
        window.clearInterval(this.eventTimer);
        window.clearTimeout(this.shutdownTimer);
        this.eventTimer = null;
        this.shutdownTimer = null;
        if (this.stage) this.stage.classList.remove('can-wake');
    },

    startEvents() {
        window.clearInterval(this.eventTimer);
        if (this.homePresses >= 100) return;
        this.eventTimer = window.setInterval(() => {
            if (!this.subjectActive || !this.available || Math.random() > 0.12) return;
            this.randomEvent();
        }, 18000);
    },

    randomEvent() {
        const events = [
            () => {
                const names = typeof room !== 'undefined' && Array.isArray(room.players)
                    ? room.players.filter(name => name && name !== (typeof net !== 'undefined' ? net.myName : ''))
                    : [];
                const caller = names.length ? names[Math.floor(Math.random() * names.length)] : 'Unknown Number';
                this.notify(`Incoming call: ${caller}. They have nothing important to say.`);
            },
            () => this.notify('Notification: You have 0 unread homework assignments. Suspicious.'),
            () => this.glitch(),
            () => this.notify('Control Center could not connect to your toaster.'),
            () => this.freeze()
        ];
        events[Math.floor(Math.random() * events.length)]();
    },

    pressControl(button) {
        if (!this.available) return;
        const control = button.dataset.phoneControl;
        const names = {
            wifi: 'Wi-Fi',
            bluetooth: 'Bluetooth',
            airplane: 'Airplane mode',
            flashlight: 'Flashlight',
            dnd: 'Do Not Disturb',
            rotation: 'Rotation lock'
        };
        const name = names[control];
        if (!name) return;
        const enabled = button.getAttribute('aria-pressed') !== 'true';
        button.setAttribute('aria-pressed', String(enabled));
        button.classList.toggle('is-on', enabled);

        const screen = document.querySelector('.phone-screen');
        if (control === 'flashlight') screen.classList.toggle('is-flashlight', enabled);
        if (control === 'airplane') {
            this.airplaneMode = enabled;
            this.updateStatusIcons();
        }
        if (control === 'dnd') this.doNotDisturb = enabled;
        if (control === 'rotation') document.getElementById('phoneDevice').classList.toggle('is-rotation-locked', enabled);

        this.notify(`${name} ${enabled ? 'on' : 'off'}.`, true);
        this.hapticFallback(45);
    },

    updateStatusIcons() {
        const icons = document.getElementById('phoneStatusIcons');
        if (icons) icons.textContent = this.airplaneMode ? '✈ ◉ ▰' : '▮▮▮ ◉ ▰';
    },

    adjustSlider(slider, name) {
        if (!this.available) return;
        const level = Number(slider.value) / 100;
        const device = document.getElementById('phoneDevice');
        if (name === 'brightness') {
            this.applyBrightness(level);
        } else if (typeof Sound !== 'undefined' && typeof Sound.setVolume === 'function') {
            Sound.setVolume(level);
        }
        const vibrated = window.Vibrations && window.Vibrations.phoneSlider(level);
        if (!vibrated) {
            device.classList.remove('is-shaking');
            void device.offsetWidth;
            device.classList.add('is-shaking');
            window.setTimeout(() => device.classList.remove('is-shaking'), 220);
        }
    },

    applyBrightness(level) {
        const screen = document.querySelector('.phone-screen');
        if (screen) screen.style.filter = `brightness(${0.7 + level * 0.75})`;
    },

    hapticFallback(duration) {
        if (window.Vibrations && window.Vibrations.isSupported()) {
            window.Vibrations.phoneSlider(0.35);
            return;
        }
        const device = document.getElementById('phoneDevice');
        device.classList.remove('is-shaking');
        void device.offsetWidth;
        device.classList.add('is-shaking');
        window.setTimeout(() => device.classList.remove('is-shaking'), duration + 100);
    },

    getHelpContext(overrides = {}) {
        const modeSelect = document.getElementById('lobbyModeSelect');
        const categorySelect = document.getElementById('lobbyCategorySelect');
        const lobby = document.getElementById('scrLobby');
        const lobbyIsActive = lobby && lobby.classList.contains('active');
        const gameRoom = typeof room !== 'undefined' ? room : null;
        const mode = overrides.mode || (lobbyIsActive && modeSelect
            ? modeSelect.value
            : gameRoom && gameRoom.gameMode) || 'classic';
        const roomCategory = !gameRoom ? 'classic'
            : mode === 'coin' ? gameRoom.coinCategory
                : mode === 'casino' ? gameRoom.casinoCategory
                    : mode === 'openbox' && gameRoom.openboxConfig
                        ? gameRoom.openboxConfig.category
                        : gameRoom.currentCategory;
        const categoryValues = {
            classic: ['classic', 'trouble', 'spicy', 'deep', 'flirt', 'trash', 'nsfw', 'misc'],
            coin: ['Party', 'Spicy', 'Deep'],
            casino: ['slots', 'blackjack'],
            openbox: ['classic', 'spicy', 'deep', 'nsfw']
        };
        const lobbyCategory = lobbyIsActive && categorySelect &&
            categoryValues[mode] && categoryValues[mode].includes(categorySelect.value)
            ? categorySelect.value
            : roomCategory;
        const category = overrides.category || lobbyCategory || 'classic';
        const modeNames = { classic: 'Classic', coin: 'Coin Mode', casino: 'Casino', openbox: 'Openbox' };
        const categoryNames = {
            classic: {
                classic: 'Party', trouble: 'Trouble', spicy: 'Spicy', deep: 'Deep',
                flirt: 'Flirt', trash: 'Trash', nsfw: 'NSFW', misc: 'Mixed'
            },
            coin: { Party: 'Party', Spicy: 'Spicy', Deep: 'Deep' },
            casino: { slots: 'Slot Machine', blackjack: 'Blackjack' },
            openbox: { classic: 'Classic', spicy: 'Spicy', deep: 'Deep', nsfw: 'NSFW (18+)' }
        };
        return Object.assign({
            mode,
            category,
            modeName: modeNames[mode] || 'Classic',
            categoryName: (categoryNames[mode] && categoryNames[mode][category]) || category || 'Party'
        }, overrides);
    },

    showLobbyHelp(kind, overrides = {}) {
        const context = this.getHelpContext(overrides);
        context.kind = kind;
        this.showInfo(context);
    },

    showInfo(context) {
        if (!this.available) return;
        const resolved = context && context.modeName ? context : this.getHelpContext(context || {});
        this.returnApp = this.activeApp === 'info' ? this.returnApp : this.activeApp;
        const modeRules = {
            classic: 'Everyone except the current subject writes an answer to the prompt. The subject reveals the cards and picks a favorite; the room can vote when that option is enabled.',
            coin: 'The subject secretly chooses Heads or Tails, then picks a target. The coin starts flipping automatically on every phone as soon as the target is picked; a matching side protects the answer, while the other side reveals it.',
            casino: resolved.category === 'blackjack'
                ? 'Join the table, receive two cards, then hit or stand. The closest hand to 21 wins; going over 21 busts.'
                : 'Open the Slot Machine app on this phone and spin as many times as you like. Matching symbols are a jackpot. No bot or second player is needed.',
            openbox: 'True/False: one subject writes a question or statement and marks its truth; correct predictions and each player fooled earn 1 point. Open Answer: correct predictions earn 1 point, and an answer author earns 1 for each other player who chooses their answer. Reveals show who voted for each answer.'
        };
        const categoryRules = {
            classic: {
                classic: 'Party prompts are light, quick questions designed for funny answers.',
                trouble: 'Trouble prompts invite mischievous answers. Keep them playful and respect the room.',
                spicy: 'Spicy prompts are more daring. Skip anything that makes you uncomfortable.',
                deep: 'Deep prompts are reflective. Share only what you are comfortable sharing.',
                flirt: 'Flirt prompts are playful. Keep it consensual and comfortable for everyone.',
                trash: 'Trash prompts are silly, chaotic, and intentionally low-stakes.',
                nsfw: 'NSFW prompts are intended for adults only. Make sure everyone in the room is comfortable.',
                misc: 'Mixed draws from a variety of prompt styles.'
            },
            coin: {
                Party: 'Party Coin prompts are light scenarios. Pick a target, choose a side, then flip.',
                Spicy: 'Spicy Coin prompts are more daring. Pick a target and side, and skip anything uncomfortable.',
                Deep: 'Deep Coin prompts are reflective. Choose what you are comfortable sharing before the flip.'
            },
            casino: {
                slots: 'Spin as many times as you like. Three matching symbols make a jackpot.',
                blackjack: 'Blackjack is a shared table: join, then compete for the best hand without going over 21.'
            },
            openbox: {
                classic: 'Light bluffing prompts for the whole room.',
                spicy: 'Playful, bolder prompts; skip anything uncomfortable.',
                deep: 'Reflective prompts; share only what you choose.',
                nsfw: 'Adults-only, more explicit prompts. Keep consent and boundaries clear.'
            }
        };
        const modeAnswer = modeRules[resolved.mode] || modeRules.classic;
        const categoryAnswer = (categoryRules[resolved.mode] && categoryRules[resolved.mode][resolved.category])
            || modeAnswer;
        const kind = resolved.kind || 'overview';
        const answer = kind === 'mode'
            ? modeAnswer
            : kind === 'category'
                ? `${resolved.categoryName} in ${resolved.modeName}: ${categoryAnswer}`
                : `${resolved.modeName}: ${modeAnswer}\n\n${resolved.categoryName}: ${categoryAnswer}`;
        const openingQuestion = kind === 'mode'
            ? `Explain ${resolved.modeName}`
            : kind === 'category'
                ? `Explain ${resolved.categoryName} in ${resolved.modeName}`
                : `Quick guide to ${resolved.modeName}`;

        this.infoContext = {
            ...resolved,
            kind,
            answer,
            modeRules: modeAnswer,
            categoryRules: categoryAnswer
        };
        this.selectedSuggestion = '';
        this.infoHistory = [];
        document.getElementById('phoneGeminiWelcome').hidden = false;
        document.getElementById('phoneGeminiResponse').hidden = true;
        document.getElementById('phoneGeminiResponse').replaceChildren();
        this.setGeminiProfile();
        this.renderSuggestions();
        const input = document.getElementById('phoneInfoInput');
        if (input) input.value = '';
        this.openApp('info');
        this.addInfoTurn(openingQuestion, answer);
    },

    renderSuggestions() {
        const context = this.infoContext || this.getHelpContext();
        const label = context.kind === 'mode' ? context.modeName : context.categoryName;
        const suggestions = [
            { icon: '✧', text: `How do I play ${label}?` },
            { icon: '♙', text: `What happens in ${context.modeName}?` },
            { icon: '♧', text: `Explain the ${context.categoryName} rules` }
        ];
        const container = document.getElementById('phoneSuggestions');
        if (!container) return;
        container.replaceChildren(...suggestions.map(({ icon, text }) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'phone-suggestion';
            const mark = document.createElement('span');
            mark.className = 'phone-suggestion-mark';
            mark.setAttribute('aria-hidden', 'true');
            mark.textContent = icon;
            const label = document.createElement('span');
            label.textContent = text;
            button.dataset.prompt = text;
            button.setAttribute('aria-pressed', String(text === this.selectedSuggestion));
            if (text === this.selectedSuggestion) button.classList.add('is-selected');
            button.append(mark, label);
            button.addEventListener('click', () => this.selectSuggestion(text));
            return button;
        }));
    },

    addInfoTurn(question, answer) {
        this.infoHistory.push({ question, answer });
        const response = document.getElementById('phoneGeminiResponse');
        if (!response) return;
        const turn = document.createElement('div');
        turn.className = 'phone-chat-turn';
        const questionElement = document.createElement('p');
        questionElement.className = 'phone-chat-question';
        questionElement.textContent = question;
        const answerElement = document.createElement('div');
        answerElement.className = 'phone-chat-answer';
        answerElement.textContent = answer;
        turn.append(questionElement, answerElement);
        response.appendChild(turn);
        response.hidden = false;
        document.getElementById('phoneGeminiWelcome').hidden = true;
        const chat = document.querySelector('.phone-chat-scroll');
        if (chat) chat.scrollTop = chat.scrollHeight;
    },

    updateSuggestionSelection() {
        const container = document.getElementById('phoneSuggestions');
        if (!container) return;
        container.querySelectorAll('.phone-suggestion').forEach(button => {
            const selected = button.dataset.prompt === this.selectedSuggestion;
            button.classList.toggle('is-selected', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
    },

    setGeminiProfile() {
        const avatar = document.getElementById('phoneGeminiAvatar');
        if (!avatar) return;
        const nameInput = document.getElementById('menuNameInput');
        const name = (typeof net !== 'undefined' && net.myName) ||
            (nameInput && nameInput.value.trim()) || 'Player';
        const colors = ['#d52f72', '#536fe1', '#e27a36', '#238c7b', '#8b5dc4', '#b24d45'];
        if (!this.profileColor) {
            this.profileColor = colors[Math.floor(Math.random() * colors.length)];
        }
        avatar.textContent = name.trim().charAt(0).toUpperCase() || 'P';
        avatar.style.setProperty('--profile-color', this.profileColor);
        avatar.setAttribute('aria-label', `${name}'s profile`);
    },

    selectSuggestion(phrase) {
        const input = document.getElementById('phoneInfoInput');
        if (!input) return;
        this.selectedSuggestion = phrase;
        this.updateSuggestionSelection();
        input.value = phrase;
        this.askInfo();
    },

    askInfo() {
        const input = document.getElementById('phoneInfoInput');
        const question = input ? input.value.trim() : '';
        if (!question) return;
        if (question !== this.selectedSuggestion) {
            this.selectedSuggestion = '';
            this.updateSuggestionSelection();
        }
        const context = this.infoContext || this.getHelpContext();
        this.addInfoTurn(question, this.answerInfoQuestion(question, context));
        if (input) input.value = '';
    },

    answerInfoQuestion(question, context) {
        const lower = question.toLowerCase();
        const modeAnswer = context.modeRules || context.answer;
        const categoryAnswer = context.categoryRules || context.answer;

        if (/\bbots?\b/.test(lower)) {
            return context.mode === 'casino' && context.category === 'slots'
                ? 'Slots are a solo activity, so bots are optional. If room bots are present, they spin automatically alongside you.'
                : 'Room bots can write and vote in Classic, take turns in Coin Mode, and join Blackjack automatically.';
        }
        if (context.mode === 'coin' && /\b(coin|heads?|tails?|flip|target)\b/.test(lower)) {
            return 'The subject secretly chooses Heads or Tails, then picks a target. The coin starts flipping automatically on every phone as soon as the target is picked: the matching side protects the answer, and the other side reveals it.';
        }
        if (context.mode === 'casino' && context.category === 'blackjack' &&
            /\b(blackjack|hit|stand|hand|21|deal)\b/.test(lower)) {
            return 'Join the table and receive two cards. On your turn, Hit to draw or Stand to keep your hand; the closest total to 21 wins without going over.';
        }
        if (context.mode === 'casino' && context.category === 'slots' &&
            /\b(slot|spin|reel|jackpot|symbol)\b/.test(lower)) {
            return 'Open the Slot Machine app on the phone and spin as often as you like. Three matching symbols make a jackpot.';
        }
        if (/\b(score|scoring|points?|win|winner)\b/.test(lower)) {
            if (context.mode === 'openbox') {
                return 'Openbox awards 1 point per scoring event: correct predictions score 1, True/False subjects earn 1 per player fooled, and Open Answer authors earn 1 per other player who chooses their answer. Totals carry across rounds; reveals show who voted for each answer.';
            }
            if (context.mode === 'casino' && context.category === 'blackjack') {
                return 'The winner is the player whose hand is closest to 21 without going over.';
            }
            if (context.mode === 'casino' && context.category === 'slots') {
                return 'Three matching slot symbols make a jackpot.';
            }
            return `${modeAnswer} Follow the on-screen result to see who won the round.`;
        }
        const categoryLabel = String(context.categoryName || '').toLowerCase();
        if (/\b(category|tone|style)\b/.test(lower) || (categoryLabel && lower.includes(categoryLabel))) {
            return `${context.categoryName} in ${context.modeName}: ${categoryAnswer}`;
        }
        if (/\b(next|after|turn|round|phase)\b/.test(lower)) {
            if (context.mode === 'coin') {
                return 'The subject chooses a secret side first, then picks a target. The coin starts flipping automatically on every phone as soon as the target is picked.';
            }
            if (context.mode === 'casino' && context.category === 'blackjack') {
                return 'Join the table; when it is your turn, use Hit or Stand. The table lead deals the next hand.';
            }
            return modeAnswer;
        }
        if (/\b(subject|vote|voting|write|answer|prompt)\b/.test(lower)) {
            return modeAnswer;
        }
        if (/\b(mode|play|rules|happens)\b/.test(lower)) {
            return `${context.modeName}: ${modeAnswer}`;
        }
        return `${context.categoryName} in ${context.modeName}: ${categoryAnswer} I can also explain turns, scoring, or bots.`;
    },

    resetInfo() {
        this.showInfo(this.infoContext || this.getHelpContext());
    },

    showControls() {
        if (!this.available) return;
        const returnApp = this.returnApp;
        this.returnApp = null;
        if (returnApp === 'coin') {
            this.showCoinPhase(this.coinPhase);
            return;
        }
        if (returnApp === 'info') {
            this.activeApp = 'info';
            this.setView('info');
            this.open();
            return;
        }
        this.activeApp = returnApp === 'slots' && (
            this.slotMode === 'reward' ||
            (window.CasinoSlot && CasinoSlot.active)
        )
            ? 'slots'
            : 'controls';
        this.setView(this.activeApp);
        this.open();
    },

    home() {
        if (!this.available || this.homePresses >= 100) return;
        this.homePresses += 1;
        this.crackPresses = this.homePresses === 100 ? 100 : this.crackPresses + 1;
        this.renderCracks();
        this.hapticFallback(35);
        if (this.homePresses === 100) {
            window.clearInterval(this.eventTimer);
            window.clearTimeout(this.shutdownTimer);
            this.eventTimer = null;
            this.shutdownTimer = null;
            this.notify('Screen fully cracked. Still somehow scrolling.');
        }
        if (this.activeApp !== 'controls') {
            const app = this.activeApp === 'info' ? this.returnApp : this.activeApp;
            this.homeReturnApp = app === 'coin' || app === 'slots' ? app : null;
            this.returnApp = null;
            this.activeApp = 'controls';
            this.updateReturnToGame();
            this.setView('controls');
            this.open();
        }
    },

    updateReturnToGame() {
        const button = document.getElementById('phoneReturnToGame');
        if (!button) return;
        const labels = { coin: 'Return to Coin Mode', slots: 'Return to Slot Machine' };
        button.hidden = !labels[this.homeReturnApp];
        button.textContent = labels[this.homeReturnApp] || '';
    },

    returnToGame() {
        const app = this.homeReturnApp;
        if (app !== 'coin' && app !== 'slots') return;
        this.homeReturnApp = null;
        this.returnApp = null;
        this.activeApp = app;
        this.updateReturnToGame();
        if (app === 'coin') this.showCoinPhase(this.coinPhase);
        else this.open();
    },

    renderCracks() {
        const cracks = document.getElementById('phoneCracks');
        if (!cracks) return;
        const stage = Math.min(5, Math.floor(this.crackPresses / 20));
        cracks.dataset.crackStage = String(stage);
        const isBroken = this.homePresses >= 100;
        const device = document.getElementById('phoneDevice');
        if (device) device.classList.toggle('is-shattered', isBroken);
        if (this.stage) this.stage.classList.toggle('is-broken', isBroken);
        const screen = document.querySelector('.phone-screen');
        if (screen) {
            screen.classList.toggle('is-cracked', this.crackPresses > 0);
            screen.classList.toggle('is-broken', isBroken);
            screen.inert = isBroken;
            if (isBroken) screen.setAttribute('aria-disabled', 'true');
            else screen.removeAttribute('aria-disabled');
        }
        const button = document.getElementById('phoneHomeButton');
        if (button) button.disabled = isBroken;
        const wakeTab = document.getElementById('phoneWakeTab');
        if (wakeTab) {
            const isOpen = this.stage && this.stage.classList.contains('is-phone-open');
            wakeTab.textContent = isBroken && isOpen ? 'PUT AWAY' : 'PHONE';
            wakeTab.setAttribute('aria-label',
                isBroken && isOpen ? 'Put broken phone away' : 'Open your phone');
        }
    },

    notify(message, force) {
        if (this.doNotDisturb && !force) return;
        const notification = document.getElementById('phoneNotification');
        if (!notification) return;
        notification.textContent = message;
        notification.classList.add('is-visible');
        window.clearTimeout(this.notificationTimer);
        this.notificationTimer = window.setTimeout(() => notification.classList.remove('is-visible'), 3000);
    },

    glitch() {
        const screen = document.querySelector('.phone-screen');
        screen.classList.add('phone-glitch');
        this.notify('Screen glitch. Your imaginary warranty has expired.');
        window.setTimeout(() => screen.classList.remove('phone-glitch'), 600);
    },

    freeze() {
        const screen = document.querySelector('.phone-screen');
        screen.classList.add('phone-frozen');
        this.notify('Screen frozen. Please wait while it remembers how to be a phone.');
        window.setTimeout(() => screen.classList.remove('phone-frozen'), 900);
    },

    shutdown() {
        this.available = false;
        this.close();
        document.getElementById('phoneShutdown').hidden = false;
        document.getElementById('phoneDevice').classList.add('is-open');
        document.getElementById('phoneDevice').setAttribute('aria-hidden', 'false');
        this.stage.classList.add('is-phone-open');
    }
};

window.Phone = Phone;
window.leaveNotebook = () => {
    window.close();
    window.setTimeout(() => {
        if (!window.closed) window.alert('Your browser will not let this page close itself. Close the tab to leave.');
    }, 250);
};
Phone.init();
