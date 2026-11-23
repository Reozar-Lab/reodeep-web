// reodeep Worker —— 精简版
// 功能：注册 / 登录 / 登出 / 对话代理（自动注入 API Key，前端不接触密钥）
// 无外部 npm 依赖；密码用 Web Crypto PBKDF2 哈希；会话存 D1，Cookie 为 HttpOnly

const SESSION_DAY = 7;
const DEEPSEEK_MODEL = "deepseek-flash";

// ---------- 工具函数 ----------

function getCookie(cookieStr, key) {
  if (!cookieStr) return null;
  const map = {};
  cookieStr.split(';').forEach(item => {
    const [k, v] = item.trim().split('=');
    if (k) map[k] = v;
  });
  return map[key] || null;
}

function setSessionCookie(sessionId, expireAt) {
  const d = new Date(expireAt * 1000);
  return `__Host-session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=${d.toUTCString()}`;
}

// PBKDF2 密码哈希（无第三方依赖），返回 "salt:hash"
async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = crypto.randomUUID();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return `${salt}:${hash}`;
}

async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const candidate = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return candidate === hash;
}

// 鉴权：读 Cookie 里的 session_id，查 D1 得到 user_id
async function auth(env, cookie) {
  if (!cookie) return null;
  const row = await env.DB.prepare(`
    SELECT user_id FROM user_sessions
    WHERE session_id = ? AND expire_at > unixepoch()
  `).bind(cookie).first();
  return row ? row.user_id : null;
}



export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cookie = getCookie(request.headers.get('Cookie'), '__Host-session');

    // 登录态探测（页面刷新时恢复）
    if (path === '/api/auth/me' && method === 'GET') {
      const uid = await auth(env, cookie);
      if (!uid) return Response.json({ err: "未登录" }, { status: 401 });
      return Response.json({ ok: true });
    }

    // 注册
    if (path === '/api/auth/register' && method === 'POST') {
      const { username, password } = await request.json();
      if (!username || !password) {
        return Response.json({ err: "账号密码不能为空" }, { status: 400 });
      }
      const exists = await env.DB.prepare(`SELECT id FROM users WHERE username = ?`)
        .bind(username).first();
      if (exists) {
        return Response.json({ err: "用户名已存在" }, { status: 400 });
      }
      const hash = await hashPassword(password);
      const ins = await env.DB.prepare(`
        INSERT INTO users(username, password_hash) VALUES (?, ?)
      `).bind(username, hash).run();

      const sid = crypto.randomUUID();
      const exp = Math.floor(Date.now() / 1000) + SESSION_DAY * 86400;
      await env.DB.prepare(`
        INSERT INTO user_sessions(session_id, user_id, expire_at) VALUES (?, ?, ?)
      `).bind(sid, ins.meta.last_row_id, exp).run();

      return Response.json({ ok: true }, {
        headers: { "Set-Cookie": setSessionCookie(sid, exp) }
      });
    }

    // 登录
    if (path === '/api/auth/login' && method === 'POST') {
      const { username, password } = await request.json();
      const user = await env.DB.prepare(`
        SELECT id, password_hash FROM users WHERE username = ?
      `).bind(username).first();
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return Response.json({ err: "账号或密码错误" }, { status: 401 });
      }
      const sid = crypto.randomUUID();
      const exp = Math.floor(Date.now() / 1000) + SESSION_DAY * 86400;
      await env.DB.prepare(`
        INSERT INTO user_sessions(session_id, user_id, expire_at) VALUES (?, ?, ?)
      `).bind(sid, user.id, exp).run();

      return Response.json({ ok: true }, {
        headers: { "Set-Cookie": setSessionCookie(sid, exp) }
      });
    }

    // 登出
    if (path === '/api/auth/logout' && method === 'POST') {
      if (cookie) {
        await env.DB.prepare(`DELETE FROM user_sessions WHERE session_id = ?`)
          .bind(cookie).run();
      }
      return Response.json({ ok: true }, {
        headers: {
          "Set-Cookie": `__Host-session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
        }
      });
    }

    // 对话代理：鉴权通过后，Worker 自动注入控制台配置的 API Key
    if (path === '/v1/chat/completions' && method === 'POST') {
      const uid = await auth(env, cookie);
      if (!uid) return Response.json({ err: "未登录" }, { status: 401 });

      const body = await request.json();
      const payload = { ...body, model: DEEPSEEK_MODEL };

      const upstream = await fetch(
        `${env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env["DEEPSEEK-API"]}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      );

      // SSE 流式透传
      return new Response(upstream.body, {
        status: upstream.status,
        headers: upstream.headers
      });
    }

    // 其余路径：返回前端静态页面
    return env.ASSETS.fetch(request);
  }
};
