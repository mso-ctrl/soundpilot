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
  'Afrobeats': {
    platforms: 'TikTok first — Afrobeats blows up through dance challenges and the For You page algorithm, not through followers. Instagram Reels second (diaspora community reposts). YouTube Shorts third (longer shelf life but slower ignition).',
    postTime: 'Friday 8pm–midnight EST and Saturday 6pm–11pm EST. The African diaspora is most active Friday night across North America, UK, and Europe simultaneously — this is when Afrobeats content spreads fastest.',
    contentStyle: 'Dance is the primary discovery engine for Afrobeats. Content that works: a short dance routine on the hook (even just 8 counts), street/lifestyle clips showing the culture, group reaction videos, and diaspora pride moments. Colour grading should be vibrant — warm, saturated, not moody. Avoid sitting-down or talking-to-camera content unless it is extremely charismatic. The comment section is part of the strategy: Afrobeats audiences tag friends heavily, so post with a caption that invites tagging.',
    bpmNote: 'Afrobeats typically runs 95–115 BPM. The percussion pattern (dembow-adjacent kick/snare) is what audiences lock on to for dance — flag if BPM deviates.',
    audienceNote: 'Core audience: Nigerian, Ghanaian, Kenyan diaspora in UK, USA, Canada. Secondary: broader African-American and Latinx audiences discovering the genre. Platform behaviour: heavy sharing, tagging, and group viewing.',
  },
  'Afro-R&B': {
    platforms: 'Instagram Reels first — Afro-R&B thrives on aesthetics and the Instagram visual culture is where this audience lives. TikTok second (growing fast but audience skews slightly younger than the core Afro-R&B listener). YouTube for full song streams and long-form.',
    postTime: 'Thursday 9pm–midnight EST and Saturday 8pm–11pm EST. Afro-R&B listeners are late-night streamers — they put this on when they are winding down, getting ready to go out, or in a situationship.',
    contentStyle: 'Aesthetics over energy. Content that works: soft lighting, golden hour or candlelight, bedroom/apartment settings, outfit fits, subtle swaying — not full dancing. Text overlays with a line from the song work extremely well for this genre. The artist does NOT need to be in every clip — a cinematic empty-room shot with the vocals playing converts well. Avoid hype edits, quick cuts, or trend formats designed for Afrobeats — they kill the mood.',
    audienceNote: 'Core audience: 20–30 year old Black women and men in UK, USA, Canada. This audience responds strongly to emotional specificity — lyrics about situationships, late nights, longing perform best.',
  },
  'Amapiano': {
    platforms: 'TikTok first — Amapiano spreads almost entirely through dance on TikTok, specifically the log drum groove. Instagram Reels second (South African diaspora is strong here). YouTube Shorts third.',
    postTime: 'Friday evening and Saturday afternoon EST — when South African diaspora and African-American audiences are most active.',
    contentStyle: 'The log drum is the hook, not the vocals. Content that works: groove-based movement (not choreographed dance, more body isolation and footwork), house party clips, sunset/golden hour aesthetic, South African fashion and lifestyle. The yano shuffle and other dance styles from SA spread fast on TikTok. Colour grade warm and bright. Avoid moody or dark visuals — Amapiano is about elevation and celebration.',
    audienceNote: 'Growing fast in UK and USA. Core: South African diaspora + African-American listeners discovering through TikTok. The genre is still early enough that an unknown artist can go viral with the right dance clip.',
  },
  'Hip-Hop/Rap': {
    platforms: 'TikTok first — rap discovery is now dominated by 15-second bar clips and beat previews on FYP. YouTube Shorts second (rap has a strong YouTube-native audience who watch reaction videos and cyphers). Instagram Reels third.',
    postTime: 'Tuesday and Thursday 9pm–midnight EST, Saturday 8pm–11pm EST. Avoid Sunday morning — rap audiences are not active then.',
    contentStyle: 'Content that works: 15-second bar-focused clips (pick the most quotable line, not just the hook), freestyle energy clips, studio session footage that feels raw and unscripted, beat reaction videos. The artist should look like they belong — over-produced or polished content kills credibility in rap. Lyrics on screen (karaoke-style captions) dramatically increase watch time for rap content.',
    audienceNote: 'TikTok rap audiences respond to quotability above all else. One memorable bar, delivered with conviction, can do more than a full promotional campaign.',
  },
  'R&B': {
    platforms: 'Instagram Reels first — R&B is a visual-aesthetic genre and Instagram is still the dominant platform for this. TikTok second (R&B is growing on TikTok through emotional POV content). YouTube for streams.',
    postTime: 'Wednesday 8–11pm EST and Saturday 7–10pm EST.',
    contentStyle: 'Emotional storytelling is the engine. Content that works: POV clips with a caption that sets a specific scenario (e.g. "when they say they miss you but..."), moody aesthetic clips with lyrics as text overlay, artist performance clips that show vocal range, candlelit or softly lit visuals. The comment section is key — R&B audiences leave long comments about their personal situations. Post with a caption that opens a conversation.',
    audienceNote: 'Core audience: 18–35 Black women and men in USA and UK. This audience streams heavily on Spotify and Apple Music — good TikTok performance directly converts to playlist adds.',
  },
  'Drill': {
    platforms: 'YouTube Shorts first — drill has one of the strongest YouTube-native audiences of any genre. Street rap blogs and reaction channels extend reach significantly. TikTok second. Instagram Reels third.',
    postTime: 'Friday and Saturday, 9pm–2am EST.',
    contentStyle: 'Raw and unfiltered. Content that works: studio session clips with the beat playing, no-frills performance footage, lyric videos for YouTube, cyphers and freestyles. Do NOT over-produce drill content — it reads as inauthentic immediately. The artist should look comfortable and in their element, not like they are performing for a camera. Keep colour grading minimal — desaturated or natural works better than heavily filtered.',
    audienceNote: 'Drill audiences are intensely loyal but hard to crack from the outside. The strongest entry point is YouTube — a strong lyric video or studio clip can get picked up by reaction channels which multiply reach significantly.',
  },
  'Dancehall': {
    platforms: 'TikTok first — Dancehall spreads through dance challenges almost exclusively on short-form. Instagram Reels second. YouTube for full videos and riddim playlists.',
    postTime: 'Friday 7pm–midnight EST and Saturday 6pm–11pm EST.',
    contentStyle: 'Dance is non-negotiable for Dancehall — if there is no dance, there is no short-form strategy. Content that works: a simple, learnable dance routine on the hook (8–16 counts max), outdoor/beach/party settings, Caribbean fashion and lifestyle, vibrant colour grading. Dancehall riddim culture means the song needs to stand out on a riddim before it can spread — if it is a one-drop, the vocal performance needs to be the hook.',
    audienceNote: 'Core: Caribbean diaspora in UK, USA, Canada. Secondary: African-American audience. Dancehall songs that get a challenge spread extremely fast — the challenge IS the marketing strategy.',
  },
  'Pop': {
    platforms: 'TikTok first — pop discovery is almost entirely For You Page driven in 2025. Instagram Reels second. YouTube Shorts third.',
    postTime: 'Thursday–Saturday 5–9pm EST.',
    contentStyle: 'Hook-driven content — the first 2 seconds must grab. Content that works: emotional POV clips, trend-adjacent formats that use the song as a sound, transition videos on the instrumental break, comedic or relatable scenarios. Pop has the widest acceptable content range — almost any format works if the hook is strong enough. Test 2–3 different content angles in the first week to see what the algorithm responds to.',
    audienceNote: 'Pop has the broadest demographic but the most competitive For You Page. Differentiation is critical — generic pop content disappears instantly.',
  },
  'Dance/Electronic': {
    platforms: 'TikTok first for younger electronic audiences, YouTube Shorts second (DJ sets and festival clips perform well), Instagram Reels third.',
    postTime: 'Friday–Saturday 9pm–midnight EST.',
    contentStyle: 'Build and drop moments are the content. Content that works: the exact drop moment as a clip (3–5 seconds of the drop looped or cut), DJ booth footage, festival crowd reaction clips, visual transition videos timed to the beat. Electronic music lives on the energy of the drop — if the drop does not work as a short clip, the short-form strategy is harder.',
    audienceNote: 'Electronic audiences are platform-diverse — they also live on SoundCloud, Bandcamp, and festival culture. Short-form is a top-of-funnel play to drive SoundCloud/Spotify follows.',
  },
  'Alternative': {
    platforms: 'Instagram Reels first (alternative audiences skew older and more Instagram-native), TikTok second (growing fast for indie/alt), YouTube Shorts third.',
    postTime: 'Wednesday and Saturday 7–10pm EST.',
    contentStyle: 'Atmosphere and artistry over trends. Content that works: live performance clips that show musicianship, aesthetic visual clips that match the sonic world of the song, studio footage showing the creative process, lyrics-first content for lyrically dense tracks. Alternative audiences reward authenticity and depth — they are allergic to content that feels like marketing.',
    audienceNote: 'Alternative listeners are heavy Spotify users and playlist-seekers. A strong short-form presence drives playlist pitching leverage — curators check social proof.',
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

    // ── Track-level differentiators ─────────────────────
    // These push the advice beyond the genre default based on actual audio data
    const bpm = features.bpm || 0;
    const energy = features.energy || 'Medium';
    const tone = features.tone || 'Warm';
    const detectedMood = features.mood || 'Melodic';

    // BPM context: flag unusual tempos for genre
    const genreBpmRanges = {
      'Afrobeats': [90, 115], 'Afro-R&B': [65, 95], 'Hip-Hop/Rap': [75, 100],
      'R&B': [60, 95], 'Drill': [130, 160], 'Pop': [95, 135],
      'Dance/Electronic': [120, 145], 'Reggaeton': [90, 105], 'Soul/Gospel': [60, 90],
    };
    const bpmRange = genreBpmRanges[genre];
    const bpmNote = bpmRange && bpm > 0
      ? (bpm < bpmRange[0]
          ? 'TEMPO NOTE: This track is slower than the typical ' + genre + ' range (' + bpmRange[0] + '-' + bpmRange[1] + ' BPM). Flag this in your strategy — slower tempo changes which content formats work and may suit a more cinematic, scrolling aesthetic over fast cuts.'
          : bpm > bpmRange[1]
          ? 'TEMPO NOTE: This track is faster than the typical ' + genre + ' range (' + bpmRange[0] + '-' + bpmRange[1] + ' BPM). Flag this — the faster energy could be used for quick-cut edits or trending audio swap formats.'
          : 'Tempo sits comfortably within the typical ' + genre + ' range.')
      : '';

    // Energy + tone modifiers — change content direction within same genre
    const energyNote = energy === 'High'
      ? 'HIGH ENERGY track — content should match: fast cuts, movement, physical reactions. Avoid slow/moody aesthetics.'
      : energy === 'Low'
      ? 'LOW ENERGY track — this needs a stillness-forward approach: single-shot clips, long holds, minimal movement. Trending audio swaps won\'t work here.'
      : 'MID ENERGY — flexible. Test both movement-led and static aesthetic content to see what clicks.';

    const toneNote = tone === 'Bright'
      ? 'Bright/sharp tone — visually, think daylight, clean aesthetics, high contrast. Avoid dark moody filters.'
      : tone === 'Dark'
      ? 'Dark tone — visually, think low light, night settings, muted colour grading. Fits late-night TikTok scroll behaviour.'
      : 'Warm tone — golden hour aesthetics, intimate settings work well. Mid-range visual palette.';

    const moodNote = detectedMood === 'Energetic'
      ? 'Energetic mood — prioritise content that puts the energy on screen. Viewer should feel it in 2 seconds.'
      : detectedMood === 'Melancholic'
      ? 'Melancholic mood — this is a storytelling track. POV captions, text overlays, and emotional comment-bait angles will perform better than dance/trend formats.'
      : 'Melodic mood — balance between vibe and narrative. Works for both aesthetic and story-driven content.';

    const inspirationNote = (inspirations && inspirations.trim())
      ? 'Artist cites ' + inspirations + ' as inspirations — factor their fanbase culture, visual aesthetic, and the platforms where those artists\'s audiences are most active into your content recommendations.'
      : '';

    const prompt = `You are SoundPilot — a blunt, culturally sharp music strategist. You work like a top indie A&R consultant: direct, specific, zero filler. You know the difference between Afrobeats and Afro-R&B, between drill and trap, between what drives streams on TikTok Lagos vs TikTok Toronto.

TRACK PROFILE:
- Genre: ${genre}
- Mood/theme: ${mood || 'not given'}
- Artist inspirations: ${inspirations || 'not given'}
- Tempo: ${bpmStr}
- Energy: ${energy}
- Tone: ${tone}
- Detected mood: ${detectedMood}
- Hook window: ${hookStr} | Hook Strength: ${features.hookStrength || '6.5'}/10 — ${hookVerdict}

AUDIO ANALYSIS FLAGS (use these to make this strategy different from every other ${genre} song):
- ${energyNote}
- ${toneNote}
- ${moodNote}
- ${bpmNote}
- ${inspirationNote}

GENRE INTELLIGENCE FOR ${genre.toUpperCase()}:
Platform strategy: ${gp.platforms}
Post timing: ${gp.postTime}
What content actually works for this genre: ${gp.contentStyle}
${gp.audienceNote ? 'Audience behaviour: ' + gp.audienceNote : ''}

YOUR JOB: Use the AUDIO ANALYSIS FLAGS and the genre intelligence together to write a strategy specific to THIS track. Two ${genre} songs with different energy, tempo, tone, or mood must get meaningfully different content advice — the genre intelligence is the foundation, the audio flags are the differentiators. If a flag contradicts the genre baseline, follow the flag. Be direct about weaknesses — do not soften them.

BANNED PHRASES — do not use: "leverage", "engage with your audience", "build anticipation", "authentic connection", "captivate", "resonate", "share your journey", "connect with fans", "drive engagement", "behind the scenes content", "make sure to".

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
