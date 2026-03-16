# SoundPilot

> AI label infrastructure for independent artists.

**Label-level strategy. Artist-level control.**

## Deploy on Railway (5 minutes, free)

1. Fork this repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your forked `soundpilot` repo
4. Add environment variable: `OPENAI_API_KEY` = your key
5. Done — Railway gives you a public URL

Users never see your API key. It lives on the server.

## Local development

```bash
cd server
npm install
cp .env.example .env
# Add your OPENAI_API_KEY to .env
npm run dev
```

Then open `index.html` in a browser (or serve with `npx serve .` from root).

## Architecture

```
soundpilot/
├── index.html        # Frontend
├── style.css         # Styles
├── app.js            # Frontend JS (audio analysis via Meyda, calls backend)
├── server/
│   ├── index.js      # Express server — OpenAI proxy, rate limiting
│   ├── package.json
│   └── .env.example  # Copy to .env with your OpenAI key
└── railway.json      # Railway deploy config
```

**Rate limits:** 10 strategy generations per IP per hour (configurable in `server/index.js`).

## Stack

- Vanilla HTML/CSS/JS frontend
- [Meyda](https://meyda.sound.app/) — client-side audio analysis
- Node.js + Express backend
- OpenAI GPT-4o
- Railway for hosting
