function getStoredAdminToken() {
  return window.localStorage.getItem('admin_token')
    || window.sessionStorage.getItem('issue-admin-secret')
    || '';
}

function updateAuthenticationStatus() {
  const status = document.getElementById('authStatus');
  if (!status) {
    return;
  }

  status.textContent = getStoredAdminToken()
    ? '已检测到后台认证，可直接测试管理接口'
    : '未检测到后台认证；管理接口将返回 401';
}

window.addEventListener('storage', updateAuthenticationStatus);

window.addEventListener('load', () => {
  updateAuthenticationStatus();

  window.ui = window.SwaggerUIBundle({
    url: '/docs/openapi.yaml',
    dom_id: '#swagger-ui',
    deepLinking: true,
    displayRequestDuration: true,
    persistAuthorization: true,
    presets: [
      window.SwaggerUIBundle.presets.apis,
      window.SwaggerUIStandalonePreset,
    ],
    layout: 'StandaloneLayout',
    requestInterceptor: (req) => {
      const token = getStoredAdminToken();
      if (token && !req.headers.Authorization) {
        req.headers.Authorization = `Bearer ${token}`;
      }
      return req;
    },
  });
});
