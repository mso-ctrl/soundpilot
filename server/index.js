require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const multer     = require('multer');
const rateLimit  = require('express-rate-limit');
const OpenAI     = require('openai');
const path       = require('path');

const app  = express();
const port = process.env.PORT || 3001;

// ── OpenAI client (lazy — so missing key doesn't crash on boot) ──
let _openai = null;
function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY env var is not set on the server.');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// ── CORS — allow all origins (manual headers + cors package) ───
// Manual headers first — belt-and-suspenders approach
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
app.use(cors({ origin: true, methods: ['GET', 'POST'], credentials: false }));
app.use(express.json());

// Serve frontend static files (for Railway one-repo deploy)
app.use(express.static(path.join(__dirname, '../')));

// ── Rate limiting ──────────────────────────────────
// 10 strategy generations per IP per hour
const strategyLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests. Try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API limit: 60 requests/15min per IP
const apiLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Rate limit exceeded. Try again shortly.' },
});

app.use('/api', apiLimit);

// ── File upload (in memory, no disk storage) ───────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/webm'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|m4a|ogg|webm)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are supported (MP3, WAV, M4A).'));
    }
  }
});

// ── Health check ───────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0' });
});

// ── Strategy generation endpoint ───────────────────
app.post('/api/analyze', strategyLimit, upload.single('audio'), async (req, res) => {
  try {
    const { genre, mood, inspirations, audioData } = req.body;

    if (!genre) {
      return res.status(400).json({ error: 'Genre is required.' });
    }

    // audioData is JSON-stringified features from client-side Meyda analysis
    let features = {};
    try {
      features = audioData ? JSON.parse(audioData) : {};
    } catch {
      features = {};
    }

    const bpmStr  = features.bpm ? `${features.bpm} BPM` : 'BPM not detected';
    const hookStr = (features.hookStart && features.hookEnd)
      ? `${features.hookStart} – ${features.hookEnd}`
      : '~0:09 – 0:16';

    const prompt = `You are SoundPilot — an expert music strategist and A&R consultant for independent artists. You specialize in viral release strategy for short-form content platforms in 2025-2026.

An artist has uploaded an unreleased track with the following profile:
- Genre: ${genre}
- Mood/theme: ${mood || 'Not specified'}
- Artist inspirations: ${inspirations || 'Not specified'}
- Tempo: ${bpmStr}
- Energy: ${features.energy || 'Medium'}
- Tone: ${features.tone || 'Warm'}
- Song mood: ${features.mood || 'Melodic'}
- HookFinder identified strongest moment: ${hookStr} (Hook Strength: ${features.hookStrength || '7.5'}/10)

Generate a strategic release plan with EXACTLY these four sections. Be specific, culturally informed, and avoid generic advice.

---

## Song Identity

In 2–3 vivid sentences: describe the song's emotional core, sonic identity, and the listener it speaks to. Be specific about the vibe.

---

## Comparable Artists

List exactly 5 comparable artists as a numbered list. Format: **Artist Name** — one sentence explaining the sonic or cultural connection.

---

## Content Strategy

**Hook moment to use:** Reference the ${hookStr} timestamp and explain exactly why this moment works for short-form content.

**3 content formats** (numbered list): Specific, visual video concepts that match this song's energy.

**Best platforms:** Rank TikTok, Instagram Reels, YouTube Shorts in order and explain why.

**Optimal posting:** Specific day(s) and time window.

---

## 14-Day Release Rollout

Format as Day 1, Day 4, Day 7, Day 10, Day 14. Bold title per day + 1–2 specific actions. Think like a label marketing team.

---

Keep it tight, expert, and actionable.`;

    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.75,
      max_tokens: 1600,
    });

    const strategy = completion.choices[0].message.content;

    res.json({
      success: true,
      strategy,
      features,
    });

  } catch (err) {
    console.error('Analyze error:', err.message);

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Max 20MB.' });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: 'OpenAI rate limit hit. Try again in a moment.' });
    }
    if (err.status === 401) {
      return res.status(500).json({ error: 'Server configuration error. Contact support.' });
    }

    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Serve frontend for all other routes ───────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// ── Start ──────────────────────────────────────────
app.listen(port, '0.0.0.0', () => {
  console.log(`SoundPilot server running on port ${port}`);
});
