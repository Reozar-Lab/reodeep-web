export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. 登录验证接口
    if (url.pathname === '/api/login' && request.method === 'POST') {
      try {
        const { password } = await request.json();
        if (password === env.ACCESS_CODE) {
          return new Response(JSON.stringify({ success: true, apiKey: env.DEEPSEEK_API_KEY }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response('Bad Request', { status: 400 });
      }
    }
    
    // 2. 返回前端资源并注入拦截脚本
    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get('Content-Type');
    
    if (contentType && contentType.includes('text/html')) {
      let html = await assetResponse.text();
      
      // 注入全屏拦截脚本
      const injectScript = `
        <script>
          (function() {
            // 检查是否已验证过
            const isLogged = localStorage.getItem('reoseek_verified');
            if (isLogged === 'true') return; // 已登录，放行给官方React

            // 没登录，直接抹掉整个页面，盖上一块黑布
            document.write(\`
              <style>
                body { margin: 0; padding: 0; background-color: #111; color: #f5d78d; font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; }
                .login-box { background: #1c1c1e; padding: 40px 30px; border-radius: 20px; border: 1px solid #333; text-align: center; width: 280px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
                h2 { margin-top: 0; letter-spacing: 0.1em; font-size: 20px; }
                p { font-size: 13px; opacity: 0.6; margin-bottom: 25px; }
                input { width: 100%; box-sizing: border-box; padding: 14px; border-radius: 10px; border: 1px solid #333; background: #000; color: #fff; margin-bottom: 20px; text-align: center; font-size: 16px; outline: none; transition: border 0.2s; }
                input:focus { border-color: #f5d78d; }
                button { width: 100%; padding: 14px; border-radius: 10px; border: none; background: linear-gradient(to right, #e8c88c, #c89f5d); color: #000; font-weight: bold; cursor: pointer; font-size: 15px; transition: 0.2s; }
                button:active { transform: scale(0.98); }
              </style>
              <div class="login-box">
                <h2>Reoseek 访问验证</h2>
                <p>请输入访问密码进入镜像站</p>
                <input type="password" id="reo-pwd" placeholder="输入密码" autofocus>
                <button onclick="window.doReoLogin()">进入系统</button>
              </div>
            \`);

            // 登录逻辑
            window.doReoLogin = async function() {
              const pwd = document.getElementById('reo-pwd').value;
              if (!pwd) return;

              const btn = document.querySelector('button');
              btn.textContent = '验证中...';
              btn.disabled = true;

              try {
                const res = await fetch('/api/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ password: pwd })
                });

                if (res.ok) {
                  const data = await res.json();
                  
                  // 🌟 暴力遍历 localStorage，把所有疑似 API Key 的地方全改成我们的真 Key
                  for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    try {
                      const val = JSON.parse(localStorage.getItem(key));
                      if (val && typeof val === 'object') {
                        // 匹配扁平或嵌套的 apiKey/api_key 字段
                        let changed = false;
                        if (val.apiKey) { val.apiKey = data.apiKey; changed = true; }
                        if (val.api_key) { val.api_key = data.apiKey; changed = true; }
                        if (val.state && val.state.apiKey) { val.state.apiKey = data.apiKey; changed = true; }
                        if (val.state && val.state.api_key) { val.state.api_key = data.apiKey; changed = true; }
                        
                        if (changed) localStorage.setItem(key, JSON.stringify(val));
                      }
                    } catch (e) {}
                  }

                  // 强行注入官方可能需要的默认存储位置
                  const fallback = JSON.stringify({ apiKey: data.apiKey, state: { apiKey: data.apiKey } });
                  localStorage.setItem('settings', fallback);
                  localStorage.setItem('chat-demo-settings', fallback);

                  // 标记已验证，防止刷新后再次弹窗
                  localStorage.setItem('reoseek_verified', 'true');
                  
                  // 刷新页面，此时黑布撤去，官方 UI 启动
                  location.reload(); 
                } else {
                  alert('密码错误，请重新输入');
                  btn.textContent = '进入系统';
                  btn.disabled = false;
                }
              } catch (err) {
                alert('网络错误，请重试');
                btn.textContent = '进入系统';
                btn.disabled = false;
              }
            };
            
            // 绑定回车键
            document.getElementById('reo-pwd').addEventListener('keydown', (e) => {
              if (e.key === 'Enter') window.doReoLogin();
            });
          })();
        </script>
      `;
      
      // 将脚本插入到最前面，绝对不让官方 React 抢在前面
      html = html.replace('<head>', `<head>${injectScript}`);
      
      const newHeaders = new Headers(assetResponse.headers);
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      return new Response(html, { status: assetResponse.status, headers: newHeaders });
    }
    
    return assetResponse;
  }
};