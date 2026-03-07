# 问题反馈系统

一个基于 Cloudflare Pages、Pages Functions、D1 和 KV 的问题反馈系统。

## 当前运行模式

- 唯一受支持的后端运行模式是 Cloudflare Pages Functions。
- 权威 API 实现在 `functions/api/` 下。
- `src/index.js` 仅保留为历史参考，不参与当前部署。
- 旧的根目录 `_worker.js` 已归档到 `src/legacy/pages-worker.js`，用于回看历史实现，不再作为 Pages 入口生效。

## 功能概览

- 用户提交问题反馈，实名信息必填
- 首页分页展示公开问题内容与提交时间
- 管理后台分页展示完整数据与统计信息
- D1 存储问题数据，KV 用于限流
- `/health` 页面与 `/api/health` 健康检查接口

## 技术栈

- 前端：HTML + Tailwind CSS v4 + 原生 JavaScript
- 后端：Cloudflare Pages Functions
- 数据库：Cloudflare D1
- 限流：Cloudflare KV
- 部署：Cloudflare Pages

## 项目结构

```text
web_message/
├── index.html
├── admin.html
├── health.html
├── styles.css
├── functions/
│   └── api/
│       ├── issues.js
│       ├── health.js
│       └── admin/
│           └── issues.js
├── src/
│   ├── input.css
│   ├── index.js
│   ├── legacy/
│   │   └── pages-worker.js
│   └── shared/
│       ├── auth.js
│       ├── rateLimit.js
│       └── request.js
├── storage/
│   └── Beian.png
├── schema.sql
├── wrangler.toml
└── AGENT.md
```

## API 契约

### `GET /api/issues`

- 返回首页问题列表
- 响应字段：`messages`、`pagination`
- 排序：`created_at DESC`

### `POST /api/issues`

- 创建问题
- 请求体：`{ issue, name, student_id, isInformationPublic, isReport }`

### `GET /api/admin/issues`

- 返回后台问题列表
- 需要 `Authorization: Bearer <ADMIN_SECRET_KEY>`
- 响应字段：`issues`、`pagination`、`stats`
- 带 `Origin` 时仅接受受信任来源；不可信来源返回 `403`

### `GET /api/health`

- 返回数据库健康状态 JSON

## 开发命令

```bash
npm install
npm run build:css
npm run dev
npm run deploy
npm run d1:init
npm run d1:init:local
```

- `npm run dev` 与 `npm run pages:dev` 等价，都会启动 `wrangler pages dev`
- `npm run deploy` 与 `npm run pages:deploy` 等价，都会调用 `wrangler pages deploy`

## 部署步骤

### 1. 安装依赖

```bash
npm install
```

### 2. 登录 Cloudflare

```bash
npx wrangler login
```

### 3. 创建 D1 数据库

生产环境数据库：

```bash
npx wrangler d1 create issue-board-db
```

预发布环境数据库：

```bash
npx wrangler d1 create issue-board-db-preview
```

将返回的 `database_id` 分别写入 `wrangler.toml` 中 `env.production.d1_databases` 和 `env.preview.d1_databases`。preview 必须使用独立于 production 的 D1。

### 4. 创建 KV namespace

```bash
npx wrangler kv namespace create RATE_LIMIT_KV
```

将返回的 namespace ID 写入 `wrangler.toml`。

### 5. 初始化数据库

生产数据库初始化：

```bash
npx wrangler d1 execute issue-board-db --remote --file=./schema.sql
```

预发布数据库初始化：

```bash
npx wrangler d1 execute issue-board-db-preview --remote --file=./schema.sql
```

本地数据库初始化：

```bash
npx wrangler d1 execute issue-board-db --local --file=./schema.sql
```

当前仅隔离 D1；`env.preview.kv_namespaces` 仍暂时复用 production 的 `RATE_LIMIT_KV`。

### 6. 配置环境变量

本地开发使用 `.dev.vars`：

```bash
ADMIN_SECRET_KEY=your-secret-key-here-min-32-chars
```

生产与预发布环境在 Cloudflare Pages Dashboard 中配置：

- `ADMIN_SECRET_KEY`
- `ENVIRONMENT`

### 7. 本地开发

```bash
npm run dev
```

默认访问：

- `http://localhost:8787/`
- `http://localhost:8787/admin.html`
- `http://localhost:8787/health.html`

### 8. 部署到 Cloudflare Pages

```bash
npm run deploy
```

也可以将仓库接入 Cloudflare Pages 的 Git 集成，让推送触发自动部署。

## Pages 配置要点

- `wrangler.toml` 使用 `pages_build_output_dir = "./"`
- D1 绑定名：`DB`
- KV 绑定名：`RATE_LIMIT_KV`
- Pages Functions 目录：`functions/`

## 安全与边界

- 所有用户输入都在前端展示前进行 HTML 转义
- 实名信息仅在后台接口返回
- 限流位于应用层，存储在 KV
- 管理接口依赖管理员密钥校验与受控 CORS
- `ENVIRONMENT=production` 时仅信任 `https://issue.calvin-xia.cn`、`https://issue-origin.calvin-xia.cn`、`https://web-message-board.pages.dev` 与单层子域 `https://<branch>.web-message-board.pages.dev`
- `ENVIRONMENT=local` / `preview` 时仅信任 `localhost` 与 `127.0.0.1`，协议允许 `http` / `https`，端口不限
- 管理接口响应统一带 `Vary: Origin`；没有 `Origin` 的请求不会被拒绝，但不会返回 `Access-Control-Allow-Origin`

## 历史实现说明

- `src/index.js` 是旧的 Worker 原型，仅作参考
- `src/legacy/pages-worker.js` 是归档后的旧 `_worker.js`
- 如需查看旧运行面，请查看归档文件或 Git 历史，不要把它们当作当前部署入口

## License

MIT

