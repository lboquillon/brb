#!/bin/bash
# =============================================================================
# brb-models.sh — Start llama.cpp embedding + extraction servers for brb
# =============================================================================
#
# FIRST TIME SETUP:
#
# 1. Build llama.cpp (one-time):
#
#    cd ~/projects
#    git clone https://github.com/ggerganov/llama.cpp.git
#    cd llama.cpp
#    cmake -B build -DGGML_METAL=ON
#    cmake --build build --config Release -j$(sysctl -n hw.ncpu)
#
# 2. Download models:
#
#    mkdir -p ~/projects/llama.cpp/models
#    cd ~/projects/llama.cpp/models
#
#    # Embedding model — nomic-embed-text v1.5 Q8 (~134MB)
#    curl -L -o nomic-embed-text-v1.5.Q8_0.gguf \
#      https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf
#
#    # Extraction model — Qwen2.5-3B Instruct Q4_K_M (~2.1GB)
#    curl -L -o Qwen2.5-3B-Instruct-Q4_K_M.gguf \
#      https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf
#
# 3. Run this script:
#
#    chmod +x brb-models.sh
#    ./brb-models.sh
#
# =============================================================================

set -euo pipefail

# --- Config ---
LLAMA_DIR="${LLAMA_DIR:-$HOME/workspace/llama.cpp}"
LLAMA_SERVER="$LLAMA_DIR/build/bin/llama-server"
MODELS_DIR="$LLAMA_DIR/models"
LOG_DIR="$LLAMA_DIR/logs"

EMBED_MODEL="nomic-embed-text-v1.5.Q8_0.gguf"
EXTRACT_MODEL="Qwen2.5-3B-Instruct-Q4_K_M.gguf"

EMBED_PORT=9090
EXTRACT_PORT=9091

HEALTH_TIMEOUT=60        # seconds to wait for servers to become healthy
HEALTH_INTERVAL=2        # seconds between health checks

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} $1"; }
ok()   { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} ${GREEN}✓${NC} $1"; }
warn() { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} ${RED}✗${NC} $1"; }

# --- Preflight checks ---
log "Checking prerequisites..."

if [ ! -f "$LLAMA_SERVER" ]; then
  fail "llama-server not found at $LLAMA_SERVER"
  echo ""
  echo "  Build it first:"
  echo "    cd $LLAMA_DIR"
  echo "    cmake -B build -DGGML_METAL=ON"
  echo "    cmake --build build --config Release -j\$(sysctl -n hw.ncpu)"
  exit 1
fi

if [ ! -f "$MODELS_DIR/$EMBED_MODEL" ]; then
  fail "Embedding model not found: $MODELS_DIR/$EMBED_MODEL"
  echo ""
  echo "  Download it:"
  echo "    cd $MODELS_DIR"
  echo "    curl -L -o $EMBED_MODEL \\"
  echo "      https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/$EMBED_MODEL"
  exit 1
fi

if [ ! -f "$MODELS_DIR/$EXTRACT_MODEL" ]; then
  fail "Extraction model not found: $MODELS_DIR/$EXTRACT_MODEL"
  echo ""
  echo "  Download it:"
  echo "    cd $MODELS_DIR"
  echo "    curl -L -o $EXTRACT_MODEL \\"
  echo "      https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf"
  exit 1
fi

ok "llama-server found"
ok "Embedding model found: $EMBED_MODEL"
ok "Extraction model found: $EXTRACT_MODEL"

# --- Kill existing servers on these ports ---
for port in $EMBED_PORT $EXTRACT_PORT; do
  pid=$(lsof -ti tcp:$port 2>/dev/null || true)
  if [ -n "$pid" ]; then
    warn "Port $port in use (PID $pid), killing..."
    kill $pid 2>/dev/null || true
    sleep 1
  fi
done

# --- Create log directory ---
mkdir -p "$LOG_DIR"

EMBED_LOG="$LOG_DIR/embed-$(date '+%Y%m%d').log"
EXTRACT_LOG="$LOG_DIR/extract-$(date '+%Y%m%d').log"

# --- Start embedding server ---
log "Starting embedding server (nomic-embed-text) on :$EMBED_PORT..."

"$LLAMA_SERVER" \
  -m "$MODELS_DIR/$EMBED_MODEL" \
  --port $EMBED_PORT \
  --embedding \
  --pooling mean \
  >> "$EMBED_LOG" 2>&1 &

