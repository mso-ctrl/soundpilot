require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const multer    = require('multer');
const rateLimit = require('express-rate-limit');
const OpenAI    = require('openai');
const path      = require('path');
const https     = require('https');
const crypto    = require('crypto');
const Database  = require('better-sqlite3');
const fs        = require('fs');

const app  = express();
const port = process.env.PORT || 3001;

// ── Database setup ────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'soundpilot.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS test_sessions (
    id          TEXT PRIMARY KEY,
    artist_key  TEXT NOT NULL,          -- private key for artist to view results
    genre       TEXT NOT NULL,
    hooks       TEXT NOT NULL,          -- JSON array of {line, window, score, reason}
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,       -- unix ms, 48h after creation
    track_name  TEXT
  );

  CREATE TABLE IF NOT EXISTS votes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES test_sessions(id),
    hook_index  INTEGER NOT NULL,       -- 0=A, 1=B, 2=C
    voter_fp    TEXT NOT NULL,          -- hashed fingerprint (IP+UA)
    voted_at    INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_voter ON votes(session_id, voter_fp);
`);

// Cleanup expired sessions older than 7 days
const cleanupStmt = db.prepare(`DELETE FROM test_sessions WHERE expires_at < ?`);
setInterval(() => {
  try { cleanupStmt.run(Date.now() - 7 * 24 * 60 * 60 * 1000); } catch {}
}, 60 * 60 * 1000); // hourly

// ── OpenAI client (lazy init) ─────────────────────
let _openai = null;
function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// ── CORS ──────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(cors({ origin: true, methods: ['GET', 'POST'], credentials: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../')));

// ── Rate limiting ─────────────────────────────────
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
const voteLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: 'Rate limit exceeded.' },
});
app.use('/api', apiLimit);

// ── File upload ───────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || file.originalname.match(/\.(mp3|wav|m4a|ogg|webm|flac)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are supported.'));
    }
  }
});

// ── Perplexity live trend search ──────────────────
async function fetchLiveTrends(genre) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;

  const now = new Date();
  const monthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const query = `What ${genre} songs and sounds are trending on TikTok and going viral in ${monthYear}? What content formats are working best for ${genre} artists right now? What are the key characteristics of ${genre} songs that are blowing up? Be specific and current.`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'sonar',
      messages: [
        {
          role: 'system',
          content: 'You are a music industry trend analyst. Give concise, specific, current information. No generic advice. Focus on what is actually happening right now in this genre on social platforms.'
        },
        { role: 'user', content: query }
      ],
      max_tokens: 600,
      temperature: 0.2,
      search_recency_filter: 'month',
      return_citations: false,
    });

    const options = {
      hostname: 'api.perplexity.ai',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.message?.content;
          resolve(content || null);
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ── Genre intelligence ────────────────────────────
const GENRE_PROFILES = {
  'Afrobeats': {
    platforms: 'TikTok first — Afrobeats discovery happens through dance challenges and the FYP algorithm, not follower count. Instagram Reels second (diaspora reposts). YouTube Shorts third.',
    postTime: 'Friday 8pm–midnight EST / 1am–5am WAT. Saturday 6–11pm EST. Hits UK, North America, and West Africa simultaneously.',
    contentStyle: 'Dance is the discovery engine. 8 counts on the hook outperforms any promotional post. Warm, vibrant, saturated colour grading. Captions should invite tagging.',
    audienceNote: 'Core: Nigerian, Ghanaian, Kenyan diaspora in UK, USA, Canada. Heavy sharing, tagging, group listening.',
    contentDont: 'Sitting-down talking-to-camera. Over-produced marketing visuals. English-only captions when the song has Pidgin or Yoruba.',
    bpmRange: [90, 115],
  },
  'Afro-R&B': {
    platforms: 'Instagram Reels first — aesthetics-first audience. TikTok second (emotional POV content). YouTube for full streams.',
    postTime: 'Thursday 9pm–midnight EST. Saturday 8–11pm EST. Late-night streaming audience.',
    contentStyle: 'Soft lighting, golden hour, bedroom settings, subtle movement. Text overlay with a specific lyric. Avoid hype edits — they kill the mood.',
    audienceNote: 'Core: 20–32 Black women and men in UK, USA, Canada. Responds to emotional specificity — situationships, late nights, longing.',
    contentDont: 'Fast cuts. Dance challenge formats. Bright energetic colour grading.',
    bpmRange: [65, 95],
  },
  'Amapiano': {
    platforms: 'TikTok first — log drum groove drives dance discovery. Instagram Reels second. YouTube for DJ sets.',
    postTime: 'Friday evening and Saturday afternoon EST.',
    contentStyle: 'Log drum is the hook, not the vocals. Body isolation and footwork. House party clips. Warm, bright colour grade.',
    audienceNote: 'Early mainstream in UK/USA — high viral potential for unknown artists.',
    contentDont: 'Moody or dark visuals. Treating it like Afrobeats.',
    bpmRange: [110, 130],
  },
  'Hip-Hop/Rap': {
    platforms: 'TikTok first — 15-second bar clips on FYP. YouTube Shorts second (reaction channel culture). Instagram Reels third.',
    postTime: 'Tuesday and Thursday 9pm–midnight EST. Saturday 8–11pm EST.',
    contentStyle: 'Most quotable line, not the hook. Karaoke-style lyrics on screen. Raw studio footage. Over-produced content kills credibility.',
    audienceNote: 'One quotable bar delivered with conviction can outperform a full campaign.',
    contentDont: 'Over-produced visuals. Talking about the song instead of performing it.',
    bpmRange: [75, 105],
  },
  'R&B': {
    platforms: 'Instagram Reels first. TikTok second (emotional POV). YouTube for streams.',
    postTime: 'Wednesday 8–11pm EST and Saturday 7–10pm EST.',
    contentStyle: 'POV clips with specific scenario captions. Moody aesthetic with lyric overlay. R&B audiences leave long personal comments — open a conversation.',
    audienceNote: 'Core: 18–35 Black women and men in USA and UK. TikTok traction converts directly to Spotify playlist adds.',
    contentDont: 'Fast cuts. Dance formats. Generic promotional language.',
    bpmRange: [60, 95],
  },
  'Drill': {
    platforms: 'YouTube Shorts first (reaction channel culture). TikTok second. Instagram Reels third.',
    postTime: 'Friday and Saturday 9pm–2am EST.',
    contentStyle: 'Raw and unfiltered. Studio clips with beat playing. No-frills performance. Desaturated or natural colour grade.',
    audienceNote: 'Reaction channels multiply reach dramatically. YouTube-native audience.',
    contentDont: 'Polished visuals. Dance content. Mainstream pop marketing aesthetics.',
    bpmRange: [130, 160],
  },
  'Dancehall': {
    platforms: 'TikTok first — dance challenges. Instagram Reels second. YouTube for riddim playlists.',
    postTime: 'Friday 7pm–midnight EST and Saturday 6–11pm EST.',
    contentStyle: 'Dance is non-negotiable. Simple learnable routine, 8–16 counts max. Vibrant Caribbean colour. The challenge IS the strategy.',
    audienceNote: 'Caribbean diaspora in UK, USA, Canada. Songs with challenges spread extremely fast.',
    contentDont: 'Static or moody content. Content without movement.',
    bpmRange: [90, 110],
  },
  'Pop': {
    platforms: 'TikTok first — FYP-driven discovery. Instagram Reels second. YouTube Shorts third.',
    postTime: 'Thursday–Saturday 5–9pm EST.',
    contentStyle: 'First 2 seconds must stop the scroll. Test 2–3 different content formats week one. Algorithm tells you what to double down on.',
    audienceNote: 'Broadest demographic, most competitive FYP. Generic content disappears instantly.',
    contentDont: 'Generic promotional content. Anything that looks like an ad.',
    bpmRange: [95, 135],
  },
  'Dance/Electronic': {
    platforms: 'TikTok first (18–24). YouTube Shorts second (DJ sets). Instagram Reals third.',
    postTime: 'Friday–Saturday 9pm–midnight EST.',
    contentStyle: 'The drop is the content. 3–5 second drop clip. Festival crowd reactions. Visual transitions timed to the beat.',
    audienceNote: 'Electronic audiences also live on SoundCloud. Short-form drives platform follows.',
    contentDont: 'Content without the drop. Slow-building clips that never hit.',
    bpmRange: [120, 145],
  },
  'Alternative': {
    platforms: 'Instagram Reels first (22–35 demographic). TikTok second. YouTube Shorts third.',
    postTime: 'Wednesday and Saturday 7–10pm EST.',
    contentStyle: 'Live performance clips showing musicianship. Aesthetic visuals matching the sonic world. Alternative audiences are allergic to content that feels like marketing.',
    audienceNote: 'Heavy Spotify users. Strong short-form drives playlist pitching leverage.',
    contentDont: 'Dance formats. Trend-chasing. Mainstream pop marketing aesthetics.',
    bpmRange: [70, 130],
  },
};

// ── Health check ──────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '5.0.0' });
});

// ── Main analysis endpoint ────────────────────────
app.post('/api/analyze', strategyLimit, upload.single('audio'), async (req, res) => {
  try {
    const { genre, mood, inspirations } = req.body;
    if (!genre) return res.status(400).json({ error: 'Genre is required.' });
    if (!req.file) return res.status(400).json({ error: 'Audio file is required.' });

    const openai = getOpenAI();
    const gp = GENRE_PROFILES[genre] || {
      platforms: 'TikTok first, Instagram Reels second, YouTube Shorts third',
      postTime: 'Thursday–Saturday, 7–10pm EST',
      contentStyle: 'Authentic, artist-led content matching the sonic energy',
      audienceNote: '',
      contentDont: '',
      bpmRange: [80, 120],
    };

    // ── Run Whisper + Perplexity in parallel ──────
    const ext = req.file.originalname.match(/\.(mp3|wav|m4a|ogg|webm|flac)$/i)?.[1] || 'm4a';
    const audioFile = new File([req.file.buffer], `track.${ext}`, { type: req.file.mimetype || 'audio/mpeg' });

    const [whisperResult, trendContext] = await Promise.allSettled([
      openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      }),
      fetchLiveTrends(genre),
    ]);

    // ── Process Whisper result ─────────────────────
    let transcript = '';
    let detectedLanguage = 'english';
    let hooks = [];
    let transcriptError = false;

    if (whisperResult.status === 'fulfilled') {
      const w = whisperResult.value;
      transcript = w.text || '';
      detectedLanguage = w.language || 'english';

      if (w.segments && w.segments.length > 0) {
        const totalDuration = w.segments[w.segments.length - 1].end || 180;
        const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

        const scored = w.segments.map(seg => {
          const pos = seg.start / totalDuration;
          const posFactor = pos > 0.12 && pos < 0.82 ? 1.3 : 0.5;
          const words = (seg.text || '').trim().split(/\s+/).filter(Boolean).length;
          const segWords = (seg.text || '').toLowerCase().split(/\s+/);
          let repetitions = 0;
          for (const other of w.segments) {
            if (other === seg) continue;
            const otherWords = (other.text || '').toLowerCase().split(/\s+/);
            for (let i = 0; i <= segWords.length - 4; i++) {
              const ngram = segWords.slice(i, i + 4).join(' ');
              if (otherWords.join(' ').includes(ngram)) { repetitions++; break; }
            }
          }
          const rawScore = (words * 0.6 + repetitions * 4) * posFactor;
          return { seg, rawScore, words, repetitions, pos };
        });

        scored.sort((a, b) => b.rawScore - a.rawScore);
        const selected = [];
        for (const item of scored) {
          const tooClose = selected.some(s => Math.abs(s.seg.start - item.seg.start) < 20);
          if (!tooClose) {
            selected.push(item);
            if (selected.length === 3) break;
          }
        }

        const maxRaw = selected[0]?.rawScore || 1;
        const minRaw = selected[selected.length - 1]?.rawScore || 0;
        const range = maxRaw - minRaw || 1;

        hooks = selected.map((item, i) => {
          const hookStart = Math.floor(item.seg.start);
          const hookEnd   = Math.min(Math.floor(item.seg.end) + 7, Math.floor(totalDuration));
          const normScore = 5.0 + ((item.rawScore - minRaw) / range) * 4.5;
          const score = parseFloat(normScore.toFixed(1));
          const reasons = [];
          if (item.repetitions > 0) reasons.push(`repeated ${item.repetitions}× — likely chorus`);
          if (item.pos > 0.3 && item.pos < 0.6) reasons.push('mid-song sweet spot');
          if (item.pos > 0.6 && item.pos < 0.8) reasons.push('strong post-chorus position');
          if (item.words > 10) reasons.push('high lyrical density');
          const reason = reasons.length ? reasons.join(', ') : (i === 0 ? 'highest combined score' : 'strong candidate');
          return {
            window: `${fmt(hookStart)}–${fmt(hookEnd)}`,
            startSec: hookStart,
            endSec: hookEnd,
            line: item.seg.text.trim(),
            score,
            reason,
          };
        });
      }
    } else {
      console.error('Whisper error:', whisperResult.reason?.message);
      transcriptError = true;
    }

    // ── Live trend context ─────────────────────────
    const liveTrends = trendContext.status === 'fulfilled' ? trendContext.value : null;

    // ── Build leverage scores ─────────────────────
    const topHook = hooks[0];
    const hookStrength = topHook?.score || 6.0;
    const hasChorus = hooks.some(h => h.reason.includes('repeated'));
    const replayPotential = hookStrength >= 8 ? 'High' : hookStrength >= 6.5 ? 'Medium' : 'Low';
    const shortFormCompatibility = hooks.length >= 2 ? 'Strong' : hooks.length === 1 ? 'Moderate' : 'Weak';
    const genreTrendAlignment = liveTrends ? 'Rising' : 'Stable';
    const lyricalSpecificity = transcript.length > 200 ? 'High' : transcript.length > 50 ? 'Medium' : 'Low';

    const leverage = {
      hookStrength,
      replayPotential,
      shortFormCompatibility,
      genreTrendAlignment,
      lyricalSpecificity,
      detectedLanguage,
    };

    // ── GPT-4o strategy prompt ─────────────────────
    const isEnglish = ['english', 'en'].includes(detectedLanguage.toLowerCase());
    const languageNote = !isEnglish
      ? `LANGUAGE: Whisper detected "${detectedLanguage}" — this may include Pidgin, Yoruba, Patois, French, or another language. PRESERVE all lyrics exactly as transcribed. Do NOT translate. Treat the language as a cultural asset and advise on diaspora audience targeting.`
      : '';

    const hooksText = hooks.length > 0
      ? hooks.map((h, i) => `Hook ${String.fromCharCode(65+i)}: "${h.line}" at ${h.window} (score ${h.score}/10 — ${h.reason})`).join('\n')
      : 'No hooks identified (likely instrumental)';

    const trendSection = liveTrends
      ? `LIVE TREND DATA (fetched right now for ${genre} — use this to ground your advice in what's actually happening this week):\n${liveTrends}`
      : `NOTE: Live trend data unavailable. Use your knowledge of current ${genre} trends.`;

    const transcriptSection = transcript
      ? `ACTUAL LYRICS (transcribed verbatim — quote these, do not paraphrase):\n"""\n${transcript.slice(0, 3500)}${transcript.length > 3500 ? '\n[continues...]' : ''}\n"""\n${languageNote}`
      : 'INSTRUMENTAL or transcription unavailable — base strategy on genre, mood, and inspirations.';

    const prompt = `You are SoundPilot — a senior music strategist with deep cultural fluency across Afrobeats, Afro-R&B, Drill, Dancehall, Hip-Hop, and diaspora music culture. You give direct, specific, actionable advice grounded in real data. You work like a top A&R consultant — not a chatbot.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRACK PROFILE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Genre: ${genre}
Mood/theme: ${mood || 'not specified'}
Artist inspirations: ${inspirations || 'not specified'}

${transcriptSection}

TOP HOOK CANDIDATES (identified by lyric repetition + position analysis):
${hooksText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${trendSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GENRE INTELLIGENCE: ${genre.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Platform strategy: ${gp.platforms}
Post timing: ${gp.postTime}
What converts: ${gp.contentStyle}
Audience: ${gp.audienceNote}
DO NOT: ${gp.contentDont}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR MANDATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Every recommendation must reference the ACTUAL LYRICS or LIVE TREND DATA above
2. Two songs in the same genre must get different strategies — use the lyrics to differentiate
3. If a hook is scored below 6.5, say so plainly and explain what to do instead
4. Quote lyrics in their original language — never translate
5. Generic advice that ignores the transcript is a failure

BANNED PHRASES: "leverage", "engage with your audience", "build anticipation", "authentic connection", "captivate", "resonate", "share your journey", "connect with fans", "drive engagement", "make sure to"

---

## Song Identity

2–3 sentences. Quote a specific lyric. Name the exact emotion, the specific listener, and one cultural reference point. Write like a music critic who actually listened.

---

## Comparable Artists

Exactly 5 artists. Format: **Artist Name** — one sentence on the specific sonic/lyrical connection. Quote a lyric if it helps. Prioritise artists whose fanbase would stream this based on what you read.

---

## Content Strategy

**Primary hook (use ${topHook ? topHook.window : 'the strongest moment'}):** Quote "${topHook ? topHook.line : 'the hook'}" — explain exactly why this works for short-form in ${genre} culture. Specific shot, specific caption using the actual lyric.

**3 content formats:** Concrete, genre-native. Describe the shot, the vibe, the caption — use the real lyrics. Reference the live trend data if relevant.

**Platform ranking:** ${gp.platforms} — explain why for this specific track.

**Post timing:** ${gp.postTime}

**2 things NOT to do:** Specific to this track and genre.

---

## 14-Day Release Rollout

Day 1, Day 3, Day 5, Day 7, Day 10, Day 14. Bold title + 2 specific actions. Zero paid ads. Reference the actual lyrics/hook in content actions. Include one wildcard move most artists skip.

---

Be direct. Quote the lyrics. No padding.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.75,
      max_tokens: 2200,
    });

    // ── Create a test session for Hook A/B/C voting ──
    let testSession = null;
    if (hooks.length >= 2) {
      const sessionId  = crypto.randomBytes(8).toString('hex');
      const artistKey  = crypto.randomBytes(12).toString('hex');
      const now        = Date.now();
      const expiresAt  = now + 48 * 60 * 60 * 1000; // 48 hours
      const trackName  = req.file.originalname.replace(/\.[^.]+$/, '') || 'Untitled';

      db.prepare(`
        INSERT INTO test_sessions (id, artist_key, genre, hooks, created_at, expires_at, track_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, artistKey, genre, JSON.stringify(hooks), now, expiresAt, trackName);

      testSession = {
        testUrl:    `/test/${sessionId}`,
        resultsUrl: `/results/${sessionId}?key=${artistKey}`,
        expiresAt,
      };
    }

    res.json({
      success: true,
      strategy: completion.choices[0].message.content,
      hooks,
      leverage,
      trendContext: liveTrends || null,
      transcript: transcript || null,
      transcriptError,
      testSession,
    });

  } catch (err) {
    console.error('Analyze error:', err.message);
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Max 50MB.' });
    if (err.status === 429) return res.status(429).json({ error: 'OpenAI rate limit hit. Try again in a moment.' });
    if (err.status === 401) return res.status(500).json({ error: 'Server configuration error.' });
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── GET /api/test/:id — get session data for vote page ──
app.get('/api/test/:id', (req, res) => {
  const session = db.prepare('SELECT * FROM test_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Test not found.' });
  if (Date.now() > session.expires_at) return res.status(410).json({ error: 'This test link has expired.' });

  // Vote counts per hook
  const counts = db.prepare(`
    SELECT hook_index, COUNT(*) as cnt FROM votes WHERE session_id = ? GROUP BY hook_index
  `).all(req.params.id);

  const voteCounts = {};
  counts.forEach(r => { voteCounts[r.hook_index] = r.cnt; });

  // Check if this IP already voted
  const fp = voterFingerprint(req);
  const voted = db.prepare('SELECT hook_index FROM votes WHERE session_id = ? AND voter_fp = ?').get(req.params.id, fp);

  res.json({
    sessionId: session.id,
    genre: session.genre,
    trackName: session.track_name,
    hooks: JSON.parse(session.hooks),
    expiresAt: session.expires_at,
    totalVotes: counts.reduce((a, r) => a + r.cnt, 0),
    voteCounts,
    alreadyVoted: voted ? voted.hook_index : null,
  });
});

