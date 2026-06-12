# Shared Backend Helpers

25 modules imported by both Pages Functions (server) and browser scripts (client).

## Module Inventory

| Module | Purpose | Browser-Safe |
|--------|---------|:------------:|
| `assignment.js` | Auto-assignment rules, Chinese text segmentation (jieba-wasm), keyword matching. | ✗ |
| `auth.js` | Admin Bearer auth + origin policy. Re-exports from `corsConfig.js` for compatibility. | ✗ |
| `constants.js` | Enum arrays: `STATUS_VALUES`, `CATEGORY_VALUES`, `PRIORITY_VALUES`, `SLA_STATUS_VALUES`, `ASSIGN_STATS_PERIOD_VALUES`, etc. | ✓ |
| `corsConfig.js` | CORS policy definitions for public and admin routes. | ✗ |
| `csv.js` | CSV generation helpers for admin export. | ✗ |
| `email.js` | Resend email notification integration. | ✗ |
| `issueData.js` | Issue mapping, pagination, data shaping. Re-exports `toBoolean` from `utils.js`. | ✗ |
| `issueQueries.js` | SQL WHERE/ORDER builders for issue queries. Includes SLA status filters and legacy sort maps. | ✗ |
| `knowledgeData.js` | Knowledge base data helpers. | ✗ |
| `labels.js` | Display label mappings (categories, status, distress types). | ✓ |
| `observability.js` | Request recording, error log extraction. | ✗ |
| `rateLimit.js` | KV-backed rate limiting with D1 fallback. Includes `adminBatch` config. | ✗ |
| `request.js` | `parseJsonBody()` and request utilities. | ✗ |
| `response.js` | `successResponse`, `errorResponse`, `notFoundResponse` envelope helpers. | ✗ |
| `security.js` | HTTPS enforcement, security headers. | ✗ |
| `sla.js` | SLA rule mapping, deadline calculation, violation detection, SLA status helpers. | ✗ |
| `sql.js` | SQL fragment builders for safe dynamic queries. | ✗ |
| `tracking.js` | Unique tracking code generation (nanoid). | ✗ |
| `utils.js` | General utilities: `toBoolean`, `parseJsonValue`. | ✓ |
| `validation.js` | All Zod schemas: `issueSchema`, `batchUpdateSchema`, `slaRuleSchema`, `assignRuleSchema`, etc. | ✗ |
| `campusMapGeometry.js` | Campus map SVG geometry utilities. | ✓ |
| `campusMapHeat.js` | Heat map normalization for campus map. | ✓ |
| `campusMapProjection.js` | Campus map projection constants. | ✓ |
| `campusMapResponse.js` | Campus map response parsing. | ✓ |
| `campusMapRules.js` | Campus map business rules. | ✓ |

## Import Patterns

```js
// In Pages Functions (server)
import { authorizeAdminRequest } from '../../shared/auth.js';
import { successResponse, errorResponse } from '../../shared/response.js';
import { issueSchema } from '../../shared/validation.js';

// In browser scripts (client)
import { CATEGORY_LABELS, STATUS_LABELS } from './src/shared/labels.js';
import { normalizeHeatValue } from './src/shared/campusMapHeat.js';
```

## Key Conventions

- Always include `.js` extension on relative imports.
- Browser-safe modules (`✓` above) must not use Node-only APIs (no `fs`, `path`, `process.env`).
- Server-only modules (`✗`) import from `zod`, use `process.env`, or access D1/KV bindings.
- Reuse these helpers instead of duplicating logic in routes or browser scripts.
- `auth.js` re-exports from `corsConfig.js` for backward compatibility; prefer importing from `corsConfig.js` directly.
