import os, uuid, json, math, random, httpx
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from duckduckgo_search import DDGS
import trafilatura

# =========================
# Config
# =========================
BACKEND      = os.getenv("LLM_BACKEND", "echo")          # echo | groq
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL   = os.getenv("GROQ_MODEL", "llama3-8b-8192")  # good default

# =========================
# FastAPI setup + Static
# =========================
app = FastAPI(title="PiGenie Online AI Chat")

STATIC_DIR = Path(__file__).parent / "static"
# Make minimal static structure if missing (prevents crash)
if not STATIC_DIR.exists():
    (STATIC_DIR / "css").mkdir(parents=True, exist_ok=True)
    (STATIC_DIR / "js").mkdir(parents=True, exist_ok=True)
    (STATIC_DIR / "index.html").write_text(
        "<!doctype html><title>PiGenie</title>"
        "<h1>PiGenie is running</h1>"
        "<p>But the static UI is missing. Add static/index.html, css/style.css, js/app.js to your repo.</p>",
        encoding="utf-8"
    )

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
with open(STATIC_DIR / "index.html", "r", encoding="utf-8") as f:
    INDEX = f.read()

@app.get("/", response_class=HTMLResponse)
def root():
    return INDEX

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/whoami")
def whoami():
    return {
        "backend": BACKEND,
        "model": GROQ_MODEL,
        "has_key": bool(GROQ_API_KEY),
    }

# =========================
# Input model
# =========================
class ChatIn(BaseModel):
    session_id: str | None = None
    message: str
    mode: str = "chat"  # chat | rag | akinator

# =========================
# Akinator (self-learning)
# =========================
AKI_PATH = Path(__file__).parent / "akinator_seed.json"
if not AKI_PATH.exists():
    # seed a minimal file if missing
    AKI_PATH.write_text(
        json.dumps({
            "attributes": [
                "Is the person real",
                "Is the person alive",
                "Is the person an actor",
                "Is the person a politician",
                "Is the person in technology",
                "Is the person from Pakistan",
                "Is the person American",
                "Is the person an athlete",
                "Is the person a singer",
                "Is the person historical (pre-1950)"
            ],
            "entities": [
                {
                    "name": "Elon Musk",
                    "attrs": {
                        "Is the person real": True,
                        "Is the person alive": True,
                        "Is the person an actor": False,
                        "Is the person a politician": False,
                        "Is the person in technology": True,
                        "Is the person from Pakistan": False,
                        "Is the person American": True,
                        "Is the person an athlete": False,
                        "Is the person a singer": False,
                        "Is the person historical (pre-1950)": False
                    }
                }
            ]
        }, indent=2),
        encoding="utf-8"
    )

# Read allowing BOM (Windows Notepad)
DATA = json.loads(AKI_PATH.read_text(encoding="utf-8-sig"))

class Aki:
    def __init__(self):
        self.entities = DATA["entities"][:]
        self.attrs    = DATA["attributes"][:]
        self.asked    = set()
        self.hist     = []
        self.end      = False
        self.waiting_new = False
        self.new_name = None

    def _ent(self, p):
        if p in (0, 1): return 0
        return -(p*math.log2(p) + (1-p)*math.log2(1-p))

    def _best(self):
        best, score = None, -1
        for a in self.attrs:
            if a in self.asked: 
                continue
            have, known = 0, 0
            for e in self.entities:
                if a in e.get("attrs", {}):
                    known += 1
                    have += e["attrs"][a] is True
            if not known:
                continue
            s = self._ent(have/known)
            if s > score:
                best, score = a, s
        return best

    def step(self, text: str):
        text = (text or "").lower().strip()

        if self.waiting_new:
            if not self.new_name:
                self.new_name = text.title()
                return f"Great! Now answer for {self.new_name}: {', '.join(self.attrs)} (yes/no/unknown, comma-separated)", False
            answers = [w.strip() for w in text.split(",")]
            attrs_map = {}
            for i, a in enumerate(self.attrs):
                if i < len(answers):
                    ans = answers[i].lower()
                    if ans.startswith("y"): attrs_map[a] = True
                    elif ans.startswith("n"): attrs_map[a] = False
            new_ent = {"name": self.new_name, "attrs": attrs_map}
            self.entities.append(new_ent)
            DATA["entities"].append(new_ent)
            AKI_PATH.write_text(json.dumps(DATA, indent=2), encoding="utf-8")
            self.waiting_new = False
            return f"Thanks! I’ve learned {self.new_name}.", True

        if not self.hist:
            q = self._best() or random.choice(self.attrs)
            self.asked.add(q)
            self.hist.append((q, None))
            return f"Think of a person. {q}? (yes/no/unknown)", False

        last, _ = self.hist[-1]
        ans = "unknown"
        if any(w in text for w in ["yes", "y"]): ans = "yes"
        elif any(w in text for w in ["no", "n"]): ans = "no"

        new = []
        for e in self.entities:
            v = e.get("attrs", {}).get(last, None)
            if ans == "yes" and v is True: new.append(e)
            elif ans == "no" and v is False: new.append(e)
            elif ans == "unknown": new.append(e)
        self.entities = new
        self.hist[-1] = (last, ans)

        if len(self.entities) <= 2 and self.entities:
            self.end = True
            guess = random.choice(self.entities)["name"]
            return f"My guess: {guess}. Am I right? (yes/no)", False

        if self.end and ans == "no":
            self.waiting_new = True
            return "Oops, I got it wrong! Who were you thinking of?", False

        q = self._best()
        if not q:
            self.end = True
            g = random.choice(self.entities)["name"] if self.entities else "no one"
            return f"I’ll guess: {g}. Am I right? (yes/no)", False

        self.asked.add(q)
        self.hist.append((q, None))
        return f"{q}? (yes/no/unknown)", False

