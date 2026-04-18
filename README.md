# 问题反馈系统

一个基于 Cloudflare Pages Functions、D1 与 KV 的校园问题反馈系统。当前仓库已经覆盖公开提交与追踪、后台运营台、心理咨询热区、健康检查、测试基建与安全加固。

## 当前状态

- `/api/health` 已扩展为结构化健康检查接口，覆盖 D1、KV、延迟、趋势、告警规则与脱敏错误日志。
- `/health.html` 已升级为健康检查面板，支持服务状态、关键指标、限流命中率与响应时间趋势展示。
- API 层新增统一安全头与 HTTPS 强制跳转保护，后台接口继续使用受控 CORS 与 Bearer 鉴权。
- 公开首页已接入校园心理压力热区与懒加载校园矢量地图，地图使用预处理静态 GeoJSON 资产与 `/api/insights` 聚合数据渲染。
- Vitest 已覆盖核心 API、共享工具、校园地图规则和前端数据处理辅助逻辑，并可生成覆盖率报告。
- GitHub Actions CI 已配置，提交或 PR 会自动构建样式、执行测试并上传覆盖率产物。

## 核心能力

- 公开用户提交问题并生成追踪编号
- 公开追踪页查看状态、时间线与公开回复
- 公开心理咨询热区展示，支持校园矢量地图悬停查看公开聚合数据
- 后台运营台支持筛选、状态流转、备注、回复、导出与统计
- 健康检查 API 与可视化健康面板
- 限流、输入验证、日志脱敏、安全响应头与运维文档

## 架构图

```mermaid
flowchart LR
    User["公开用户"] --> Static["Pages 静态页面\nindex / tracking / health"]
    Admin["管理员"] --> AdminUI["admin.html + admin-app.js"]
    Static --> API["Pages Functions /api/*"]
    Static --> MapAsset["/storage/campus-care-map.json\npreprocessed campus vector data"]
    AdminUI --> API
    API --> D1["Cloudflare D1\nissues / updates / notes / admin_actions"]
    API --> KV["Cloudflare KV\nrate limit + observability snapshot"]
    API --> Health["/api/health\nservices + metrics + alerts"]
```

## 主要页面与接口

### 页面

- `/`：公开提交页、公开问题列表与校园心理压力热区
- `/tracking.html`：追踪页
- `/admin.html`：后台运营台
- `/health.html`：健康检查面板

### API

- `GET /api/health`
- `GET /api/issues`
- `POST /api/issues`
- `GET /api/issues/:trackingCode`
- `GET /api/insights`
- `GET /api/admin/issues`
- `GET/PATCH /api/admin/issues/:id`
- `POST /api/admin/issues/:id/notes`
- `POST /api/admin/issues/:id/replies`
- `GET /api/admin/actions`
- `GET /api/admin/export`
- `GET /api/admin/metrics`

详细契约见 [docs/API.md](./docs/API.md)。

## 环境变量

| 变量 | 必填 | 用途 |
| --- | --- | --- |
| `ADMIN_SECRET_KEY` | 是 | 后台 Bearer 鉴权密钥 |
| `ENVIRONMENT` | 是 | 环境标识：`local` / `preview` / `production` |
| `RESEND_API_KEY` | 通知功能需要 | 邮件通知投递密钥；未配置时邮件发送会失败并记录错误 |
| `PUBLIC_BASE_URL` | 否 | 邮件中的追踪链接基准地址；未配置时按请求来源或默认生产域名推断 |

本地示例见 `.dev.vars.example`。

## 开发命令

```bash
npm ci
npm run build:css
npm run dev
npm test
npm run test:coverage
npm run d1:migrate:local
```

## 测试与验证

- `npm test`：执行全部 Vitest 用例
- `npm run test:coverage`：输出 `output/coverage/` 覆盖率报告
- `npm run build:map -- <geojson>`：从校园 GeoJSON 导出生成 `storage/campus-care-map.json`，仅地图源数据变化时需要重新运行

## 文档结构

- `docs/API.md`：当前 API 与公开静态资产契约。
- `docs/DEPLOYMENT.md`：Cloudflare 资源、迁移、部署与发布检查。
- `docs/SECURITY.md`：公开/后台数据边界与运行安全约束。
- `AGENTS.md`：仓库内编码代理使用的命令、约定和代码边界。

## 部署

部署说明、数据库迁移、Pages 绑定配置与 CI 说明见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)。

## 安全说明

输入验证、CORS、HTTPS/HSTS、安全响应头、日志脱敏与“无 Cookie”策略见 [docs/SECURITY.md](./docs/SECURITY.md)。
