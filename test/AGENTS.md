# Test Suite

Vitest test files covering API routes, shared helpers, middleware, and frontend structure.

## Layout

```
test/
├── helpers/
│   └── fakeCloudflare.js   # D1/KV/env test doubles
├── *.test.js               # 38 test files (flat, no subdirs)
```

## FakeCloudflare API

Central test helper. Import from `./helpers/fakeCloudflare.js`.

### `createD1Database()`

Returns `FakeD1Database` with in-memory tables:
- `issues`, `issueUpdates`, `issueInternalNotes`, `adminActions`
- `knowledgeItems`, `rateLimitState`, `requestObservations`

Methods:
- `prepare(sql).bind(...).run()` / `.first()` / `.all()` — SQL pattern matching
- `batch([statements])` — transactional with rollback
- `snapshot()` / `.restore()` — for concurrency testing

### `createRateLimitKv(initial?)`

Returns `Map`-backed KV namespace mock with `get`/`put`/`delete`.

### `createAppEnv(overrides?)`

Factory returning `{ ADMIN_SECRET_KEY, ENVIRONMENT, RATE_LIMIT_KV, DB, ...overrides }`.

## Test Patterns

### Route Handler Test

```js
import { onRequest } from '../functions/api/issues.js';
import { createAppEnv } from './helpers/fakeCloudflare.js';

const response = await onRequest({
  request: new Request('http://localhost/api/issues', { method: 'POST', ... }),
  env: createAppEnv(),
  params: { trackingCode: '...' },
});
const payload = await response.json();
```

### Error Suppression

```js
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
// ... test that triggers console.error ...
errorSpy.mockRestore();
```

### Request Builder (Test-Local)

Each route test defines local helpers:
```js
function createJsonRequest(url, method, body, headers = {}) { ... }
function createIssuePayload(overrides = {}) { ... }
```

### Frontend HTML Tests

```js
import { readFileSync } from 'fs';
const html = readFileSync('index.html', 'utf-8');
expect(html).toContain('data-side-nav-shell');
```

## Naming

- Files: `camelCase.test.js` (e.g., `adminIssuesRoute.test.js`)
- Describe blocks: English
- String content: Chinese (matching zh-CN locale)

## Coverage

- Provider: v8
- Targets: `functions/api/**/*.js`, `src/shared/**/*.js`
- Thresholds: 80% lines/statements/functions, 60% branches
- Output: `output/coverage/`