akinator_sessions = {}

# =========================
# LLM (Groq) with clear errors
# =========================
async def llm_complete(prompt: str) -> str:
    if BACKEND == "groq":
        if not GROQ_API_KEY:
            return "Groq API error: missing GROQ_API_KEY (set it in Render → Environment)."
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {GROQ_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": GROQ_MODEL,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.4,
                        "max_tokens": 256,
                    },
                )
                if r.status_code >= 400:
                    # Try to surface a helpful error in the UI
                    try:
                        err = r.json()
                    except Exception:
                        err = {"text": r.text}
                    print("Groq API error:", r.status_code, err)  # logs
                    if r.status_code in (401, 403):
                        return "Groq API error: unauthorized/forbidden. Check GROQ_API_KEY (rotate if disabled)."
                    if r.status_code == 404:
                        return f"Groq API error: model not found: {GROQ_MODEL}. Try llama3-8b-8192."
                    if r.status_code == 429:
                        return "Groq API error: rate limit. Try again later or switch to a smaller model."
                    return f"Groq API error: HTTP {r.status_code}. {err}"
                data = r.json()
                return data["choices"][0]["message"]["content"].strip()
        except httpx.ReadTimeout:
            return "Groq API error: timeout. Try again or reduce max_tokens."
        except Exception as e:
            print("Groq exception:", repr(e))
            return f"Groq API error: {e}"
    # fallback if BACKEND != groq
    return f"(echo) {prompt}"

# =========================
# Web RAG
# =========================
async def answer_with_rag(query: str):
    hits = []
    try:
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=5):
                hits.append({"title": r.get("title", ""), "href": r.get("href", "")})
    except Exception as e:
        return f"Search error: {e}", []

    docs = []
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
        for h in hits:
            try:
                resp = await client.get(h["href"], headers={"User-Agent": "PiGenie/1.0"})
                txt = trafilatura.extract(resp.text) or ""
                if txt.strip():
                    docs.append({"title": h["title"], "url": h["href"], "text": txt[:2000]})
            except:
                pass

    if not docs:
        # No docs — fall back to direct LLM
        return await llm_complete(f"Answer briefly: {query}"), []
    ctx = "\n".join([f"[{i+1}] {d['title']} ({d['url']})\n{d['text']}" for i, d in enumerate(docs[:3])])
    ans = await llm_complete(f"Answer using ONLY this:\n{ctx}\n\nQ:{query}\nA:")
    return ans, [{"title": d["title"], "url": d["url"]} for d in docs[:3]]

# =========================
# API Route
# =========================
@app.post("/api/chat")
async def chat(b: ChatIn):
    sid = b.session_id or str(uuid.uuid4())
    msg = (b.message or "").strip()
    mode = b.mode.lower().strip()

    if mode == "akinator":
        s = akinator_sessions.get(sid) or Aki()
        akinator_sessions[sid] = s
        reply, _ = s.step(msg)
        return {"session_id": sid, "reply": reply}

    if mode == "rag":
        reply, src = await answer_with_rag(msg)
        return {"session_id": sid, "reply": reply, "sources": src}

    reply = await llm_complete(msg)
    return {"session_id": sid, "reply": reply}

# =========================
# Entrypoint (local run)
# =========================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")))