EMBED_PID=$!
log "  PID: $EMBED_PID | Log: $EMBED_LOG"

# --- Start extraction server ---
log "Starting extraction server (Qwen2.5-3B) on :$EXTRACT_PORT..."

"$LLAMA_SERVER" \
  -m "$MODELS_DIR/$EXTRACT_MODEL" \
  --port $EXTRACT_PORT \
  >> "$EXTRACT_LOG" 2>&1 &

EXTRACT_PID=$!
log "  PID: $EXTRACT_PID | Log: $EXTRACT_LOG"

# --- Cleanup on exit ---
cleanup() {
  echo ""
  log "Shutting down servers..."
  kill $EMBED_PID 2>/dev/null && ok "Embedding server stopped (PID $EMBED_PID)" || true
  kill $EXTRACT_PID 2>/dev/null && ok "Extraction server stopped (PID $EXTRACT_PID)" || true
  exit 0
}

trap cleanup SIGINT SIGTERM

# --- Health check loop ---
wait_for_health() {
  local name=$1
  local port=$2
  local elapsed=0

  while [ $elapsed -lt $HEALTH_TIMEOUT ]; do
    status=$(curl -s --max-time 2 "http://localhost:$port/health" 2>/dev/null | grep -o '"status":"[^"]*"' | head -1 || true)
    if [ "$status" = '"status":"ok"' ]; then
      return 0
    fi
    sleep $HEALTH_INTERVAL
    elapsed=$((elapsed + HEALTH_INTERVAL))
    printf "  waiting... %ds / %ds\r" $elapsed $HEALTH_TIMEOUT
  done
  return 1
}

echo ""
log "Waiting for servers to load models..."
echo ""

# Check embedding server
printf "  Embedding server (:$EMBED_PORT) "
if wait_for_health "embedding" $EMBED_PORT; then
  echo ""
  ok "Embedding server healthy on :$EMBED_PORT"
else
  echo ""
  fail "Embedding server failed to start within ${HEALTH_TIMEOUT}s"
  echo "  Check log: tail -50 $EMBED_LOG"
  cleanup
fi

# Check extraction server
printf "  Extraction server (:$EXTRACT_PORT) "
if wait_for_health "extraction" $EXTRACT_PORT; then
  echo ""
  ok "Extraction server healthy on :$EXTRACT_PORT"
else
  echo ""
  fail "Extraction server failed to start within ${HEALTH_TIMEOUT}s"
  echo "  Check log: tail -50 $EXTRACT_LOG"
  cleanup
fi

# --- Smoke tests ---
echo ""
log "Running smoke tests..."

# Test embedding
embed_dim=$(curl -s http://localhost:$EMBED_PORT/embedding \
  -H "Content-Type: application/json" \
  -d '{"content": "hello world"}' 2>/dev/null \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)[0]['embedding'][0]))" 2>/dev/null || echo "0")

if [ "$embed_dim" = "768" ]; then
  ok "Embedding test passed (768 dimensions)"
else
  fail "Embedding test failed (expected 768 dims, got: $embed_dim)"
fi

# Test chat completion
chat_ok=$(curl -s http://localhost:$EXTRACT_PORT/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Say OK"}],
    "temperature": 0.1,
    "max_tokens": 10,
    "stream": false
  }' 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if d.get('choices') else 'fail')" 2>/dev/null || echo "fail")

if [ "$chat_ok" = "ok" ]; then
  ok "Chat completion test passed"
else
  fail "Chat completion test failed"
fi

# --- Summary ---
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "Both servers running"
echo ""
echo "  Embedding:   http://localhost:$EMBED_PORT   PID $EMBED_PID"
echo "  Extraction:  http://localhost:$EXTRACT_PORT   PID $EXTRACT_PID"
echo ""
echo "  Logs:"
echo "    tail -f $EMBED_LOG"
echo "    tail -f $EXTRACT_LOG"
echo ""
echo "  For brb config (.env):"
echo "    BRB_EMBED_URL=http://localhost:$EMBED_PORT"
echo "    BRB_EXTRACT_URL=http://localhost:$EXTRACT_PORT"
echo ""
echo "  Press Ctrl+C to stop both servers"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# --- Keep alive ---
wait