# Code Review Summary

**Review date**: 2026-03-07
**Scope**: Whole repository implementation review (frontend, Pages Functions, worker entrypoints, shared modules, config, schema, docs)
**Files reviewed in depth**: `package.json`, `wrangler.toml`, `schema.sql`, `index.html`, `admin.html`, `health.html`, `_worker.js`, `src/index.js`, `src/shared/auth.js`, `src/shared/rateLimit.js`, `functions/api/issues.js`, `functions/api/health.js`, `functions/api/admin/issues.js`, `README.md`
**Excluded from deep review**: `node_modules/`, generated CSS details in `styles.css`, local secret values in `.dev.vars`
**Overall assessment**: `REQUEST_CHANGES`

---

## Findings

### P1 - High

1. **[wrangler.toml:21-40] Preview and production share the same D1 database and KV namespace**
   - `env.production` and `env.preview` both bind to the same `database_id` and the same `RATE_LIMIT_KV` id.
   - This means every preview deployment reads and writes the live issue table and shares the same rate-limit state.
   - A preview branch can pollute production data, skew rate-limit counters, and make unreviewed code operate on real user submissions.
   - Suggested fix:
     - Create separate preview D1/KV resources.
     - If preview does not need writes, make preview read-only or disable submission/admin routes there.

2. **[src/shared/auth.js:36-60] Admin CORS policy is too permissive and can be bypassed**
   - Production checks `origin.startsWith(allowed)`, which accepts attacker-controlled origins like `https://issue.calvin-xia.cn.evil.example`.
   - Non-production falls back to `Access-Control-Allow-Origin: *`, and preview is explicitly configured as non-production in `wrangler.toml`.
   - Because `/api/admin/issues` returns PII, the origin check needs to be exact and explicit per environment.
   - Suggested fix:
     - Parse `new URL(origin).origin` and compare for exact equality.
     - Replace preview wildcard CORS with an explicit allowlist.
     - Add `Vary: Origin` on admin responses.

3. **[package.json:9-12] [README.md:30-37] [README.md:208-218] The documented Workers deployment path is not actually supported by the current config**
   - The repository claims to support both Workers and Pages deployments, and `npm run deploy` calls `wrangler deploy`.
   - A local `wrangler deploy --dry-run` confirms Wrangler recognizes this repo as a Pages project and rejects the Workers deploy command.
   - At the same time, there are three backend implementations with divergent behavior:
     - `functions/api/issues.js:21-49` returns paginated data ordered by `created_at DESC`.
     - `_worker.js:113-129` returns non-paginated data ordered by `created_at ASC`.
     - `_worker.js:243-264` returns admin data without pagination, while `admin.html:228-247` and `admin.html:322-385` expect pagination metadata.
     - `src/index.js:102-118` also returns non-paginated public data and does not expose `/admin.html`.
   - This is both an operational problem (broken deploy path) and a correctness problem (runtime behavior depends on which entrypoint is used).
   - Suggested fix:
     - Pick one authoritative runtime surface, preferably Pages Functions given the current config.
     - Remove or quarantine unused entrypoints.
     - Align `package.json` scripts and `README.md` with the actual supported deployment mode.

4. **[src/shared/rateLimit.js:32-54] Rate limiting is race-prone and does not enforce the advertised block duration**
   - The limiter does a `get` followed by `put` against KV. That is a read-modify-write sequence with no atomicity, so concurrent requests can exceed the configured thresholds.
   - `blockDuration` is only echoed back in the response. The actual stored TTL is always `periodSeconds`, so `postIssue` claims a 300-second backoff while persisting only a 60-second counter window.
   - The current implementation therefore gives weaker abuse protection than the code and docs imply.
   - Suggested fix:
     - Move rate limiting to an atomic primitive (for example Durable Objects or a transactional store).
     - If KV must remain, add a dedicated block key with its own TTL and accept that the quota counter is still approximate.

### P2 - Medium

5. **[functions/api/issues.js:63-64] Malformed JSON is reported as a 500 instead of a 400**
   - `await request.json()` is outside a request-validation boundary, so invalid JSON falls into the outer catch and becomes an internal server error.
   - The same bug is duplicated in `_worker.js:137-138` and `src/index.js:126-127`.
   - This makes client mistakes look like server failures and creates noisy logs/alerts.
   - Suggested fix:
     - Wrap JSON parsing in a narrow `try/catch`.
     - Return `400` with a stable error like `请求体不是合法 JSON`.

