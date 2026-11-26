export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. 处理跨域预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
          'Access-Control-Allow-Headers': '*',
        }
      });
    }
    
    // 2. 拦截 API 请求
    const isApiRequest = url.pathname === '/models' || url.pathname.startsWith('/anthropic/');
    
    if (isApiRequest) {
      
      // 【假校验】直接放行前端的 /models 测试
      if (url.pathname === '/models') {
        return new Response(JSON.stringify({ object: "list", data: [{ id: "deepseek-flash", object: "model" }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      
      // 提取前端带来的 Token
      const authHeader = request.headers.get('Authorization') || '';
      const xApiKey = request.headers.get('x-api-key') || '';
      const token = xApiKey || authHeader.replace('Bearer ', '');
      
      // 【严格校验】：验证 Token 是否合法（必须是 Base64 且包含我们的专属盐）
      let isValidToken = false;
      if (token) {
        try {
          const decoded = atob(token);
          if (decoded.includes("_reoseek_salt")) {
            isValidToken = true;
          }
        } catch (e) {
          isValidToken = false;
        }
      }
      
      if (!isValidToken) {
        return new Response(JSON.stringify({ error: '未授权，请前往 reoseek.de5.net 获取访问权限' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      
      // 构建发往 DeepSeek 的请求
      const newHeaders = new Headers(request.headers);
      newHeaders.delete('x-api-key');
      newHeaders.delete('Authorization');
      newHeaders.set('Authorization', `Bearer ${env.DEEPSEEK_API_KEY}`);
      newHeaders.set('x-api-key', env.DEEPSEEK_API_KEY);
      
      const targetUrl = `https://api.deepseek.com${url.pathname}${url.search}`;
      const proxyReq = new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body
      });
      
      try {
        const response = await fetch(proxyReq);
        const newResponse = new Response(response.body, response);
        newResponse.headers.set('Access-Control-Allow-Origin', '*');
        return newResponse;
      } catch (error) {
        return new Response(JSON.stringify({ error: '代理请求失败' }), { status: 502 });
      }
    }
    
    // 3. 静态资源处理与注入
    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get('Content-Type');
    
    if (contentType && contentType.includes('text/html')) {
      let html = await assetResponse.text();
      
      // 【前端强制驱逐脚本】
      const injectScript = `
        <script>
          (function() {
            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get('token');
            
            if (token) {
              // 如果 URL 带 token，保存到本地并清理 URL
              localStorage.setItem('reoseek_token', token);
              window.history.replaceState({}, document.title, window.location.pathname);
            } else {
              // 如果 URL 没带 token，检查本地有没有
              const localToken = localStorage.getItem('reoseek_token');
              if (!localToken) {
                // 本地也没有，直接踢回主域名
                window.location.href = "https://reoseek.de5.net";
              }
            }
          })();
        </script>
      `;
      
      if (html.includes('</head>')) {
        html = html.replace('</head>', `${injectScript}</head>`);
      } else {
        html = injectScript + html;
      }
      const newHeaders = new Headers(assetResponse.headers);
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      return new Response(html, { status: assetResponse.status, headers: newHeaders });
    }
    
    return assetResponse;
  }
};