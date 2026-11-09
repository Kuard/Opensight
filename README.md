# OpenSight

OpenSight is a browser-based party game with Classic and Coin modes. It uses
PeerJS data connections for peer-to-peer rooms and loads question pools from
local JSON files.

Player text supports Unicode and emoji. The UI uses emoji sparingly and includes
system emoji font fallbacks for cards and other player-provided text. Browser
haptics are best-effort: a device's haptic hardware alone does not guarantee
that its browser exposes the Vibration API, and browser policies/settings may
still suppress vibration.

## Run

Serve this folder over HTTP or HTTPS, then open `index.html`. A static server is
required because the game fetches its question files; opening the HTML file
directly with `file://` will not work reliably. UI sounds are synthesized in
the browser.

## File ownership

- `networking.js` owns PeerJS connections, player identity, reconnects, and
  transport-level messages. Connections enter the broadcast roster only after
  the host processes their player-identity JOIN handshake.
- `players.js` owns lobby roster rendering and player-list actions.
- `blackjack.js` owns the host-authoritative lobby Blackjack side game; private
  hands go only to their owners until the hand ends.
- `blackjack.css` owns the dedicated Blackjack screen and table layout.
- `game.js` owns Classic Mode state, rounds, scoring, and game-level messages.
- `gambling.js` owns the host-authoritative Classic Mode slot rewards, lobby
  toggle synchronization, and local spin animation.
- `gambling.css` owns the slot-machine lobby toggle and gambling screen styling.
- `coinMode.js` owns Coin Mode state, questions, and phase transitions.
- `cards.js` and `fidget.js` own their respective interactions.
- `buttons.js` owns shared button actions; `vibrations.js` owns haptic feedback,
  including safe delegated feedback for buttons and lobby controls.
- `theme.css` contains shared design tokens; the other CSS files own the page or
  component styles named by their responsibility.
- `questions.json` and `target_questions.json` are the Classic and Coin Mode
  question pools.

While waiting in the lobby, the host can open the separate Blackjack screen;
players can enter it from the lobby header and exit back to the lobby at any
time. The host can play too and deals when at least two people have joined.
Blackjack uses a shuffled 52-card deck, standard card values, and Aces counted
as 1 or 11. Players independently hit or stand; the closest total at or below
21 wins, with a two-card 21 beating other 21s and tied best hands sharing the
win. Hands stay private until everyone stands or busts (or the host ends the
hand). The screen's information button displays the complete rules. Blackjack
is a waiting-room activity and does not affect the main game's score. The host
can add one Blackjack-only test bot; it is not added to the main game roster.
The game's regular test bots automatically spin, use any bonus spin, and only
begin writing after their spin sequence resolves.

In Classic Mode, a writer sees submitted cards only after submitting their own;
the host starts anonymous community voting when writing ends. The subject
receives the cards only after voting closes and sees the community favourite
only after choosing their own; community votes stay hidden until then, and each
eligible bot casts one vote. A card submitted after time expires gets a randomly
cycled timeout line and cannot be selected as either favourite.
The single community favourite is the uniquely highest-voted card; a tie means
there is no community favourite. Subject selection is randomized among the
least-selected players, with the remaining rounds distributed randomly.
The host can enable or disable the Classic Mode slot machine in the lobby.
When enabled, every round opens a full-screen slot machine before the writing
or subject screen appears for writers; the subject does not gamble. Writers can
start a spin or skip it; their writing timer starts after their last spin, with a
two-second result hold. The host rolls results; a reward requires three matching
symbols, with an 80% win chance per spin and a miss granting nothing. Rewards
are +15 seconds, Lucky Vote, 2x Points, and one bounded +1 Spin. The extra spin
has a 5% share of winning outcomes and cannot award another extra spin; 2x Points
also has a 5% share. Lucky Vote lets you vote for another player's card and
awards you 1 point for voting, whether or not that card becomes a favourite.
Players can never vote for their own card. The reels spin vertically, stop one
at a time on the host-selected symbols, and play a spin sound. 2x Points doubles
all points the player earns in that round. A blue dot marks your community vote
only on your own screen; other players' votes remain private. Community voting
still uses a long press on the centered card. A +15-second boost is banked up
to one charge, persists across rounds, and can be activated manually at any
time before submitting a card. Coin Mode uses the same balanced subject
selection, has no gambling, and ends without a points or winner board. Browser
vibration is optional and may be unavailable due to device or browser
restrictions.
