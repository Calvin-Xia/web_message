# 部署文档

## 1. 前置要求

- Node.js 20+
- npm 10+
- Cloudflare 账号
- 已安装并登录 Wrangler

```bash
npm install
npx wrangler login
```

## 2. Cloudflare 资源

### D1

```bash
npx wrangler d1 create issue-board-db
npx wrangler d1 create issue-board-db-preview
```

将返回的 `database_id` 填入 `wrangler.toml` 对应环境。

### KV

```bash
npx wrangler kv namespace create RATE_LIMIT_KV
```

同一个 KV 同时用于：

- 应用限流计数
- Phase 3 健康检查观测快照

## 3. 环境变量

### 本地 `.dev.vars`

```bash
ADMIN_SECRET_KEY="replace-with-real-secret"
RESEND_API_KEY="re_xxxxxxxxx"
ENVIRONMENT="local"
PUBLIC_BASE_URL="http://localhost:8787"
```

### Pages Dashboard

生产与预发环境至少配置：

- `ADMIN_SECRET_KEY`
- `ENVIRONMENT`
- `RESEND_API_KEY`

可选配置：

- `PUBLIC_BASE_URL`

## 4. 本地开发与迁移

```bash
npm run d1:migrate:local
npm run dev
```

默认访问：

- `http://localhost:8787/`
- `http://localhost:8787/admin.html`
- `http://localhost:8787/tracking.html`
- `http://localhost:8787/health.html`

## 5. 测试与覆盖率

```bash
npm test
npm run test:coverage
```

覆盖率输出目录：`output/coverage/`

## 6. 生产部署

```bash
npm run d1:migrate
npm run deploy
```

预发数据库迁移：

```bash
npm run d1:migrate:preview
```

## 7. CI

仓库已提供 `.github/workflows/ci.yml`，包含：

1. `npm ci`
2. `npm test`
3. `npm run test:coverage`
4. 上传 `output/coverage/` 作为 artifact

## 8. 发布检查建议

- 确认 `ADMIN_SECRET_KEY` 已在目标环境配置
- 确认 `RESEND_API_KEY` 已在目标环境配置，且 `support@calvin-xia.cn` 可作为 Resend 发件人与回复地址
- 确认 D1 与 KV 绑定存在
- 访问 `/health.html` 检查 D1 / KV 状态
- 在后台执行一次导出，确认审计日志与 CSV 正常
- 检查 CI 最新一次通过后再切换流量