// ── POST /api/test/:id/vote ──
app.post('/api/test/:id/vote', voteLimit, (req, res) => {
  const session = db.prepare('SELECT * FROM test_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Test not found.' });
  if (Date.now() > session.expires_at) return res.status(410).json({ error: 'This test has expired.' });

  const { hookIndex } = req.body;
  if (hookIndex == null || hookIndex < 0 || hookIndex > 2) {
    return res.status(400).json({ error: 'Invalid hook index.' });
  }

  const hooks = JSON.parse(session.hooks);
  if (hookIndex >= hooks.length) return res.status(400).json({ error: 'Hook not found.' });

  const fp = voterFingerprint(req);

  try {
    db.prepare(`
      INSERT INTO votes (session_id, hook_index, voter_fp, voted_at) VALUES (?, ?, ?, ?)
    `).run(req.params.id, hookIndex, fp, Date.now());
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'You already voted on this test.' });
    }
    throw e;
  }

  // Return updated counts
  const counts = db.prepare(`
    SELECT hook_index, COUNT(*) as cnt FROM votes WHERE session_id = ? GROUP BY hook_index
  `).all(req.params.id);
  const voteCounts = {};
  counts.forEach(r => { voteCounts[r.hook_index] = r.cnt; });
  const totalVotes = counts.reduce((a, r) => a + r.cnt, 0);

  res.json({ success: true, voteCounts, totalVotes, yourVote: hookIndex });
});

