# ChAI Quiz — live buzzer

Players pick one of 10 AI-themed teams from a dropdown, enter their name, then hit a big BUZZ button.
The host sees the buzz order (1st, 2nd, 3rd…) instantly with each person's name and team, marks answers ✓ Correct / ✗ Wrong (points go to the person and the team automatically), and moves to the next question. The end shows a podium, team ranking and top players.

- Zero dependencies — only Node.js 18+ is needed (no `npm install`).
- Live updates via Server-Sent Events: works over corporate proxies and tunnels.

| Page | URL | Who |
|---|---|---|
| Player | `/` | Everyone (share this link or the QR) |
| Host | `/admin` | You — needs the PIN |
| Projector | `/screen` | Put on the big screen: QR in the lobby, then question, timer, buzz order, scores |

## 1. Run it

```bash
cd chai-quiz
ADMIN_PIN=pick-a-pin node server.js
```

Windows PowerShell:

```powershell
cd chai-quiz
$env:ADMIN_PIN="pick-a-pin"; node server.js
```

Default port is 3000 (`PORT=4000 node server.js` to change). Default PIN is `chai123` if you don't set one.
The console prints the local and LAN URLs.

## 2. Add your questions

Either edit `questions.json` before starting:

```json
[
  { "q": "What does the 'T' in GPT stand for?", "a": "Transformer", "time": 20 }
]
```

`time` = seconds players have to buzz (`0` = no limit; default 15).

Or use **Questions → Edit** on the host page — one per line: `Question | Answer | seconds | level`.

## Teams

The 10 team names and emojis are in `teams.json` — edit and restart to change them.

## Scoring

- **✓ Correct** gives 10 pts to that person and their team, and locks buzzers. Click again to undo.
- **✗ Wrong** marks the buzz (0 pts by default) so you can move to the next person in line.
- **+5 / −5** on the leaderboard adjusts a team manually.
- Change points with env vars: `POINTS=20 WRONG_PENALTY=5 ADMIN_PIN=1234 node server.js`

## 3. Share the link

Pick whichever works on your network:

**A. Same office Wi-Fi** — share the `http://<your-ip>:3000/` URL printed in the console.
(Some corporate Wi-Fi blocks device-to-device traffic — test from your phone first.)

**B. Public tunnel from your laptop (no install, just SSH):**

```bash
ssh -R 80:localhost:3000 nokey@localhost.run
```

It prints an `https://….lhr.life` URL — share that. Alternative: `cloudflared tunnel --url http://localhost:3000`.

**C. Host it on Render (free, stable URL):**
1. Push this folder to a GitHub repo.
2. render.com → New → Web Service → pick the repo.
3. Build command: *(leave empty)* · Start command: `node server.js`
4. Environment → add `ADMIN_PIN`.
5. Free instances sleep when idle — open the URL a minute before the session.
   Put questions in `questions.json` before deploying (edits made in the UI are lost when Render restarts).

## 4. Running the quiz

1. Open `/admin` on your laptop, enter the PIN. Open `/screen` on the projector.
2. People scan the QR / open the link and join.
3. **Start quiz ▶** shows Q1 on every phone and starts the buzz timer.
4. Buzzes appear instantly in order (with a beep). Give #1 the chance to answer, then click **✓ Correct** or **✗ Wrong** (or press `1` / `X`).
5. **Reveal answer** shows it to everyone. **Next question ▶** moves on — nothing advances until you click.

Keyboard shortcuts on the host page: `N` or `→` next, `←` previous, `L` lock buzzers, `R` reveal, `1` mark #1 correct, `X` mark #1 wrong.

### Rules built in
- One buzz per team per question — the fastest teammate counts; teammates see who buzzed.
- Buzzers close automatically when the timer ends; you can also **Lock** early or **Re-open** (clears buzzes, restarts timer).
- Order is decided by when the server receives each buzz, and the gap to #1 is shown (`+0.17s`).
- Players who refresh or lose network are re-joined automatically with the same team/name.
- Everything is kept in memory: restarting the server resets the game (questions in `questions.json` stay).

## Files

```
chai-quiz/
├── server.js          # HTTP server, game state, live stream
├── questions.json     # your questions
├── teams.json         # the 10 team names + emojis
├── package.json
└── public/
    ├── index.html     # player (join + buzzer)
    ├── admin.html     # host controls
    ├── screen.html    # projector view
    ├── live.js        # shared client helpers
    └── style.css
```
