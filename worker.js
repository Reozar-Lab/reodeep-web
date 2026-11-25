export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. 处理跨域预检请求 (CORS)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
          'Access-Control-Allow-Headers': '*',
        }
      });
    }
    
    // ==========================================
    // 2. 拦截 API 请求
    // ==========================================
    // 官方 Demo 会请求 /models 进行校验，请求 /anthropic/... 进行对话
    const isApiRequest = url.pathname === '/models' || url.pathname.startsWith('/anthropic/');
    
    if (isApiRequest) {
      
      // 【核心补丁】：直接拦截前端的 Key 校验请求，给它返回一个假成功，防止报错
      if (url.pathname === '/models') {
        return new Response(JSON.stringify({
          object: "list",
          data: [{ id: "deepseek-flash", object: "model" }]
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      
      // 提取前端带来的 Token
      const authHeader = request.headers.get('Authorization') || '';
      const xApiKey = request.headers.get('x-api-key') || '';
      const token = xApiKey || authHeader.replace('Bearer ', '');
      
      // 验证是不是我们网关发出去的假 Token
      if (!token.includes("_reoseek_salt")) {
        return new Response(JSON.stringify({ error: '未授权，请重新输入接入码' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      
      // 构建发往 DeepSeek 官方的请求
      const newHeaders = new Headers(request.headers);
      // 删掉前端的假凭证
      newHeaders.delete('x-api-key');
      newHeaders.delete('Authorization');
      // 注入你真实的 DeepSeek Key
      newHeaders.set('Authorization', `Bearer ${env.DEEPSEEK_API_KEY}`);
      newHeaders.set('x-api-key', env.DEEPSEEK_API_KEY);
      
      // 拼接目标 URL（直接原路径转发）
      const targetUrl = `https://api.deepseek.com${url.pathname}${url.search}`;
      
      const proxyReq = new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body // 流式透传
      });
      
      try {
        const response = await fetch(proxyReq);
        
        // 复制一份 response headers，加上 CORS
        const newResponse = new Response(response.body, response);
        newResponse.headers.set('Access-Control-Allow-Origin', '*');
        
        // 如果代理请求返回非 200，打印错误方便排查
        if (!response.ok) {
          console.error(`DeepSeek API Error: ${response.status} - ${await response.clone().text()}`);
        }
        
        return newResponse;
      } catch (error) {
        return new Response(JSON.stringify({ error: '代理请求失败', details: error.message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }
    
    // ==========================================
    // 3. 托管前端静态资源
    // ==========================================
    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get('Content-Type');
    
    // 4. 如果是 HTML 页面，注入脚本提取 URL 上的 Token 并保存到本地
    if (contentType && contentType.includes('text/html')) {
      let html = await assetResponse.text();
      
      const injectScript = `
        <script>
          (function() {
            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get('token');
            if (token) {
              localStorage.setItem('reoseek_token', token);
              // 清理 URL 里的 token，防止被分享出去
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
      // 防止 HTML 被缓存，确保每次跳转过来都能执行脚本获取 Token
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      
      return new Response(html, { status: assetResponse.status, headers: newHeaders });
    }
    
    // 其他静态资源（JS、CSS、图片）直接透传
    return assetResponse;
  }
};