// ── GET /api/results/:id — artist-only results ──
app.get('/api/results/:id', (req, res) => {
  const { key } = req.query;
  const session = db.prepare('SELECT * FROM test_sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Results not found.' });
  if (session.artist_key !== key) return res.status(403).json({ error: 'Invalid key.' });

  const counts = db.prepare(`
    SELECT hook_index, COUNT(*) as cnt FROM votes WHERE session_id = ? GROUP BY hook_index
  `).all(req.params.id);

  const voteCounts = {};
  counts.forEach(r => { voteCounts[r.hook_index] = r.cnt; });
  const totalVotes = counts.reduce((a, r) => a + r.cnt, 0);
  const hooks = JSON.parse(session.hooks);

  // Find winner
  let winnerIndex = 0;
  let winnerVotes = 0;
  Object.entries(voteCounts).forEach(([idx, cnt]) => {
    if (cnt > winnerVotes) { winnerVotes = cnt; winnerIndex = parseInt(idx); }
  });

  // Build recommendation
  let recommendation = '';
  if (totalVotes === 0) {
    recommendation = 'No votes yet. Share the test link with your audience.';
  } else {
    const pct = Math.round((winnerVotes / totalVotes) * 100);
    const winner = hooks[winnerIndex];
    const label = String.fromCharCode(65 + winnerIndex);
    if (pct >= 60) {
      recommendation = `Hook ${label} is the clear winner at ${pct}% of votes. Lead with "${winner.line}" in your promo content. This is the line your audience will replay.`;
    } else if (pct >= 40) {
      recommendation = `Hook ${label} edges ahead at ${pct}%. The split suggests your track has more than one viral angle — consider testing different hooks on different platforms.`;
    } else {
      recommendation = `Votes are split evenly across all hooks. Your track has multiple strong moments. Try Hook A on TikTok and Hook B on Instagram Reels to let each platform decide.`;
    }
  }

  res.json({
    sessionId: session.id,
    genre: session.genre,
    trackName: session.track_name,
    hooks,
    totalVotes,
    voteCounts,
    winnerIndex: totalVotes > 0 ? winnerIndex : null,
    recommendation,
    expiresAt: session.expires_at,
    isExpired: Date.now() > session.expires_at,
  });
});

// ── Voter fingerprint (privacy-preserving hash) ──
function voterFingerprint(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || 'unknown';
  const ua = req.headers['user-agent'] || '';
  return crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 24);
}

// ── Serve SPA routes ──────────────────────────────
// Test and results pages are served by the frontend SPA
app.get('/test/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../test.html'));
});
app.get('/results/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../results.html'));
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// ── Start ─────────────────────────────────────────
app.listen(port, '0.0.0.0', () => {
  console.log(`SoundPilot v5.0 running on port ${port}`);
});