6. **[schema.sql:6-13] Database constraints do not enforce the invariants the application depends on**
   - The schema comments say `issue` is capped at 1000 chars, `name` at 20 chars, `student_id` must match 4/5/13 digits, and flags are effectively `yes/no`.
   - None of those invariants are enforced in the table definition.
   - Since the repo already has multiple write paths and encourages manual D1 commands in the README, invalid rows can be inserted and later break UI assumptions.
   - Suggested fix:
     - Add `CHECK` constraints for length limits and student ID format.
     - Add `CHECK` constraints for `isInformationPublic` and `isReport` to only allow expected values.

7. **[admin.html:330-333] Admin dashboard summary cards show per-page counts but are labeled as global metrics**
   - `totalCount` uses server pagination metadata, but `publicCount`, `reportCount`, and `todayCount` are computed from the current page only.
   - Once the table spans multiple pages, the dashboard silently misreports the dataset.
   - Suggested fix:
     - Return aggregate counters from `/api/admin/issues`, or
     - Relabel these cards as “当前页公开实名 / 当前页请求上报 / 当前页今日新增”.

### P3 - Low

8. **[index.html:105-107] [index.html:334-343] [admin.html:126-135] [admin.html:352] The UI labels timestamps as UTC, but formatting uses local time**
   - Both pages call `new Date(...)` and format with local `getHours()` / `getDate()` APIs.
   - The page copy explicitly says “UTC标准时间” and “提交时间(UTC)”, so the UI is currently lying about the displayed timezone.
   - `admin.html:isToday()` also uses the viewer's local date boundary, so “今日新增” changes with browser timezone rather than a defined business timezone.
   - Suggested fix:
     - Either use `getUTC*()` consistently, or
     - Remove the UTC label and format in the user's locale on purpose.

---

## Removal / Iteration Plan

### Defer Removal - Consolidate runtime entrypoints

| Field | Details |
|-------|---------|
| **Location** | `_worker.js`, `src/index.js`, `functions/api/issues.js`, `functions/api/admin/issues.js`, `functions/api/health.js`, `package.json`, `README.md` |
| **Why defer** | The repo currently documents multiple deployment modes, so deleting one path without an explicit product/deployment decision is risky. |
| **Preconditions** | Decide whether the supported runtime is Pages only or genuinely dual-mode. |
| **Breaking changes** | Deployment commands, local dev flow, and API behavior may change depending on the chosen path. |
| **Migration plan** | 1. Pick the authoritative runtime. 2. Freeze API contract in integration tests. 3. Remove unused entrypoints and docs. 4. Re-test deploy scripts and admin/public pages. |
| **Validation** | `wrangler pages dev`, `wrangler pages deploy` dry-run, public submit/read flow, admin login/pagination flow, health endpoint |
| **Rollback plan** | Keep the removed path on a branch until the new deployment process is exercised in both preview and production. |

---

## Additional Suggestions

- Add API contract tests for `GET /api/issues`, `POST /api/issues`, `GET /api/admin/issues`, and `GET /api/health` so runtime drift is caught quickly.
- Treat preview as hostile-by-default: separate data, separate admin key, and explicit origin allowlist.
- Centralize request validation so the same input rules are not duplicated across `functions/api/issues.js`, `_worker.js`, and `src/index.js`.
- If the admin surface is expected to grow, move away from a single static bearer secret and toward signed sessions or Cloudflare Access.

---

## Verification Notes

- Verified repository state was clean (`git status --short` returned no pending changes).
- Confirmed deployment-mode mismatch with a local `wrangler deploy --dry-run`, which reported that the repo is a Pages project and rejected the Workers-specific deploy command.
- Did not run a live Cloudflare deployment, end-to-end browser tests, or database migrations during this review.

---

## Next Steps

I found 8 issues total.

- `P0`: 0
- `P1`: 4
- `P2`: 3
- `P3`: 1

Recommended order:

1. Split preview and production resources in `wrangler.toml`.
2. Fix admin CORS matching and remove preview wildcard CORS.
3. Choose a single deployment/runtime model and delete the misleading path.
4. Replace or redesign the rate limiter.
5. Add schema constraints and tighten request parsing.
