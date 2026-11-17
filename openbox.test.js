const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const Openbox = require(path.join(__dirname, '..', '.js files', 'openbox.js'));
const { Engine } = Openbox;

function openAnswerRound(subjectCount, players, subjects) {
    return Engine.createRound({
        type: 'openAnswer',
        category: 'classic',
        subjectCount,
        players,
        subjects,
        question: 'What is your answer?',
        scores: {}
    });
}

test('question placeholders automatically identify two-subject prompts', () => {
    assert.deepEqual(Engine.normalizeQuestionEntry('What would {subject} do?'), {
        text: 'What would {subject} do?',
        subjectCount: 1
    });
    assert.deepEqual(Engine.normalizeQuestionEntry({
        text: 'How would {subject} react if {other} asked them out?',
        subjectCount: 2
    }), {
        text: 'How would {subject} react if {other} asked them out?',
        subjectCount: 2
    });
    assert.throws(() => Engine.normalizeQuestionEntry({
        text: 'A two-subject prompt with no partner placeholder.',
        subjectCount: 2
    }), /use \{other\}/);
});

test('Openbox uses the shared finite and unlimited round limits', () => {
    assert.equal(Engine.hasReachedRoundLimit(10, 10), true);
    assert.equal(Engine.hasReachedRoundLimit(9, 10), false);
    assert.equal(Engine.hasReachedRoundLimit(100, 'unlimited'), false);
    assert.equal(Object.hasOwn(Openbox.normalizeConfig({ rounds: 3 }), 'rounds'), false);
});

test('two-subject prompts are filtered out when the room needs a voter', () => {
    const prompts = [
        'What would {subject} do?',
        { text: 'How would {subject} react if {other} asked them out?', subjectCount: 2 }
    ];
    assert.deepEqual(Engine.filterEligibleQuestionEntries(prompts, 2), [
        { text: 'What would {subject} do?', subjectCount: 1 }
    ]);
    assert.equal(Engine.filterEligibleQuestionEntries(prompts, 3).length, 2);
});

test('subject assignment is automatic, unique, and balances repeated pairs', () => {
    const subjectCounts = {};
    const pairCounts = {};
    const first = Engine.selectFairSubjects(['A', 'B', 'C'], 2, subjectCounts, pairCounts, () => 0);
    const second = Engine.selectFairSubjects(['A', 'B', 'C'], 2, subjectCounts, pairCounts, () => 0);
    const third = Engine.selectFairSubjects(['A', 'B', 'C'], 2, subjectCounts, pairCounts, () => 0);

    [first, second, third].forEach(subjects => {
        assert.equal(subjects.length, 2);
        assert.equal(new Set(subjects).size, 2);
    });
    assert.deepEqual(subjectCounts, { A: 2, B: 2, C: 2 });
    assert.equal(Engine.selectFairSubjects(['A', 'B'], 2, {}, {}, () => 0).length, 0);
    assert.equal(Engine.selectFairSubjects(['A', 'B'], 1, {}, {}, () => 0).length, 1);
});

test('answer shuffling keeps separate duplicate answers anonymous and includes every subject answer', () => {
    const round = openAnswerRound(2, ['A', 'B', 'C'], ['A', 'B']);
    assert.equal(Engine.submitAnswer(round, 'A', 'same answer').accepted, true);
    assert.equal(Engine.submitAnswer(round, 'B', 'same answer').accepted, true);
    assert.equal(Engine.submitAnswer(round, 'C', 'a bluff').accepted, true);

    const prepared = Engine.prepareOpenAnswerVoting(round, () => 0);
    assert.equal(prepared.ready, true);
    assert.equal(round.answers.length, 3);
    assert.equal(new Set(round.answers.map(answer => answer.id)).size, 3);
    assert.deepEqual(new Set(Object.values(round.correctBySubject)), new Set([
        round.answers.find(answer => answer.author === 'A').id,
        round.answers.find(answer => answer.author === 'B').id
    ]));
    assert.notEqual(round.answers.find(answer => answer.author === 'C').id, round.submissionsByPlayer.C.id);

    const view = Engine.publicState(round, 'C');
    assert.ok(view.answerOptions.every(answer => !Object.hasOwn(answer, 'author')));
    assert.deepEqual(view.correctBySubject, {});
    assert.equal(view.viewer.isSubject, false);
});

test('answers must be non-empty and each player can submit only once', () => {
    const round = openAnswerRound(1, ['A', 'B'], ['A']);
    assert.equal(Engine.submitAnswer(round, 'A', '  ').reason, 'empty-answer');
    assert.equal(Engine.submitAnswer(round, 'B', 'bluff').accepted, true);
    assert.equal(Engine.submitAnswer(round, 'B', 'second attempt').reason, 'already-submitted');
    assert.equal(Engine.prepareOpenAnswerVoting(round).reason, 'missing-subject-answer');
});

