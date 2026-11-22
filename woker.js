/**
 * reodeep.de5.net 一体化Worker
 * 功能：
 * 1. 静态页面：Assets返回chat-demo前端
 * 2. /v1/chat/completions 转发DeepSeek
 * 3. /api/save 保存会话到D1
 * 4. /api/load 读取D1会话
 */
const upstreamUrl = "https://api.deepseek.com/v1/chat/completions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

/**
 * 预检OPTIONS
 */
async function handleOptions() {
  return new Response(null, { headers: corsHeaders });
}

/**
 * DeepSeek API代理转发
 */
async function handleProxy(request, env) {
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${env.DEEPSEEK_API_KEY}`);
  headers.delete("Origin");
  headers.delete("Referer");
  
  const upstreamRes = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: request.body,
    signal: request.signal
  });
  
  const newHeaders = new Headers(upstreamRes.headers);
  for (const [k, v] of Object.entries(corsHeaders)) {
    newHeaders.set(k, v);
  }
  return new Response(upstreamRes.body, { headers: newHeaders, status: upstreamRes.status });
}

/**
 * POST /api/save 保存会话
 */
async function handleSaveSession(request, env) {
  const { sessionId, messages } = await request.json();
  await env.DB.prepare(`
    INSERT OR REPLACE INTO sessions (session_id, data, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).bind(sessionId, JSON.stringify(messages)).run();
  return Response.json({ ok: true });
}

/**
 * GET /api/load 读取会话
 */
async function handleLoadSession(request, env, url) {
  const sessionId = url.searchParams.get("sessionId");
  const row = await env.DB.prepare(`
    SELECT data FROM sessions WHERE session_id = ?
  `).bind(sessionId).first();
  return Response.json({
    messages: row ? JSON.parse(row.data) : []
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (request.method === "OPTIONS") {
      return handleOptions();
    }
    
    // AI接口代理
    if (url.pathname === "/v1/chat/completions") {
      return handleProxy(request, env);
    }
    
    // D1保存会话
    if (url.pathname === "/api/save" && request.method === "POST") {
      return handleSaveSession(request, env);
    }
    
    // D1读取会话
    if (url.pathname === "/api/load" && request.method === "GET") {
      return handleLoadSession(request, env, url);
    }
    
    // 其余全部交给Assets返回前端页面
    return env.ASSETS.fetch(request);
  }
};