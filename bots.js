/**
 * Insight - Bot decision and timing helpers.
 * Game engines pass callbacks so bot actions use their normal state paths.
 */
const Bots = {
    classicAnswers: [
        '100% true.',
        'Classic behavior.',
        'Without a doubt.',
        'Secretly an expert.',
        'Probably under pressure.'
    ],

    isBot(name) {
        return typeof name === 'string' && name.toLowerCase().startsWith('bot');
    },

    decisionDelay() {
        return 3000 + Math.random() * 2000;
    },

    scheduleClassicAnswers(players, subject, isRoundActive, hasSubmitted, submit) {
        players.forEach(player => {
            if (!this.isBot(player) || player === subject) return;

            setTimeout(() => {
                if (!isRoundActive() || hasSubmitted(player)) return;
                const answer = this.classicAnswers[Math.floor(Math.random() * this.classicAnswers.length)];
                submit({
                    type: 'SUBMIT_CARD',
                    text: `[${player}] ${answer}`,
                    creator: player
                });
            }, this.decisionDelay());
        });
    },

    chooseOtherPlayer(players, subject) {
        const candidates = players.filter(player => player !== subject);
        return candidates[Math.floor(Math.random() * candidates.length)] || '';
    },

    chooseSide() {
        return Math.random() > 0.5 ? 'heads' : 'tails';
    }
};

window.Bots = Bots;
