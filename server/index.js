require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const multer    = require('multer');
const rateLimit = require('express-rate-limit');
const OpenAI    = require('openai');
const path      = require('path');
const { Readable } = require('stream');

const app  = express();
const port = process.env.PORT || 3001;

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
app.use('/api', apiLimit);

// ── File upload (in memory, 50MB max) ────────────
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

// ── Genre profiles ────────────────────────────────
const GENRE_PROFILES = {
  'Afrobeats': {
    platforms: 'TikTok first — Afrobeats blows up through dance challenges and the For You page, not followers. Instagram Reels second (diaspora community reposts). YouTube Shorts third (longer shelf life).',
    postTime: 'Friday 8pm–midnight EST and Saturday 6–11pm EST. The African diaspora is most active Friday night across North America, UK, and Europe simultaneously.',
    contentStyle: 'Dance is the primary discovery engine. Content that works: a short routine on the hook (even 8 counts), street/lifestyle clips, group reaction videos, diaspora pride moments. Colour grade vibrant and warm. The comment section is part of the strategy — Afrobeats audiences tag friends heavily.',
    audienceNote: 'Core: Nigerian, Ghanaian, Kenyan diaspora in UK, USA, Canada. Secondary: African-American and Latinx audiences discovering the genre. Heavy sharing, tagging, and group viewing behaviour.',
  },
  'Afro-R&B': {
    platforms: 'Instagram Reels first — Afro-R&B thrives on aesthetics and the Instagram visual culture. TikTok second (growing fast but audience skews younger). YouTube for full song streams.',
    postTime: 'Thursday 9pm–midnight EST and Saturday 8–11pm EST. This audience streams late at night — winding down, getting ready to go out, or in a situationship.',
    contentStyle: 'Aesthetics over energy. Content that works: soft lighting, golden hour or candlelight, bedroom settings, outfit fits, subtle movement. Text overlays with a lyric line work extremely well. Avoid hype edits or quick cuts — they kill the mood.',
    audienceNote: 'Core: 20–30 year old Black women and men in UK, USA, Canada. Responds strongly to emotional specificity — lyrics about situationships, late nights, longing.',
  },
  'Amapiano': {
    platforms: 'TikTok first — spreads almost entirely through dance, specifically the log drum groove. Instagram Reels second. YouTube Shorts third.',
    postTime: 'Friday evening and Saturday afternoon EST.',
    contentStyle: 'The log drum is the hook, not the vocals. Content that works: groove-based movement (body isolation and footwork, not choreography), house party clips, golden hour aesthetic, South African fashion. Colour grade warm and bright.',
    audienceNote: 'Growing fast in UK and USA. Early enough that an unknown artist can go viral with the right dance clip.',
  },
  'Hip-Hop/Rap': {
    platforms: 'TikTok first — rap discovery is dominated by 15-second bar clips on FYP. YouTube Shorts second (rap has a strong YouTube-native audience). Instagram Reels third.',
    postTime: 'Tuesday and Thursday 9pm–midnight EST, Saturday 8–11pm EST.',
    contentStyle: 'Content that works: 15-second bar clips (pick the most quotable line, not just the hook), freestyle energy, raw studio footage. Lyrics on screen (karaoke captions) dramatically increase watch time. Over-produced content kills credibility in rap.',
    audienceNote: 'TikTok rap audiences respond to quotability above everything. One memorable bar delivered with conviction can outperform a full campaign.',
  },
  'R&B': {
    platforms: 'Instagram Reels first — R&B is a visual-aesthetic genre. TikTok second (growing through emotional POV content). YouTube for streams.',
    postTime: 'Wednesday 8–11pm EST and Saturday 7–10pm EST.',
    contentStyle: 'Emotional storytelling is the engine. Content that works: POV clips with a specific scenario caption, moody aesthetic clips with lyrics as overlay, performance clips showing vocal range. R&B audiences leave long personal comments — post captions that open a conversation.',
    audienceNote: 'Core: 18–35 Black women and men in USA and UK. This audience streams heavily on Spotify and Apple Music — TikTok performance directly converts to playlist adds.',
  },
  'Drill': {
    platforms: 'YouTube Shorts first — drill has one of the strongest YouTube-native audiences. Street rap blogs and reaction channels multiply reach. TikTok second. Instagram Reels third.',
    postTime: 'Friday and Saturday, 9pm–2am EST.',
    contentStyle: 'Raw and unfiltered. Content that works: studio session clips with the beat playing, no-frills performance footage, lyric videos. Do NOT over-produce drill content — it reads as inauthentic immediately.',
    audienceNote: 'Drill audiences are intensely loyal. Strongest entry point is YouTube — a strong lyric video can get picked up by reaction channels which multiply reach significantly.',
  },
  'Dancehall': {
    platforms: 'TikTok first — spreads through dance challenges almost exclusively. Instagram Reels second. YouTube for full videos and riddim playlists.',
    postTime: 'Friday 7pm–midnight EST and Saturday 6–11pm EST.',
    contentStyle: 'Dance is non-negotiable. Content that works: a simple learnable routine on the hook (8–16 counts max), outdoor/beach/party settings, vibrant colour. The challenge IS the marketing strategy.',
    audienceNote: 'Core: Caribbean diaspora in UK, USA, Canada. Secondary: African-American audience. Songs that get a challenge spread extremely fast.',
  },
  'Pop': {
    platforms: 'TikTok first — pop discovery is almost entirely FYP-driven. Instagram Reels second. YouTube Shorts third.',
    postTime: 'Thursday–Saturday 5–9pm EST.',
    contentStyle: 'The first 2 seconds must grab. Content that works: emotional POV clips, trend-adjacent formats using the song as a sound, transition videos on the instrumental break. Test 2–3 different angles in week one to see what the algorithm responds to.',
    audienceNote: 'Pop has the broadest demographic but most competitive FYP. Generic content disappears instantly — differentiation is critical.',
  },
  'Dance/Electronic': {
    platforms: 'TikTok first for younger audiences, YouTube Shorts second (DJ sets and festival clips perform well), Instagram Reels third.',
    postTime: 'Friday–Saturday 9pm–midnight EST.',
    contentStyle: 'The drop is the content. Content that works: the exact drop moment as a clip, DJ booth footage, festival crowd reaction, visual transitions timed to the beat. If the drop does not work as a short clip, the short-form strategy is harder.',
    audienceNote: 'Electronic audiences also live on SoundCloud and Bandcamp. Short-form is top-of-funnel to drive platform follows.',
  },
  'Alternative': {
    platforms: 'Instagram Reels first (alternative audiences skew older and more Instagram-native), TikTok second (growing fast for indie/alt), YouTube Shorts third.',
    postTime: 'Wednesday and Saturday 7–10pm EST.',
    contentStyle: 'Atmosphere and artistry over trends. Content that works: live performance clips showing musicianship, aesthetic visuals matching the sonic world, studio footage showing creative process. Alternative audiences are allergic to content that feels like marketing.',
    audienceNote: 'Alternative listeners are heavy Spotify users and playlist-seekers. Strong short-form drives playlist pitching leverage — curators check social proof.',
  },
};

