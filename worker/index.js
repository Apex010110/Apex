/**
 * APEX AI — Cloudflare Worker
 * Proxies chat requests to Groq, keeping the API key server-side.
 * Handles: chat | rag | akinator modes
 */

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama3-8b-8192';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function groq(messages, env, maxTokens = 300) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:       GROQ_MODEL,
      messages,
      temperature: 0.4,
      max_tokens:  maxTokens,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Groq ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

/* ── Chat ───────────────────────────────────────────────────────── */
async function chat(message, env) {
  return groq([
    { role: 'system', content: 'You are APEX AI, a sharp and helpful assistant. Be concise.' },
    { role: 'user',   content: message },
  ], env);
}

/* ── Web RAG ─────────────────────────────────────────────────────── */
async function rag(message, env) {
  let context = '';
  try {
    const r = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(message)}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'ApexAI/1.0' } }
    );
    const d = await r.json();
    const bits = [];
    if (d.AbstractText)    bits.push(d.AbstractText);
    if (d.Answer)          bits.push(d.Answer);
    (d.RelatedTopics || []).slice(0, 4).forEach(t => t.Text && bits.push(t.Text));
    context = bits.join('\n\n');
  } catch { /* fall back to model knowledge */ }

  return groq([
    {
      role: 'system',
      content: context
        ? `Answer using this web context:\n\n${context}\n\nIf the context is insufficient, use your own knowledge.`
        : 'Answer using your knowledge. Be concise and accurate.',
    },
    { role: 'user', content: message },
  ], env, 400);
}

/* ── Akinator ────────────────────────────────────────────────────── */
async function akinator(message, env) {
  return groq([
    {
      role: 'system',
      content: `You are playing Akinator. Guess the person the user is thinking of.
Rules:
- Ask ONE yes/no question per turn
- End each question with "(yes / no / unknown)"
- When confident (≤2 candidates), guess: "My guess: [Name]. Am I right? (yes/no)"
- If wrong, ask who they were thinking of, say you've learned it, then offer to play again
- Be fun and engaging`,
    },
    { role: 'user', content: message || 'start' },
  ], env);
}

/* ── Main handler ────────────────────────────────────────────────── */
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/api/chat' || request.method !== 'POST') {
      return new Response('Not found', { status: 404, headers: CORS });
    }

    let body;
    try { body = await request.json(); }
    catch { return respond({ error: 'Invalid JSON' }, 400); }

    const { session_id, message, mode = 'chat' } = body;
    const sid = session_id || crypto.randomUUID();

    try {
      let reply;
      if      (mode === 'rag')      reply = await rag(message, env);
      else if (mode === 'akinator') reply = await akinator(message, env);
      else                          reply = await chat(message, env);

      return respond({ session_id: sid, reply });
    } catch (err) {
      return respond({ session_id: sid, reply: `Error: ${err.message}` });
    }
  },
};
