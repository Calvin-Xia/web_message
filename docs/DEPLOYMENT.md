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
npm run build
npm run d1:migrate
npm run deploy
```

当前迁移说明：

- `0006_add_counseling_insights_fields.sql` 新增心理咨询扩展字段，并为新初始化环境创建复合索引。
- `0007_bound_public_insights_indexes.sql` 为公开心理热区接口补充带公开与时间范围约束的聚合索引。
- `0008_replace_counseling_single_column_indexes.sql` 是已运行旧版 `0006` 环境的前向修复迁移，会替换早期单列索引为 `(category, distress_type)` 与 `(category, scene_tag)` 复合索引。
- 新数据库按迁移顺序执行即可；已经应用过旧版 `0006` 的远端数据库也需要继续执行到 `0008`。

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

- 确认本次发布前已经重新生成 `styles.css`。使用 `npm run build`，或直接运行带有自动预编译的 `npm run deploy` / `npm run pages:deploy`
- 确认 `ADMIN_SECRET_KEY` 已在目标环境配置
- 确认 `RESEND_API_KEY` 已在目标环境配置，且 `support@calvin-xia.cn` 可作为 Resend 发件人与回复地址
- 确认 D1 与 KV 绑定存在
- 访问 `/health.html` 检查 D1 / KV 状态
- 在后台执行一次导出，确认审计日志与 CSV 正常
- 检查 CI 最新一次通过后再切换流量

## 9. 样式构建说明

- 页面依赖根目录的 `styles.css`，它由 `src/input.css` 编译生成。
- 如果修改了 `src/input.css`，或者新增了页面里使用的 Tailwind 类名，发布前必须重新执行 `npm run build`。
- 如果通过 Cloudflare Pages Dashboard 配置 Git 自动部署，建议将 Build command 设置为 `npm run build`，Build output directory 设置为 `.`
