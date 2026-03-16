/* =====================================================
   SOUNDPILOT v2 — App Logic
   ===================================================== */
'use strict';

// ── Theme ──────────────────────────────────────────
(function () {
  const btn = document.querySelector('[data-theme-toggle]');
  const html = document.documentElement;
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  html.setAttribute('data-theme', theme);
  setIcon(theme);

  btn && btn.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', theme);
    setIcon(theme);
  });

  function setIcon(t) {
    if (!btn) return;
    btn.innerHTML = t === 'dark'
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  }
})();

// ── Hero demo wave ─────────────────────────────────
(function () {
  const c = document.getElementById('heroWave');
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = 500, H = 48;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const style = getComputedStyle(document.documentElement);
    const accent = style.getPropertyValue('--accent').trim() || '#a78bfa';
    const border = style.getPropertyValue('--border2').trim() || 'rgba(255,255,255,0.12)';

    // Background bars
    for (let i = 0; i < W; i += 3) {
      const h = (Math.sin(i * 0.05) * 0.3 + Math.random() * 0.5 + 0.2) * (H / 2);
      ctx.fillStyle = border;
      ctx.fillRect(i, H/2 - h, 2, h * 2);
    }

    // Hook region (highlighted)
    const hStart = Math.floor(W * 0.28);
    const hEnd   = Math.floor(W * 0.50);
    for (let i = hStart; i < hEnd; i += 3) {
      const h = (Math.sin(i * 0.05) * 0.3 + Math.sin(i * 0.12) * 0.2 + 0.6) * (H / 2);
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(i, H/2 - h, 2, h * 2);
      ctx.globalAlpha = 1;
    }
  }

  draw();
  document.querySelector('[data-theme-toggle]') &&
    document.querySelector('[data-theme-toggle]').addEventListener('click', () => setTimeout(draw, 50));
})();

// ── Config ────────────────────────────────────────
// In production this points to your Railway server.
// In local dev, change to 'http://localhost:3001'
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001'
  : 'https://soundpilot-production.up.railway.app';

// ── State ──────────────────────────────────────────
let audioFile = null;
let audioFeatures = null;

// ── DOM ────────────────────────────────────────────
const dropzone  = document.getElementById('dropzone');
const audioInput = document.getElementById('audioInput');
const fileRow   = document.getElementById('fileRow');
const fileNameEl = document.getElementById('fileNameEl');
const removeBtn = document.getElementById('removeBtn');
const waveCanvas = document.getElementById('waveCanvas');
const genreEl   = document.getElementById('genreEl');
const moodEl    = document.getElementById('moodEl');
const inspsEl   = document.getElementById('inspsEl');
const genBtn    = document.getElementById('genBtn');
const genLabel  = document.getElementById('genLabel');
const genArrow  = document.getElementById('genArrow');
const progWrap  = document.getElementById('progWrap');
const errMsg    = document.getElementById('errMsg');
const resultsSection = document.getElementById('resultsSection');
const hfrMetrics = document.getElementById('hfrMetrics');
const resSections = document.getElementById('resSections');
const scMetrics  = document.getElementById('scMetrics');
const resetBtn   = document.getElementById('resetBtn');
const appSection = document.getElementById('app');

// ── Upload ─────────────────────────────────────────
dropzone.addEventListener('click', () => audioInput.click());
dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); audioInput.click(); } });
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault(); dropzone.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('audio/')) handleFile(f);
});
audioInput.addEventListener('change', () => { if (audioInput.files[0]) handleFile(audioInput.files[0]); });

removeBtn.addEventListener('click', () => {
  audioFile = null; audioFeatures = null;
  fileRow.classList.add('hidden');
  dropzone.classList.remove('hidden');
  waveCanvas.classList.add('hidden');
  audioInput.value = '';
  checkReady();
});

function handleFile(f) {
  audioFile = f;
  fileNameEl.textContent = f.name;
  dropzone.classList.add('hidden');
  fileRow.classList.remove('hidden');
  waveCanvas.classList.remove('hidden');
  checkReady();
  drawWave(f);
  extractFeatures(f);
}

// ── Waveform ───────────────────────────────────────
function drawWave(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const buf = await ac.decodeAudioData(e.target.result);
      renderWave(buf.getChannelData(0));
      ac.close();
    } catch { renderFallback(); }
  };
  reader.readAsArrayBuffer(file);
}

