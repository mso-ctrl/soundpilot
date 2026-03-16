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

// ── CORS — allow all origins ────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(cors({ origin: true, methods: ['GET', 'POST'], credentials: false }));
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../')));

// ── Rate limiting ────────────────────────────────────
const strategyLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests. Try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Rate limit exceeded. Try again shortly.' },
});

app.use('/api', apiLimit);

// ── File upload (in memory) ──────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/webm'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|m4a|ogg|webm)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are supported (MP3, WAV, M4A).'));
    }
  }
});

// ── Health check ─────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.1.0' });
});

// ── Genre profiles ───────────────────────────────────
const GENRE_PROFILES = {
  'Afro-R&B':         {
    platforms: 'Instagram Reels first (diaspora community is strongest there), TikTok second, YouTube Shorts third',
    postTime: 'Thursday–Saturday, 7–10pm EST',
    contentStyle: 'aesthetics-first — soft lighting, late-night bedroom energy, outfit fits, subtle movement. No hype edits.',
  },
  'Afrobeats':        {
    platforms: 'TikTok first (dance trends drive Afrobeats discovery), Instagram Reels second, YouTube Shorts third',
    postTime: 'Friday–Sunday, 6–11pm EST',
    contentStyle: 'dance challenges, street style, vibrant colour grading, diaspora pride moments',
  },
  'Hip-Hop/Rap':      {
    platforms: 'TikTok first, YouTube Shorts second, Instagram Reels third',
    postTime: 'Tuesday, Thursday, Saturday — 8–11pm EST',
    contentStyle: 'bars-focused clips, freestyle energy, studio or street authenticity — avoid over-produced content',
  },
  'R&B':              {
    platforms: 'Instagram Reels first, TikTok second, YouTube Shorts third',
    postTime: 'Wednesday and Saturday, 7–10pm EST',
    contentStyle: 'emotional storytelling, moody aesthetics, POV-style clips. Let the vocals carry the content.',
  },
  'Pop':              {
    platforms: 'TikTok first, Instagram Reels second, YouTube Shorts third',
    postTime: 'Thursday–Saturday, 5–9pm EST',
    contentStyle: 'hook-driven, trend-adjacent concepts, emotional or comedic angle',
  },
  'Dance/Electronic': {
    platforms: 'TikTok first, YouTube Shorts second, Instagram Reels third',
    postTime: 'Friday–Saturday, 9pm–midnight EST',
    contentStyle: 'build/drop moments, visual transitions, festival energy, DJ set clips',
  },
  'Drill':            {
    platforms: 'YouTube Shorts first (drill has a YouTube-native audience), TikTok second, Instagram Reels third',
    postTime: 'Friday–Sunday, 8pm–1am EST',
    contentStyle: 'raw, unfiltered. Studio sessions, no-frills cuts over the beat. Authenticity over production.',
  },
  'Reggaeton':        {
    platforms: 'TikTok first, Instagram Reels second, YouTube Shorts third',
    postTime: 'Friday–Sunday, 7–11pm EST',
    contentStyle: 'sensual movement, party clips, Latin lifestyle content',
  },
  'Soul/Gospel':      {
    platforms: 'YouTube Shorts first, Instagram Reels second, TikTok third',
    postTime: 'Sunday morning + Wednesday evening EST',
    contentStyle: 'live performance clips, emotional reaction content, community moments',
  },
};

