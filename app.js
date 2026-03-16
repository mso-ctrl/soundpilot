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
  let best = { score: -1, start: 0 };

  for (let i = 0; i + segLen < data.length; i += hop) {
    const seg = data.slice(i, i + segLen);
    const frame = Array.from(seg.slice(0, fs));
    let rms = 0, sc = 0;
    try {
      const r = Meyda.extract(['rms', 'spectralCentroid'], frame);
      rms = r.rms || 0; sc = r.spectralCentroid || 0;
    } catch {}

    // Prefer mid-song (skip first 10% and last 10%)
    const pos = i / data.length;
    const posFactor = pos > 0.1 && pos < 0.7 ? 1.2 : 0.8;

    const score = (rms * 10 + sc / 1000) * posFactor;
    if (score > best.score) { best = { score, start: i }; }
  }

  const startSec = Math.round(best.start / sr);
  const endSec   = startSec + 7;

  // Normalize scores to 1–10
  const norm = n => Math.min(10, Math.max(1, n));
  const strength = norm(best.score * 12);
  const replay   = norm(strength * (0.85 + Math.random() * 0.3));
  const content  = norm((strength + replay) / 2 * (0.9 + Math.random() * 0.2));

  return {
    startSec: formatTime(startSec),
    endSec:   formatTime(endSec),
    strength: (strength).toFixed(1),
    replay:   (replay).toFixed(1),
    content:  content > 7 ? 'High' : content > 4 ? 'Medium' : 'Low',
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

  if (!audioFeatures) await sleep(1200);
  const features = audioFeatures || defaultFeatures(null);

  // Start
  genBtn.disabled = true;
  genLabel.textContent = 'Analyzing...';
  genArrow && (genArrow.outerHTML = '<div class="spinner"></div>');
  progWrap.classList.remove('hidden');
  errMsg.classList.add('hidden');

  try {
    await step('p1', 900);
    await step('p2', 1200);
    await setActive('p3');
    const strategy = await callBackend(genre, mood, insps, features);
    setDone('p3');
    await step('p4', 500);

    progWrap.classList.add('hidden');
    showResults(features, strategy);
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
  formData.append('audioData', JSON.stringify(features));

  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: 'POST',
    body: formData,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 429) throw new Error('Too many requests. Try again in an hour.');
    throw new Error(data.error || `Server error ${res.status}`);
  }

  return data.strategy;
}

// ── Render results ─────────────────────────────────
function showResults(features, text) {
  // HookFinder metrics
  hfrMetrics.innerHTML = `
    <div class="hfr-metric">
      <span class="hfm-val accent">${features.hookStart} – ${features.hookEnd}</span>
      <span class="hfm-key">Best clip</span>
    </div>
    <div class="hfr-metric">
      <span class="hfm-val">${features.hookStrength}</span>
      <span class="hfm-key">Hook Strength</span>
    </div>
    <div class="hfr-metric">
      <span class="hfm-val">${features.replayPotential}</span>
      <span class="hfm-key">Replay Potential</span>
    </div>
    <div class="hfr-metric">
      <span class="hfm-val">${features.contentScore}</span>
      <span class="hfm-key">Content Potential</span>
    </div>
    ${features.bpm ? `<div class="hfr-metric"><span class="hfm-val">${features.bpm}</span><span class="hfm-key">BPM</span></div>` : ''}
    <div class="hfr-metric">
      <span class="hfm-val">${features.energy}</span>
      <span class="hfm-key">Energy</span>
    </div>
  `;

  // Share card
  scMetrics.innerHTML = `
    <div class="sc-m"><span class="sc-v">${features.hookStrength}</span><span class="sc-k">Hook Strength</span></div>
    <div class="sc-m"><span class="sc-v">${features.contentScore}</span><span class="sc-k">Content Potential</span></div>
    <div class="sc-m"><span class="sc-v">${features.replayPotential}</span><span class="sc-k">Replay Score</span></div>
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