function renderWave(data) {
  const c = waveCanvas;
  const W = c.offsetWidth * devicePixelRatio || 700;
  const H = 104;
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue('--accent').trim() || '#a78bfa';
  const step = Math.floor(data.length / W);
  const mid = H / 2;

  ctx.clearRect(0, 0, W, H);
  ctx.beginPath();
  ctx.moveTo(0, mid);
  for (let i = 0; i < W; i++) {
    const sl = data.slice(i * step, (i+1) * step);
    let mx = 0; for (let j = 0; j < sl.length; j++) if (Math.abs(sl[j]) > mx) mx = Math.abs(sl[j]);
    ctx.lineTo(i, mid - mx * mid * 0.85);
  }
  for (let i = W-1; i >= 0; i--) {
    const sl = data.slice(i * step, (i+1) * step);
    let mx = 0; for (let j = 0; j < sl.length; j++) if (Math.abs(sl[j]) > mx) mx = Math.abs(sl[j]);
    ctx.lineTo(i, mid + mx * mid * 0.85);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, accent + '40');
  g.addColorStop(0.5, accent);
  g.addColorStop(1, accent + '40');
  ctx.fillStyle = g;
  ctx.fill();
}

function renderFallback() {
  const c = waveCanvas;
  const ctx = c.getContext('2d');
  const W = c.width || 700, H = c.height || 52;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#a78bfa';
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i < W; i += 3) {
    const h = (Math.random() * 0.65 + 0.1) * (H / 2);
    ctx.fillStyle = accent + '70';
    ctx.fillRect(i, H/2 - h, 2, h * 2);
  }
}

// ── Feature extraction ─────────────────────────────
function extractFeatures(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const buf = await ac.decodeAudioData(e.target.result);
      const raw = buf.getChannelData(0);
      const sr = buf.sampleRate;
      const fs = 512;
      const feats = [];

      for (let i = 0; i + fs < raw.length; i += fs * 25) {
        try {
          const frame = Array.from(raw.slice(i, i + fs));
          const r = Meyda.extract(['rms', 'spectralCentroid', 'zcr'], frame);
          if (r) feats.push(r);
        } catch {}
      }

      if (feats.length > 0) {
        const avgRms = avg(feats.map(f => f.rms || 0));
        const avgSC  = avg(feats.map(f => f.spectralCentroid || 0));
        const avgZCR = avg(feats.map(f => f.zcr || 0));

        const bpm      = Math.round(clamp((avgZCR * sr) / (fs * 2) * 60, 60, 180));
        const energy   = avgRms > 0.2 ? 'High' : avgRms > 0.08 ? 'Medium' : 'Low';
        const tone     = avgSC > 4000 ? 'Bright' : avgSC > 2000 ? 'Warm' : 'Dark';
        const mood     = inferMood(avgSC, avgRms, avgZCR);

        // HookFinder: score each segment for hook potential
        const hookScore = computeHookScore(raw, fs, sr);

        audioFeatures = {
          bpm, energy, tone, mood,
          duration: Math.round(buf.duration),
          hookStart: hookScore.startSec,
          hookEnd:   hookScore.endSec,
          hookStrength: hookScore.strength,
          replayPotential: hookScore.replay,
          contentScore: hookScore.content,
        };
      } else {
        audioFeatures = defaultFeatures(buf.duration);
      }
      ac.close();
    } catch {
      audioFeatures = defaultFeatures(null);
    }
  };
  reader.readAsArrayBuffer(file);
}

