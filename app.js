/* ===== SOUNDPILOT — App Logic ===== */
'use strict';

// ── Theme toggle ──────────────────────────────────────────────
(function () {
  const btn = document.querySelector('[data-theme-toggle]');
  const html = document.documentElement;
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  html.setAttribute('data-theme', theme);
  updateToggleIcon(btn, theme);

  btn && btn.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', theme);
    updateToggleIcon(btn, theme);
  });

  function updateToggleIcon(btn, t) {
    if (!btn) return;
    btn.innerHTML = t === 'dark'
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    btn.setAttribute('aria-label', `Switch to ${t === 'dark' ? 'light' : 'dark'} mode`);
  }
})();

// ── State ──────────────────────────────────────────────────────
let audioFile = null;
let audioFeatures = null;

// ── DOM refs ───────────────────────────────────────────────────
const dropzone     = document.getElementById('dropzone');
const audioInput   = document.getElementById('audioInput');
const filePreview  = document.getElementById('filePreview');
const fileName     = document.getElementById('fileName');
const removeFile   = document.getElementById('removeFile');
const waveformCanvas = document.getElementById('waveformCanvas');
const genreSelect  = document.getElementById('genreSelect');
const inspirationsInput = document.getElementById('inspirationsInput');
const apiKeyInput  = document.getElementById('apiKeyInput');
const keyToggle    = document.getElementById('keyToggle');
const generateBtn  = document.getElementById('generateBtn');
const generateLabel = document.getElementById('generateLabel');
const progressWrap = document.getElementById('progressWrap');
const resultsSection = document.getElementById('resultsSection');
const uploadCard   = document.getElementById('uploadCard');
const audioMetrics = document.getElementById('audioMetrics');
const aiOutput     = document.getElementById('aiOutput');
const newAnalysisBtn = document.getElementById('newAnalysisBtn');

// ── File upload ─────────────────────────────────────────────────
dropzone.addEventListener('click', () => audioInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); audioInput.click(); }
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('audio/')) handleFile(f);
});

audioInput.addEventListener('change', () => {
  if (audioInput.files[0]) handleFile(audioInput.files[0]);
});

removeFile.addEventListener('click', () => {
  audioFile = null;
  audioFeatures = null;
  filePreview.classList.add('hidden');
  dropzone.classList.remove('hidden');
  waveformCanvas.classList.add('hidden');
  audioInput.value = '';
  checkReady();
});

function handleFile(f) {
  audioFile = f;
  fileName.textContent = f.name;
  dropzone.classList.add('hidden');
  filePreview.classList.remove('hidden');
  waveformCanvas.classList.remove('hidden');
  checkReady();
  drawWaveform(f);
  extractAudioFeatures(f);
}

// ── Waveform visualizer ─────────────────────────────────────────
function drawWaveform(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = e.target.result;
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const data = audioBuffer.getChannelData(0);
      renderWave(data);
    } catch (err) {
      // fallback: draw random-ish wave
      renderFallbackWave();
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderWave(data) {
  const canvas = waveformCanvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth * window.devicePixelRatio || 600;
  const H = 120;
  canvas.width = W;
  canvas.height = H;

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#a78bfa';

  ctx.clearRect(0, 0, W, H);

  const step = Math.floor(data.length / W);
  const midY = H / 2;
  const amp = midY * 0.85;

  ctx.beginPath();
  ctx.moveTo(0, midY);

  for (let i = 0; i < W; i++) {
    const slice = data.slice(i * step, (i + 1) * step);
    let max = 0;
    for (let j = 0; j < slice.length; j++) {
      if (Math.abs(slice[j]) > max) max = Math.abs(slice[j]);
    }
    const y = midY - max * amp;
    ctx.lineTo(i, y);
  }

  for (let i = W - 1; i >= 0; i--) {
    const slice = data.slice(i * step, (i + 1) * step);
    let max = 0;
    for (let j = 0; j < slice.length; j++) {
      if (Math.abs(slice[j]) > max) max = Math.abs(slice[j]);
    }
    const y = midY + max * amp;
    ctx.lineTo(i, y);
  }

  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, 0, W, 0);
  gradient.addColorStop(0, accent + '60');
  gradient.addColorStop(0.5, accent);
  gradient.addColorStop(1, accent + '60');
  ctx.fillStyle = gradient;
  ctx.fill();
}

