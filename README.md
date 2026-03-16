# SoundPilot

> AI label infrastructure for independent artists.

**Label-level strategy. Artist-level control.**

SoundPilot is an AI-assisted release strategy platform for independent artists. Upload an unreleased snippet and get a full viral rollout strategy — the kind major labels provide but indie artists rarely access.

## Core Features

- **HookFinder™** — Identifies the strongest moment in your track (highest replay potential, short-form compatibility)
- **Content Strategy** — Platform-specific formats tailored to your sound
- **14-Day Rollout** — Day-by-day release calendar
- **Signal Metrics** — Hook Strength, Content Potential, Replay Score
- **Collaborator Network** — AI-matched A&Rs, curators, creators (coming soon)

## How to use

1. Upload unreleased snippet (MP3/WAV/M4A, 10–60s)
2. Select genre, add mood and inspirations
3. Add your [OpenAI API key](https://platform.openai.com/api-keys) — runs entirely in browser, never stored
4. Generate strategy

Requires OpenAI API credits ($5 covers hundreds of analyses).

## Stack

- Vanilla HTML/CSS/JS — zero framework, fast, portable
- [Meyda](https://meyda.sound.app/) — client-side audio feature extraction
- OpenAI GPT-4o — strategy generation
- GitHub Pages — hosting

## Philosophy

> AI does the analysis. You make the calls.

SoundPilot is designed around three roles:
- **AI** — audio analysis & pattern recognition
- **Artist** — creative control & final decisions  
- **Humans** — collaboration & expertise the AI can't replicate

## Local development

Open `index.html` in any browser. No build step required.
