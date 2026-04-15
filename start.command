#!/bin/bash
# BackNine Health — double-click to start, or: bash ~/Documents/BackNine/start.command

DIR="$(cd "$(dirname "$0")" && pwd)"
echo "🚀 BackNine Health starting..."

# ── Kill any leftover processes on 8000/3000 ─────────────────────────────────
lsof -ti:8000 | xargs kill -9 2>/dev/null && echo "  Cleared port 8000" || true
lsof -ti:3000 | xargs kill -9 2>/dev/null && echo "  Cleared port 3000" || true
sleep 1

# ── Backend ───────────────────────────────────────────────────────────────────
echo ""
echo "📦 Setting up Python backend..."
cd "$DIR/backend"
python3 -m venv .venv 2>/dev/null || true
source .venv/bin/activate
pip install -q -r requirements.txt
echo "🔧 Starting FastAPI on http://localhost:8000 ..."
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Wait until backend is accepting connections
for i in $(seq 1 20); do
  sleep 1
  curl -sf http://localhost:8000/health > /dev/null 2>&1 && echo "  ✅ Backend ready" && break
done

# ── Frontend ──────────────────────────────────────────────────────────────────
echo ""
echo "📦 Setting up Node frontend..."
cd "$DIR/frontend"
npm install --silent
echo "🌐 Starting Next.js on http://localhost:3000 ..."
npm run dev &
FRONTEND_PID=$!

# Wait until frontend is accepting connections
for i in $(seq 1 30); do
  sleep 1
  curl -sf http://localhost:3000 > /dev/null 2>&1 && echo "  ✅ Frontend ready" && break
done

# ── Open browser ──────────────────────────────────────────────────────────────
echo ""
echo "✅ BackNine is running!"
echo "   Dashboard → http://localhost:3000/dashboard"
echo "   API docs  → http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers."
open "http://localhost:3000/dashboard"

trap "echo ''; echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