function renderFallbackWave() {
  const canvas = waveformCanvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 600;
  const H = canvas.height || 60;
  ctx.clearRect(0, 0, W, H);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#a78bfa';
  const midY = H / 2;
  ctx.beginPath();
  for (let i = 0; i < W; i++) {
    const h = (Math.random() * 0.7 + 0.1) * midY;
    ctx.moveTo(i, midY - h);
    ctx.lineTo(i, midY + h);
  }
  ctx.strokeStyle = accent + '80';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ── Audio feature extraction via Meyda ─────────────────────────
function extractAudioFeatures(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      const buffer = await ctx.decodeAudioData(e.target.result);

      // Get raw PCM data from first channel
      const rawData = buffer.getChannelData(0);
      const sampleRate = buffer.sampleRate;

      // Compute features from chunks
      const frameSize = 512;
      const hopSize = 256;
      const features = [];

      for (let i = 0; i + frameSize < rawData.length; i += hopSize * 20) {
        const frame = Array.from(rawData.slice(i, i + frameSize));
        try {
          const result = Meyda.extract(['rms', 'spectralCentroid', 'spectralRolloff', 'zcr'], frame);
          if (result) features.push(result);
        } catch (e2) { /* skip bad frames */ }
      }

      if (features.length > 0) {
        const avgRms = avg(features.map(f => f.rms || 0));
        const avgSC  = avg(features.map(f => f.spectralCentroid || 0));
        const avgSR  = avg(features.map(f => f.spectralRolloff || 0));
        const avgZCR = avg(features.map(f => f.zcr || 0));

        // Estimate BPM from ZCR (rough heuristic, normalized to reasonable range)
        const bpmEstimate = Math.round(clamp((avgZCR * sampleRate) / (frameSize * 2) * 60, 60, 180));
        const energyLevel = avgRms > 0.2 ? 'High' : avgRms > 0.08 ? 'Medium' : 'Low';
        const brightness  = avgSC > 4000 ? 'Bright' : avgSC > 2000 ? 'Warm' : 'Dark';
        const mood        = classifyMood(avgSC, avgRms, avgZCR);

        audioFeatures = { bpm: bpmEstimate, energy: energyLevel, brightness, mood, duration: Math.round(buffer.duration) };
      } else {
        audioFeatures = { bpm: '—', energy: 'Medium', brightness: 'Warm', mood: 'Melodic', duration: Math.round(buffer.duration) };
      }

      ctx.close();
    } catch (err) {
      audioFeatures = { bpm: '—', energy: 'Medium', brightness: 'Warm', mood: 'Melodic', duration: null };
    }
  };
  reader.readAsArrayBuffer(file);
}

function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }

function classifyMood(sc, rms, zcr) {
  if (rms > 0.2 && zcr > 0.15) return 'Energetic';
  if (sc > 5000 && rms < 0.1)   return 'Melancholic';
  if (sc > 3000)                 return 'Upbeat';
  if (rms < 0.06)                return 'Ambient';
  return 'Melodic';
}

