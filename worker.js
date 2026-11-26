export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. 登录验证接口：验证通过，直接下发真实 API Key！
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
      
      // 核心注入脚本
      const injectScript = `
        <script>
          (async function() {
            // 检查是否已经通过验证并注入了 Key
            const isLogged = localStorage.getItem('reoseek_verified');
            
            if (isLogged === 'true') {
              return; // 已验证，正常放行，加载官方 UI
            }

            // 未验证，锁死页面，防止官方 React 初始化
            document.documentElement.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#111;color:#f5d78d;font-family:sans-serif;"><h2>正在连接 Reoseek 安全网关...</h2></div>';
            
            // 弹窗要求输入密码
            const pwd = prompt("【Reoseek 安全网关】请输入访问密码：");
            
            if (!pwd) {
              document.documentElement.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#111;color:#f5d78d;font-family:sans-serif;"><h2>已取消访问</h2></div>';
              return;
            }

            try {
              // 向后端请求真 Key
              const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd })
              });
              
              if (res.ok) {
                const data = await res.json();
                
                // 🌟 最高黑科技：暴力遍历官方的 localStorage，把里面的 apiKey 强制改成你下发的真 Key
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  try {
                    const val = JSON.parse(localStorage.getItem(key));
                    if (val && typeof val === 'object') {
                      // 找到包含 apiKey 属性的对象，强行覆盖
                      if ('apiKey' in val || 'api_key' in val) {
                        if ('apiKey' in val) val.apiKey = data.apiKey;
                        if ('api_key' in val) val.api_key = data.apiKey;
                        localStorage.setItem(key, JSON.stringify(val));
                      }
                    }
                  } catch (e) {
                    // 忽略非 JSON 格式的 localStorage
                  }
                }

                // 如果官方没有现成配置，我们直接造一个常见的（以防万一）
                // 官方一般会存一个类似 settings 的键
                const fallbackSettings = { apiKey: data.apiKey };
                localStorage.setItem('settings', JSON.stringify(fallbackSettings));
                localStorage.setItem('chat-demo-settings', JSON.stringify(fallbackSettings));
                
                // 标记已通过验证
                localStorage.setItem('reoseek_verified', 'true');
                
                // 刷新页面！此时官方 React 启动，读到了已经被我们篡改的配置，直接开门！
                location.reload(); 
              } else {
                alert("密码错误！");
                location.reload();
              }
            } catch (e) {
              alert("网络请求失败，请刷新重试");
            }
          })();
        </script>
      `;
      
      // 将脚本插入到 HTML 最前面，确保它比官方 React 的脚本先执行
      html = html.replace('<head>', `<head>${injectScript}`);
      
      const newHeaders = new Headers(assetResponse.headers);
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      return new Response(html, { status: assetResponse.status, headers: newHeaders });
    }
    
    return assetResponse;
  }
};