// ── Health check ──────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '3.0.0' });
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
      contentStyle: 'Authentic, artist-led content that matches the sonic energy of the track',
      audienceNote: '',
    };

    // ── Step 1: Transcribe with Whisper ────────────
    // Convert buffer to a File-like object for OpenAI SDK
    const audioBuffer = req.file.buffer;
    const ext = req.file.originalname.match(/\.(mp3|wav|m4a|ogg|webm|flac)$/i)?.[1] || 'm4a';
    const mimeType = req.file.mimetype || 'audio/mpeg';

    // Create a File object from the buffer (Node 20+)
    const audioFile = new File([audioBuffer], `track.${ext}`, { type: mimeType });

    let transcript = '';
    let transcriptError = false;
    try {
      const whisperRes = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        response_format: 'verbose_json', // gives us word-level timestamps
        timestamp_granularities: ['segment'],
      });

      transcript = whisperRes.text || '';

      // Find the segment with highest density of repeated phrases (hook indicator)
      // Whisper verbose_json gives segments with start/end times
      if (whisperRes.segments && whisperRes.segments.length > 0) {
        // Score segments: prefer those in the middle of the song, penalise first 10%
        const totalDuration = whisperRes.segments[whisperRes.segments.length - 1].end || 180;
        const scored = whisperRes.segments.map(seg => {
          const pos = seg.start / totalDuration;
          const posFactor = pos > 0.1 && pos < 0.75 ? 1.2 : 0.7;
          // Word density as a proxy for hook density
          const wordCount = (seg.text || '').trim().split(/\s+/).length;
          return { ...seg, score: wordCount * posFactor };
        });
        scored.sort((a, b) => b.score - a.score);
        const hookSeg = scored[0];
        const hookStart = Math.floor(hookSeg.start);
        const hookEnd   = Math.min(Math.floor(hookSeg.end) + 7, Math.floor(totalDuration));
        const fmt = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
        req.hookWindow = `${fmt(hookStart)}–${fmt(hookEnd)}`;
        req.hookLine   = hookSeg.text.trim();
      }
    } catch (whisperErr) {
      console.error('Whisper error:', whisperErr.message);
      transcriptError = true;
      transcript = '';
    }

    // ── Step 2: Build GPT-4o prompt ────────────────
    const hookWindow = req.hookWindow || '~0:30–0:45';
    const hookLine   = req.hookLine   || '(hook not identified)';

    const transcriptSection = transcript
      ? `SONG LYRICS (transcribed by Whisper — this is what the song actually says):
"""
${transcript.slice(0, 3000)}${transcript.length > 3000 ? '\n[...truncated]' : ''}
"""

HOOK MOMENT IDENTIFIED: Around ${hookWindow} — "${hookLine}"
This is the section with the highest lyrical density in the track. Use this specific line in your content strategy.`
      : `NOTE: Audio transcription was not available for this track (instrumental or transcription failed). Base your strategy on the genre, mood, and inspirations provided.`;

    const prompt = `You are SoundPilot — a blunt, culturally sharp music strategist. You work like a top indie A&R: direct, specific, zero filler. You know the difference between Afrobeats and Afro-R&B, between UK drill and NY drill, between what drives streams on TikTok Lagos vs TikTok Toronto.

TRACK PROFILE:
- Genre: ${genre}
- Mood/theme: ${mood || 'not given'}
- Artist inspirations: ${inspirations || 'not given'}

${transcriptSection}

GENRE INTELLIGENCE FOR ${genre.toUpperCase()}:
- Platform strategy: ${gp.platforms}
- Post timing: ${gp.postTime}
- What content actually works: ${gp.contentStyle}
- Audience behaviour: ${gp.audienceNote || 'N/A'}

YOUR JOB: You have the actual lyrics. Use them. Reference specific lines from the transcript in your strategy. The content formats, the hook moment, the comparable artists — all of it should be informed by what the song literally says and the emotions it expresses. Generic advice that could apply to any ${genre} song is a failure.

BANNED PHRASES — do not use: "leverage", "engage with your audience", "build anticipation", "authentic connection", "captivate", "resonate", "share your journey", "connect with fans", "drive engagement", "make sure to".

---

## Song Identity

2–3 sentences. Reference specific lyrical content. Name the exact emotion, the specific listener, and one cultural reference point. Write like a Pitchfork critic, not a hype machine.

---

## Comparable Artists

Exactly 5 artists. Format: **Artist Name** — one sentence on the specific sonic or lyrical reason (quote a relevant lyric if it helps). Prioritise artists whose fanbase would actually stream this.

---

## Content Strategy

**Hook moment (${hookWindow}):** The line "${hookLine}" — explain exactly why this specific lyric works for short-form content and how to use it. What caption does it pair with? What visual?

**3 content formats:** Concrete, specific to ${genre} culture. Describe the shot, the vibe, the caption using the actual lyrics. Not generic.

**Platform ranking:** ${gp.platforms}. Explain why for this specific track.

**Post timing:** ${gp.postTime}. Why this window.

---

## 14-Day Release Rollout

Day 1, Day 3, Day 5, Day 7, Day 10, Day 14. Bold title + 2 specific actions. Zero paid ads. Each day builds. Include one wildcard move most artists skip. Reference the actual lyrics/hook where relevant.

---

Be direct. Be specific. No padding.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 2000,
    });

    const strategy = completion.choices[0].message.content;

    res.json({
      success: true,
      strategy,
      transcript: transcript || null,
      hookWindow,
      hookLine: transcript ? hookLine : null,
      transcriptError,
    });

  } catch (err) {
    console.error('Analyze error:', err.message);
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Max 50MB.' });
    if (err.status === 429) return res.status(429).json({ error: 'OpenAI rate limit hit. Try again in a moment.' });
    if (err.status === 401) return res.status(500).json({ error: 'Server configuration error.' });
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── Serve frontend ────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// ── Start ─────────────────────────────────────────
app.listen(port, '0.0.0.0', () => {
  console.log(`SoundPilot server running on port ${port}`);
});