// ── API key toggle ──────────────────────────────────────────────
keyToggle.addEventListener('click', () => {
  const show = apiKeyInput.type === 'password';
  apiKeyInput.type = show ? 'text' : 'password';
  keyToggle.innerHTML = show
    ? `<svg id="eyeIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg id="eyeIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
});

// ── Ready state ─────────────────────────────────────────────────
function checkReady() {
  const hasFile  = !!audioFile;
  const hasGenre = !!genreSelect.value;
  const hasKey   = apiKeyInput.value.trim().startsWith('sk-');
  generateBtn.disabled = !(hasFile && hasGenre && hasKey);
}

genreSelect.addEventListener('change', checkReady);
apiKeyInput.addEventListener('input', checkReady);

// ── Generate ────────────────────────────────────────────────────
generateBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  const genre  = genreSelect.value;
  const insps  = inspirationsInput.value.trim();

  if (!audioFile || !genre || !apiKey) return;

  // Wait a beat for features to extract if still pending
  if (!audioFeatures) {
    await sleep(1200);
  }

  startLoading();

  try {
    // Step 1
    await animateStep('ps1', 900);
    const features = audioFeatures || { bpm: '—', energy: 'Medium', brightness: 'Warm', mood: 'Melodic' };

    // Step 2
    await animateStep('ps2', 1100);

    // Step 3 — call OpenAI
    await setStepActive('ps3');
    const strategy = await callOpenAI(apiKey, genre, insps, features);

    // Step 4
    await animateStep('ps4', 600);

    // Show results
    stopLoading();
    showResults(features, strategy);

  } catch (err) {
    stopLoading();
    showError(err.message || 'Something went wrong. Check your API key and try again.');
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function animateStep(id, duration) {
  setStepActive(id);
  await sleep(duration);
  setStepDone(id);
}

function setStepActive(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('done');
  el.classList.add('active');
  el.querySelector('.ps-icon').innerHTML = '<div class="ps-dot"></div>';
}

function setStepDone(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('active');
  el.classList.add('done');
  el.querySelector('.ps-icon').innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
}

function startLoading() {
  generateBtn.classList.add('loading');
  generateLabel.textContent = 'Analyzing...';
  const icon = generateBtn.querySelector('.generate-icon');
  if (icon) {
    icon.outerHTML = '<div class="spinner"></div>';
  }
  progressWrap.classList.remove('hidden');
  generateBtn.disabled = true;
}

function stopLoading() {
  progressWrap.classList.add('hidden');
  ['ps1','ps2','ps3','ps4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('active','done'); el.querySelector('.ps-icon').innerHTML = el.dataset.origIcon || ''; }
  });
}

// ── OpenAI call ─────────────────────────────────────────────────
async function callOpenAI(apiKey, genre, inspirations, features) {
  const bpmStr   = features.bpm !== '—' ? `${features.bpm} BPM` : 'BPM unknown';
  const inspsStr = inspirations ? `Artist inspirations: ${inspirations}.` : '';

  const prompt = `You are SoundPilot — an expert AI music marketing strategist and A&R consultant working for independent artists. You have deep knowledge of TikTok trends, Spotify growth strategies, and what makes songs go viral in 2025.

An artist has uploaded an unreleased song with the following audio profile:
- Genre: ${genre}
- Tempo: ${bpmStr}
- Energy level: ${features.energy}
- Tonal brightness: ${features.brightness}
- Mood/vibe: ${features.mood}
${inspsStr}

Generate a comprehensive viral pre-release strategy with EXACTLY these four sections. Be specific, actionable, and culturally relevant. Do NOT use generic advice.

---

## 🎧 Song Vibe & Identity

Write 2-3 sentences describing the song's unique identity, emotional core, and the type of listener who will connect with it. Be vivid and specific.

---

## 🎤 Comparable Artists (list exactly 5)

Format as a numbered list. For each, include: Artist name — one sentence on WHY they're comparable (sound, audience, or era).

---

## 📲 TikTok & Content Strategy

Provide:
- **Hook Moment**: Which part of the song to use (e.g., "the 0:12 melodic drop" — infer from the vibe)
- **3 Content Angles**: Specific video formats/styles that fit this song (e.g., POV romantic skits, late night drive aesthetic)
- **Caption Style**: The type of caption/text overlay that works for this vibe
- **Best Posting Time**: Day of week and time window (give a specific recommendation)

---

## 📅 3-Week Release Rollout

Format as Week 1, Week 2, Week 3. For each week give:
- A bold title (e.g., "Week 1 — The Teaser")
- 2-3 specific daily actions (what to post, where, and why)

Be culturally informed, specific to the genre, and inspiring. This artist needs to feel like they have a real label behind them.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 1400
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ── Render results ──────────────────────────────────────────────
function showResults(features, strategyText) {
  // Show audio metrics
  audioMetrics.innerHTML = `
    <div class="metric">
      <span class="metric-value">${features.bpm || '—'}</span>
      <span class="metric-label">BPM</span>
    </div>
    <div class="metric">
      <span class="metric-value">${features.energy}</span>
      <span class="metric-label">Energy</span>
    </div>
    <div class="metric">
      <span class="metric-value">${features.brightness}</span>
      <span class="metric-label">Tone</span>
    </div>
    <div class="metric">
      <span class="metric-value">${features.mood}</span>
      <span class="metric-label">Mood</span>
    </div>
    ${features.duration ? `<div class="metric">
      <span class="metric-value">${features.duration}s</span>
      <span class="metric-label">Duration</span>
    </div>` : ''}
  `;

  // Parse and render AI sections
  aiOutput.innerHTML = '';
  const sections = parseStrategyIntoSections(strategyText);

  sections.forEach(({ title, icon, content }) => {
    const sec = document.createElement('div');
    sec.className = 'ai-section';
    sec.innerHTML = `
      <div class="ai-section-header">
        <div class="ai-section-icon">${icon}</div>
        <span class="ai-section-title">${title}</span>
      </div>
      <div class="ai-section-body">${formatContent(content)}</div>
    `;
    aiOutput.appendChild(sec);
  });

  // Show results, hide upload
  document.querySelector('.upload-section').classList.add('hidden');
  resultsSection.classList.remove('hidden');
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function parseStrategyIntoSections(text) {
  const sections = [];

  // Try to parse by headings
  const sectionMap = [
    { pattern: /song vibe|identity/i, title: 'Song Vibe & Identity', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>` },
    { pattern: /comparable artists/i, title: 'Comparable Artists', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><circle cx="17" cy="7" r="4" opacity=".5"/><path d="M23 21v-2a4 4 0 0 0-3-3.87" opacity=".5"/></svg>` },
    { pattern: /tiktok|content strategy/i, title: 'TikTok & Content Strategy', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>` },
    { pattern: /release rollout|week/i, title: '3-Week Release Rollout', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>` },
  ];

  // Split by markdown headings
  const headingRegex = /^#{1,3}\s+.+$/gm;
  const headings = [...text.matchAll(headingRegex)];

  if (headings.length >= 2) {
    headings.forEach((h, idx) => {
      const start = h.index + h[0].length;
      const end   = headings[idx + 1] ? headings[idx + 1].index : text.length;
      const content = text.slice(start, end).trim();
      const headingText = h[0].replace(/^#+\s*/, '').replace(/[🎧🎤📲📅]/gu, '').trim();

      const matched = sectionMap.find(s => s.pattern.test(headingText));
      sections.push({
        title: matched ? matched.title : headingText,
        icon:  matched ? matched.icon : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
        content
      });
    });
  } else {
    // Fallback: show as one block
    sections.push({
      title: 'Strategy Report',
      icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
      content: text
    });
  }

  return sections;
}

function formatContent(raw) {
  return raw
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul role="list">$&</ul>')
    .replace(/\n{2,}/g, '\n\n');
}

function showError(msg) {
  generateBtn.disabled = false;
  generateLabel.textContent = 'Generate Strategy';
  const spinner = generateBtn.querySelector('.spinner');
  if (spinner) {
    spinner.outerHTML = `<svg class="generate-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
  }

  const errEl = document.createElement('p');
  errEl.style.cssText = `color: var(--color-error, #d163a7); font-size: var(--text-sm); padding: var(--space-4) 0; text-align: center;`;
  errEl.textContent = '⚠ ' + msg;

  const existing = document.getElementById('errorMsg');
  if (existing) existing.remove();
  errEl.id = 'errorMsg';
  generateBtn.parentNode.insertBefore(errEl, generateBtn.nextSibling);
}

// ── New analysis ────────────────────────────────────────────────
newAnalysisBtn.addEventListener('click', () => {
  audioFile = null;
  audioFeatures = null;
  filePreview.classList.add('hidden');
  dropzone.classList.remove('hidden');
  waveformCanvas.classList.add('hidden');
  audioInput.value = '';
  genreSelect.value = '';
  inspirationsInput.value = '';
  generateBtn.disabled = true;
  generateLabel.textContent = 'Generate Strategy';

  const spinner = generateBtn.querySelector('.spinner');
  if (spinner) {
    spinner.outerHTML = `<svg class="generate-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
  }

  resultsSection.classList.add('hidden');
  document.querySelector('.upload-section').classList.remove('hidden');
  document.querySelector('.upload-section').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const errEl = document.getElementById('errorMsg');
  if (errEl) errEl.remove();
});
