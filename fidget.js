/**
 * Insight - Shared fidget menu controls.
 * Both game modes use the same toy behavior and visual structure.
 */
const Fidget = {
    setup({ clickerId, toggleId, bubbleGridId }) {
        const clicker = document.getElementById(clickerId);
        if (clicker) {
            clicker.innerText = '0';
            clicker.onclick = () => {
                const count = parseInt(clicker.innerText, 10) + 1;
                clicker.innerText = count;
                Sound.play(400 + (count % 10) * 20, 'triangle', 0.05);
                if (typeof Vibrate !== 'undefined' && Vibrate.tap) Vibrate.tap();
            };
        }

        const toggle = document.getElementById(toggleId);
        if (toggle) {
            toggle.classList.remove('on');
            toggle.onclick = () => {
                toggle.classList.toggle('on');
                Sound.play(150, 'sine', 0.05);
                if (typeof Vibrate !== 'undefined' && Vibrate.click) Vibrate.click();
            };
        }

        const bubbleGrid = document.getElementById(bubbleGridId);
        if (!bubbleGrid) return;
        bubbleGrid.innerHTML = '';
        for (let index = 0; index < 8; index++) {
            const bubble = document.createElement('div');
            bubble.className = 'bubble';
            bubble.onclick = () => {
                if (bubble.classList.contains('popped')) return;
                bubble.classList.add('popped');
                Sound.play(600, 'sine', 0.02);
                if (typeof Vibrate !== 'undefined' && Vibrate.pop) Vibrate.pop();
                setTimeout(() => bubble.classList.remove('popped'), 3000);
            };
            bubbleGrid.appendChild(bubble);
        }
    }
};

window.Fidget = Fidget;
