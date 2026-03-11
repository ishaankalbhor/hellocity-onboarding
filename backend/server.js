const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const OpenAI = require("openai");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Initialize Groq client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// In-memory session store
const sessions = new Map();

// ── Helpers ─────────────────────────────
function createSession() {
  const sessionId = uuidv4();
  const state = { interests: [], phase: "chat", interestCount: 0, complete: false };
  sessions.set(sessionId, { state, history: [] });
  return { sessionId, state };
}

function updateSession(sessionId, newState) {
  const session = sessions.get(sessionId);
  if (session) {
    session.state = { ...session.state, ...newState };
    return session.state;
  }
  return null;
}

// ── Routes ──────────────────────────────

// Create new session
app.post("/session", (req, res) => {
  const { sessionId, state } = createSession();
  const message = "Hey! Welcome to HelloCity. Tell me a few things you love in Miami!";
  res.json({ sessionId, message, state });
});

// Chat endpoint
app.post("/chat", async (req, res) => {
  const { sessionId, message } = req.body;

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });

  session.history.push({ role: "user", content: message });

  const systemPrompt = `
You are a friendly Miami guide.
Always respond conversationally.

After your reply include EXACTLY ONE tag like this:

<EXTRACT>{"interest": "..."}</EXTRACT>

Only include it if a new interest is detected.
`;

  try {
    const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: systemPrompt },
    ...session.history,
  ],
});

    const aiMessage = completion.choices[0].message.content;

    // Extract interest
    const extractMatch = aiMessage.match(/<EXTRACT>(.*?)<\/EXTRACT>/);
    const pendingInterest = extractMatch
      ? JSON.parse(extractMatch[1]).interest
      : null;

    const cleanMessage = aiMessage.replace(/<EXTRACT>.*?<\/EXTRACT>/, "").trim();

    let venues = null;

    if (pendingInterest) {
      venues = [
        {
          name: "Sugar",
          neighborhood: "Brickell",
          description: "Rooftop bar with amazing cocktails.",
          hours: "5pm-2am",
          vibe: "Chic & Airy",
          emoji: "🍹",
        },
        {
          name: "Juvia",
          neighborhood: "Miami Beach",
          description: "Modern rooftop with city views.",
          hours: "6pm-1am",
          vibe: "Trendy",
          emoji: "🌇",
        },
        {
          name: "Area 31",
          neighborhood: "Downtown",
          description: "Upscale rooftop with seafood.",
          hours: "5pm-12am",
          vibe: "Elegant",
          emoji: "🍸",
        },
      ];

      session.state.phase = "confirm";
    }

    session.history.push({ role: "assistant", content: aiMessage });

    res.json({
      message: cleanMessage,
      pendingInterest,
      venues,
      state: session.state,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "LLM error" });
  }
});

// Confirm interest
app.post("/confirm", (req, res) => {
  const { sessionId, confirmed } = req.body;

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });

  if (session.state.phase !== "confirm")
    return res.status(400).json({ error: "No interest to confirm" });

  const interest = session.history[session.history.length - 1].content.match(
    /<EXTRACT>(.*?)<\/EXTRACT>/
  );

  let interestText = interest ? JSON.parse(interest[1]).interest : null;

  if (confirmed && interestText) session.state.interests.push(interestText);

  session.state.interestCount = session.state.interests.length;

  session.state.phase = session.state.interestCount >= 3 ? "done" : "chat";

  if (session.state.phase === "done") session.state.complete = true;

  res.json({
    message:
      session.state.phase === "done"
        ? "Amazing! You're all set as a Miami insider. 🌴"
        : "Love it! What else do you enjoy in the city?",
    profile:
      session.state.phase === "done"
        ? { interests: session.state.interests }
        : undefined,
    state: session.state,
  });
});

// Get session state
app.get("/session/:id", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  res.json({ state: session.state });
});

// Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));