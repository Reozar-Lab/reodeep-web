export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. 处理 CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
          'Access-Control-Allow-Headers': '*',
        }
      });
    }
    
    // 2. 拦截 API 请求 (官方 demo 会请求 /models 和 /anthropic/...)
    const isApiRequest = url.pathname === '/models' || url.pathname.startsWith('/anthropic/');
    
    if (isApiRequest) {
      const authHeader = request.headers.get('Authorization') || '';
      const xApiKey = request.headers.get('x-api-key') || '';
      const token = xApiKey || authHeader.replace('Bearer ', '');
      
      // 验证假 Token
      if (!token.includes("_reoseek_salt")) {
        return new Response(JSON.stringify({ error: '未授权，请重新输入接入码' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
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
    
    // 3. 托管静态资源
    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get('Content-Type');
    
    // 4. 如果是 HTML，注入脚本提取 URL 里的 Token
    if (contentType && contentType.includes('text/html')) {
      let html = await assetResponse.text();
      const injectScript = `
        <script>
          (function() {
            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get('token');
            if (token) {
              localStorage.setItem('reoseek_token', token);
              window.history.replaceState({}, document.title, window.location.pathname);
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