<div align="center">

![brb](docs/images/logo.png)

# **B**arbara **R**emembers **B**etter

### Long-term memory for Claude. Your AI remembers what you told it yesterday.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/Node-20+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![llama.cpp](https://img.shields.io/badge/llama.cpp-local_AI-8B5CF6?style=for-the-badge)](https://github.com/ggerganov/llama.cpp)

[Quick Start](#quick-start) · [Configuration](#configuration) · [How It Works](#how-it-works) · [Retrieval](#retrieval-algorithm) · [The Hard Parts](#why-this-is-harder-than-it-looks)

</div>

---

## The Problem

Every time you start a new conversation with Claude, it forgets everything. Your name, your stack, your preferences, that you hate tabs, that the deadline is Friday. You repeat yourself. Again.

<b style="color:#e63946">brb</b> sits between Claude and the Anthropic API, silently learning from every conversation and injecting relevant memories into future ones. No manual tagging. No memory commands. It just works.

**Session 1:** Tell Claude your preferences

![Session 1](docs/images/initial.png)

**Session 2:** Claude remembers

![Session 2](docs/images/remember.png)

---

## Features

You talk to Claude normally. <b style="color:#e63946">brb</b> does everything else.

- 🧠 **Learns** Facts, preferences, decisions extracted from every conversation automatically
- 🎯 **Retrieves** Memories ranked by similarity, recency, strength, confidence. Only the relevant ones get injected
- 🔄 **Self-Corrects** Say your name is Leo, correct it to Leoncio, the memory updates in place. Newer always wins
- 🔒 **Private** 100% local. PII (emails, phones, SSNs, API keys, credit cards) redacted before storage. No telemetry. Your API key is passed through to Anthropic, never stored
- ⚡ **Zero Wait** Retrieval before the request, extraction after the response in the background
- 🔍 **Transparent** `GET /memories` and `GET /memories/search?q=...` to see everything stored

---

## Quick Start

**Prerequisites:** Node.js 20+, [llama.cpp](https://github.com/ggerganov/llama.cpp) built with Metal (Apple Silicon) or CUDA (NVIDIA)

```bash
# 1. Clone & install
git clone https://github.com/youruser/brb.git && cd brb && npm install

# 2. Download models
mkdir -p ~/workspace/llama.cpp/models && cd ~/workspace/llama.cpp/models

curl -L -o nomic-embed-text-v1.5.Q8_0.gguf \
  https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf

curl -L -o Qwen2.5-3B-Instruct-Q4_K_M.gguf \
  https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf

# 3. Start model servers
cd /path/to/brb && chmod +x start.sh && ./start.sh

# 4. Start brb (new terminal)
cp .env.example .env && npm start

# 5. Point Claude at brb
export ANTHROPIC_BASE_URL=http://localhost:3000
claude
```

---

## Configuration

Copy `.env.example` to `.env`:

```bash
BRB_PORT=3000                         # Proxy port
BRB_DATA_DIR=./data                   # Data directory
BRB_EMBED_URL=http://localhost:9090   # Embedding server
BRB_EXTRACT_URL=http://localhost:9091 # Extraction server
BRB_EMBED_DIM=768                     # Embedding dimensions
BRB_MAX_MEMORIES=10                   # Max memories injected per request
BRB_MAX_MEMORY_TOKENS=1500            # Max tokens in injected memory block
BRB_MIN_SCORE=0.3                     # Minimum composite score threshold
BRB_MIN_SIMILARITY=0.15               # Minimum raw cosine similarity floor
BRB_DEDUP_THRESHOLD=0.82              # Cosine similarity for merging
BRB_NO_REWRITE=false                  # Skip query rewriting
```

<details>
<summary>Memory Categories</summary>

- ❤️ `preference` "prefers dark mode", "hates semicolons"
- 📁 `project_context` "building a REST API", "using PostgreSQL"
- ⚙️ `technical_choice` "chose JWT over sessions", "using Tailwind"
- 👤 `personal_info` "name is Leoncio", "based in Miami"
- ✅ `decision` "will deploy on Fly.io", "shipping v2 first"
- 🚧 `constraint` "budget is $500/mo", "deadline is March 15"
- 📝 `todo` "need to fix auth bug", "migrate to v3"

</details>

---

## Models

- 📐 [nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF) Embedding (768-dim), ~134MB, port `:9090`
- 🧩 [Qwen2.5-3B-Instruct](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF) Extraction + query rewrite, ~2.1GB, port `:9091`

---

## Development

```bash
npm run dev        # Dev mode with auto-reload
npm test           # Run tests (requires llama.cpp servers)
npm run build      # Compile TypeScript
npm run clean      # Delete compiled JS output
npm run clearData  # Nuke all memories and checkpoints
```

---

## How It Works

```
                         ┌─────────────────────────────────────┐
                         │               brb                   │
                         │                                     │
  Claude ───POST────────▶│  retrieve → score → inject prompt   │───────▶ Anthropic API
  (claude code,          │                                     │
   cursor, etc)◀─────────│  stream response back               │◀──────── response
                         │                                     │
                         │  ┌─────────────────────────────────┐│
                         │  │  background: extract → dedupe   ││
                         │  │  → PII filter → embed → store   ││
                         │  └─────────────────────────────────┘│
                         └─────────────────────────────────────┘
```

1. Claude sends a normal API request to <b style="color:#e63946">brb</b> instead of `api.anthropic.com`
2. <b style="color:#e63946">brb</b> searches for relevant memories and appends them to the system prompt (preserving prompt cache)
3. The response streams back untouched
4. In the background, <b style="color:#e63946">brb</b> extracts facts and stores them for next time

---

## Retrieval Algorithm

Not all memories are equal. <b style="color:#e63946">brb</b> uses a multi-stage pipeline:

```
  "where were we on that thing?"
              │
              ▼
  ┌───────────────────────┐
  │   Vague Detection     │  Regex detects references like
  │                       │  "that thing", "where were we"
  └───────────┬───────────┘
              │  vague? → rewrite    explicit? → use as-is
              ▼
  ┌───────────────────────┐
  │    Query Rewrite      │  LLM rewrites vague queries using
  │    (Qwen2.5-3B)       │  the last 5 messages as context
  └───────────┬───────────┘
              │  "restaurant dashboard pagination revenue"
              ▼
  ┌───────────────────────┐
  │    Embed + Search     │  768-dim vector search (HNSW)
  │    (nomic-embed-text) │  task prefixes + 30 candidates
  └───────────┬───────────┘
              │
              ▼
  ┌───────────────────────┐
  │  Similarity Floor     │  Drop anything below MIN_SIMILARITY
  └───────────┬───────────┘  (prevents composite score rescue)
              │
              ▼
  ┌───────────────────────┐
  │   Composite Scoring   │  Each candidate scored on 4 signals
  └───────────┬───────────┘
              │
              ▼
  ┌───────────────────────┐
  │  Filter + Rank + Cut  │  Drop below threshold, keep top 10
  └───────────┬───────────┘
              │
              ▼
     Injected into system prompt
```

### Scoring

Every memory gets a score from 0 to 1, composed of four weighted signals:

```
S = 0.55·sim + 0.25·strength·exp(-0.01·dc) + 0.15·exp(-0.005·da) + 0.05·conf
```

Where `dc` = days since created, `da` = days since last accessed.

**Similarity (55%)** Cosine similarity between the user's message and the stored memory, both embedded as 768-dim vectors by nomic-embed-text. "guacamole" and "Leo dislikes avocados" will be close. "database indexes" won't. This dominates because if a memory isn't about the right topic, nothing else matters.

nomic-embed-text requires task prefixes: memories are stored with `search_document:` prefix, queries use `search_query:`. Without these, similarity scores are near-random. With them, related content scores 0.6-0.9.

**Strength x Decay (25%)** Every time <b style="color:#e63946">brb</b> extracts the same fact again (you mention it in another conversation), strength goes up. But it fades over time, multiplied by `exp(-0.01·dc)`. A fact mentioned 10 times is strong. A fact mentioned 10 times six months ago is less strong. Like a tan: reinforced by the sun, fades if you stop going outside.

**Recency (15%)** Every time a memory gets injected into a conversation, its `last_accessed` timestamp updates. Decays as `exp(-0.005·da)`. A memory used yesterday scores ~1.0. A memory nobody asked about in 3 months scores ~0.64. Prevents stale facts from hogging the top 10 spots.

**Confidence (5%)** When Qwen2.5 extracts a fact, it assigns a confidence score (0-1). "Leo hates avocados" after you explicitly said "I hate avocados" gets ~0.95. Something the model guessed at gets ~0.5. Weighted low because the model is usually either right or wrong.

Anything below `0.3` composite gets thrown out. Top 10 survivors get injected.

### Why not just use similarity?

Because similarity alone doesn't account for time. Example:

- You said "I use Postgres" once, 8 months ago. Similarity to "what database?" might be 0.6
- You said "I switched to SQLite" yesterday. Similarity might also be 0.6

Pure similarity treats these equally. The composite score makes the recent one win because of recency and the old one lose because of decay.

But the composite score has a trap: it can boost unrelated memories. A completely off-topic memory (similarity 0.2) created today can score above 0.3 thanks to high recency and strength. That's why there's a raw similarity floor (`MIN_SIMILARITY = 0.15`) that kills candidates before the composite formula can rescue them.

### Deduplication

When a new fact is extracted, <b style="color:#e63946">brb</b> searches for existing memories with cosine similarity above 0.82. If found, it merges, always keeping the newer content and bumping strength. Corrections work naturally: "my name is Leonardo" gets overwritten by "my name is Leoncio" in the same slot.

### Why this is harder than it looks

Scoring and contradiction handling seem simple on paper. They're not.

**Composite scores rescue garbage.** A memory with 0.28 cosine similarity (basically unrelated) can score 0.59 composite if it was created recently and has high strength. That's above the 0.3 threshold, so it gets injected. Irrelevant memories confuse Claude. The fix is a raw similarity floor that kills candidates before the composite formula gets to them. But set it too high and you lose legitimate matches that embedding models just happen to score lower than expected.

**Contradictions need semantic matching, not keyword matching.** "I use Postgres" and "I switched to MySQL" are contradictions, but they share almost no words. You need embeddings to detect they're about the same topic. The dedup threshold (0.82) has to be high enough that "I use Postgres" matches "I now use MySQL" (same topic, different answer) but low enough that "I use Postgres for the dashboard" doesn't merge with "I use Redis for caching" (both databases, different contexts). There's no perfect number.

**The extraction model fights you.** Qwen2.5-3B is small and literal. Give it too many rules ("don't extract questions", "don't extract speculation", "preserve conditionals", "only facts about the user") and it returns nothing, an empty facts array for perfectly good input. Give it too few rules and it extracts garbage like "assistance offered for help with software" (a fact about the assistant, not the user). Five concise rules is the sweet spot, with code-level filters as a safety net for what the model misses.

**Corrections are silent merges.** When you say "actually my name is Leoncio", the old "my name is Leonardo" gets overwritten in place: same slot, new content, bumped strength. No history, no "previous value" field. If the dedup threshold is too low, the correction creates a second memory instead of updating the first, and now Claude sees both names. If it's too high, unrelated facts merge into each other.

---

<div align="center">

*Named after my daughter Barbara, who never forgets a single thing you tell her, even when you wish she would.*

<b style="color:#e63946">brb</b> be right back, with context.

[![Star on GitHub](https://img.shields.io/github/stars/lboquillon/brb?style=social)](https://github.com/lboquillon/brb)

</div>
