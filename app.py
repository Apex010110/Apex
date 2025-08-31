import os, uuid, json, math, random, httpx
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from duckduckgo_search import DDGS
import trafilatura

# -------------------
# Config
# -------------------
BACKEND       = os.getenv("LLM_BACKEND", "echo")  # echo | groq
GROQ_API_KEY  = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL    = os.getenv("GROQ_MODEL", "llama3-8b-8192")

# -------------------
# FastAPI setup
# -------------------
app = FastAPI(title="PiGenie Online AI Chat")
app.mount("/static", StaticFiles(directory="static"), name="static")
with open("static/index.html", "r", encoding="utf-8") as f:
    INDEX = f.read()

class ChatIn(BaseModel):
    session_id: str | None = None
    message: str
    mode: str = "chat"  # chat | rag | akinator

# -------------------
# Akinator (self-learning)
# -------------------
DATA = json.loads(open("akinator_seed.json","r",encoding="utf-8-sig").read())

class Aki:
    def __init__(self):
        self.entities = DATA["entities"][:]
        self.attrs    = DATA["attributes"][:]
        self.asked=set(); self.hist=[]; self.end=False
        self.waiting_new=False; self.new_name=None

    def _ent(self,p): 
        return 0 if p in (0,1) else -(p*math.log2(p)+(1-p)*math.log2(1-p))

    def _best(self):
        best,score=None,-1
        for a in self.attrs:
            if a in self.asked: continue
            have=0; known=0
            for e in self.entities:
                if a in e.get("attrs", {}): 
                    known+=1
                    have+= e["attrs"][a] is True
            if not known: continue
            s=self._ent(have/known)
            if s>score: best,score=a,s
        return best

    def step(self,text:str):
        text=(text or "").lower().strip()

        if self.waiting_new:
            if not self.new_name:
                self.new_name=text.title()
                return f"Great! Now answer for {self.new_name}: {', '.join(self.attrs)} (yes/no/unknown, comma-separated)", False
            answers=[w.strip() for w in text.split(",")]
            attrs_map={}
            for i,a in enumerate(self.attrs):
                if i<len(answers):
                    ans=answers[i].lower()
                    if ans.startswith("y"): attrs_map[a]=True
                    elif ans.startswith("n"): attrs_map[a]=False
            new_ent={"name":self.new_name,"attrs":attrs_map}
            self.entities.append(new_ent); DATA["entities"].append(new_ent)
            with open("akinator_seed.json","w",encoding="utf-8") as f: json.dump(DATA,f,indent=2)
            self.waiting_new=False
            return f"Thanks! I’ve learned {self.new_name}.", True

        if not self.hist:
            q=self._best() or random.choice(self.attrs)
            self.asked.add(q); self.hist.append((q,None))
            return f"Think of a person. {q}? (yes/no/unknown)", False

        last,_=self.hist[-1]
        ans="unknown"
        if any(w in text for w in ["yes","y"]): ans="yes"
        elif any(w in text for w in ["no","n"]): ans="no"

        new=[]
        for e in self.entities:
            v=e.get("attrs",{}).get(last,None)
            if ans=="yes" and v is True: new.append(e)
            elif ans=="no" and v is False: new.append(e)
            elif ans=="unknown": new.append(e)
        self.entities=new; self.hist[-1]=(last,ans)

        if len(self.entities)<=2 and self.entities:
            self.end=True
            guess=random.choice(self.entities)["name"]
            return f"My guess: {guess}. Am I right? (yes/no)", False

        if self.end and ans=="no":
            self.waiting_new=True
            return "Oops, I got it wrong! Who were you thinking of?", False

        q=self._best()
        if not q:
            self.end=True
            g=random.choice(self.entities)["name"] if self.entities else "no one"
            return f"I’ll guess: {g}. Am I right? (yes/no)", False

        self.asked.add(q); self.hist.append((q,None))
        return f"{q}? (yes/no/unknown)", False

akinator_sessions={}

# -------------------
# LLM
# -------------------
async def llm_complete(prompt:str)->str:
    if BACKEND=="groq":
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                r=await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization":f"Bearer {GROQ_API_KEY}"},
                    json={
                        "model":GROQ_MODEL,
                        "messages":[{"role":"user","content":prompt}],
                        "temperature":0.4,"max_tokens":256
                    }
                )
                r.raise_for_status()
                data=r.json()
                return data["choices"][0]["message"]["content"].strip()
        except Exception as e:
            return f"Groq API error: {e}"
    return f"(echo) {prompt}"

# -------------------
# RAG
# -------------------
async def answer_with_rag(query:str):
    hits=[]
    with DDGS() as ddgs:
        for r in ddgs.text(query, max_results=5):
            hits.append({"title":r.get("title",""),"href":r.get("href","")})
    docs=[]
    async with httpx.AsyncClient(timeout=10.0,follow_redirects=True) as client:
        for h in hits:
            try:
                resp=await client.get(h["href"],headers={"User-Agent":"PiGenie/1.0"})
                txt=trafilatura.extract(resp.text) or ""
                if txt.strip(): docs.append({"title":h["title"],"url":h["href"],"text":txt[:2000]})
            except: pass
    if not docs: return await llm_complete(f"Answer briefly: {query}"),[]
    ctx="\n".join([f"[{i+1}] {d['title']} ({d['url']})\n{d['text']}" for i,d in enumerate(docs[:3])])
    ans=await llm_complete(f"Answer using ONLY this:\n{ctx}\n\nQ:{query}\nA:")
    return ans,[{"title":d["title"],"url":d["url"]} for d in docs[:3]]

# -------------------
# Routes
# -------------------
@app.get("/",response_class=HTMLResponse)
def root(): 
    return INDEX

@app.post("/api/chat")
async def chat(b:ChatIn):
    sid=b.session_id or str(uuid.uuid4())
    msg=(b.message or "").strip()
    mode=b.mode.lower().strip()

    if mode=="akinator":
        s=akinator_sessions.get(sid) or Aki()
        akinator_sessions[sid]=s
        reply,_=s.step(msg)
        return {"session_id":sid,"reply":reply}

    if mode=="rag":
        reply,src=await answer_with_rag(msg)
        return {"session_id":sid,"reply":reply,"sources":src}

    reply=await llm_complete(msg)
    return {"session_id":sid,"reply":reply}

@app.get("/health")
def health(): 
    return {"ok":True}

if __name__=="__main__":
    import uvicorn
    uvicorn.run("app:app",host="0.0.0.0",port=int(os.getenv("PORT","8000")))



