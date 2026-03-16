require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const multer    = require('multer');
const rateLimit = require('express-rate-limit');
const OpenAI    = require('openai');
const path      = require('path');

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

// ── File upload (50MB max) ────────────────────────
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

// ── Genre intelligence ────────────────────────────
// Each profile has platform strategy, timing, content style, and audience behaviour
// This is injected into the prompt as grounded knowledge
const GENRE_PROFILES = {
  'Afrobeats': {
    platforms: 'TikTok first — Afrobeats discovery happens through dance challenges and the FYP algorithm, not follower count. The For You page in UK, Canada, and Nigeria all amplify Afrobeats simultaneously when a clip gets traction. Instagram Reels second — diaspora reposts are where it spreads to older demographics. YouTube Shorts third — slower ignition but longer shelf life.',
    postTime: 'Friday 8pm–midnight EST / 1am–5am WAT. Saturday 6–11pm EST. This window hits UK evening, North American evening, and West African late-night simultaneously — the three biggest Afrobeats markets.',
    contentStyle: 'Dance is the discovery engine, not promotion. A clip of someone doing 8 counts on the hook will outperform any promotional post. Content that converts: choreography on the hook (even amateur), street/lifestyle clips with the song playing, group reaction videos, diaspora pride moments. Colour grade: warm, vibrant, saturated — not moody or desaturated. Captions should invite tagging (e.g. "send this to your friend that needs to hear this"). Comment section strategy matters — respond to early comments to boost algorithm.',
    audienceNote: 'Core: Nigerian, Ghanaian, Kenyan diaspora aged 16–35 in UK (London especially), USA (Atlanta, Houston, NYC), Canada (Toronto). Secondary: African-American and Latinx audiences discovering the genre through TikTok. Audience behaviour: extremely high sharing rate, group listening culture, heavy tagging of friends.',
    contentDont: 'Sitting-down talking-to-camera content. Over-produced/polished marketing visuals. English-only captions when the song has Pidgin or Yoruba — code-switch with your audience.',
  },
  'Afro-R&B': {
    platforms: 'Instagram Reels first — Afro-R&B is a visual-aesthetic genre and the Instagram audience is where the core listener lives. The algorithm rewards saves and shares over likes for this genre. TikTok second — growing fast through emotional POV content and "playlist" culture. YouTube for full song streams, not clips.',
    postTime: 'Thursday 9pm–midnight EST. Saturday 8–11pm EST. This audience streams late at night — winding down, getting ready to go out, in a long-distance situationship. Midweek posts build momentum before the weekend release.',
    contentStyle: 'Aesthetics over energy — the visual should feel like the sonic world of the song. Content that converts: soft lighting (golden hour or candlelight), bedroom/apartment settings, subtle movement not full dancing, text overlays with a specific lyric line, outfit fits. A cinematic empty-room shot with the vocals playing can outperform an artist performance clip. Avoid hype edits and fast cuts — they break the mood this genre depends on.',
    audienceNote: 'Core: Black women and men aged 20–32 in UK, USA, Canada. This audience responds to emotional specificity — lyrics about situationships, late nights, longing, and the in-between perform best. They share when a lyric captures something they cannot say themselves.',
    contentDont: 'Fast cuts. Bright/energetic colour grading. Dance challenge formats — wrong genre energy.',
  },
  'Amapiano': {
    platforms: 'TikTok first — Amapiano spreads almost entirely through the log drum groove and dance. The yano shuffle and related styles spread fast on FYP. Instagram Reels second — South African diaspora is highly active here. YouTube for full DJ sets and mixes.',
    postTime: 'Friday evening and Saturday afternoon EST. South African diaspora most active Friday night.',
    contentStyle: 'The log drum is the hook, not the vocals. Content that works: groove-based movement (body isolation and footwork, not formal choreography), house party clips, golden hour and sunset aesthetic, South African fashion and lifestyle. Colour grade warm and bright. The culture of elevation and celebration should come through visually.',
    audienceNote: 'Still early in mainstream adoption in UK and USA — an unknown artist can genuinely go viral with the right clip. Core: South African diaspora + African-American listeners discovering through TikTok.',
    contentDont: 'Moody or dark visuals. Treating it like Afrobeats — different energy, different audience behaviour.',
  },
  'Hip-Hop/Rap': {
    platforms: 'TikTok first — rap discovery is now dominated by 15-second bar clips on FYP. A single quotable bar can blow up a track before it releases. YouTube Shorts second — rap has the strongest YouTube-native audience of any genre, and reaction channels multiply reach. Instagram Reels third.',
    postTime: 'Tuesday and Thursday 9pm–midnight EST. Saturday 8–11pm EST. Avoid Sunday morning — this audience is not active then.',
    contentStyle: 'Bars first, aesthetics second. Content that converts: 15-second clip of the most quotable line (not the hook — the most quotable line), freestyle energy in a studio or car, raw unscripted footage. Karaoke-style lyrics on screen dramatically increase watch time and shares. The artist should look like they belong — over-produced content kills credibility.',
    audienceNote: 'TikTok rap audiences respond to quotability above all else. One bar delivered with conviction can do more than a full promo campaign. Comment section is critical — rap audiences debate lyrics.',
    contentDont: 'Over-produced visuals. Talking about the song instead of performing it. Posting without captions — rap needs text.',
  },
  'R&B': {
    platforms: 'Instagram Reels first — R&B is a visual-aesthetic genre, Instagram is still dominant. Algorithm rewards saves and shares. TikTok second — growing through emotional POV content. YouTube for streams and music video.',
    postTime: 'Wednesday 8–11pm EST and Saturday 7–10pm EST.',
    contentStyle: 'Emotional storytelling. Content that converts: POV clips with a specific scenario in the caption (the more specific the better — "when they text you after 3 months"), moody aesthetic clips with lyrics as overlay, performance clips showing vocal range. R&B audiences leave long personal comments — captions that open a conversation outperform promotional captions.',
    audienceNote: 'Core: Black women and men aged 18–35 in USA and UK. This audience streams heavily on Spotify and Apple Music — TikTok traction directly converts to playlist adds. Saves rate is the key metric to watch.',
    contentDont: 'Fast cuts. Dance formats. Generic promotional language.',
  },
  'Drill': {
    platforms: 'YouTube Shorts first — drill has one of the strongest YouTube-native audiences. Street rap blogs and reaction channels (No Jumper, DJ Akademiks clips) multiply reach dramatically. TikTok second. Instagram Reels third.',
    postTime: 'Friday and Saturday 9pm–2am EST.',
    contentStyle: 'Raw and unfiltered. Content that converts: studio session clips with the beat playing, no-frills performance footage, lyric videos on YouTube. Do NOT over-produce drill content — it reads as inauthentic immediately. The artist should look comfortable and in their element. Desaturated or natural colour grade works better than heavily filtered.',
    audienceNote: 'Drill audiences are intensely loyal but hard to crack from the outside. Strongest entry point is YouTube — a good lyric video can get picked up by reaction channels and multiply reach 10x.',
    contentDont: 'Polished/glossy visuals. Dance content. Anything that looks like mainstream pop marketing.',
  },
  'Dancehall': {
    platforms: 'TikTok first — spreads through dance challenges almost exclusively. Instagram Reels second. YouTube for full videos and riddim playlists.',
    postTime: 'Friday 7pm–midnight EST and Saturday 6–11pm EST.',
    contentStyle: 'Dance is non-negotiable. A simple learnable routine on the hook (8–16 counts max) is the entire short-form strategy. Outdoor, beach, and party settings. Vibrant Caribbean colour grading. The challenge IS the marketing strategy — if there is no dance, short-form does not work for this genre.',
    audienceNote: 'Core: Caribbean diaspora in UK, USA, Canada. Secondary: African-American audience. Songs that get a challenge spread extremely fast — the challenge multiplies reach.',
    contentDont: 'Static or moody content. Content without movement.',
  },
  'Pop': {
    platforms: 'TikTok first — pop discovery is almost entirely FYP-driven in 2025-2026. Instagram Reels second. YouTube Shorts third.',
    postTime: 'Thursday–Saturday 5–9pm EST.',
    contentStyle: 'The first 2 seconds must grab — stop the scroll. Content that converts: emotional POV clips with a specific relatable scenario, trend-adjacent formats that use the song as a sound, transition videos on the instrumental break, comedic angles. Test 2–3 different content formats in week one — the algorithm will tell you which one to double down on.',
    audienceNote: 'Pop has the broadest demographic but the most competitive FYP. Generic content disappears immediately. Differentiation through emotional specificity or visual novelty is critical.',
    contentDont: 'Generic promotional content. Anything that looks like an ad.',
  },
  'Dance/Electronic': {
    platforms: 'TikTok first for younger audiences (18–24), YouTube Shorts second (DJ sets and festival clips perform well with older fans), Instagram Reels third.',
    postTime: 'Friday–Saturday 9pm–midnight EST.',
    contentStyle: 'The drop is the content. Content that converts: the exact drop moment as a clip (3–5 seconds), DJ booth footage, festival crowd reaction, visual transition videos timed to the beat drop. If the drop does not work as a standalone 5-second clip, the short-form strategy needs to be reconsidered.',
    audienceNote: 'Electronic audiences also live on SoundCloud and Bandcamp. Short-form is top-of-funnel — goal is SoundCloud/Spotify follows and festival discovery.',
    contentDont: 'Content without the drop. Slow-building ambient clips that do not hit.',
  },
  'Alternative': {
    platforms: 'Instagram Reels first (alternative audiences skew 22–35 and more Instagram-native), TikTok second (growing fast for indie/alt through aesthetic content), YouTube Shorts third.',
    postTime: 'Wednesday and Saturday 7–10pm EST.',
    contentStyle: 'Atmosphere and artistry over trend-chasing. Content that converts: live performance clips showing musicianship, aesthetic visuals that match the sonic world, studio footage showing creative process, lyrics-first content for lyrically dense tracks. Alternative audiences are allergic to content that feels like marketing — authenticity is the strategy.',
    audienceNote: 'Alternative listeners are heavy Spotify users and playlist-seekers. Strong short-form drives playlist pitching leverage — curators check social proof before adding unknown artists.',
    contentDont: 'Dance formats. Trend-chasing. Anything that looks like mainstream pop marketing.',
  },
};

