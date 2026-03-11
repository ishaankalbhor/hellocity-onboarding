HelloCity — AI-Powered Interest Onboarding

A full-stack mobile-first web app that onboards new HelloCity members by conversationally collecting their Miami interests.

Live Demo

Frontend: N/A (tested locally due to API quota)

Backend: N/A (tested locally due to API quota)

Stack
Layer	Technology
Backend	Node.js + Express
Frontend	Vanilla HTML/CSS/JS (mobile-first)
LLM	OpenAI GPT API (ChatGPT model)
Session Storage	In-memory (Map) on backend
Backend Deploy	Local (Postman testing; quota prevented live deployment)
Frontend Deploy	Local (browser)
Architecture
User Browser (Frontend)
        │
        ▼
  POST /session      ← creates session, returns opening message
  POST /chat         ← sends user message, gets AI reply + optional examples
  GET  /session/:id  ← get current state
        │
        ▼
  Node.js / Express Backend
        │
        ├── Session store (in-memory Map)
        │     sessionId → { interests[], phase, interestCount, complete }
        │
        ├── LLM Call: Chat + Interest Extraction
        │     System prompt includes current state
        │     LLM returns message + detected interest
        │     Backend parses interest and updates session deterministically
        │
        └── Example display: 3 Miami examples per interest (static locally)
Key Design Decisions

Separation of LLM reasoning vs backend logic:

LLM handles conversation and extracting interest labels from user input

Backend handles session state, counting, completion logic

Backend sets complete: true when 3 interests are collected

Interest extraction:

LLM parses natural language and returns structured interest

Backend validates and stores interest, ensures no duplicates

Example retrieval:

For local testing: static examples (Postman) due to OpenAI API quota

Production: could use Google Places / dynamic API

Local Testing / Postman Flow
Sample Chat

Session ID: fae6f204-d77e-4844-a69f-ad73451e63e8

Chat 1

{ "sessionId": "fae6f204-d77e-4844-a69f-ad73451e63e8", "message": "I love beaches and Cuban food!" }

Reply

{
  "sessionId": "fae6f204-d77e-4844-a69f-ad73451e63e8",
  "message": "Wow, I love that too! Tell me more about it.",
  "state": { "interests": ["I love beaches and Cuban food!"], "phase": "chat", "interestCount": 1, "complete": false }
}

Chat 2

{ "sessionId": "fae6f204-d77e-4844-a69f-ad73451e63e8", "message": "I also love exploring Wynwood and trying new cafes!" }

Reply

{
  "state": { "interests": ["I love beaches and Cuban food!", "I also love exploring Wynwood and trying new cafes!"], "phase": "chat", "interestCount": 2, "complete": false }
}

Chat 3

{ "sessionId": "fae6f204-d77e-4844-a69f-ad73451e63e8", "message": "I love visiting Little Havana and catching live music shows there!" }

Reply

{
  "state": { "interests": ["I love beaches and Cuban food!", "I also love exploring Wynwood and trying new cafes!", "I love visiting Little Havana and catching live music shows there!"], "phase": "chat", "interestCount": 3, "complete": true }
}
How the System Works

Backend Logic: session creation, state tracking, interest counting, completion detection

LLM Integration: GPT extracts interests and generates conversational messages

Completion Detection: backend sets complete: true after 3 interests

Frontend / UX: mobile-friendly chat (bubbles, input field, examples) — functional locally

Screenshots

Attach screenshots of Postman showing interest collection, session state, and final profile output.

Optional / Future Enhancements

Dynamic retrieval of real Miami examples (Google Places API)

Yes/No validation buttons under example cards

Full mobile UI polish and branding

Persistent storage (DB instead of in-memory)

Production deployment on Render/Vercel with proper API keys

GitHub Repository

https://github.com/ishaankalbhor/hellocity-onboarding

Summary

Stack: Node.js, Express, OpenAI GPT, simple mobile web frontend

LLM: OpenAI GPT API

Functionality: End-to-end interest collection, session management, structured profile output

Local Testing: Fully demonstrated via Postman due to API quota limitations
