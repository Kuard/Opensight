(function (root) {
    'use strict';

    const CATEGORIES = ['classic', 'spicy', 'deep', 'nsfw'];
    const GAME_TYPES = ['openAnswer', 'trueFalse'];
    const PHASES = ['submitting', 'subject-answering', 'voting', 'reveal', 'complete', 'host-disconnected'];
    const POINTS_PER_CORRECT_VOTE = 1;
    const MAX_ANSWER_LENGTH = 280;
    const DEFAULT_CONFIG = {
        type: 'openAnswer',
        category: 'classic',
        submitSeconds: 60,
        voteSeconds: 45
    };

    function clampInteger(value, minimum, maximum, fallback) {
        const number = Number(value);
        return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
    }

    function hasReachedRoundLimit(round, limit) {
        return limit !== 'unlimited' && round >= limit;
    }

    function normalizeConfig(config) {
        const source = config && typeof config === 'object' ? config : {};
        return {
            type: GAME_TYPES.includes(source.type) ? source.type : DEFAULT_CONFIG.type,
            category: CATEGORIES.includes(source.category) ? source.category : 'classic',
            submitSeconds: clampInteger(source.submitSeconds, 10, 180, DEFAULT_CONFIG.submitSeconds),
            voteSeconds: clampInteger(source.voteSeconds, 10, 180, DEFAULT_CONFIG.voteSeconds)
        };
    }

    function normalizeQuestionEntry(entry) {
        const isObject = entry && typeof entry === 'object' && !Array.isArray(entry);
        const text = typeof entry === 'string' ? entry : isObject ? entry.text : '';
        if (typeof text !== 'string' || !text.trim()) {
            throw new TypeError('Openbox prompts must be non-empty strings or prompt objects.');
        }
        const hasOther = /\{other\}/i.test(text);
        const subjectCount = isObject && entry.subjectCount !== undefined
            ? entry.subjectCount
            : hasOther ? 2 : 1;
        if (![1, 2].includes(subjectCount) || (subjectCount === 2) !== hasOther) {
            throw new TypeError('Two-subject prompts must declare subjectCount: 2 and use {other}.');
        }
        return { text: text.trim(), subjectCount };
    }

    function filterEligibleQuestionEntries(entries, playerCount) {
        return (Array.isArray(entries) ? entries : [])
            .map(normalizeQuestionEntry)
            .filter(question => question.subjectCount < playerCount);
    }

    function shuffleAnswers(answers, random) {
        const result = Array.isArray(answers) ? answers.slice() : [];
        const choose = typeof random === 'function' ? random : Math.random;
        for (let index = result.length - 1; index > 0; index--) {
            const swapIndex = Math.min(index, Math.floor(choose() * (index + 1)));
            [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
        }
        return result;
    }

    function selectFairSubjects(players, subjectCount, subjectCounts, pairCounts, random) {
        const names = [...new Set((players || []).filter(name => typeof name === 'string' && name))];
        if (![1, 2].includes(subjectCount) || names.length <= subjectCount) return [];
        const counts = subjectCounts && typeof subjectCounts === 'object' ? subjectCounts : {};
        const pairs = pairCounts && typeof pairCounts === 'object' ? pairCounts : {};
        const choose = typeof random === 'function' ? random : Math.random;
        const pickIndex = length => Math.min(length - 1, Math.max(0, Math.floor(choose() * length)));
        let selected;

        if (subjectCount === 1) {
            const minimum = Math.min(...names.map(name => Number(counts[name]) || 0));
            const candidates = names.filter(name => (Number(counts[name]) || 0) === minimum);
            selected = [candidates[pickIndex(candidates.length)]];
        } else {
            const candidates = [];
            for (let first = 0; first < names.length; first++) {
                for (let second = first + 1; second < names.length; second++) {
                    candidates.push([names[first], names[second]]);
                }
            }
            const exposure = pair => pair.reduce((total, name) => total + (Number(counts[name]) || 0), 0);
            const minimumExposure = Math.min(...candidates.map(exposure));
            const leastExposed = candidates.filter(pair => exposure(pair) === minimumExposure);
            const pairKey = pair => JSON.stringify(pair.slice().sort());
            const minimumPairCount = Math.min(...leastExposed.map(pair => Number(pairs[pairKey(pair)]) || 0));
            const leastUsedPairs = leastExposed.filter(pair =>
                (Number(pairs[pairKey(pair)]) || 0) === minimumPairCount);
            selected = leastUsedPairs[pickIndex(leastUsedPairs.length)].slice();
            const key = pairKey(selected);
            pairs[key] = (Number(pairs[key]) || 0) + 1;
            selected = shuffleAnswers(selected, choose);
        }

        selected.forEach(name => {
            counts[name] = (Number(counts[name]) || 0) + 1;
        });
        return selected;
    }

    function createRound(options) {
        const input = options || {};
        const players = [...new Set((input.players || []).filter(name => typeof name === 'string' && name))];
        const subjects = [...new Set((input.subjects || []).filter(name => players.includes(name)))];
        if (!GAME_TYPES.includes(input.type)) throw new TypeError('Openbox round type is invalid.');
        if (!CATEGORIES.includes(input.category)) throw new TypeError('Openbox category is invalid.');
        if (!subjects.length || subjects.length !== (input.subjectCount || subjects.length)) {
            throw new RangeError('Openbox requires the prompt number of unique subjects.');
        }
        if (players.length <= subjects.length) throw new RangeError('Openbox requires at least one voter who is not a subject.');

        return {
            phase: input.type === 'openAnswer' ? 'submitting' : 'subject-answering',
            type: input.type,
            category: input.category,
            round: input.round || 1,
            roundLimit: input.roundLimit || 10,
            players,
            subjects,
            question: String(input.question || ''),
            deadline: 0,
            submissionsByPlayer: {},
            answers: [],
            correctBySubject: {},
            statementsBySubject: {},
            truthBySubject: {},
            votesByPlayer: {},
            eligibleVoters: players.filter(player => !subjects.includes(player)),
            roundPoints: {},
            scores: { ...(input.scores || {}) },
            skipped: false,
            skipReason: ''
        };
    }

    function submitAnswer(state, player, text) {
        if (!state || state.phase !== 'submitting') return { accepted: false, reason: 'wrong-phase' };
        if (!state.players.includes(player)) return { accepted: false, reason: 'not-a-player' };
        if (state.submissionsByPlayer[player]) return { accepted: false, reason: 'already-submitted' };
        if (typeof text !== 'string' || !text.trim()) return { accepted: false, reason: 'empty-answer' };
        if (text.trim().length > MAX_ANSWER_LENGTH) return { accepted: false, reason: 'answer-too-long' };

        const id = `answer-${Object.keys(state.submissionsByPlayer).length + 1}`;
        state.submissionsByPlayer[player] = { id, text: text.trim(), author: player };
        return { accepted: true, complete: state.players.every(name => !!state.submissionsByPlayer[name]) };
    }

    function prepareOpenAnswerVoting(state, random) {
        if (!state || state.type !== 'openAnswer' || state.phase !== 'submitting') {
            return { ready: false, reason: 'wrong-phase' };
        }
        const missingSubjects = state.subjects.filter(subject => !state.submissionsByPlayer[subject]);
        if (missingSubjects.length) return { ready: false, reason: 'missing-subject-answer', missingSubjects };

        state.answers = shuffleAnswers(Object.values(state.submissionsByPlayer), random)
            .map((answer, index) => ({ id: `answer-${index + 1}`, text: answer.text, author: answer.author }));
        state.correctBySubject = Object.fromEntries(state.subjects.map(subject => [
            subject,
            state.answers.find(answer => answer.author === subject).id
        ]));
        state.phase = 'voting';
        state.votesByPlayer = {};
        return { ready: true };
    }

    function submitTruth(state, player, text, truth) {
        if (!state || state.type !== 'trueFalse' || state.phase !== 'subject-answering') {
            return { accepted: false, reason: 'wrong-phase' };
        }
        if (!state.subjects.includes(player)) return { accepted: false, reason: 'not-a-subject' };
        if (Object.prototype.hasOwnProperty.call(state.statementsBySubject, player)) {
            return { accepted: false, reason: 'already-submitted' };
        }
        if (typeof text !== 'string' || !text.trim()) return { accepted: false, reason: 'empty-answer' };
        if (text.trim().length > MAX_ANSWER_LENGTH) return { accepted: false, reason: 'answer-too-long' };
        if (typeof truth !== 'boolean') return { accepted: false, reason: 'invalid-answer' };
        state.statementsBySubject[player] = text.trim();
        state.truthBySubject[player] = truth;
        return { accepted: true, complete: state.subjects.every(subject =>
            Object.prototype.hasOwnProperty.call(state.statementsBySubject, subject)) };
    }

    function prepareTrueFalseVoting(state) {
        if (!state || state.type !== 'trueFalse' || state.phase !== 'subject-answering') {
            return { ready: false, reason: 'wrong-phase' };
        }
        const missingSubjects = state.subjects.filter(subject =>
            !Object.prototype.hasOwnProperty.call(state.truthBySubject, subject));
        if (missingSubjects.length) return { ready: false, reason: 'missing-subject-answer', missingSubjects };
        state.phase = 'voting';
        state.votesByPlayer = {};
        return { ready: true };
    }

    function submitVote(state, voter, subject, choice) {
        if (!state || state.phase !== 'voting') return { accepted: false, reason: 'wrong-phase' };
        if (!state.eligibleVoters.includes(voter)) return { accepted: false, reason: 'not-eligible' };
        if (!state.subjects.includes(subject)) return { accepted: false, reason: 'invalid-subject' };
        if (state.type === 'openAnswer' &&
            !state.answers.some(answer => answer.id === choice)) {
            return { accepted: false, reason: 'invalid-answer' };
        }
        if (state.type === 'trueFalse' && typeof choice !== 'boolean') {
            return { accepted: false, reason: 'invalid-answer' };
        }
        const votes = state.votesByPlayer[voter] || (state.votesByPlayer[voter] = {});
        if (Object.prototype.hasOwnProperty.call(votes, subject)) {
            return { accepted: false, reason: 'already-voted' };
        }
        votes[subject] = choice;
        return { accepted: true, complete: allVotesSubmitted(state) };
    }

    function allVotesSubmitted(state) {
        if (!state || state.phase !== 'voting') return false;
        return state.eligibleVoters.every(voter => state.subjects.every(subject =>
            Object.prototype.hasOwnProperty.call(state.votesByPlayer[voter] || {}, subject)));
    }

    function scoreRound(state) {
        const scores = { ...(state && state.scores || {}) };
        const roundPoints = {};
        const answerVotersByAuthor = new Map();
        (state && state.players || []).forEach(player => {
            if (!Object.prototype.hasOwnProperty.call(scores, player)) scores[player] = 0;
            roundPoints[player] = 0;
        });
        (state && state.eligibleVoters || []).forEach(voter => {
            state.subjects.forEach(subject => {
                const votes = state.votesByPlayer[voter] || {};
                if (!Object.prototype.hasOwnProperty.call(votes, subject)) return;
                const choice = votes[subject];
                if (state.type === 'openAnswer') {
                    if (choice === state.correctBySubject[subject]) {
                        roundPoints[voter] += POINTS_PER_CORRECT_VOTE;
                    }
                    const answer = state.answers.find(item => item.id === choice);
                    if (answer && answer.author !== voter) {
                        let voters = answerVotersByAuthor.get(answer.author);
                        if (!voters) {
                            voters = new Set();
                            answerVotersByAuthor.set(answer.author, voters);
                        }
                        voters.add(voter);
                    }
                } else if (choice === state.truthBySubject[subject]) {
                    roundPoints[voter] += POINTS_PER_CORRECT_VOTE;
                } else if (Object.prototype.hasOwnProperty.call(roundPoints, subject)) {
                    roundPoints[subject] += POINTS_PER_CORRECT_VOTE;
                }
            });
        });
        answerVotersByAuthor.forEach((voters, author) => {
            if (Object.prototype.hasOwnProperty.call(roundPoints, author)) {
                roundPoints[author] += voters.size;
            }
        });
        Object.keys(roundPoints).forEach(player => {
            scores[player] = (Number(scores[player]) || 0) + roundPoints[player];
        });
        return { roundPoints, scores };
    }

    function publicState(state, viewer) {
        if (!state) return null;
        const reveal = state.phase === 'reveal' || state.phase === 'complete';
        const isSubject = state.subjects.includes(viewer);
        const myVotes = state.votesByPlayer[viewer] || {};
        const hasSubmitted = state.type === 'openAnswer'
            ? !!state.submissionsByPlayer[viewer]
            : Object.prototype.hasOwnProperty.call(state.statementsBySubject, viewer);
        const revealStatements = state.phase === 'voting' || reveal;
        const answerOptions = state.phase === 'voting' || reveal
            ? state.answers.map(answer => reveal
                ? { id: answer.id, text: answer.text, author: answer.author }
                : { id: answer.id, text: answer.text })
            : [];
        const correctBySubject = reveal ? { ...state.correctBySubject } : {};
        const truthBySubject = reveal ? { ...state.truthBySubject } : {};

        return {
            phase: state.phase,
            type: state.type,
            category: state.category,
            round: state.round,
            roundLimit: state.roundLimit,
            question: state.question,
            subjects: state.subjects.slice(),
            participants: state.players.slice(),
            eligibleVoters: state.eligibleVoters.slice(),
            deadline: state.deadline,
            submissionCount: state.type === 'openAnswer'
                ? Object.keys(state.submissionsByPlayer).length
                : Object.keys(state.statementsBySubject).length,
            submissionTotal: state.type === 'openAnswer' ? state.players.length : state.subjects.length,
            voteCount: Object.values(state.votesByPlayer).reduce((count, votes) => count + Object.keys(votes).length, 0),
            voteTotal: state.eligibleVoters.length * state.subjects.length,
            answerOptions,
            correctBySubject,
            statementsBySubject: revealStatements ? { ...state.statementsBySubject } : {},
            truthBySubject,
            votesByPlayer: reveal
                ? Object.fromEntries(Object.entries(state.votesByPlayer).map(([player, votes]) => [
                    player, { ...votes }
                ]))
                : {},
            roundPoints: reveal ? { ...state.roundPoints } : {},
            scores: reveal ? { ...state.scores } : {},
            skipped: !!state.skipped,
            skipReason: reveal ? state.skipReason : '',
            viewer: {
                isSubject,
                isParticipant: state.players.includes(viewer),
                hasSubmitted,
                myVotes: { ...myVotes }
            }
        };
    }

    const Engine = {
        CATEGORIES,
        GAME_TYPES,
        POINTS_PER_CORRECT_VOTE,
        MAX_ANSWER_LENGTH,
        DEFAULT_CONFIG,
        normalizeConfig,
        normalizeQuestionEntry,
        filterEligibleQuestionEntries,
        shuffleAnswers,
        selectFairSubjects,
        createRound,
        submitAnswer,
        prepareOpenAnswerVoting,
        submitTruth,
        prepareTrueFalseVoting,
        submitVote,
        allVotesSubmitted,
        scoreRound,
        publicState,
        hasReachedRoundLimit
    };

    let state = null;
    let questionBankPromise = null;
    let questionBank = null;
    let phaseTimeout = null;
    let countdownInterval = null;
    let usedQuestions = {};
    let subjectCounts = {};
    let subjectPairCounts = {};
    let rendering = false;
    let renderModel = null;
    let starting = false;

    function getConfig() {
        return normalizeConfig(room.openboxConfig);
    }

    function cancelTimers() {
        if (phaseTimeout !== null) clearTimeout(phaseTimeout);
        if (countdownInterval !== null) clearInterval(countdownInterval);
        phaseTimeout = null;
        countdownInterval = null;
    }

    function validateQuestionBank(data) {
        if (!data || typeof data !== 'object') throw new TypeError('Openbox question data must be an object.');
        GAME_TYPES.forEach(type => {
            if (!data[type] || typeof data[type] !== 'object') {
                throw new TypeError(`Openbox question data is missing "${type}".`);
            }
            CATEGORIES.forEach(category => {
                const questions = data[type][category];
                if (!Array.isArray(questions) || !questions.length) {
                    throw new TypeError(`Openbox question data needs prompts for ${type}/${category}.`);
                }
                questions.forEach(normalizeQuestionEntry);
            });
        });
        return data;
    }

    function loadQuestionBank() {
        if (!questionBankPromise) {
            questionBankPromise = fetch('openbox_questions.json?v=20261116-auto-paired')
                .then(response => {
                    if (!response.ok) throw new Error(`Openbox question request failed (${response.status}).`);
                    return response.json();
                })
                .then(validateQuestionBank)
                .then(data => {
                    questionBank = data;
                    return data;
                })
                .catch(error => {
                    questionBankPromise = null;
                    throw error;
                });
        }
        return questionBankPromise;
    }

    function drawQuestion(type, category, playerCount) {
        const pool = questionBank[type][category];
        const key = `${type}:${category}`;
        const used = usedQuestions[key] || (usedQuestions[key] = []);
        const eligible = filterEligibleQuestionEntries(pool, playerCount);
        let available = eligible.filter(question => !used.includes(question.text));
        if (!available.length) {
            used.length = 0;
            available = eligible.slice();
        }
        if (!available.length) return null;
        const question = available[Math.floor(Math.random() * available.length)];
        used.push(question.text);
        return question;
    }

    function showToast(message) {
        if (typeof root.showToast === 'function') root.showToast(message);
        else console.warn(`[Openbox] ${message}`);
    }

    function getElement(id) {
        return document.getElementById(id);
    }

    function appendText(parent, tag, className, text) {
        const child = document.createElement(tag);
        if (className) child.className = className;
        if (text !== undefined) child.textContent = text;
        parent.appendChild(child);
        return child;
    }

    function button(parent, text, className, onClick, disabled) {
        const control = appendText(parent, 'button', className || 'btn-secondary', text);
        control.type = 'button';
        control.disabled = !!disabled;
        control.addEventListener('click', onClick);
        return control;
    }

    function makeStateMessage(viewer) {
        return { type: 'OPENBOX_STATE', state: Engine.publicState(state, viewer) };
    }

    function publish() {
        if (!state) return;
        render();
        if (net.role !== 'host') return;
        room.players.filter(player => player !== net.myName &&
            !(typeof Bots !== 'undefined' && Bots.isBot(player)))
            .forEach(player => sendToPlayer(player, makeStateMessage(player)));
    }

    function sendStateToConnection(connection, viewer) {
        if (!state || !connection || !connection.open) return;
        try {
            connection.send(makeStateMessage(viewer));
        } catch (error) {
            console.error(`Could not sync Openbox state to ${viewer}.`, error);
        }
    }

    function setPhaseDeadline(seconds, callback) {
        cancelTimers();
        state.deadline = Date.now() + seconds * 1000;
        publish();
        phaseTimeout = setTimeout(() => {
            phaseTimeout = null;
            callback();
        }, seconds * 1000);
    }

    function startVoting() {
        if (!state || state.phase !== 'submitting' && state.phase !== 'subject-answering') return;
        const result = state.type === 'openAnswer'
            ? Engine.prepareOpenAnswerVoting(state)
            : Engine.prepareTrueFalseVoting(state);
        if (!result.ready) {
            finishSkippedRound(result.reason === 'missing-subject-answer'
                ? 'A subject did not submit an answer in time.'
                : 'The round could not be completed.');
            return;
        }
        state.phase = 'voting';
        setPhaseDeadline(getConfig().voteSeconds, finishVoting);
        scheduleBotVotes();
    }

    function finishSkippedRound(reason) {
        cancelTimers();
        state.phase = Engine.hasReachedRoundLimit(state.round, state.roundLimit) ? 'complete' : 'reveal';
        state.deadline = 0;
        state.skipped = true;
        state.skipReason = reason;
        state.roundPoints = {};
        state.scores = { ...room.scores };
        room.phase = 'openbox';
        publish();
    }

    function finishVoting() {
        if (!state || state.phase !== 'voting') return;
        cancelTimers();
        const result = Engine.scoreRound(state);
        state.roundPoints = result.roundPoints;
        state.scores = result.scores;
        room.scores = { ...result.scores };
        state.phase = Engine.hasReachedRoundLimit(state.round, state.roundLimit) ? 'complete' : 'reveal';
        state.deadline = 0;
        room.phase = 'openbox';
        publish();
    }

    function startRound() {
        const config = getConfig();
        const participants = [...new Set(room.players.filter(name => typeof name === 'string' && name))];
        if (participants.length < 2) {
            showToast('Openbox needs at least two active players.');
            return false;
        }
        if (state && state.round > 0 && Engine.hasReachedRoundLimit(state.round, state.roundLimit)) {
            showToast('The configured Openbox rounds are complete.');
            return false;
        }

        const prompt = config.type === 'trueFalse'
            ? { text: '', subjectCount: 1 }
            : drawQuestion(config.type, config.category, participants.length);
        if (!prompt) {
            showToast('There is no eligible question for the active players. Add a single-subject prompt or invite another player.');
            return false;
        }
        const selected = selectFairSubjects(
            participants, prompt.subjectCount, subjectCounts, subjectPairCounts);
        if (!selected.length) {
            showToast('Openbox needs enough active players for the selected question.');
            return false;
        }

        cancelTimers();
        const nextRound = state ? state.round + 1 : 1;
        const scores = { ...room.scores };
        participants.forEach(player => {
            if (!Object.prototype.hasOwnProperty.call(scores, player)) scores[player] = 0;
        });
        state = Engine.createRound({
            type: config.type,
            category: config.category,
            subjectCount: prompt.subjectCount,
            subjects: selected,
            players: participants,
            question: prompt.text,
            round: nextRound,
            roundLimit: room.maxRounds,
            scores
        });
        state.deadline = Date.now() + config.submitSeconds * 1000;
        room.openboxConfig = { ...config };
        room.currentCategory = config.category;
        room.roundCount = nextRound;
        room.phase = 'openbox';
        room.roundActive = false;
        room.currentSubject = selected[0];
        room.currentPrompt = prompt.text;
        if (net.role === 'host') room.scores = scores;
        publish();
        const timeout = config.submitSeconds * 1000;
        phaseTimeout = setTimeout(() => {
            phaseTimeout = null;
            startVoting();
        }, timeout);
        scheduleBotSubmissions();
        return true;
    }

    function beginGame() {
        if (starting) return;
        const config = getConfig();
        if (room.players.length < 2) {
            showToast('Openbox needs at least two active players.');
            return;
        }
        room.openboxConfig = config;
        room.currentCategory = config.category;
        room.roundCount = 0;
        usedQuestions = {};
        subjectCounts = {};
        subjectPairCounts = {};
        state = null;
        starting = true;
        const startButton = getElement('hostStartBtn');
        if (startButton) startButton.disabled = true;
        const questionsReady = config.type === 'openAnswer' ? loadQuestionBank() : Promise.resolve();
        questionsReady.then(() => {
            starting = false;
            if (startButton) startButton.disabled = false;
            if (net.role !== 'host' || room.gameMode !== 'openbox' || room.phase !== 'lobby') return;
            startRound();
        }).catch(error => {
            starting = false;
            if (startButton) startButton.disabled = false;
            console.error('Could not start Openbox because its question bank failed to load.', error);
            showToast('Openbox questions could not be loaded. Check the connection and try again.');
        });
    }

    function updateTimerPreview() {
        [
            ['openboxSubmitSeconds', 'openboxSubmitValue'],
            ['openboxVoteSeconds', 'openboxVoteValue']
        ].forEach(([inputId, outputId]) => {
            const input = getElement(inputId);
            const output = getElement(outputId);
            if (input && output) output.textContent = `${input.value} sec`;
        });
    }

    function updateLobbyConfig() {
        if (net.role !== 'host' || room.phase !== 'lobby') return;
        const trueFalseControl = getElement('openboxTrueFalseToggle');
        const openAnswerControl = getElement('openboxOpenAnswerToggle');
        const submitControl = getElement('openboxSubmitSeconds');
        const voteControl = getElement('openboxVoteSeconds');
        room.openboxConfig = normalizeConfig({
            ...room.openboxConfig,
            type: trueFalseControl && trueFalseControl.checked
                ? 'trueFalse'
                : openAnswerControl && openAnswerControl.checked
                    ? 'openAnswer'
                    : room.openboxConfig.type,
            category: room.currentCategory,
            submitSeconds: submitControl ? submitControl.value : room.openboxConfig.submitSeconds,
            voteSeconds: voteControl ? voteControl.value : room.openboxConfig.voteSeconds
        });
        if (typeof updateLobbyUI === 'function') updateLobbyUI();
        if (typeof broadcastLobbySettings === 'function') broadcastLobbySettings();
    }

    function setCategory(category) {
        if (net.role !== 'host' || room.phase !== 'lobby' || !CATEGORIES.includes(category)) return;
        room.currentCategory = category;
        room.openboxConfig = normalizeConfig({ ...room.openboxConfig, category });
        if (typeof updateLobbyUI === 'function') updateLobbyUI();
        if (typeof broadcastLobbySettings === 'function') broadcastLobbySettings();
    }

    function applyLobbyConfig(config) {
        room.openboxConfig = normalizeConfig(config);
        if (typeof updateLobbyUI === 'function') updateLobbyUI();
    }

    function refreshLobbyControls() {
        const controls = getElement('openboxOnlyControls');
        if (controls) controls.hidden = room.gameMode !== 'openbox';
        const config = normalizeConfig(room.openboxConfig);
        const trueFalseControl = getElement('openboxTrueFalseToggle');
        const openAnswerControl = getElement('openboxOpenAnswerToggle');
        if (trueFalseControl) trueFalseControl.checked = config.type === 'trueFalse';
        if (openAnswerControl) openAnswerControl.checked = config.type === 'openAnswer';
        ['openboxSubmitSeconds', 'openboxVoteSeconds'].forEach(id => {
            const control = getElement(id);
            if (!control) return;
            const key = id === 'openboxSubmitSeconds' ? 'submitSeconds' : 'voteSeconds';
            control.value = String(config[key]);
        });
        updateTimerPreview();
    }

    function submitAnswerFromUI() {
        const input = getElement('openboxAnswerInput');
        if (!input) return;
        dispatchAction({ type: 'answer', text: input.value });
    }

    function submitTruthFromUI(value) {
        const input = getElement('openboxAnswerInput');
        if (!input) return;
        dispatchAction({ type: 'truth', text: input.value, value });
    }

    function dispatchAction(action) {
        if (net.role === 'host') {
            applyHostAction(net.myName, action);
            return;
        }
        if (!net.conn || !net.conn.open) {
            showToast('Waiting for the host connection.');
            return;
        }
        try {
            net.conn.send({ type: 'OPENBOX_ACTION', action });
        } catch (error) {
            console.error('Could not send the Openbox action to the host.', error);
            showToast('Could not reach the host. Try again.');
        }
    }

    function rejectAction(connection, message) {
        if (!connection) {
            showToast(message);
            return;
        }
        try {
            if (connection.open) connection.send({ type: 'OPENBOX_REJECT', message });
        } catch (error) {
            console.error('Could not report the rejected Openbox action.', error);
        }
    }

    function applyHostAction(player, action, connection) {
        if (net.role !== 'host' || room.gameMode !== 'openbox' || !state ||
            !action || typeof action.type !== 'string') return;
        let result;
        if (action.type === 'answer') {
            result = Engine.submitAnswer(state, player, action.text);
            if (result.accepted && result.complete) {
                startVoting();
                return;
            }
        } else if (action.type === 'truth') {
            result = Engine.submitTruth(state, player, action.text, action.value);
            if (result.accepted && result.complete) {
                startVoting();
                return;
            }
        } else if (action.type === 'vote') {
            result = Engine.submitVote(state, player, action.subject, action.choice);
            if (result.accepted && result.complete) {
                finishVoting();
                return;
            }
        } else {
            return;
        }
        if (!result || !result.accepted) {
            const messages = {
                'empty-answer': 'Write an answer before submitting.',
                'answer-too-long': `Keep answers under ${MAX_ANSWER_LENGTH} characters.`,
                'invalid-answer': 'Choose TRUE or FALSE for your statement.',
                'already-submitted': 'Your answer is already locked in.',
                'already-voted': 'Your vote for this subject is already locked in.',
                'not-eligible': 'Subjects and spectators cannot vote on this round.',
                'wrong-phase': 'That action is no longer available.'
            };
            rejectAction(connection, messages[result && result.reason] || 'That Openbox action was not accepted.');
            return;
        }
        publish();
    }

    function handleNetwork(data, connection) {
        if (!data || typeof data.type !== 'string') return;
        if (net.role === 'host') {
            if (data.type !== 'OPENBOX_ACTION' || !connection) return;
            const record = connection._playerId && net.roster[connection._playerId];
            if (!record || record.conn !== connection || !record.connected) return;
            applyHostAction(record.label, data.action, connection);
            return;
        }
        if (connection && connection !== net.conn) return;
        if (data.type === 'OPENBOX_STATE' && net.role === 'client') {
            const incoming = data.state;
            if (!incoming || !PHASES.includes(incoming.phase) || !GAME_TYPES.includes(incoming.type) ||
                !Array.isArray(incoming.subjects) || !Array.isArray(incoming.participants)) return;
            state = incoming;
            if (incoming.scores && Object.keys(incoming.scores).length) room.scores = { ...incoming.scores };
            room.gameMode = 'openbox';
            room.currentCategory = incoming.category;
            room.roundCount = incoming.round;
            room.phase = 'openbox';
            render();
        } else if (data.type === 'OPENBOX_REJECT') {
            showToast(typeof data.message === 'string' ? data.message : 'That Openbox action was not accepted.');
        }
    }

    function scheduleBotSubmissions() {
        if (net.role !== 'host' || !state || typeof Bots === 'undefined') return;
        const current = state;
        state.players.filter(player => Bots.isBot(player)).forEach(player => {
            setTimeout(() => {
                if (state !== current || state.phase !== current.phase) return;
                if (current.type === 'openAnswer') {
                    applyHostAction(player, {
                        type: 'answer',
                        text: Bots.chooseOpenboxAnswer(current.question, current.category, current.subjects.includes(player))
                    });
                } else if (current.subjects.includes(player)) {
                    applyHostAction(player, {
                        type: 'truth',
                        text: Bots.chooseOpenboxStatement(current.category),
                        value: Bots.chooseOpenboxTruth()
                    });
                }
            }, Bots.decisionDelay());
        });
    }

    function scheduleBotVotes() {
        if (net.role !== 'host' || !state || typeof Bots === 'undefined') return;
        const current = state;
        state.eligibleVoters.filter(player => Bots.isBot(player)).forEach(player => {
            state.subjects.forEach((subject, index) => {
                setTimeout(() => {
                    if (state !== current || state.phase !== 'voting') return;
                    const choice = current.type === 'openAnswer'
                        ? Bots.chooseOpenboxVote(current.answers)
                        : Bots.chooseOpenboxTruth();
                    applyHostAction(player, { type: 'vote', subject, choice });
                }, Bots.decisionDelay() + index * 250);
            });
        });
    }

    function beginNextQuestion() {
        if (net.role !== 'host' || !state || state.phase !== 'reveal') return;
        startRound();
    }

    function returnToLobby() {
        if (net.role !== 'host' || !state) return;
        const message = {
            type: 'RETURN_TO_LOBBY',
            players: room.players,
            category: room.currentCategory,
            gameMode: room.gameMode,
            coinCategory: room.coinCategory,
            casinoCategory: room.casinoCategory,
            gamblingEnabled: room.gamblingEnabled,
            maxRounds: room.maxRounds,
            openboxConfig: room.openboxConfig
        };
        handleData(message, null);
        broadcastToAll(message);
    }

    function formatQuestionForSubject(question, subject, subjects) {
        const partner = subjects.find(name => name !== subject) || 'another player';
        return String(question || '')
            .replace(/\{subject\}/gi, subject || 'you')
            .replace(/\{other\}/gi, partner);
    }

    function appendQuestionPrompts(parent, question, subjects, focusedSubject) {
        const targets = focusedSubject ? [focusedSubject] : subjects;
        targets.forEach(subject => {
            if (subjects.length > 1) {
                appendText(parent, 'div', 'openbox-prompt-subject', `FOR ${subject}`);
            }
            appendText(parent, 'p', 'openbox-question',
                formatQuestionForSubject(question, subject, subjects));
        });
    }

    function makeProgress(parent, label, count, total) {
        const track = appendText(parent, 'div', 'openbox-progress', '');
        appendText(track, 'span', 'openbox-progress-label', label);
        appendText(track, 'strong', 'openbox-progress-count', `${count} / ${total}`);
        const bar = appendText(track, 'div', 'openbox-progress-bar', '');
        const fill = appendText(bar, 'span', 'openbox-progress-fill', '');
        fill.style.width = `${total > 0 ? Math.min(100, count / total * 100) : 0}%`;
    }

    function addHeader(container) {
        const header = appendText(container, 'header', 'openbox-header', '');
        const title = appendText(header, 'div', 'openbox-brand', 'OPENBOX');
        appendText(title, 'span', 'openbox-round',         `ROUND ${renderModel.round} / ${renderModel.roundLimit === 'unlimited' ? '∞' : renderModel.roundLimit}`);
        const leave = button(header, '', 'circle-btn game-leave-button', () => triggerLeaveConfirmation());
        leave.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>';
        leave.title = 'Leave game';
        leave.setAttribute('aria-label', 'Leave game');
        appendText(container, 'div', 'openbox-category-label', `${renderModel.category.toUpperCase()} · ${renderModel.type === 'openAnswer' ? 'OPEN ANSWER' : 'TRUE OR FALSE'}`);
    }

    function addCountdown(container) {
        const timer = appendText(container, 'div', 'openbox-countdown', '');
        const deadline = renderModel.deadline;
        const update = () => {
            const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            timer.textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
        };
        update();
        countdownInterval = setInterval(update, 250);
    }

    function renderSubmitPhase(container, viewer) {
        const subjectNames = renderModel.subjects.join(' · ');
        appendText(container, 'div', 'openbox-subject-line', `SUBJECT${renderModel.subjects.length === 1 ? '' : 'S'}: ${subjectNames}`);
        appendText(container, 'h1', 'openbox-phase-title', renderModel.type === 'openAnswer'
            ? 'Write your answer'
            : 'Write a true-or-false question');
        if (renderModel.type === 'openAnswer') {
            appendQuestionPrompts(container, renderModel.question, renderModel.subjects,
                viewer.isSubject && viewer.isParticipant ? net.myName : null);
            if (!viewer.isParticipant) {
                appendText(container, 'p', 'openbox-waiting', 'You joined during a round. You can play next round.');
            } else if (viewer.hasSubmitted) {
                appendText(container, 'p', 'openbox-waiting', 'Answer locked. The room will not see who wrote it.');
            } else {
                appendText(container, 'label', 'openbox-field-label', viewer.isSubject ? 'Submit your real answer' : 'Invent a believable answer');
                const input = document.createElement('textarea');
                input.id = 'openboxAnswerInput';
                input.maxLength = MAX_ANSWER_LENGTH;
                input.rows = 3;
                input.placeholder = 'Keep it short and convincing…';
                container.appendChild(input);
                button(container, 'Lock in answer', 'btn-main openbox-primary-action', submitAnswerFromUI);
            }
        } else {
            if (viewer.isSubject && viewer.isParticipant) {
                if (viewer.hasSubmitted) {
                    appendText(container, 'p', 'openbox-waiting',
                        'Your question and answer are locked and hidden from the room.');
                } else {
                    appendText(container, 'p', 'openbox-waiting',
                        'Write a question or statement about yourself, then mark the true answer.');
                    appendText(container, 'label', 'openbox-field-label', 'Your question or statement');
                    const input = document.createElement('textarea');
                    input.id = 'openboxAnswerInput';
                    input.maxLength = MAX_ANSWER_LENGTH;
                    input.rows = 3;
                    input.placeholder = 'Write something the group can judge…';
                    container.appendChild(input);
                    const choices = appendText(container, 'div', 'openbox-choice-row', '');
                    const trueButton = button(choices, 'TRUE', 'btn-main',
                        () => submitTruthFromUI(true), true);
                    const falseButton = button(choices, 'FALSE', 'btn-secondary',
                        () => submitTruthFromUI(false), true);
                    input.addEventListener('input', () => {
                        const disabled = !input.value.trim();
                        trueButton.disabled = disabled;
                        falseButton.disabled = disabled;
                    });
                }
            } else if (viewer.isParticipant) {
                appendText(container, 'p', 'openbox-waiting',
                    'The subject is writing a question and choosing its true answer privately.');
            } else {
                appendText(container, 'p', 'openbox-waiting', 'You joined during a round. You can play next round.');
            }
        }
        addCountdown(container);
        makeProgress(container, renderModel.type === 'openAnswer' ? 'Answers submitted' : 'Subject answers', renderModel.submissionCount, renderModel.submissionTotal);
    }

    function renderVotePhase(container, viewer) {
        appendText(container, 'div', 'openbox-subject-line', `SUBJECT${renderModel.subjects.length === 1 ? '' : 'S'}: ${renderModel.subjects.join(' · ')}`);
        appendText(container, 'h1', 'openbox-phase-title', renderModel.type === 'openAnswer' ? 'Which answer is real?' : 'What is your prediction?');
        if (!viewer.isParticipant) {
            appendText(container, 'p', 'openbox-waiting', 'You joined during a round. You can play next round.');
        } else if (viewer.isSubject) {
            appendText(container, 'p', 'openbox-waiting', 'Subjects cannot vote on their own question.');
        } else {
            renderModel.subjects.forEach(subject => {
                const group = appendText(container, 'section', 'openbox-vote-group', '');
                if (renderModel.type === 'openAnswer') {
                    appendQuestionPrompts(group, renderModel.question, renderModel.subjects, subject);
                } else {
                    appendText(group, 'p', 'openbox-question',
                        renderModel.statementsBySubject && renderModel.statementsBySubject[subject] || '');
                }
                appendText(group, 'h2', 'openbox-vote-title', renderModel.type === 'openAnswer'
                    ? `Which answer belongs to ${subject}?`
                    : `Is ${subject}'s question true?`);
                if (Object.prototype.hasOwnProperty.call(viewer.myVotes, subject)) {
                    appendText(group, 'p', 'openbox-vote-locked', 'Vote locked');
                    return;
                }
                if (renderModel.type === 'openAnswer') {
                    renderModel.answerOptions.forEach((answer, index) => {
                        button(group, `${index + 1}. ${answer.text}`, 'openbox-answer-option',
                            () => dispatchAction({ type: 'vote', subject, choice: answer.id }));
                    });
                } else {
                    const row = appendText(group, 'div', 'openbox-choice-row', '');
                    button(row, 'TRUE', 'btn-main', () => dispatchAction({ type: 'vote', subject, choice: true }));
                    button(row, 'FALSE', 'btn-secondary', () => dispatchAction({ type: 'vote', subject, choice: false }));
                }
            });
        }
        addCountdown(container);
        makeProgress(container, 'Votes received', renderModel.voteCount, renderModel.voteTotal);
    }

    function renderRevealPhase(container) {
        appendText(container, 'div', 'openbox-subject-line', `SUBJECT${renderModel.subjects.length === 1 ? '' : 'S'}: ${renderModel.subjects.join(' · ')}`);
        appendText(container, 'h1', 'openbox-phase-title', renderModel.skipped ? 'Round skipped' : 'The reveal');
        if (renderModel.skipped) {
            appendText(container, 'p', 'openbox-skip-reason', renderModel.skipReason);
        } else if (renderModel.type === 'openAnswer') {
            const votesByPlayer = renderModel.votesByPlayer || {};
            renderModel.subjects.forEach(subject => {
                const subjectSection = appendText(container, 'section', 'openbox-reveal-subject', '');
                appendQuestionPrompts(subjectSection, renderModel.question, renderModel.subjects, subject);
                appendText(subjectSection, 'h2', 'openbox-vote-title', `Who picked ${subject}'s answer?`);
                const list = appendText(subjectSection, 'div', 'openbox-reveal-list', '');
                renderModel.answerOptions.forEach((answer, index) => {
                    const isCorrect = renderModel.correctBySubject[subject] === answer.id;
                    const item = appendText(list, 'div',
                        `openbox-reveal-answer${isCorrect ? ' correct' : ''}`, '');
                    appendText(item, 'span', 'openbox-answer-number', String(index + 1));
                    const details = appendText(item, 'div', 'openbox-answer-details', '');
                    appendText(details, 'p', 'openbox-answer-text', answer.text);
                    appendText(details, 'span', 'openbox-answer-author', `Written by ${answer.author}`);
                    const voters = Object.entries(votesByPlayer)
                        .filter(([, votes]) => votes[subject] === answer.id)
                        .map(([voter]) => voter);
                    appendText(details, 'span', 'openbox-vote-attribution',
                        `Voted by: ${voters.join(', ') || 'No one'}`);
                    if (isCorrect) {
                        appendText(item, 'strong', 'openbox-correct-label', `REAL · ${subject}`);
                    }
                });
            });
        } else {
            const votesByPlayer = renderModel.votesByPlayer || {};
            renderModel.subjects.forEach(subject => {
                const result = appendText(container, 'section', 'openbox-truth-reveal', '');
                const row = appendText(result, 'div', 'openbox-truth-result', '');
                appendText(row, 'strong', 'openbox-truth-subject', subject);
                const truth = renderModel.truthBySubject[subject];
                appendText(row, 'span', `openbox-truth-value ${truth ? 'true' : 'false'}`,
                    truth ? 'TRUE' : 'FALSE');
                appendText(result, 'p', 'openbox-question openbox-revealed-statement',
                    renderModel.statementsBySubject && renderModel.statementsBySubject[subject] || '');
                const trueVoters = Object.entries(votesByPlayer)
                    .filter(([, votes]) => votes[subject] === true)
                    .map(([voter]) => voter);
                const falseVoters = Object.entries(votesByPlayer)
                    .filter(([, votes]) => votes[subject] === false)
                    .map(([voter]) => voter);
                appendText(result, 'p', 'openbox-vote-attribution',
                    `TRUE votes: ${trueVoters.join(', ') || 'No one'}`);
                appendText(result, 'p', 'openbox-vote-attribution',
                    `FALSE votes: ${falseVoters.join(', ') || 'No one'}`);
                const fooledVoters = truth ? falseVoters : trueVoters;
                appendText(result, 'p', 'openbox-fooled-voters',
                    `Fooled ${fooledVoters.length}: ${fooledVoters.join(', ') || 'No one'}`);
            });
        }
        const scores = Object.entries(renderModel.scores || {}).sort((left, right) => right[1] - left[1]);
        if (scores.length) {
            const list = appendText(container, 'div', 'openbox-score-list', '');
            appendText(list, 'h2', 'openbox-vote-title', 'SCOREBOARD');
            scores.slice(0, 8).forEach(([name, score], index) => {
                const row = appendText(list, 'div', 'openbox-score-row', '');
                appendText(row, 'span', 'openbox-score-rank', `${index + 1}`);
                appendText(row, 'span', 'openbox-score-name', name);
                const earned = Number(renderModel.roundPoints[name]) || 0;
                appendText(row, 'strong', 'openbox-score-value', `${score}${earned ? ` (+${earned})` : ''}`);
            });
        }
        if (net.role === 'host') {
            if (renderModel.phase === 'complete') {
                button(container, 'Back to lobby', 'btn-main openbox-primary-action', returnToLobby);
            } else {
                button(container, 'Next question', 'btn-main openbox-primary-action', beginNextQuestion);
            }
        } else {
            appendText(container, 'p', 'openbox-waiting', 'Waiting for the host to continue.');
        }
    }

    function renderHostDisconnected(container) {
        appendText(container, 'h1', 'openbox-phase-title', 'Host connection lost');
        appendText(container, 'p', 'openbox-waiting', 'The host could not be reached. Return to the cover and rejoin the room.');
        button(container, 'Leave room', 'btn-main openbox-primary-action', () => triggerLeaveConfirmation());
    }

    function render() {
        if (rendering || !state || typeof document === 'undefined') return;
        const container = getElement('openboxContent');
        if (!container) return;
        rendering = true;
        renderModel = net.role === 'host' ? Engine.publicState(state, net.myName) : state;
        if (countdownInterval !== null) clearInterval(countdownInterval);
        countdownInterval = null;
        const previousInput = getElement('openboxAnswerInput');
        const previousDraft = previousInput ? previousInput.value : '';
        container.replaceChildren();
        addHeader(container);
        if (renderModel.phase === 'submitting' || renderModel.phase === 'subject-answering') {
            renderSubmitPhase(container, renderModel.viewer);
            const input = getElement('openboxAnswerInput');
            if (input) {
                input.value = previousDraft;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } else if (renderModel.phase === 'voting') {
            renderVotePhase(container, renderModel.viewer);
        } else if (renderModel.phase === 'reveal' || renderModel.phase === 'complete') {
            renderRevealPhase(container);
        } else if (renderModel.phase === 'host-disconnected') {
            renderHostDisconnected(container);
        }
        if (!document.getElementById('scrOpenbox').classList.contains('active')) showScreen('scrOpenbox');
        rendering = false;
        renderModel = null;
    }

    function onPlayerLeft(name) {
        if (net.role !== 'host' || !state || !state.players.includes(name)) return;
        state.players = state.players.filter(player => player !== name);
        state.eligibleVoters = state.eligibleVoters.filter(player => player !== name);
        delete state.scores[name];
        delete state.roundPoints[name];
        delete state.votesByPlayer[name];
        if (state.phase === 'submitting' && state.players.every(player => state.submissionsByPlayer[player])) {
            startVoting();
        } else if (state.phase === 'subject-answering' &&
            state.subjects.every(subject => Object.prototype.hasOwnProperty.call(state.truthBySubject, subject))) {
            startVoting();
        } else if (state.phase === 'voting' && Engine.allVotesSubmitted(state)) {
            finishVoting();
        } else if ((state.phase === 'submitting' || state.phase === 'subject-answering') &&
            state.subjects.includes(name) &&
            !(state.type === 'openAnswer' ? state.submissionsByPlayer[name] : Object.prototype.hasOwnProperty.call(state.truthBySubject, name))) {
            finishSkippedRound('A subject left before answering.');
        } else {
            publish();
        }
    }

    function reset() {
        cancelTimers();
        state = null;
        renderModel = null;
        usedQuestions = {};
        subjectCounts = {};
        subjectPairCounts = {};
        starting = false;
    }

    function hostDisconnected() {
        if (net.role !== 'client' || !state) return;
        cancelTimers();
        state = { ...state, phase: 'host-disconnected', deadline: 0 };
        render();
    }

    const Openbox = {
        Engine,
        DEFAULT_CONFIG,
        get state() { return state; },
        getConfig,
        normalizeConfig,
        refreshLobbyControls,
        updateLobbyConfig,
        updateTimerPreview,
        applyLobbyConfig,
        setCategory,
        beginGame,
        handleNetwork,
        sendStateToConnection,
        onPlayerLeft,
        hostDisconnected,
        reset
    };

    root.Openbox = Openbox;
    if (typeof module !== 'undefined' && module.exports) module.exports = Openbox;
})(typeof window !== 'undefined' ? window : globalThis);