// ── Health check ──────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '3.1.0' });
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
      contentDont: '',
    };

    // ── Step 1: Transcribe with Whisper ──────────
    const ext = req.file.originalname.match(/\.(mp3|wav|m4a|ogg|webm|flac)$/i)?.[1] || 'm4a';
    const audioFile = new File([req.file.buffer], `track.${ext}`, { type: req.file.mimetype || 'audio/mpeg' });

    let transcript = '';
    let detectedLanguage = 'english';
    let hookWindow = '~0:30–0:45';
    let hookLine = null;
    let transcriptError = false;

    try {
      const whisperRes = await openai.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      });

      transcript = whisperRes.text || '';
      // Preserve original language — don't translate Pidgin, Yoruba, Patois, etc.
      detectedLanguage = whisperRes.language || 'english';

      // Find hook: highest word-density segment in the middle 60% of the song
      if (whisperRes.segments && whisperRes.segments.length > 0) {
        const totalDuration = whisperRes.segments[whisperRes.segments.length - 1].end || 180;
        const scored = whisperRes.segments.map(seg => {
          const pos = seg.start / totalDuration;
          // Prefer segments between 15% and 75% of the song (skip intros and outros)
          const posFactor = pos > 0.15 && pos < 0.75 ? 1.3 : 0.6;
          const wordCount = (seg.text || '').trim().split(/\s+/).length;
          // Also favour repeated phrases (hook indicator) — check if line appears elsewhere
          const lineText = seg.text.trim().toLowerCase();
          const repetitions = whisperRes.segments.filter(s =>
            s !== seg && s.text.trim().toLowerCase().includes(lineText.slice(0, 20))
          ).length;
          return { ...seg, score: (wordCount + repetitions * 3) * posFactor };
        });
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        const hookStart = Math.floor(best.start);
        const hookEnd   = Math.min(Math.floor(best.end) + 7, Math.floor(totalDuration));
        const fmt = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
        hookWindow = `${fmt(hookStart)}–${fmt(hookEnd)}`;
        // Keep the lyric in its original language — don't translate
        hookLine = best.text.trim();
      }
    } catch (whisperErr) {
      console.error('Whisper error:', whisperErr.message);
      transcriptError = true;
    }

    // ── Step 2: GPT-4o strategy ───────────────────
    const isEnglishOnly = ['english', 'en'].includes(detectedLanguage.toLowerCase());
    const languageNote = !isEnglishOnly
      ? `LANGUAGE NOTE: Whisper detected this track is in "${detectedLanguage}" or contains non-English lyrics (Pidgin, Yoruba, Patois, French, etc.). Do NOT translate the lyrics or the hook line — preserve and quote them exactly as transcribed. Your strategy should acknowledge the language as a cultural asset and advise on how to use it (e.g. code-switching in captions, diaspora audience targeting).`
      : '';

    const transcriptSection = transcript
      ? `ACTUAL LYRICS (transcribed verbatim by Whisper — do not translate, quote exactly):
"""
${transcript.slice(0, 3500)}${transcript.length > 3500 ? '\n[...continues]' : ''}
"""

DETECTED HOOK MOMENT: ${hookWindow} — "${hookLine}"
This line was identified by repetition and position analysis. Use this exact lyric (in its original language) in your content strategy.

${languageNote}`
      : `NOTE: This appears to be an instrumental track, or transcription was not available. Base your strategy on genre, mood, and artist inspirations only.`;

    const prompt = `You are SoundPilot — a blunt, culturally fluent music strategist with deep knowledge of how independent artists break through in 2025-2026. You understand Afrobeats, Afro-R&B, UK Drill, Nigerian Pidgin, Patois, and diaspora music culture. You work like a senior A&R consultant — direct, specific, no filler, no generic advice.

You have access to the actual lyrics of this unreleased track. Your entire strategy must be grounded in what the song literally says. Generic advice that could apply to any ${genre} song is a failure.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRACK PROFILE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Genre: ${genre}
Mood/theme: ${mood || 'not specified'}
Artist inspirations: ${inspirations || 'not specified'}

${transcriptSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GENRE INTELLIGENCE: ${genre.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Platform strategy: ${gp.platforms}

Post timing: ${gp.postTime}

What content actually converts for this genre: ${gp.contentStyle}

Audience behaviour: ${gp.audienceNote || 'N/A'}

What NOT to do: ${gp.contentDont || 'N/A'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BANNED PHRASES (instant failure if used): "leverage", "engage with your audience", "build anticipation", "authentic connection", "captivate", "resonate", "share your journey", "connect with fans", "drive engagement", "make sure to", "don't forget to"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

---

## Song Identity

2–3 sentences. Reference the specific lyrics. Name the exact emotion, the specific listener this speaks to, and one cultural reference point. Write like a music critic. If the song is in Pidgin or another language, acknowledge it and explain why that is a cultural strength, not a limitation.

---

## Comparable Artists

Exactly 5 artists. Format: **Artist Name** — one sentence on the specific sonic or lyrical connection (quote a lyric if relevant). Prioritise artists whose fanbase would actually stream this track based on the lyrics you read.

---

## Content Strategy

**Hook moment (${hookWindow}):** Quote the line "${hookLine || 'identified hook'}" and explain exactly why this specific line/moment works for short-form. What caption does it pair with? What visual? Be specific about the shot.

**3 content formats:** Concrete, visual, specific to ${genre} culture. Describe the shot, the vibe, the caption — use the actual lyrics in the caption examples. Not generic.

**Platform ranking with reasoning:** ${gp.platforms}

**Post timing:** ${gp.postTime} — explain why for this specific track.

**What NOT to do:** Based on the genre intelligence above, name 2 specific mistakes this artist should avoid.

---

## 14-Day Release Rollout

Day 1, Day 3, Day 5, Day 7, Day 10, Day 14. Bold title + 2 specific actions per day. Zero paid ads. Each day builds on the last. Reference the actual hook/lyrics in the content actions. Include one wildcard move that most independent artists skip.

---

Be direct. Be specific. Quote the lyrics. No padding.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.75,
      max_tokens: 2200,
    });

    res.json({
      success: true,
      strategy: completion.choices[0].message.content,
      transcript: transcript || null,
      hookWindow,
      hookLine: transcript ? hookLine : null,
      detectedLanguage,
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
