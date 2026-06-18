import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { onRequest as apiMiddleware } from '../functions/api/_middleware.js';

async function loadVersionedRouter() {
  try {
    return await import('../functions/v1/api/[[path]].js');
  } catch {
    return null;
  }
}

describe('phase 3 API versioning', () => {
  it('redirects unversioned API requests to the v1 path while preserving the query string', async () => {
    const response = await apiMiddleware({
      request: new Request('http://localhost/api/issues?page=2', { method: 'POST' }),
      env: {
        ENVIRONMENT: 'development',
      },
      next: async () => new Response('unexpected', { status: 200 }),
    });

    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe('http://localhost/v1/api/issues?page=2');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('keeps unversioned preflight requests on the legacy route', async () => {
    const response = await apiMiddleware({
      request: new Request('http://localhost/api/admin/issues', { method: 'OPTIONS' }),
      env: {
        ENVIRONMENT: 'development',
      },
      next: async () => new Response(null, { status: 204 }),
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('Location')).toBeNull();
  });

  it('does not redirect canonical v1 API requests', async () => {
    const response = await apiMiddleware({
      request: new Request('http://localhost/v1/api/issues', { method: 'GET' }),
      env: {
        ENVIRONMENT: 'development',
      },
      next: async () => new Response('ok', { status: 200 }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Location')).toBeNull();
  });

  it('matches collection and dynamic v1 routes to existing handlers', async () => {
    const router = await loadVersionedRouter();

    expect(router).not.toBeNull();
    if (!router) {
      return;
    }

    expect(router.matchVersionedApiPath(['issues'])).toMatchObject({
      routeKey: 'issues',
      params: {},
    });
    expect(router.matchVersionedApiPath(['issues', 'ABCD23EF'])).toMatchObject({
      routeKey: 'issueDetail',
      params: { trackingCode: 'ABCD23EF' },
    });
    expect(router.matchVersionedApiPath(['admin', 'issues', '42', 'notes'])).toMatchObject({
      routeKey: 'adminIssueNotes',
      params: { id: '42' },
    });
    expect(router.matchVersionedApiPath(['admin', 'sla', 'rules', '7'])).toMatchObject({
      routeKey: 'adminSlaRuleDetail',
      params: { id: '7' },
    });
  });

  it('returns the standard JSON envelope for unknown v1 routes', async () => {
    const router = await loadVersionedRouter();

    expect(router).not.toBeNull();
    if (!router) {
      return;
    }

    const response = await router.onRequest({
      request: new Request('http://localhost/v1/api/not-found'),
      env: {},
      params: {
        path: ['not-found'],
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({
      success: false,
      error: 'API 路由不存在',
    });
  });

  it('uses v1 as the canonical API base in live browser clients', () => {
    const publicScript = readFileSync(new URL('../public-app.js', import.meta.url), 'utf8');
    const adminScript = readFileSync(new URL('../admin-app.js', import.meta.url), 'utf8');
    const loginScript = readFileSync(new URL('../login-app.js', import.meta.url), 'utf8');
    const trackingPage = readFileSync(new URL('../tracking.html', import.meta.url), 'utf8');
    const healthScript = readFileSync(new URL('../health-app.js', import.meta.url), 'utf8');

    expect(publicScript).toContain("const API_BASE = '/v1/api';");
    expect(adminScript).toContain("const API_BASE = '/v1/api';");
    expect(loginScript).toContain("const API_BASE = '/v1/api';");
    expect(trackingPage).toContain("const API_BASE = '/v1/api';");
    expect(healthScript).toContain("fetchWithTimeout('/v1/api/health')");
  });
});

describe('phase 3 OpenAPI documentation', () => {
  it('provides a valid OpenAPI 3.0.3 document for every live endpoint', async () => {
    const openApiUrl = new URL('../docs/openapi.yaml', import.meta.url);
    const openApiPath = fileURLToPath(openApiUrl);
    const parserModule = await import('@apidevtools/swagger-parser').catch(() => null);

    expect(existsSync(openApiPath)).toBe(true);
    expect(parserModule).not.toBeNull();
    if (!existsSync(openApiPath) || !parserModule) {
      return;
    }

    const document = await parserModule.default.validate(openApiPath);
    const expectedOperations = {
      '/api/health': ['get'],
      '/api/issues': ['get', 'post'],
      '/api/issues/{trackingCode}': ['get'],
      '/api/insights': ['get'],
      '/api/knowledge': ['get'],
      '/api/admin/auth/login': ['post'],
      '/api/admin/auth/logout': ['post'],
      '/api/admin/auth/forgot-password': ['post'],
      '/api/admin/auth/reset-password': ['post'],
      '/api/admin/users': ['get', 'post'],
      '/api/admin/users/{id}': ['patch', 'delete'],
      '/api/admin/issues': ['get'],
      '/api/admin/issues/{id}': ['get', 'patch'],
      '/api/admin/issues/{id}/notes': ['post'],
      '/api/admin/issues/{id}/replies': ['post'],
      '/api/admin/issues/batch': ['post'],
      '/api/admin/assign-rules': ['get', 'post'],
      '/api/admin/assign-rules/{id}': ['patch', 'delete'],
      '/api/admin/assign-stats': ['get'],
      '/api/admin/sla/rules': ['get', 'post'],
      '/api/admin/sla/rules/{id}': ['patch'],
      '/api/admin/sla/violations': ['get'],
      '/api/admin/knowledge': ['get', 'post'],
      '/api/admin/knowledge/{id}': ['patch', 'delete'],
      '/api/admin/actions': ['get'],
      '/api/admin/export': ['get'],
      '/api/admin/metrics': ['get'],
    };

    expect(document.openapi).toBe('3.0.3');
    expect(document.servers).toContainEqual(expect.objectContaining({ url: '/v1' }));
    expect(document.components.securitySchemes).toMatchObject({
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
      },
      SharedKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
      },
    });
    expect(Object.keys(document.paths).sort()).toEqual(Object.keys(expectedOperations).sort());

    Object.entries(expectedOperations).forEach(([path, methods]) => {
      expect(Object.keys(document.paths[path]).filter((key) => methods.includes(key)).sort()).toEqual(methods.sort());

      methods.forEach((method) => {
        const operation = document.paths[path][method];
        const successResponse = Object.entries(operation.responses)
          .find(([status]) => /^2\d\d$/.test(status))?.[1];
        const errorResponse = operation.responses.default
          || operation.responses['400']
          || operation.responses['401']
          || operation.responses['403'];

        expect(operation.operationId).toBeTruthy();
        expect(operation.summary).toBeTruthy();
        expect(successResponse?.content).toBeTruthy();
        expect(errorResponse?.content).toBeTruthy();
      });
    });

    ['Issue', 'User', 'SLARule', 'AssignRule', 'KnowledgeItem', 'ErrorResponse'].forEach((schemaName) => {
      expect(document.components.schemas[schemaName]).toBeTruthy();
    });
  });

  it('includes request examples for every operation with a request body', async () => {
    const openApiPath = fileURLToPath(new URL('../docs/openapi.yaml', import.meta.url));
    const parserModule = await import('@apidevtools/swagger-parser').catch(() => null);

    expect(parserModule).not.toBeNull();
    if (!parserModule || !existsSync(openApiPath)) {
      return;
    }

    const document = await parserModule.default.validate(openApiPath);
    const requestBodyOperations = [
      ['/api/issues', 'post'],
      ['/api/admin/auth/login', 'post'],
      ['/api/admin/auth/forgot-password', 'post'],
      ['/api/admin/auth/reset-password', 'post'],
      ['/api/admin/users', 'post'],
      ['/api/admin/users/{id}', 'patch'],
      ['/api/admin/issues/{id}', 'patch'],
      ['/api/admin/issues/{id}/notes', 'post'],
      ['/api/admin/issues/{id}/replies', 'post'],
      ['/api/admin/issues/batch', 'post'],
      ['/api/admin/assign-rules', 'post'],
      ['/api/admin/assign-rules/{id}', 'patch'],
      ['/api/admin/sla/rules', 'post'],
      ['/api/admin/sla/rules/{id}', 'patch'],
      ['/api/admin/knowledge', 'post'],
      ['/api/admin/knowledge/{id}', 'patch'],
      ['/api/admin/knowledge/{id}', 'delete'],
    ];

    requestBodyOperations.forEach(([path, method]) => {
      const mediaType = document.paths[path][method].requestBody?.content?.['application/json'];
      expect(mediaType?.example || mediaType?.examples || mediaType?.schema?.example).toBeTruthy();
    });
  });
});

describe('phase 3 Swagger UI', () => {
  it('builds local Swagger UI assets and configures authenticated requests', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const swaggerIndexUrl = new URL('../docs/swagger/index.html', import.meta.url);
    const initializerUrl = new URL('../docs/swagger/swagger-initializer.js', import.meta.url);

    expect(packageJson.devDependencies['swagger-ui-dist']).toBeTruthy();
    expect(packageJson.scripts['build:swagger']).toBeTruthy();
    expect(packageJson.scripts.build).toContain('build:swagger');
    expect(existsSync(fileURLToPath(swaggerIndexUrl))).toBe(true);
    expect(existsSync(fileURLToPath(initializerUrl))).toBe(true);
    if (!existsSync(fileURLToPath(swaggerIndexUrl)) || !existsSync(fileURLToPath(initializerUrl))) {
      return;
    }

    const html = readFileSync(swaggerIndexUrl, 'utf8');
    const initializer = readFileSync(initializerUrl, 'utf8');

    expect(html).toContain('./swagger-ui.css');
    expect(html).toContain('./swagger-ui-bundle.js');
    expect(html).toContain('./swagger-ui-standalone-preset.js');
    expect(initializer).toContain("url: '/docs/openapi.yaml'");
    expect(initializer).toContain("window.localStorage.getItem('admin_token')");
    expect(initializer).toContain("window.sessionStorage.getItem('issue-admin-secret')");
    expect(initializer).toContain("req.headers.Authorization = `Bearer ${token}`");
  });

  it('provides the API documentation page with an authentication status', () => {
    const apiPageUrl = new URL('../docs/api.html', import.meta.url);

    expect(existsSync(fileURLToPath(apiPageUrl))).toBe(true);
    if (!existsSync(fileURLToPath(apiPageUrl))) {
      return;
    }

    const html = readFileSync(apiPageUrl, 'utf8');
    expect(html).toContain('id="authStatus"');
    expect(html).toContain('/docs/swagger/index.html');
    expect(html).toContain('/docs/openapi.yaml');
    expect(html).toContain('id="swagger-ui"');
    expect(html).not.toContain('<iframe');
  });

  it('links the developer documentation from public and admin navigation', () => {
    const publicPage = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const adminPage = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

    expect(publicPage).toContain('href="/docs/api.html"');
    expect(publicPage).toContain('开发者文档');
    expect(adminPage).toContain('href="/docs/api.html"');
    expect(adminPage).toContain('API 文档');
  });
});
