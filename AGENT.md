# AGENT.md - AI Agent Context Guide

## Project Overview

This is a **Feedback Issue System** (问题反馈系统) built with Cloudflare Pages and D1 database. Users can submit feedback/issues with their real-name information.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML + Tailwind CSS v4 (compiled) + Vanilla JavaScript |
| Backend | Cloudflare Pages Functions / Workers |
| Database | Cloudflare D1 (SQLite) |
| Deployment | Cloudflare Pages |
| Build | Tailwind CSS v4 (via `@tailwindcss/cli`) |

## Project Structure

```
web_message/
├── index.html              # Main frontend page (single-page app)
├── styles.css              # Compiled Tailwind CSS (generated)
├── functions/
│   └── api/
│       └── issues.js       # API endpoint for Pages Functions
├── src/
│   ├── index.js            # Workers entry point (imports HTML/CSS)
│   └── input.css           # Tailwind CSS source file
├── storage/
│   └── Beian.png           # ICP filing badge image
├── schema.sql              # Database schema definition
├── wrangler.toml           # Cloudflare configuration
├── package.json            # Project dependencies and scripts
├── _worker.js              # Worker entry file (for Pages deployment)
├── AGENT.md                # This file
└── README.md               # Project documentation
```

## Database Schema

### Table: `issues`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key, auto-increment |
| `issue` | TEXT | Issue content (required, max 1000 chars) |
| `isInformationPublic` | TEXT | Whether to public real-name ('yes'/'no') |
| `name` | TEXT | User name (required, max 20 chars) |
| `student_id` | TEXT | Student ID (required, must be 4/5/13 digits) |
| `isReport` | TEXT | Whether to report this issue ('yes'/'no') |
| `created_at` | DATETIME | Creation timestamp (UTC) |

## API Endpoints

### GET `/api/issues`
- Returns list of issues (only `id`, `issue`, `created_at` - no personal info)
- Max 100 records, ordered by `created_at ASC`

### POST `/api/issues`
- Create a new issue
- Required body: `{ issue, name, student_id, isInformationPublic, isReport }`
- Validation:
  - issue: required, max 1000 chars
  - name: required, max 20 chars
  - student_id: required, must be 4/5/13 digits

### OPTIONS `/api/issues`
- CORS preflight handler

### Static Files
- `GET /` or `GET /index.html` - Main HTML page
- `GET /styles.css` - Compiled CSS (cached for 1 year)

## Key Features

1. **Real-name Required**: Name and student_id are mandatory fields
2. **Privacy Protection**: Frontend only displays issue content and timestamp
3. **XSS Prevention**: All user input is HTML-escaped before display
4. **Responsive Design**: Mobile-friendly with Tailwind CSS
5. **CORS Enabled**: Allows cross-origin requests
6. **Compiled CSS**: Uses Tailwind CSS v4 with custom theme

## Development Commands

```bash
# Install dependencies
npm install

# Build CSS (if needed)
npx @tailwindcss/cli -i ./src/input.css -o ./styles.css

# Local development (Workers mode)
npm run dev

# Local development (Pages mode)
npm run pages:dev

# Deploy to Cloudflare Workers
npm run deploy

# Deploy to Cloudflare Pages
npm run pages:deploy

# Initialize database schema (remote)
npm run d1:init

# Initialize database schema (local)
npm run d1:init:local

# Query database (remote)
npm run d1:query "SELECT * FROM issues"

# Query database (local)
npm run d1:query:local "SELECT * FROM issues"
```

## Database Configuration

- **Database Name**: `issue-board-db`
- **Database ID**: `58c85d18-4868-4580-ad22-7767fccfc729`
- **Binding Name**: `DB`

## Environment Variables

| Variable | Environment | Description |
|----------|-------------|-------------|
| `ENVIRONMENT` | production/preview | Current environment name |

## Code Conventions

### Frontend (index.html)
- Uses external `styles.css` (compiled Tailwind CSS)
- Facebook-style blue color scheme (`fb-blue: #1877F2`)
- All JavaScript is inline in `<script>` tag
- Form validation on both client and server side

### CSS (src/input.css)
- Tailwind CSS v4 syntax with `@import "tailwindcss"`
- Custom theme defined in `@theme` block
- Custom colors:
  - `--color-fb-blue: #1877F2`
  - `--color-fb-blue-dark: #166FE5`
  - `--color-fb-bg: #F0F2F5`
  - `--color-fb-gray: #65676B`
  - `--color-fb-gray-light: #E4E6EB`

### Backend (src/index.js & _worker.js)
- Both files contain similar routing logic
- `src/index.js`: Imports HTML/CSS as modules (for Workers)
- `_worker.js`: Uses `env.ASSETS.fetch()` for static files (for Pages)
- CORS headers defined once and reused
- SQLite `datetime("now")` for UTC timestamps
- Error responses include Chinese error messages