// ── Strategy generation endpoint ─────────────────────
app.post('/api/analyze', strategyLimit, upload.single('audio'), async (req, res) => {
  try {
    const { genre, mood, inspirations, audioData } = req.body;

    if (!genre) {
      return res.status(400).json({ error: 'Genre is required.' });
    }

    let features = {};
    try { features = audioData ? JSON.parse(audioData) : {}; } catch { features = {}; }

    const bpmStr  = features.bpm ? `${features.bpm} BPM` : 'BPM not detected';
    const hookStr = (features.hookStart && features.hookEnd)
      ? `${features.hookStart} – ${features.hookEnd}`
      : '~0:09 – 0:16';

    const gp = GENRE_PROFILES[genre] || {
      platforms: 'TikTok first, Instagram Reels second, YouTube Shorts third',
      postTime: 'Thursday–Saturday, 7–10pm EST',
      contentStyle: 'authentic, artist-led content that matches the sonic energy of the track',
    };

    const hookStrengthNum = parseFloat(features.hookStrength) || 6.5;
    const hookVerdict = hookStrengthNum >= 7.5
      ? 'strong hook — this window should anchor every short-form clip'
      : hookStrengthNum >= 5.5
      ? 'decent hook but it needs visual framing — pair it with a strong opening shot or caption to land'
      : 'the hook is subtle — lean into mood and atmosphere rather than chasing a single viral moment';

    const prompt = `You are SoundPilot — a blunt, culturally sharp music strategist. You work like a top indie A&R consultant: direct, specific, zero filler. You know the difference between Afrobeats and Afro-R&B, between drill and trap, between what drives streams on TikTok Lagos vs TikTok Toronto.

TRACK PROFILE:
- Genre: ${genre}
- Mood/theme: ${mood || 'not given'}
- Artist inspirations: ${inspirations || 'not given'}
- Tempo: ${bpmStr}
- Energy: ${features.energy || 'Medium'}
- Tone: ${features.tone || 'Warm'}
- Detected mood: ${features.mood || 'Melodic'}
- Hook window: ${hookStr} | Hook Strength: ${features.hookStrength || '6.5'}/10 — ${hookVerdict}

GENRE INTELLIGENCE FOR ${genre.toUpperCase()}:
- Platform priority: ${gp.platforms}
- Optimal post window: ${gp.postTime}
- Content style that works for this genre: ${gp.contentStyle}

YOUR JOB: Give this artist a release strategy that no generic AI tool would produce. Be genre-native. Reference actual cultural moments, real platform behaviours, and current trends specific to ${genre}. If the hook score is below 5.5, say it plainly and redirect the strategy. If the BPM is unusual for this genre, flag it and explain the implication.

BANNED PHRASES — do not use these at all: "leverage", "engage with your audience", "build anticipation", "authentic connection", "captivate", "resonate", "share your journey", "connect with fans", "drive engagement", "behind the scenes content", "make sure to".

---

## Song Identity

2–3 sentences. Name the exact emotion, the specific listener this song speaks to, and one cultural reference point that anchors it. Write like a music critic, not a hype machine.

---

## Comparable Artists

Exactly 5 artists. Format: **Artist Name** — one sentence explaining the specific sonic or cultural reason (not "similar vibe"). Prioritise artists whose actual fanbase would stream this track.

---

## Content Strategy

**Hook moment (${hookStr}):** ${hookVerdict}. Tell the artist exactly what to do with this window — or what to pivot to if it won't carry a short-form clip on its own.

**3 content formats:** Concrete, visual, specific to ${genre} culture. Describe the shot, the vibe, the caption angle. Not generic advice.

**Platform ranking:** ${gp.platforms}. Explain why this genre performs better on the top platform vs the bottom — give algorithmic and cultural reasons.

**Post timing:** ${gp.postTime}. Explain why this specific window.

---

## 14-Day Release Rollout

Day 1, Day 3, Day 5, Day 7, Day 10, Day 14. Bold title + 2 specific actions per day. Zero paid ads — pure organic strategy. Each day must build on the last. Include one wildcard move that most independent artists skip.

---

Be direct. Be specific. No padding.`;

    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 1800,
    });

    const strategy = completion.choices[0].message.content;

    res.json({ success: true, strategy, features });

  } catch (err) {
    console.error('Analyze error:', err.message);

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Max 50MB.' });
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

// ── Serve frontend for all other routes ──────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// ── Start ─────────────────────────────────────────────
app.listen(port, '0.0.0.0', () => {
  console.log(`SoundPilot server running on port ${port}`);
});
