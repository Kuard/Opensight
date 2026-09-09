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
