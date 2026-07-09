# PROJECT BLUE BOOK

A classified-terminal-styled UAP witness intake app. The frontend is a retro
CRT interrogation console; the backend runs an AI investigator ("BlueBook")
that extracts four details from the witness (location, weather, shape,
movement) and then generates a video + still-frame reconstruction with
Higgsfield.

## Stack

- **Frontend** — plain HTML/CSS/JS (`public/`), no build step. PDF testimony
  parsing runs client-side with `pdf.js`.
- **Backend** — Node + Express (`server.js`), exposing a single `POST
  /api/chat` endpoint.
- **Interrogation agent** — Claude (Anthropic API), driven by the exact
  BlueBook system prompt from the brief. It replies with plain text while
  gathering details, then with a JSON completion block once it has all four.
- **Reconstruction** — the official [`@higgsfield/client`](https://github.com/higgsfield-ai/higgsfield-js)
  Node SDK, called server-side once the interrogation JSON is received.

## Why this isn't built on Higgsfield's own app platform

Higgsfield's hosted app builder requires Sign-in-with-Higgsfield auth and its
Quanta design system for anything that does AI generation — it doesn't
support a fully custom skin or a bespoke chat backend. Since you wanted the
exact CRT design and interrogation flow as specified, this is a standalone
app you host yourself, calling Higgsfield's public API directly instead of
going through their app platform.

## Setup

```bash
npm install
cp .env.example .env
# fill in ANTHROPIC_API_KEY, HIGGSFIELD_API_KEY, HIGGSFIELD_API_SECRET
npm start
```

Then open `http://localhost:3000`.

- Anthropic key: https://console.anthropic.com
- Higgsfield API key/secret: create an account and generate credentials at
  https://cloud.higgsfield.ai

## How the flow works

1. On load, the frontend sends a greeting to `/api/chat`; BlueBook opens the
   interrogation.
2. Each witness message is appended to the running `messages` array and sent
   to `/api/chat`, which forwards it to Claude with the BlueBook system
   prompt.
3. While Claude is still gathering details, `/api/chat` returns
   `{ type: "message", content: "..." }` and the reply is shown in the chat.
4. Once Claude has all four details, it replies with **only** the JSON
   completion block:
   ```json
   {
     "status": "complete",
     "higgsfield_prompt": "Cinematic shot, ...",
     "dossier_summary": "..."
   }
   ```
   `server.js` detects this, calls `higgsfield.generate(...)` twice (once for
   video, once for a still image) using `higgsfield_prompt`, and returns
   ```json
   {
     "type": "complete",
     "higgsfield_prompt": "...",
     "dossier_summary": "...",
     "video_url": "https://...",
     "image_url": "https://..."
   }
   ```
5. The frontend renders both in the EVIDENCE DOSSIER panel with download
   buttons.

## Notes / things to check before the hackathon demo

- **Higgsfield model IDs**: `server.js` calls `/v1/text2video/higgsfield_v1`
  and `/v1/text2image/soul` as placeholders for the video and image models —
  confirm the exact endpoint paths and required parameters (aspect ratio,
  duration, etc.) against your Higgsfield dashboard/docs once you have
  credentials, since exact model slugs can change.
- **Latency**: video generation can take well over a minute. For the demo,
  consider showing a "reconstruction in progress" state in the dossier panel
  (the frontend's `.loader` element) rather than blocking silently — you may
  want to switch `/api/chat` to kick off generation asynchronously and poll
  from the frontend if judges are watching live.
- **Error states**: if Higgsfield generation fails, `/api/chat` currently
  returns a 500 with a generic message — you may want a friendlier
  "reconstruction failed, try re-describing the object" path for the demo.
- **Secrets**: never commit `.env`; only `.env.example` is checked in.

## Deploying

Any Node host works (Render, Fly.io, Railway, a VPS, etc.). Set the three
environment variables in your host's dashboard, `npm install && npm start`.
Make sure the process serves on the port your host expects (`PORT` env var
is respected).
