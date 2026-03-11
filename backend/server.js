const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const OpenAI = require("openai");

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const sessions = {};
const MAX_INTERESTS = 3;

function buildChatSystem(session) {
  return `You are HelloCity's onboarding assistant. Your ONLY job is to collect exactly 3 interest categories from the user.

CURRENT STATUS: ${session.interests.length} of 3 interests collected.
COLLECTED SO FAR: ${session.interests.length ? session.interests.join(", ") : "none"}.

CRITICAL RULES:
- Keep responses SHORT (1-2 sentences max).
- Extract an interest from ANYTHING the user says. Be aggressive about extraction.
- "beach" = "beach activities", "food" = "dining out", "cars" = "car events", "amazing" after discussing rooftop bars = "rooftop bars"
- If the user confirms or reacts positively to something = extract THAT thing as the interest.
- Do NOT ask follow-up questions about the same topic. Extract it immediately and ask for the NEXT interest.
- Do NOT have long back-and-forth conversations. One message, extract, move on.
- Never repeat an already-collected interest.

YOU MUST end EVERY single response with this exact tag on a new line (NO EXCEPTIONS EVER):
<EXTRACT>{"interest": "exact interest category"}</EXTRACT>
or if truly nothing extractable:
<EXTRACT>{"interest": null}</EXTRACT>`;
}

const VENUES_SYSTEM = `You are a Miami local expert. Given an interest category, return exactly 3 real Miami venues/experiences.
Return ONLY valid JSON, no markdown, nothing else:
{
  "venues": [
    {
      "name": "Venue Name",
      "neighborhood": "Neighborhood, Miami",
      "description": "One sentence about what makes this place special.",
      "hours": "Typical hours or 'Varies by event'",
      "vibe": "2-3 word vibe label",
      "emoji": "one relevant emoji",
      "imageUrl": "https://source.unsplash.com/600x400/?miami,[relevant-keyword]"
    }
  ]
}
Use REAL Miami venues only. Be specific and accurate.`;

function extractInterest(text) {
  const match = text.match(/<EXTRACT>({.*?})<\/EXTRACT>/s);
  if (!match) return null;
  try { return JSON.parse(match[1]).interest || null; } catch { return null; }
}

function cleanMessage(text) {
  return text.replace(/<EXTRACT>.*?<\/EXTRACT>/s, "").trim();
}

function getOrCreateSession(sessionId) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = { interests: [], history: [], phase: "chat", pendingInterest: null };
  }
  return sessions[sessionId];
}

function buildState(session) {
  return {
    interests: session.interests,
    phase: session.phase,
    interestCount: session.interests.length,
    complete: session.phase === "done",
    profile: session.phase === "done" ? { interests: session.interests } : null,
  };
}

async function callOpenAI(systemPrompt, messages, maxTokens = 400) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: maxTokens,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
  });
  return response.choices[0].message.content;
}

// POST /session
app.post("/session", async (req, res) => {
  const sessionId = uuidv4();
  const session = getOrCreateSession(sessionId);
  try {
    const rawText = await callOpenAI(buildChatSystem(session), [
      { role: "user", content: "Hello! I just joined HelloCity." }
    ]);
    const assistantMsg = cleanMessage(rawText);
    session.history.push(
      { role: "user", content: "Hello! I just joined HelloCity." },
      { role: "assistant", content: rawText }
    );
    res.json({ sessionId, message: assistantMsg, state: buildState(session) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start session", detail: err.message });
  }
});

// POST /chat
app.post("/chat", async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: "Missing sessionId or message" });
  const session = getOrCreateSession(sessionId);
  if (session.phase === "done") return res.json({ message: "Onboarding complete.", state: buildState(session) });

  session.history.push({ role: "user", content: message });
  try {
    const rawText = await callOpenAI(buildChatSystem(session), session.history);
    const assistantMsg = cleanMessage(rawText);
    const extracted = extractInterest(rawText);
    session.history.push({ role: "assistant", content: rawText });

    const isDuplicate = extracted &&
      session.interests.map(i => i.toLowerCase()).includes(extracted.toLowerCase());

    if (extracted && !isDuplicate) {
      session.pendingInterest = extracted;
      session.phase = "confirm";

      let venues = [];
      try {
        const venueText = await callOpenAI(VENUES_SYSTEM, [
          { role: "user", content: `Give me 3 real Miami venues for: "${extracted}"` }
        ], 700);
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

// POST /confirm
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
      message: `You're all set as a Miami insider! 🌴`,
      profile: { interests: session.interests },
      state: buildState(session),
    });
  }

  session.phase = "chat";
  session.history.push({ role: "user", content: confirmed ? "Yes!" : "No, let's continue." });

  try {
    const rawText = await callOpenAI(
      buildChatSystem(session) + `\n\n"${justAdded}" was just saved (${session.interests.length} of 3 done). Ask for the next interest in one short sentence.`,
      session.history
    );
    const assistantMsg = cleanMessage(rawText);
    session.history.push({ role: "assistant", content: rawText });
    res.json({ message: assistantMsg, state: buildState(session) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "LLM call failed", detail: err.message });
  }
});

// GET /session/:id
app.get("/session/:id", (req, res) => {
  const session = sessions[req.params.id];
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json({ state: buildState(session) });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`HelloCity backend running on port ${PORT}`));
