# Pages Functions API Routes

Cloudflare Pages Functions route handlers under `functions/api/`.

## Route Structure

```
functions/api/
├── _middleware.js          # Global: HTTPS, security headers, observability
├── health.js               # GET /api/health
├── issues.js               # GET/POST /api/issues
├── issues/
│   └── [trackingCode].js   # GET /api/issues/:trackingCode
├── insights.js             # GET /api/insights
├── knowledge.js            # GET /api/knowledge
└── admin/
    ├── issues.js           # GET /api/admin/issues
    ├── issues/
    │   ├── [id].js         # GET/PATCH /api/admin/issues/:id
    │   │   ├── notes.js    # POST /api/admin/issues/:id/notes
    │   │   └── replies.js  # POST /api/admin/issues/:id/replies
    │   └── batch.js        # POST /api/admin/issues/batch
    ├── sla/
    │   ├── rules.js        # GET/POST /api/admin/sla/rules
    │   ├── rules/
    │   │   └── [id].js     # PATCH /api/admin/sla/rules/:id
    │   └── violations.js   # GET /api/admin/sla/violations
    ├── assign-rules.js     # GET/POST /api/admin/assign-rules
    ├── assign-rules/
    │   └── [id].js         # PATCH/DELETE /api/admin/assign-rules/:id
    ├── assign-stats.js     # GET /api/admin/assign-stats
    ├── knowledge.js        # GET/POST /api/admin/knowledge
    ├── knowledge/
    │   └── [id].js         # PATCH/DELETE /api/admin/knowledge/:id
    ├── actions.js          # GET /api/admin/actions
    ├── export.js           # GET /api/admin/export
    └── metrics.js          # GET /api/admin/metrics
```

## Route Handler Pattern

Every route exports `onRequest`:

```js
const ALLOWED_METHODS = 'GET, POST, OPTIONS';

export async function onRequest(context) {
  const { request, env } = context;
  // 1. CORS headers
  // 2. OPTIONS preflight
  // 3. Method guard → methodNotAllowedResponse
  // 4. Rate limiting
  // 5. Admin routes: origin check + Bearer auth
  // 6. try/catch wrapping
  // 7. Zod validation
  // 8. D1 queries
  // 9. Return response envelope
}
```

## Dynamic Route Parameters

- `[trackingCode]` → `context.params.trackingCode`
- `[id]` → `context.params.id`

## Middleware Chain

`_middleware.js` runs before every `/api/*` request:
1. HTTPS 308 redirect (production only)
2. Security headers (`X-Content-Type-Options`, `X-Frame-Options`, etc.)
3. Observability recording (async, non-blocking)
4. Calls `next()` to proceed to route handler

## Admin Route Additions

- Origin policy via `getAdminCorsPolicy` from `corsConfig.js`
- Bearer token via `authorizeAdminRequest` from `auth.js`
- Role guard via `requireAdminRole` from `auth.js` (restricts to `admin` role)
- `Cache-Control: no-store` on all responses
- Optimistic concurrency: PATCH/DELETE and batch update require `updatedAt`, return 409 on conflict
- Audit logging to `admin_actions` table

## Imports Convention

Group by responsibility:
```js
// 1. Auth/security
import { authorizeAdminRequest } from '../../shared/auth.js';
// 2. Request/response
import { parseJsonBody } from '../../shared/request.js';
import { successResponse, errorResponse } from '../../shared/response.js';
// 3. Data helpers
import { mapIssueRow } from '../../shared/issueData.js';
// 4. Validation
import { issueSchema } from '../../shared/validation.js';
// 5. Rate limiting
import { checkAdminRateLimit } from '../../shared/rateLimit.js';
```
