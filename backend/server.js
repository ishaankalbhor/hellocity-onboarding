const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── In-memory session store ───────────────────────────────────────────────
// { sessionId: { interests: [], history: [], phase: "chat"|"confirm"|"done", pendingInterest: null } }
const sessions = {};

const MAX_INTERESTS = 3;

// ─── Prompts ───────────────────────────────────────────────────────────────
function buildChatSystem(session) {
  return `You are HelloCity's friendly onboarding assistant helping new members discover Miami.
Your job is to warmly chat with the user and learn what they enjoy doing when going out in the city.

Rules:
- Be warm, upbeat, conversational. Keep messages concise (2-3 sentences max).
- Ask about ONE interest at a time.
- An "interest" is an activity category: e.g. "rooftop bars", "live jazz", "art galleries", "Cuban food", "beach activities", "salsa dancing", etc.
- Current state: ${session.interests.length} of ${MAX_INTERESTS} interests collected.
- Already collected: ${session.interests.length ? session.interests.join(", ") : "none"}.
- Never suggest or repeat an already-collected interest.
- Keep it fun and Miami-flavored.

IMPORTANT: End EVERY message with a JSON extraction block on its own line:
<EXTRACT>{"interest": "rooftop bars"}</EXTRACT>
or if no clear interest was detected:
<EXTRACT>{"interest": null}</EXTRACT>`;
}

const VENUES_SYSTEM = `You are a Miami local expert. Given an interest category, return exactly 3 real Miami venues/experiences.
Return ONLY valid JSON, nothing else:
{
  "venues": [
    {
      "name": "Venue Name",
      "neighborhood": "Neighborhood, Miami",
      "description": "One sentence about what makes this place special.",
      "hours": "Typical hours or 'Varies by event'",
      "vibe": "2-3 word vibe label",
      "emoji": "one relevant emoji"
    }
  ]
}
Use REAL Miami venues only. Be specific and accurate.`;

// ─── Helpers ───────────────────────────────────────────────────────────────
function extractInterest(text) {
  const match = text.match(/<EXTRACT>({.*?})<\/EXTRACT>/s);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed.interest || null;
  } catch {
    return null;
  }
}

function cleanMessage(text) {
  return text.replace(/<EXTRACT>.*?<\/EXTRACT>/s, "").trim();
}

function getOrCreateSession(sessionId) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      interests: [],
      history: [],
      phase: "chat",
      pendingInterest: null,
    };
  }
  return sessions[sessionId];
}

// ─── Routes ────────────────────────────────────────────────────────────────

// POST /session — create a new session and get opening message
app.post("/session", async (req, res) => {
  const sessionId = uuidv4();
  const session = getOrCreateSession(sessionId);

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: buildChatSystem(session),
      messages: [{ role: "user", content: "Hello! I just joined HelloCity." }],
    });

    const rawText = response.content[0].text;
    const assistantMsg = cleanMessage(rawText);

    session.history.push(
      { role: "user", content: "Hello! I just joined HelloCity." },
      { role: "assistant", content: assistantMsg }
    );

    res.json({
      sessionId,
      message: assistantMsg,
      state: {
        interests: session.interests,
        phase: session.phase,
        interestCount: session.interests.length,
        complete: false,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start session" });
  }
});

// POST /chat — send a message, get a response (and possibly venues)
app.post("/chat", async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: "Missing sessionId or message" });

  const session = getOrCreateSession(sessionId);
  if (session.phase === "done") return res.json({ message: "Onboarding complete.", state: buildState(session) });

  session.history.push({ role: "user", content: message });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      system: buildChatSystem(session),
      messages: session.history,
    });

    const rawText = response.content[0].text;
    const assistantMsg = cleanMessage(rawText);
    const extracted = extractInterest(rawText);

    session.history.push({ role: "assistant", content: assistantMsg });

    // Check if we extracted a new, non-duplicate interest
    const isDuplicate = extracted &&
      session.interests.map(i => i.toLowerCase()).includes(extracted.toLowerCase());

    if (extracted && !isDuplicate) {
      session.pendingInterest = extracted;
      session.phase = "confirm";

      // Fetch venues from LLM
      const venueResponse = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 700,
        system: VENUES_SYSTEM,
        messages: [{ role: "user", content: `Give me 3 real Miami venues for: "${extracted}"` }],
      });

      let venues = [];
      try {
        const venueText = venueResponse.content[0].text.replace(/```json|```/g, "").trim();
        venues = JSON.parse(venueText).venues || [];
      } catch {
        venues = [];
      }

      return res.json({
        message: assistantMsg,
        pendingInterest: extracted,
        venues,
        state: buildState(session),
      });
    }

    res.json({
      message: assistantMsg,
      state: buildState(session),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "LLM call failed" });
  }
});

// POST /confirm — user confirms or denies the detected interest
app.post("/confirm", async (req, res) => {
  const { sessionId, confirmed } = req.body;
  if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

  const session = getOrCreateSession(sessionId);
  if (!session.pendingInterest) return res.status(400).json({ error: "No pending interest" });

  // Always count the interest regardless of yes/no (per spec)
  session.interests.push(session.pendingInterest);
  const justAdded = session.pendingInterest;
  session.pendingInterest = null;

  if (session.interests.length >= MAX_INTERESTS) {
    session.phase = "done";
    const profile = { interests: session.interests };

    return res.json({
      message: `Amazing! You're all set as a Miami insider. 🌴`,
      profile,
      state: buildState(session),
    });
  }

  session.phase = "chat";

  // Get next conversational message
  const contextMsg = confirmed
    ? `Great! "${justAdded}" has been saved. Please continue asking for the next interest naturally.`
    : `The user said no, but we kept the interest anyway. Continue naturally asking for another interest.`;

  session.history.push({ role: "user", content: confirmed ? "Yes, that's what I meant!" : "No, let's keep going." });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: buildChatSystem(session) + `\n\nContext: ${contextMsg}`,
      messages: session.history,
    });

    const rawText = response.content[0].text;
    const assistantMsg = cleanMessage(rawText);
    session.history.push({ role: "assistant", content: assistantMsg });

    res.json({
      message: assistantMsg,
      state: buildState(session),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "LLM call failed" });
  }
});

// GET /session/:id — get current session state
app.get("/session/:id", (req, res) => {
  const session = sessions[req.params.id];
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json({ state: buildState(session) });
});

function buildState(session) {
  return {
    interests: session.interests,
    phase: session.phase,
    interestCount: session.interests.length,
    complete: session.phase === "done",
    profile: session.phase === "done" ? { interests: session.interests } : null,
  };
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`HelloCity backend running on port ${PORT}`));