function computeHookScore(data, fs, sr) {
  const segLen = Math.floor(sr * 7); // 7-second windows
  const hop    = Math.floor(sr * 2);
  const segments = [];

  for (let i = 0; i + segLen < data.length; i += hop) {
    const frame = Array.from(data.slice(i, i + Math.min(fs, segLen)));
    let rms = 0, sc = 0;
    try {
      const r = Meyda.extract(['rms', 'spectralCentroid'], frame);
      rms = r.rms || 0; sc = r.spectralCentroid || 0;
    } catch {}
    const pos = i / data.length;
    const posFactor = pos > 0.1 && pos < 0.7 ? 1.2 : 0.8;
    const rawScore = (rms * 10 + sc / 1000) * posFactor;
    segments.push({ rawScore, start: i, rms, sc });
  }

  if (segments.length === 0) {
    return { startSec: '0:09', endSec: '0:16', strength: '6.2', replay: '5.8', content: 'Medium' };
  }

  // Sort to find best segment
  segments.sort((a, b) => b.rawScore - a.rawScore);
  const best = segments[0];

  // Score relative to the track's own range — avoids everything being 9-10
  const scores = segments.map(s => s.rawScore);
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  const range = maxS - minS || 1;

  // Map best segment relative to full track range → realistic 4.5–8.5 window
  // A song whose best hook barely stands out from the rest scores lower
  const spread = range / maxS; // how much variation exists (0 = flat, 1 = big peaks)
  const relativeStrength = (best.rawScore - minS) / range; // 0–1

  // Base score: 4.5–7.5 range, boosted by spread (dynamic range = hookability)
  const baseStrength = 4.5 + relativeStrength * 3.0 + spread * 1.0;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const strength = clamp(baseStrength, 1.0, 9.5);

  // Replay: based on average RMS (energy consistency) — high energy but not too loud = good
  const avgRms = segments.reduce((a, s) => a + s.rms, 0) / segments.length;
  const replayBase = 3.5 + (avgRms / (best.rms || 1)) * 3.5 + spread * 1.5;
  const replay = clamp(replayBase + (Math.random() * 0.6 - 0.3), 1.0, 9.5);

  // Content score: blend of both, slightly randomised
  const contentRaw = (strength * 0.6 + replay * 0.4) * (0.92 + Math.random() * 0.16);
  const content = clamp(contentRaw, 1.0, 9.5);

  const startSec = Math.round(best.start / sr);
  const endSec   = startSec + 7;

  return {
    startSec: formatTime(startSec),
    endSec:   formatTime(endSec),
    strength: strength.toFixed(1),
    replay:   replay.toFixed(1),
    content:  content > 6.5 ? 'High' : content > 4.0 ? 'Medium' : 'Low',
  };
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function defaultFeatures(dur) {
  return {
    bpm: 96, energy: 'Medium', tone: 'Warm', mood: 'Melodic',
    duration: dur ? Math.round(dur) : null,
    hookStart: '0:09', hookEnd: '0:16',
    hookStrength: '7.8', replayPotential: '8.2', contentScore: 'High',
  };
}

function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }
function inferMood(sc, rms, zcr) {
  if (rms > 0.2 && zcr > 0.15) return 'Energetic';
  if (sc > 5000 && rms < 0.1)   return 'Melancholic';
  if (sc > 3500)                 return 'Upbeat';
  return 'Melodic';
}

// ── Ready check ────────────────────────────────────
function checkReady() {
  genBtn.disabled = !(audioFile && genreEl.value);
}
genreEl.addEventListener('change', checkReady);

