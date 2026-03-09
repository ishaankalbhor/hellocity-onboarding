// server.js
const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const fetch = require("node-fetch"); // ensure node-fetch is installed

const app = express();
app.use(cors());
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Use Gemini v1 model endpoint (v1beta) — make sure model exists in your account
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1/models/text-bison-001:generateContent?key=${GEMINI_API_KEY}`;

const sessions = {};
const MAX_INTERESTS = 3;

// Call Gemini LLM
async function callGemini(systemPrompt, messages) {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  // Prepend system prompt as first message
  const body = {
    contents: [
      { role: "user", parts: [{ text: systemPrompt }] },
      ...contents
    ],
    generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
  };

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// Build system prompt for onboarding chat
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

// Prompt for fetching Miami venues
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
      "emoji": "one relevant emoji",
      "imageUrl": "https://source.unsplash.com/600x400/?miami,[relevant keyword]"
    }
  ]
}
Use REAL Miami venues only. Be specific and accurate.`;

// Extract interest from assistant message
function extractInterest(text) {
  const match = text.match(/<EXTRACT>({.*?})<\/EXTRACT>/s);
  if (!match) return null;
  try { return JSON.parse(match[1]).interest || null; } catch { return null; }
}

// Remove extraction JSON block from text
function cleanMessage(text) {
  return text.replace(/<EXTRACT>.*?<\/EXTRACT>/s, "").trim();
}

// Session helper
function getOrCreateSession(sessionId) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = { interests: [], history: [], phase: "chat", pendingInterest: null };
  }
  return sessions[sessionId];
}

// Build frontend-friendly state
function buildState(session) {
  return {
    interests: session.interests,
    phase: session.phase,
    interestCount: session.interests.length,
    complete: session.phase === "done",
    profile: session.phase === "done" ? { interests: session.interests } : null,
  };
}

// Start new session
app.post("/session", async (req, res) => {
  const sessionId = uuidv4();
  const session = getOrCreateSession(sessionId);
  try {
    const rawText = await callGemini(buildChatSystem(session), [
      { role: "user", content: "Hello! I just joined HelloCity." }
    ]);
    const assistantMsg = cleanMessage(rawText);
    session.history.push(
      { role: "user", content: "Hello! I just joined HelloCity." },
      { role: "assistant", content: assistantMsg }
    );
    res.json({ sessionId, message: assistantMsg, state: buildState(session) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start session", detail: err.message });
  }
});

// Chat endpoint
app.post("/chat", async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: "Missing sessionId or message" });

  const session = getOrCreateSession(sessionId);
  if (session.phase === "done") return res.json({ message: "Onboarding complete.", state: buildState(session) });

  session.history.push({ role: "user", content: message });

  try {
    const rawText = await callGemini(buildChatSystem(session), session.history);
    const assistantMsg = cleanMessage(rawText);
    const extracted = extractInterest(rawText);

    session.history.push({ role: "assistant", content: assistantMsg });

    const isDuplicate = extracted && session.interests.map(i => i.toLowerCase()).includes(extracted.toLowerCase());

    if (extracted && !isDuplicate) {
      session.pendingInterest = extracted;
      session.phase = "confirm";
      let venues = [];
      try {
        const venueText = await callGemini(VENUES_SYSTEM, [
          { role: "user", content: `Give me 3 real Miami venues for: "${extracted}"` }
        ]);
        venues = JSON.parse(venueText.replace(/```json|```/g, "").trim()).venues || [];
      } catch (e) { console.error("Venue parse error:", e); }
      return res.json({ message: assistantMsg, pendingInterest: extracted, venues, state: buildState(session) });
    }

    res.json({ message: assistantMsg, state: buildState(session) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "LLM call failed", detail: err.message });
  }
});

// Confirm interest endpoint
app.post("/confirm", async (req, res) => {
  const { sessionId, confirmed } = req.body;
  if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

  const session = getOrCreateSession(sessionId);
  if (!session.pendingInterest) return res.status(400).json({ error: "No pending interest" });

  session.interests.push(session.pendingInterest);
  const justAdded = session.pendingInterest;
  session.pendingInterest = null;

  if (session.interests.length >= MAX_INTERESTS) {
    session.phase = "done";
    return res.json({
      message: `Amazing! You're all set as a Miami insider. 🌴`,
      profile: { interests: session.interests },
      state: buildState(session),
    });
  }

  session.phase = "chat";
  session.history.push({ role: "user", content: confirmed ? "Yes, that's what I meant!" : "No, let's keep going." });

  try {
    const rawText = await callGemini(
      buildChatSystem(session) + `\n\nContext: "${justAdded}" was saved. Ask for the next interest naturally.`,
      session.history
    );
    const assistantMsg = cleanMessage(rawText);
    session.history.push({ role: "assistant", content: assistantMsg });
    res.json({ message: assistantMsg, state: buildState(session) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "LLM call failed", detail: err.message });
  }
});

// Get session state
app.get("/session/:id", (req, res) => {
  const session = sessions[req.params.id];
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json({ state: buildState(session) });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`HelloCity backend running on port ${PORT}`));