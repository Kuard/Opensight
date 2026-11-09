/* Shared button actions kept separate from game state and rendering. */
let pendingNSFWEl = null;

function confirmNSFW(el) {
	pendingNSFWEl = el;
	Sound.play(200, 'sine', 0.08);
	if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
	$('confirmNSFWModal').classList.add('active');
}

function dismissNSFWConfirmation() {
	Sound.play(350, 'sine', 0.05);
	if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
	$('confirmNSFWModal').classList.remove('active');
	pendingNSFWEl = null;
}

function acceptNSFWConfirmation() {
	$('confirmNSFWModal').classList.remove('active');
	if (pendingNSFWEl) setCategory('nsfw', pendingNSFWEl);
	pendingNSFWEl = null;
}

function triggerLeaveConfirmation() {
	Sound.play(200, 'sine', 0.08);
	if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
	$('confirmLeaveModal').classList.add('active');
}

function dismissLeaveConfirmation() {
	Sound.play(350, 'sine', 0.05);
	if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
	$('confirmLeaveModal').classList.remove('active');
}

function confirmLeaveRoom() {
	$('confirmLeaveModal').classList.remove('active');
	leaveRoom();
}

function updateNextRoundButtonState() {
	const nextBtn = $('nextRoundBtn');
	const winnerSelected = room.cards.some(card => card.selected);
	const isMeSubject = net.myName === room.currentSubject;
	const isHost = net.role === 'host';

	const nextText = room.maxRounds === 'unlimited'
		? `Next Round (${room.roundCount})`
		: `Next Round (${room.roundCount}/${room.maxRounds})`;

	if (!winnerSelected) {
		nextBtn.style.display = 'none';
		return;
	}

	if (isMeSubject) {
		nextBtn.style.display = 'block';
		nextBtn.disabled = false;
		nextBtn.innerText = nextText;
		nextBtn.onclick = () => {
			if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
			nextBtn.disabled = true;
			nextBtn.innerText = 'Starting...';
			if (net.role === 'host') broadcastStartRound();
			else net.conn.send({ type: 'REQUEST_NEXT_ROUND' });
		};
	} else if (isHost) {
		nextBtn.style.display = 'block';

		if (window.hostWaitInterval) clearInterval(window.hostWaitInterval);

		nextBtn.disabled = true;
		let secs = 10;
		nextBtn.innerText = nextText + ` (Waiting for Subject... ${secs}s)`;

		window.hostWaitInterval = setInterval(() => {
			if (!$('scrRevealStage').classList.contains('active')) {
				clearInterval(window.hostWaitInterval);
				return;
			}
			secs--;
			if (secs > 0) {
				nextBtn.innerText = nextText + ` (Waiting for Subject... ${secs}s)`;
			} else {
				clearInterval(window.hostWaitInterval);
				nextBtn.disabled = false;
				nextBtn.innerText = nextText;
			}
		}, 1000);

		nextBtn.onclick = () => {
			if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
			clearInterval(window.hostWaitInterval);
			nextBtn.disabled = true;
			broadcastStartRound();
		};
	} else {
		nextBtn.style.display = 'none';
	}
}

const Buttons = {

	gamblingSpin() {
		if (net.myName === Gambling.subject || Gambling.localState.spinning ||
			Gambling.localState.requestPending || Gambling.localState.spinsRemaining <= 0) return;
		Sound.play(420, 'triangle', 0.1);
		if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
		return Gambling.requestSpin();
	},

	gamblingSkip() {
		if (net.myName === Gambling.subject || Gambling.localState.spinning ||
			Gambling.localState.resultHolding || Gambling.localState.requestPending) return;
		Sound.play(260, 'sine', 0.07);
		if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
		return Gambling.skip();
	},

	blackjackJoin() {
		if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
		return Blackjack.requestJoin();
	},

	blackjackOpen() {
		if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
		return Blackjack.openTable();
	},

	blackjackExit() {
		if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
		return Blackjack.exitTable();
	},

	blackjackAddBot() {
		if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
		return Blackjack.addOrRemoveTestBot();
	},

	blackjackStart() {
		if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
		return Blackjack.start();
	},

	blackjackHit() {
		if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
		Sound.draw();
		return Blackjack.hit();
	},

	blackjackStand() {
		if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
		Sound.play(360, 'triangle', 0.08);
		return Blackjack.stand();
	},

	blackjackEnd() {
		if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
		return Blackjack.endEarly();
	},

	useTimeBoost() {
		if (Gambling.localState.timeBoostPending || Gambling.localState.storedTime < 15 ||
			net.myName === Gambling.subject || !room.activeWriters.includes(net.myName) ||
			room.cards.some(card => card.creator === net.myName)) return;
		Sound.play(560, 'triangle', 0.12);
		if (typeof Vibrate !== 'undefined' && Vibrate.success) Vibrate.success();
		return Gambling.useTimeBoost();
	},

	submitWriterCard() {
		return submitWriterCard();
	},

	coinTarget(playerName) {
		return CoinMode.selectTargetPlayer(playerName);
	},

	coinFlip() {
		return CoinMode.triggerCoinFlip();
	},

	coinNextRound() {
		if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
		return CoinMode.startRound();
	},

	coinSide(side) {
		return CoinMode.choosePillSide(side);
	},

	coinOverrideSubject(playerName) {
		if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
		const payload = { type: 'COIN_SET_NEXT_SUBJECT', nextSubject: playerName };
		if (net.role === 'host') broadcastToAll(payload);
		else net.conn.send(payload);
	}
};

window.Buttons = Buttons;