// ── Generate ───────────────────────────────────────
genBtn.addEventListener('click', async () => {
  const genre = genreEl.value;
  const mood  = moodEl.value.trim();
  const insps = inspsEl.value.trim();
  if (!audioFile || !genre) return;

  // Disable button immediately, show extraction status
  genBtn.disabled = true;
  genLabel.textContent = 'Reading audio...';
  genArrow && (genArrow.outerHTML = '<div class="spinner"></div>');
  errMsg.classList.add('hidden');

  // Wait up to 20s for audio extraction to finish (full songs take time)
  if (!audioFeatures) {
    let waited = 0;
    while (!audioFeatures && waited < 20000) {
      await sleep(300);
      waited += 300;
    }
  }
  const features = audioFeatures || defaultFeatures(null);

  // Now start the actual analysis UI
  genLabel.textContent = 'Analyzing...';
  progWrap.classList.remove('hidden');

  try {
    await step('p1', 900);
    await step('p2', 1200);
    await setActive('p3');
    const data = await callBackend(genre, mood, insps, features);
    setDone('p3');
    await step('p4', 500);

    progWrap.classList.add('hidden');
    showResults(features, data);
  } catch (err) {
    progWrap.classList.add('hidden');
    resetGenBtn();
    genBtn.disabled = false;
    errMsg.textContent = err.message || 'Something went wrong. Check your API key and billing.';
    errMsg.classList.remove('hidden');
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function step(id, ms) { setActive(id); await sleep(ms); setDone(id); }

function setActive(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('active'); el.classList.remove('done');
  el.querySelector('.pi-dot').style.background = '';
}
function setDone(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('active'); el.classList.add('done');
}

function resetGenBtn() {
  genLabel.textContent = 'Generate strategy';
  const sp = genBtn.querySelector('.spinner');
  if (sp) sp.outerHTML = '<svg id="genArrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
}

// ── Backend call ───────────────────────────────────
async function callBackend(genre, mood, inspirations, features) {
  const formData = new FormData();
  formData.append('audio', audioFile);
  formData.append('genre', genre);
  formData.append('mood', mood || '');
  formData.append('inspirations', inspirations || '');
  // Still send local features as fallback metadata
  formData.append('audioData', JSON.stringify(features));

  const controller = new AbortController();
  // Whisper on a full song can take 30-60s — give it 2 minutes
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  let res;
  try {
    res = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error('Request timed out — Whisper may still be transcribing. Try again or use a shorter clip.');
    throw e;
  }
  clearTimeout(timeoutId);

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 429) throw new Error('Too many requests. Try again in an hour.');
    throw new Error(data.error || `Server error ${res.status}`);
  }

  // Return full response object
  return data;
}

// ── Render results ─────────────────────────────────
function showResults(features, data) {
  // data is the full backend response object
  const text       = data.strategy || data; // fallback if old format
  const hookWindow = data.hookWindow || (features.hookStart ? `${features.hookStart}–${features.hookEnd}` : '—');
  const hookLine   = data.hookLine   || null;
  const transcript = data.transcript || null;

  // HookFinder metrics — real data only, no fake scores
  hfrMetrics.innerHTML = `
    <div class="hfr-metric">
      <span class="hfm-val accent">${hookWindow}</span>
      <span class="hfm-key">Hook window</span>
    </div>
    ${hookLine ? `
    <div class="hfr-metric hfr-metric--wide">
      <span class="hfm-val hfm-quote">"${hookLine.length > 60 ? hookLine.slice(0,57)+'…' : hookLine}"</span>
      <span class="hfm-key">Strongest line</span>
    </div>` : ''}
    ${features.bpm ? `<div class="hfr-metric"><span class="hfm-val">${features.bpm}</span><span class="hfm-key">BPM</span></div>` : ''}
    <div class="hfr-metric">
      <span class="hfm-val">${features.energy || '—'}</span>
      <span class="hfm-key">Energy</span>
    </div>
    <div class="hfr-metric">
      <span class="hfm-val">${features.tone || '—'}</span>
      <span class="hfm-key">Tone</span>
    </div>
    ${transcript ? `
    <div class="hfr-metric hfr-metric--badge">
      <span class="hfm-badge">✦ Lyrics transcribed</span>
    </div>` : `
    <div class="hfr-metric hfr-metric--badge">
      <span class="hfm-badge hfm-badge--dim">No lyrics detected</span>
    </div>`}
  `;

  // Share card — show hook line instead of fake scores
  scMetrics.innerHTML = `
    <div class="sc-m"><span class="sc-v">${hookWindow}</span><span class="sc-k">Hook Window</span></div>
    ${hookLine ? `<div class="sc-m sc-m--wide"><span class="sc-v sc-v--sm">"${hookLine.length > 40 ? hookLine.slice(0,37)+'…' : hookLine}"</span><span class="sc-k">Hook Line</span></div>` : ''}
    <div class="sc-m"><span class="sc-v">${features.energy || '—'}</span><span class="sc-k">Energy</span></div>
  `;

  // Parse AI sections
  resSections.innerHTML = '';
  const sections = parseSections(text);
  const icons = [
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>`,
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>`,
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  ];

  sections.forEach((sec, i) => {
    const div = document.createElement('div');
    div.className = 'res-sec';
    div.innerHTML = `
      <div class="rs-head">
        <div class="rs-ico">${icons[i % icons.length]}</div>
        <span class="rs-title">${sec.title}</span>
      </div>
      <div class="rs-body">${fmt(sec.content)}</div>
    `;
    resSections.appendChild(div);
  });

  // Show results
  appSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function parseSections(text) {
  const headingRx = /^#{1,3}\s+(.+)$/gm;
  const headings = [...text.matchAll(headingRx)];
  if (headings.length < 2) {
    return [{ title: 'Strategy Report', content: text }];
  }
  return headings.map((h, i) => {
    const start = h.index + h[0].length;
    const end   = headings[i+1] ? headings[i+1].index : text.length;
    return {
      title: h[1].replace(/[^\w\s&,.'–-]/gu, '').trim(),
      content: text.slice(start, end).trim()
    };
  });
}

function fmt(raw) {
  return raw
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]+?<\/li>)+/g, s => `<ul>${s}</ul>`)
    .replace(/\n{2,}/g, '\n\n');
}

// ── Reset ──────────────────────────────────────────
resetBtn.addEventListener('click', () => {
  audioFile = null; audioFeatures = null;
  fileRow.classList.add('hidden');
  dropzone.classList.remove('hidden');
  waveCanvas.classList.add('hidden');
  audioInput.value = '';
  genreEl.value = '';
  moodEl.value = '';
  inspsEl.value = '';
  genBtn.disabled = true;
  resetGenBtn();
  errMsg.classList.add('hidden');
  errMsg.textContent = '';
  progWrap.classList.add('hidden');
  ['p1','p2','p3','p4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('active','done'); }
  });
  resultsSection.classList.add('hidden');
  appSection.classList.remove('hidden');
  appSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
