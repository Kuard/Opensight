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

    openboxAnswers: {
        classic: [
            'I once made a sandwich and forgot to put the bread on both sides.',
            'Probably something involving snacks and an unnecessary spreadsheet.',
            'I tried to learn it from a video and confidently skipped step two.'
        ],
        spicy: [
            'I sent the message, put my phone down, and immediately picked it back up.',
            'I practiced the line in my head and then said something completely different.',
            'I would pretend to be casual while remembering every detail later.'
        ],
        deep: [
            'I needed time to understand why it mattered to me.',
            'A friend helped me see it from a kinder angle.',
            'I learned that changing my mind was not the same as giving up.'
        ],
        nsfw: [
            'I once planned the whole date around the dessert menu.',
            'I changed outfits, then went back to the first one.',
            'The most romantic part was that we both laughed at the same terrible joke.'
        ]
    },
    openboxBluffs: {
        classic: [
            'A very small problem that somehow required a color-coded plan.',
            'A snack combination that should not work but absolutely does.',
            'A confident decision made before reading the instructions.'
        ],
        spicy: [
            'A joke that sounded much smoother in the rehearsal.',
            'A very obvious hint delivered with absolutely no subtlety.',
            'A dramatic outfit change followed by choosing the original.'
        ],
        deep: [
            'A quiet moment when I finally noticed what I needed.',
            'An unexpected conversation that changed my perspective.',
            'A small promise that took longer than expected to keep.'
        ],
        nsfw: [
            'A dessert menu that completely changed the evening plan.',
            'A flirty joke that landed better than the planned compliment.',
            'A date outfit chosen after an unreasonable number of options.'
        ]
    },
    openboxTruthStatements: {
        classic: [
            'I have memorized a phone number that I no longer use.',
            'I have made a meal using only things already in the kitchen.',
            'I have stayed awake all night to finish a book or show.'
        ],
        spicy: [
            'I have rehearsed a flirty message before sending it.',
            'I have pretended not to notice someone I liked.',
            'I have had a crush on someone I met through friends.'
        ],
        deep: [
            'I have changed my mind about something important to me.',
            'I have kept a promise even when it was difficult.',
            'I have asked someone for help when I needed it.'
        ],
        nsfw: [
            'I have gone on a date that lasted longer than I expected.',
            'I have made the first move on someone I liked.',
            'I have rehearsed a romantic compliment before saying it.'
        ]
    },

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
    },

    chooseOpenboxAnswer(question, category, isSubject) {
        const answerSet = isSubject ? this.openboxAnswers : this.openboxBluffs;
        const answers = answerSet[category] || answerSet.classic;
        return answers[Math.floor(Math.random() * answers.length)];
    },

    chooseOpenboxTruth() {
        return Math.random() >= 0.5;
    },

    chooseOpenboxStatement(category) {
        const statements = this.openboxTruthStatements[category] || this.openboxTruthStatements.classic;
        return statements[Math.floor(Math.random() * statements.length)];
    },

    chooseOpenboxVote(answers) {
        if (!Array.isArray(answers) || answers.length === 0) return null;
        return answers[Math.floor(Math.random() * answers.length)].id;
    }
};

window.Bots = Bots;
