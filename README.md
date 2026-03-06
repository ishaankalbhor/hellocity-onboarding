# HelloCity — AI-Powered Interest Onboarding

A full-stack mobile-first web app that onboards new HelloCity members by conversationally collecting their Miami interests.

## Live Demo
- **Frontend:** `[your-vercel-url]`
- **Backend:** `[your-render-url]`

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Frontend | Vanilla HTML/CSS/JS (mobile-first) |
| LLM | Claude Sonnet via Anthropic SDK |
| Session Storage | In-memory (Map) on backend |
| Backend Deploy | Render.com |
| Frontend Deploy | Vercel |

---

## Architecture

```
User Browser (Frontend)
        │
        ▼
  POST /session      ← creates session, returns opening message
  POST /chat         ← sends user message, gets AI reply + optional venues
  POST /confirm      ← confirms/denies detected interest
  GET  /session/:id  ← get current state
        │
        ▼
  Node.js / Express Backend
        │
        ├── Session store (in-memory Map)
        │     sessionId → { interests[], history[], phase, pendingInterest }
        │
        ├── LLM Call 1: Chat + Interest Extraction
        │     System prompt includes current state (interests collected, already seen)
        │     LLM returns message + <EXTRACT>{"interest": "..."}</EXTRACT> tag
        │     Backend parses the tag deterministically — LLM doesn't control flow
        │
        └── LLM Call 2: Venue Lookup (when interest detected)
              Returns 3 real Miami venues as structured JSON
```

### Key Design Decisions

**Separation of LLM reasoning vs backend logic:**
- The LLM handles: conversation, extracting interest labels from natural language, generating venue details
- The backend handles: session state, duplicate detection, counting, phase transitions, progression gating
- The LLM cannot skip steps or mark onboarding complete — only the backend can

**Interest extraction:**
- The system prompt instructs the LLM to always append `<EXTRACT>{"interest": "..."}` to every response
- The backend strips this with regex before showing the message to the user
- This keeps extraction reliable without a separate "structured output" API call

**Venue lookup:**
- Separate LLM call with a focused system prompt asking for real Miami venues as JSON
- JSON is parsed and rendered as cards in the frontend

---

## Deploying

### 1. Backend → Render.com

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your repo, set root directory to `backend/`
4. Build command: `npm install`
5. Start command: `node server.js`
6. Add environment variable: `ANTHROPIC_API_KEY=sk-ant-...`
7. Deploy — note your URL (e.g. `https://hellocity-backend.onrender.com`)

### 2. Frontend → Vercel

1. In `frontend/public/index.html`, find this line near the top of the `<script>`:
   ```js
   const API_BASE = window.BACKEND_URL || "http://localhost:3001";
   ```
2. Replace with your Render backend URL:
   ```js
   const API_BASE = "https://hellocity-backend.onrender.com";
   ```
3. Go to [vercel.com](https://vercel.com) → New Project
4. Connect repo, set root to `frontend/`
5. Deploy

### 3. Local Development

```bash
# Terminal 1 — Backend
cd backend
npm install
ANTHROPIC_API_KEY=your_key_here node server.js
# Runs on http://localhost:3001

# Terminal 2 — Frontend
# Just open frontend/public/index.html in a browser
# Or use a static server:
cd frontend/public
npx serve .
```

---

## API Reference

### `POST /session`
Creates a new session and returns the opening message.

**Response:**
```json
{
  "sessionId": "uuid",
  "message": "Hey! Welcome to HelloCity...",
  "state": { "interests": [], "phase": "chat", "interestCount": 0, "complete": false }
}
```

### `POST /chat`
Send a user message, get AI response (and optional venue cards).

**Body:** `{ "sessionId": "...", "message": "I love rooftop bars" }`

**Response:**
```json
{
  "message": "Rooftop bars — great taste! Miami has some amazing ones.",
  "pendingInterest": "rooftop bars",
  "venues": [
    { "name": "Sugar", "neighborhood": "Brickell", "description": "...", "hours": "...", "vibe": "Chic & Airy", "emoji": "🍹" }
  ],
  "state": { "interests": [], "phase": "confirm", "interestCount": 0 }
}
```

### `POST /confirm`
Confirm or deny the detected interest. Either way, the interest is counted (per spec).

**Body:** `{ "sessionId": "...", "confirmed": true }`

**Response:**
```json
{
  "message": "Love it! What else do you enjoy in the city?",
  "state": { "interests": ["rooftop bars"], "phase": "chat", "interestCount": 1 }
}
```
When complete:
```json
{
  "message": "Amazing! You're all set as a Miami insider. 🌴",
  "profile": { "interests": ["rooftop bars", "live jazz", "art galleries"] },
  "state": { "complete": true, "phase": "done" }
}
```

### `GET /session/:id`
Get current session state.

---

## What I'd Improve With More Time

1. **Persistent storage** — swap the in-memory Map for Redis or a simple SQLite/Postgres DB so sessions survive restarts
2. **Venue images** — integrate Google Places API or Foursquare for photos, ratings, and verified hours
3. **Streaming responses** — use Anthropic's streaming API so messages appear word-by-word
4. **Interest disambiguation** — if the user says "I like music", ask "Any specific genre?" before locking in
5. **Rate limiting** — add per-IP limits on the backend
6. **Session expiry** — clean up old sessions from memory after 1 hour
7. **Auth** — tie sessions to actual HelloCity user accounts