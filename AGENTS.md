# AGENTS.md
Repository-specific guide for coding agents working in `web_message/`. It supersedes the older summary in `AGENT.md` with commands and conventions taken from the current code.
## Scope
- Respect local changes and work with the existing stack.
- Update live Cloudflare Pages code paths, not archived Worker prototypes.
- Keep changes small, testable, and consistent with current patterns.
## Stack
- Frontend: static HTML plus vanilla JavaScript in the repo root.
- Styling: Tailwind CSS v4 compiled from `src/input.css` to `styles.css`.
- Backend: Cloudflare Pages Functions under `functions/api/`.
- Data: Cloudflare D1, with rate-limit and observability helpers in `src/shared/`.
- Validation: Zod.
- Tests: Vitest.
- CI: GitHub Actions on Node.js 20.
## Source Of Truth
- Live API behavior: `functions/api/`.
- Shared backend helpers: `src/shared/`.
- Live browser scripts: `public-app.js`, `admin-app.js`, `health-app.js`.
- `src/index.js` is a historical Worker prototype, not the supported deployment target.
- `src/legacy/pages-worker.js` is archived reference code only.
## Repo Layout
```text
functions/api/              Pages routes
functions/api/admin/        Admin routes
src/shared/                 Shared backend helpers
src/input.css               Tailwind source
styles.css                  Generated stylesheet
test/                       Vitest suite
test/helpers/               Fake Cloudflare/D1 helpers
docs/API.md                 API notes
docs/DEPLOYMENT.md          Deploy and migration notes
docs/SECURITY.md            Security expectations
schema.sql                  Base schema
migrations/                 D1 migrations
```
## Build And Dev Commands
Use `npm ci` in clean environments. Use `npm install` only when lockfile changes are intentional.
```bash
npm ci
npm run build:css
npm run dev:css
npm run dev
npm run deploy
```
- `npm run build:css` builds `styles.css` once.
- `npm run dev:css` watches Tailwind changes.
- `npm run pages:dev` and `npm run pages:deploy` are aliases for the same Wrangler commands.
## Database Commands
```bash
npm run d1:create
npm run d1:init
npm run d1:init:local
npm run d1:migrate
npm run d1:migrate:local
npm run d1:migrate:preview
npm run d1:query -- "SELECT 1"
npm run d1:query:local -- "SELECT 1"
```
- `schema.sql` is the bootstrap schema.
- Prefer migrations for incremental schema changes.
- Use local D1 commands first unless the task explicitly targets preview or production.
## Test Commands
Primary commands:
```bash
npm test
npm run test:watch
npm run test:coverage
```
Single-file and single-test examples:
```bash
npm test -- test/validation.test.js
npx vitest run test/validation.test.js
npx vitest run test/validation.test.js -t "accepts counseling category"
```
- Vitest includes `test/**/*.test.js`.
- Coverage output goes to `output/coverage/`.
- Coverage is configured for `functions/api/**/*.js` and `src/shared/**/*.js`.
- CI runs `npm ci`, `npm test`, and `npm run test:coverage`.
- In restricted sandboxes, Vitest/Vite may need permission to spawn `esbuild`; do not change repo config just to bypass sandbox policy.
## Linting And Formatting
- Run `npm run lint` to execute the repo ESLint checks.
- ESLint uses the flat config in `eslint.config.mjs`.
- There is no Prettier, Biome, or `.editorconfig` file.
- Preserve the existing style manually when editing.
## Cursor And Copilot Rules
- No `.cursor/rules/` directory exists.
- No `.cursorrules` file exists.
- No `.github/copilot-instructions.md` file exists.
- This `AGENTS.md` is the main agent-facing instruction file for the repo.
## JavaScript Style
- Use modern ESM `import`/`export`.
- Always include `.js` on relative imports.
- Use 2-space indentation, semicolons, and single quotes.
- Keep trailing commas in multiline arrays, objects, imports, and calls.
- Prefer `const`; use `let` only when reassignment is necessary.
- Favor small helpers and early returns over deep nesting.
- Prefer named function declarations for reusable helpers.
- Use arrow functions for short callbacks and transforms.
- Avoid new class hierarchies; the only current class-heavy area is the fake D1 test helper.
- Keep imports at the top of each file.
- Import external packages first, then project modules.
- Reuse `src/shared/` helpers instead of duplicating logic in routes or browser scripts.
- In route files, keep imports grouped by responsibility: auth/security, request/response, data helpers, validation, rate limiting.
## Naming
- Use `camelCase` for functions, variables, and API payload fields.
- Use `PascalCase` only for classes such as test doubles.
- Use `UPPER_SNAKE_CASE` for module constants and enum-like arrays.
- Use descriptive boolean names like `isPublic`, `isReported`, `hasNotes`, `shouldObserve`, and `canTransitionStatus`.
- Keep Pages route handlers named `onRequest`.
- Keep tests in `*.test.js` files under `test/`.
## API And Data Rules
- Keep API payload fields in camelCase and D1 columns in snake_case.
- Normalize and validate input with Zod in `src/shared/validation.js`.
- Convert database booleans explicitly with helpers like `toBoolean`.
- Return JSON through `successResponse`, `errorResponse`, `notFoundResponse`, and related helpers.
- Preserve the current envelope shape: `{ success, data }` or `{ success, error }`.
- Use ISO timestamps from `new Date().toISOString()`.
## Route Patterns
- Start routes with method guards and CORS/preflight handling.
- Apply rate limiting before expensive work.
- For admin routes, enforce origin policy and Bearer auth through `src/shared/auth.js`.
- Parse JSON with `parseJsonBody()` instead of ad hoc `request.json()` calls.
- Build filters and sort fragments through shared query helpers; never pass raw user input into SQL.
- Prefer batched D1 statements when multiple writes must succeed together.
- Keep optimistic concurrency checks such as `updatedAt` guards and `409` responses.
## Error Handling
- Wrap route bodies in `try/catch`.
- Log failures with route-specific `console.error` messages and useful context.
- Return localized Chinese user-facing messages, matching current API behavior.
- In production, avoid leaking raw exception details; follow the existing `ENVIRONMENT === 'production'` pattern.
- Return early on validation, auth, rate-limit, and origin failures.
## Security
- Treat `name`, `student_id`, auth headers, and admin secrets as sensitive.
- Never expose sensitive fields in public responses or browser-rendered lists.
- Escape user content before writing HTML; the browser scripts already use `escapeHtml()`.
- Preserve security headers and HTTPS enforcement in `functions/api/_middleware.js` and `src/shared/security.js`.
- Do not weaken CORS, auth, rate limiting, or observability without an explicit requirement.
## Frontend Conventions
- Keep frontend code framework-free unless the task explicitly changes the stack.
- Follow the existing pattern of a module-level `state` object plus DOM helper functions.
- Prefer direct DOM access with `document.getElementById()` and targeted selectors.
- Centralize fetch behavior through the existing timeout wrappers.
- Preserve current `zh-CN` date/time formatting behavior.
## Testing Conventions
- Use Vitest APIs from `vitest`: `describe`, `it`, `expect`, `vi`, `afterEach`.
- Import route handlers directly and call `onRequest()` with fake Cloudflare context objects.
- Reuse `test/helpers/fakeCloudflare.js` for D1, KV, and env doubles.
- Add or update tests for both happy paths and failure paths when backend behavior changes.
- Prefer focused assertions over snapshots; this repo does not use snapshot testing.
## Documentation
- Update `docs/API.md`, `docs/DEPLOYMENT.md`, or `docs/SECURITY.md` when behavior changes in those areas.
- If you add a command, add it to `package.json` and document it here.
- If you add linting or formatting tooling, update this file so agents have one current source of truth.
