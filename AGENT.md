# AGENT.md - Project Context

## Overview

This repository is a feedback issue system built for Cloudflare Pages. Users submit issues with required real-name information, while the public UI shows only sanitized issue content and timestamps.

## Supported Runtime

- The only supported backend runtime is Cloudflare Pages Functions.
- Treat `functions/api/` as the source of truth for live API behavior.
- `src/index.js` is a historical Worker prototype and is not part of the supported deployment path.
- `src/legacy/pages-worker.js` is the archived former root `_worker.js`; keep it only for historical reference.

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML + Tailwind CSS v4 + Vanilla JavaScript |
| Backend | Cloudflare Pages Functions |
| Database | Cloudflare D1 |
| Rate limiting | Cloudflare KV |
| Deployment | Cloudflare Pages |

## Repo Layout

```text
web_message/
├── index.html
├── admin.html
├── health.html
├── styles.css
├── functions/api/
├── src/input.css
├── src/index.js
├── src/legacy/pages-worker.js
├── src/shared/
├── schema.sql
├── wrangler.toml
└── package.json
```

## API Contracts

### `GET /api/issues`

- Implemented by `functions/api/issues.js`
- Returns `messages` and `pagination`
- Used by `index.html`

### `POST /api/issues`

- Implemented by `functions/api/issues.js`
- Accepts `{ issue, name, student_id, isInformationPublic, isReport }`

### `GET /api/admin/issues`

- Implemented by `functions/api/admin/issues.js`
- Requires `Authorization: Bearer <ADMIN_SECRET_KEY>`
- Returns `issues`, `pagination`, and `stats`
- Used by `admin.html`

### `GET /api/health`

- Implemented by `functions/api/health.js`
- Returns JSON health information for D1 connectivity
- Used by `health.html`

## Commands

```bash
npm install
npm run build:css
npm run dev
npm run deploy
npm run d1:init
npm run d1:init:local
```

- `npm run dev` and `npm run pages:dev` both run `wrangler pages dev`
- `npm run deploy` and `npm run pages:deploy` both run `wrangler pages deploy`

## Security Notes

- Escape user-generated content before rendering in the browser
- Keep admin responses gated behind `ADMIN_SECRET_KEY`
- Treat `name` and `student_id` as sensitive data
- Maintain rate limiting via `src/shared/rateLimit.js`
- Keep CORS rules for admin endpoints explicit and environment-aware

## Data Rules

- `issue`: required, max 1000 chars
- `name`: required, max 20 chars
- `student_id`: required, must match 4, 5, or 13 digits
- `isInformationPublic`: `yes` or `no`
- `isReport`: `yes` or `no`

## Legacy Notes

- Do not add new live routes to `src/index.js` or `src/legacy/pages-worker.js`
- If contract behavior changes, update the Pages Functions implementation and the HTML clients that depend on it
- Use Git history or archived files for legacy Worker investigation
