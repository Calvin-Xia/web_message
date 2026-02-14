# AGENT.md - AI Agent Context Guide

## Project Overview

This is a **Feedback Issue System** (问题反馈系统) built with Cloudflare Pages and D1 database. Users can submit feedback/issues with their real-name information.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML + Tailwind CSS (CDN) + Vanilla JavaScript |
| Backend | Cloudflare Pages Functions |
| Database | Cloudflare D1 (SQLite) |
| Deployment | Cloudflare Pages |

## Project Structure

```
web_message/
├── index.html              # Main frontend page (single-page app)
├── functions/
│   └── api/
│       └── issues.js       # API endpoint for CRUD operations
├── src/
│   └── index.js            # Cloudflare Workers entry point
├── storage/
│   └── Beian.png           # ICP filing badge image
├── schema.sql              # Database schema definition
├── wrangler.toml           # Cloudflare configuration
├── package.json            # Project dependencies and scripts
├── _worker.js              # Worker entry file
└── .gitignore              # Git ignore rules
```

## Database Schema

### Table: `issues`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key, auto-increment |
| `issue` | TEXT | Issue content (required, max 1000 chars) |
| `isInformationPublic` | TEXT | Whether to public real-name ('yes'/'no') |
| `name` | TEXT | User name (required) |
| `student_id` | TEXT | Student ID (required) |
| `isReport` | TEXT | Whether to report this issue ('yes'/'no') |
| `created_at` | DATETIME | Creation timestamp (UTC) |

## API Endpoints

### GET `/api/issues`
- Returns list of issues (only `id`, `issue`, `created_at` - no personal info)
- Max 100 records, ordered by `created_at ASC`

### POST `/api/issues`
- Create a new issue
- Required body: `{ issue, name, student_id, isInformationPublic, isReport }`
- Validation: issue ≤ 1000 chars, all fields required

### OPTIONS `/api/issues`
- CORS preflight handler

## Key Features

1. **Real-name Required**: Name and student_id are mandatory fields
2. **Privacy Protection**: Frontend only displays issue content and timestamp
3. **XSS Prevention**: All user input is HTML-escaped before display
4. **Responsive Design**: Mobile-friendly with Tailwind CSS
5. **CORS Enabled**: Allows cross-origin requests

## Development Commands

```bash
# Install dependencies
npm install

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
- Uses Tailwind CSS via CDN with custom color theme
- Facebook-style blue color scheme (`fb-blue: #1877F2`)
- All JavaScript is inline in `<script>` tag
- Form validation on both client and server side

### Backend (functions/api/issues.js)
- Single file handles all `/api/issues` routes
- CORS headers defined once and reused
- SQLite `datetime("now")` for UTC timestamps
- Error responses include Chinese error messages

### Styling
- Primary color: `#1877F2` (Facebook blue)
- Background: `#F0F2F5`
- Border radius: `rounded-lg`
- Shadows: `shadow-md`

## Security Considerations

1. **XSS Prevention**: `escapeHtml()` function sanitizes user input
2. **Input Validation**: Server-side validation for all required fields
3. **Length Limits**: Issue content limited to 1000 characters
4. **Privacy**: Personal info (name, student_id) never exposed in GET responses

## Deployment Notes

### Cloudflare Pages Setup
1. Connect Git repository to Cloudflare Pages
2. Build command: (leave empty - static HTML)
3. Build output directory: `/`
4. Configure D1 database binding in Dashboard

### Required Bindings
- D1 Database: `DB` → `issue-board-db`

## Common Tasks

### Adding a new API endpoint
1. Create new file in `functions/api/` directory
2. Export `onRequest` function
3. Handle CORS with preflight OPTIONS

### Modifying database schema
1. Update `schema.sql`
2. Run: `wrangler d1 execute issue-board-db --remote --file=./schema.sql`

### Changing frontend styles
- Modify Tailwind classes in `index.html`
- Custom colors defined in `tailwind.config` script tag

## File References

- Main page: [index.html](file:///c:/Users/Calvin-Xia/Documents/GitHub/web_message/index.html)
- API handler: [functions/api/issues.js](file:///c:/Users/Calvin-Xia/Documents/GitHub/web_message/functions/api/issues.js)
- Database schema: [schema.sql](file:///c:/Users/Calvin-Xia/Documents/GitHub/web_message/schema.sql)
- Cloudflare config: [wrangler.toml](file:///c:/Users/Calvin-Xia/Documents/GitHub/web_message/wrangler.toml)
