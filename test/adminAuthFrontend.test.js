import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('admin auth frontend', () => {
  it('provides a login page with password login, remember-me, forgot password and shared-key fallback', () => {
    const html = readSource('login.html');

    expect(html).toContain('id="username"');
    expect(html).toContain('id="password"');
    expect(html).toContain('id="rememberMe"');
    expect(html).toContain('id="forgotPasswordButton"');
    expect(html).toContain('id="sharedKeyLoginForm"');
    expect(html).toContain('id="loginNotification"');
    expect(html).toContain('src="/login-app.js"');
  });

  it('stores JWT auth state and calls the expected auth endpoints from login-app', () => {
    const script = readSource('login-app.js');

    expect(script).toContain("ADMIN_TOKEN_KEY = 'admin_token'");
    expect(script).toContain("ADMIN_USER_KEY = 'admin_user'");
    expect(script).toContain("apiFetch('/admin/auth/login'");
    expect(script).toContain("apiFetch('/admin/auth/forgot-password'");
    expect(script).toContain("window.localStorage.setItem(ADMIN_TOKEN_KEY");
    expect(script).toContain("window.location.assign('/admin.html')");
  });

  it('adds user management UI to the admin page', () => {
    const html = readSource('admin.html');

    expect(html).toContain('href="#userSection"');
    expect(html).toContain('id="userSection"');
    expect(html).toContain('id="userList"');
    expect(html).toContain('id="userModal"');
    expect(html).toContain('id="createUserButton"');
  });

  it('provides a login redirect button on the admin page for JWT login', () => {
    const html = readSource('admin.html');

    expect(html).toContain('href="/login.html"');
    expect(html).toContain('使用账号密码登录');
    expect(html).toContain('或使用共享密钥');
    expect(html).toContain('id="loginForm"');
  });

  it('uses stored JWT auth, 401 redirect handling, logout API and user endpoints in admin-app', () => {
    const script = readSource('admin-app.js');

    expect(script).toContain("ADMIN_TOKEN_KEY = 'admin_token'");
    expect(script).toContain("ADMIN_USER_KEY = 'admin_user'");
    expect(script).toContain("response.status === 401");
    expect(script).toContain("window.location.assign('/login.html')");
    expect(script).toContain("apiFetch('/admin/auth/logout'");
    expect(script).toContain("apiFetch('/admin/users'");
    expect(script).toContain('renderUsers');
  });
});
