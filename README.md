# OpenSight

OpenSight is a browser-based party game with Classic and Coin modes. It uses
PeerJS data connections for peer-to-peer rooms and loads question pools from
local JSON files.

## Run

Serve this folder over HTTP or HTTPS, then open `index.html`. A static server is
required because the game fetches its question files and audio asset; opening the
HTML file directly with `file://` will not work reliably.

## File ownership

- `networking.js` owns PeerJS connections, player identity, reconnects, and
  transport-level messages.
- `players.js` owns lobby roster rendering and player-list actions.
- `game.js` owns Classic Mode state, rounds, scoring, and game-level messages.
- `coinMode.js` owns Coin Mode state, questions, and phase transitions.
- `cards.js` and `fidget.js` own their respective interactions.
- `buttons.js` owns shared button actions; `vibrations.js` owns haptic feedback.
- `theme.css` contains shared design tokens; the other CSS files own the page or
  component styles named by their responsibility.
- `questions.json` and `target_questions.json` are the Classic and Coin Mode
  question pools.