### API (functions/api/issues.js)
- Single file handles all `/api/issues` routes for Pages Functions
- Same logic as Workers but in Pages Functions format

## Security Considerations

1. **XSS Prevention**: `escapeHtml()` function sanitizes user input
2. **Input Validation**: Server-side validation for all required fields
3. **Length Limits**:
   - Issue content: max 1000 characters
   - Name: max 20 characters
4. **Format Validation**:
   - Student ID: must be 4, 5, or 13 digits
5. **Privacy**: Personal info (name, student_id) never exposed in GET responses

## Rate Limiting Configuration

本项目采用应用层 Rate Limiting 策略：

### 实现方式
- **Method**: Pages Functions + KV
- **Storage**: Cloudflare KV (`RATE_LIMIT_KV`)

### 限制配置
| 端点 | 限制 | 封禁时间 |
|------|------|----------|
| POST `/api/issues` | 10 次/分钟/IP | 5 分钟 |
| GET `/api/issues` | 60 次/分钟/IP | 1 分钟 |

### 配置文件
- **KV 绑定**: `wrangler.toml` 中的 `RATE_LIMIT_KV`
- **限制参数**: `src/shared/rateLimit.js` 中的 `RATE_LIMIT_CONFIG`

### 响应格式
超限时返回 HTTP 429：
```json
{
  "error": "请求过于频繁，请稍后再试",
  "retryAfter": 300
}
```

### 注意事项
- Rate Limiting 失败时不会阻止请求（降级策略）
- KV 计数器自动过期，无需手动清理

## Deployment Notes

### Cloudflare Pages Setup
1. Connect Git repository to Cloudflare Pages
2. Build command: `npx @tailwindcss/cli -i ./src/input.css -o ./styles.css` (or leave empty if CSS is pre-built)
3. Build output directory: `/`
4. Configure D1 database binding in Dashboard

### Required Bindings
- D1 Database: `DB` → `issue-board-db`

### Two Deployment Modes
1. **Workers Mode** (`npm run deploy`): Uses `src/index.js` with imported assets
2. **Pages Mode** (`npm run pages:deploy`): Uses `_worker.js` with ASSETS binding

## Common Tasks

### Adding a new API endpoint
1. For Pages: Create new file in `functions/api/` directory
2. For Workers: Add route handling in `src/index.js`
3. Export `onRequest` function (Pages) or add to fetch handler (Workers)
4. Handle CORS with preflight OPTIONS

### Modifying database schema
1. Update `schema.sql`
2. Run: `wrangler d1 execute issue-board-db --remote --file=./schema.sql`

### Modifying CSS styles
1. Edit `src/input.css` to add/modify Tailwind classes
2. Rebuild: `npx @tailwindcss/cli -i ./src/input.css -o ./styles.css`
3. Or use watch mode: `npx @tailwindcss/cli -i ./src/input.css -o ./styles.css --watch`

### Changing frontend styles
- Use Tailwind utility classes in `index.html`
- Custom colors available: `fb-blue`, `fb-blue-dark`, `fb-bg`, `fb-gray`, `fb-gray-light`

## File References

- Main page: [index.html](file:///c:/Users/Calvin-Xia/Documents/GitHub/web_message/index.html)
- Compiled CSS: [styles.css](file:///c:/Users/Calvin-Xia/Documents/GitHub/web_message/styles.css)
- CSS source: [src/input.css](file:///c:/Users/Calvin-Xia/Documents/GitHub/web_message/src/input.css)
- Workers entry: [src/index.js](file:///c:/Users/Calvin-Xia/Documents/GitHub/web_message/src/index.js)
- Pages Worker: [_worker.js](file:///c:/Users/Calvin-Xia/Documents/GitHub/web_message/_worker.js)
- API handler: [functions/api/issues.js](file:///c:/Users/Calvin-Xia/Documents/GitHub/web_message/functions/api/issues.js)
- Database schema: [schema.sql](file:///c:/Users/Calvin-Xia/Documents/GitHub/web_message/schema.sql)
- Cloudflare config: [wrangler.toml](file:///c:/Users/Calvin-Xia/Documents/GitHub/web_message/wrangler.toml)

## Trae Documents

Project planning and change documents are stored in `.trae/documents/`:
- Cloudflare Pages 部署方案.md
- index.html 全面风格化优化.md
- 修复 Pages D1 绑定配置.md
- 修复 Pages 部署配置.md
- 修改实名信息为必填.md
- 修改问题反馈系统.md
- 备案图片显示问题排查与修复.md