test('two-subject open-answer scoring awards each correct prediction independently', () => {
    const round = openAnswerRound(2, ['A', 'B', 'C', 'D'], ['A', 'B']);
    ['A', 'B', 'C', 'D'].forEach(player => Engine.submitAnswer(round, player, `answer ${player}`));
    Engine.prepareOpenAnswerVoting(round, () => 1);
    const correctA = round.correctBySubject.A;
    const correctB = round.correctBySubject.B;
    const wrongA = round.answers.find(answer => answer.id !== correctA).id;
    const wrongB = round.answers.find(answer => answer.id !== correctB).id;

    assert.equal(Engine.submitVote(round, 'A', 'A', correctA).reason, 'not-eligible');
    Engine.submitVote(round, 'C', 'A', correctA);
    Engine.submitVote(round, 'D', 'A', wrongA);
    Engine.submitVote(round, 'D', 'B', wrongB);

    const result = Engine.scoreRound(round);
    assert.equal(result.roundPoints.C, 1);
    assert.equal(result.roundPoints.D, 0);
    assert.equal(result.scores.C, 1);
    assert.equal(result.scores.D, 0);
});

test('open-answer authors earn one point for each distinct player fooled', () => {
    const round = openAnswerRound(1, ['A', 'B', 'C'], ['A']);
    ['A', 'B', 'C'].forEach(player => Engine.submitAnswer(round, player, `answer ${player}`));
    Engine.prepareOpenAnswerVoting(round, () => 0);
    const answerByAuthor = author => round.answers.find(answer => answer.author === author);

    Engine.submitVote(round, 'B', 'A', answerByAuthor('C').id);
    Engine.submitVote(round, 'C', 'A', answerByAuthor('A').id);
    const result = Engine.scoreRound(round);

    assert.equal(result.roundPoints.A, 1);
    assert.equal(result.roundPoints.B, 0);
    assert.equal(result.roundPoints.C, 2);
    assert.equal(Engine.publicState(round, 'B').answerOptions.every(answer => !Object.hasOwn(answer, 'author')), true);
    round.phase = 'reveal';
    const reveal = Engine.publicState(round, 'B');
    assert.equal(reveal.answerOptions.find(answer => answer.author === 'C').author, 'C');
    assert.deepEqual(reveal.votesByPlayer, {
        B: { A: answerByAuthor('C').id },
        C: { A: answerByAuthor('A').id }
    });
});

test('true-false subjects write statements, earn points for fooled voters, and voters earn for correct guesses', () => {
    const round = Engine.createRound({
        type: 'trueFalse',
        category: 'deep',
        subjectCount: 2,
        players: ['A', 'B', 'C'],
        subjects: ['A', 'B'],
        question: '{subject} has changed a belief.'
    });
    assert.equal(Engine.submitTruth(round, 'C', 'A statement', true).reason, 'not-a-subject');
    Engine.submitTruth(round, 'A', 'I have changed a belief.', true);
    Engine.submitTruth(round, 'B', 'I have kept a secret.', false);
    assert.equal(Engine.prepareTrueFalseVoting(round).ready, true);

    const hidden = Engine.publicState(round, 'C');
    assert.deepEqual(hidden.truthBySubject, {});
    assert.equal(hidden.statementsBySubject.A, 'I have changed a belief.');
    assert.equal(Engine.submitVote(round, 'C', 'A', true).accepted, true);
    assert.equal(Engine.submitVote(round, 'C', 'B', false).accepted, true);
    assert.equal(Engine.allVotesSubmitted(round), true);

    const result = Engine.scoreRound(round);
    assert.equal(result.roundPoints.C, 2);
    assert.equal(result.roundPoints.A, 0);
});

test('true-false subjects gain a point for each player fooled', () => {
    const round = Engine.createRound({
        type: 'trueFalse',
        category: 'spicy',
        subjectCount: 1,
        players: ['A', 'B', 'C'],
        subjects: ['A'],
        question: ''
    });
    Engine.submitTruth(round, 'A', 'I have rehearsed a message before sending it.', false);
    Engine.prepareTrueFalseVoting(round);
    Engine.submitVote(round, 'B', 'A', true);
    Engine.submitVote(round, 'C', 'A', false);

    const result = Engine.scoreRound(round);
    assert.equal(result.roundPoints.A, 1);
    assert.equal(result.roundPoints.B, 0);
    assert.equal(result.roundPoints.C, 1);
});

test('true-false submissions require a question and a truth choice', () => {
    const round = Engine.createRound({
        type: 'trueFalse',
        category: 'classic',
        subjectCount: 1,
        players: ['A', 'B'],
        subjects: ['A'],
        question: ''
    });

    assert.equal(Engine.submitTruth(round, 'A', '  ', true).reason, 'empty-answer');
    assert.equal(Engine.submitTruth(round, 'A', 'A'.repeat(Engine.MAX_ANSWER_LENGTH + 1), false).reason,
        'answer-too-long');
    assert.equal(Engine.submitTruth(round, 'A', 'A statement', 'true').reason, 'invalid-answer');
    assert.equal(Engine.prepareTrueFalseVoting(round).reason, 'missing-subject-answer');
});

test('missing votes receive no points and duplicate votes are rejected', () => {
    const round = Engine.createRound({
        type: 'trueFalse',
        category: 'spicy',
        subjectCount: 1,
        players: ['A', 'B'],
        subjects: ['A'],
        question: 'A statement'
    });
    Engine.submitTruth(round, 'A', 'A statement', false);
    Engine.prepareTrueFalseVoting(round);
    assert.equal(Engine.submitVote(round, 'B', 'A', true).accepted, true);
    assert.equal(Engine.submitVote(round, 'B', 'A', false).reason, 'already-voted');
    const result = Engine.scoreRound(round);
    assert.equal(result.roundPoints.B, 0);
    assert.equal(result.roundPoints.A, 1);
});
