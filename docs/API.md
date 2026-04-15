# API 文档

所有 API 路径均挂载在 `/api` 下，响应采用统一 JSON 包装：

```json
{
  "success": true,
  "data": {}
}
```

错误响应：

```json
{
  "success": false,
  "error": "错误说明"
}
```

## 公开接口

### `GET /api/health`

返回系统健康状态、关键指标与告警信息。

示例响应：

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2026-03-11T15:00:00.000Z",
    "version": "3.0.0",
    "services": {
      "d1": {
        "status": "connected",
        "latency": 12,
        "lastChecked": "2026-03-11T15:00:00.000Z"
      },
      "kv": {
        "status": "connected",
        "latency": 7,
        "lastChecked": "2026-03-11T15:00:00.000Z"
      }
    },
    "metrics": {
      "requestCount": 128,
      "errorRate": 0.01,
      "avgResponseTime": 146,
      "rateLimitHits": 3
    },
    "checks": {
      "database": "pass",
      "cache": "pass",
      "rateLimiter": "pass"
    },
    "alerts": [],
    "alertRules": {
      "errorRate": { "threshold": 0.05, "duration": "5m" },
      "responseTime": { "threshold": 1000, "duration": "5m" },
      "databaseLatency": { "threshold": 100, "duration": "1m" }
    },
    "trends": [],
    "recentErrors": []
  }
}
```

### `GET /api/issues`

公开问题列表，仅返回白名单字段。
心理咨询类问题会额外返回 `distressType` 与 `sceneTag`；其他分类返回 `null`。
首页公开同步区为了移动端阅读节奏，默认以 `pageSize=5` 请求；API 仍允许调用方通过 `pageSize` 指定 `1` 到 `100` 条。

查询参数：

- `page` / `pageSize`
- `status`
- `category`
- `q`
- `startDate` / `endDate`
- `sortField`：`createdAt` / `updatedAt` / `status`
- `sortOrder`：`asc` / `desc`

### `POST /api/issues`

创建问题并返回追踪编号。

请求体：

```json
{
  "name": "张三",
  "studentId": "2024001001001",
  "email": "student@example.com",
  "notifyByEmail": true,
  "category": "facility",
  "content": "图书馆空调故障，需要尽快处理。",
  "isPublic": false,
  "isReported": false
}
```

- `email`：可选，仅用于接收关键进展邮件提醒
- `notifyByEmail`：可选，默认 `false`；未填写邮箱时即使传 `true` 也不会启用提醒
- `distressType`：仅 `category` 为 `counseling` 时可选，取值为 `academic_pressure` / `relationship` / `adaptation` / `mood` / `sleep` / `other`
- `sceneTag`：仅 `category` 为 `counseling` 时可选，取值为 `dormitory` / `classroom` / `library` / `self_study` / `cafeteria` / `playground` / `other`
- 非心理咨询分类提交非空 `distressType` 或 `sceneTag` 会返回 `400`

### `GET /api/issues/:trackingCode`

根据追踪编号返回公开可见的问题详情与时间线。

### `GET /api/insights`

返回公开心理咨询反馈的脱敏聚合数据，用于校园心理压力热区与困扰类别展示。
默认统计最近 `90` 天，只统计 `isPublic = true` 且 `category = counseling` 的问题；未填写 `sceneTag` 的记录不进入场景热区。
当前公开知识库使用前端固定脱敏支持模板，作为 MVP 内容；如需运营人员免部署维护，后续可迁移到 API/KV 配置源。

查询参数：

- `days`：统计最近多少天，默认 `90`，范围 `1` 到 `365`；未提供 `startDate` 时用于计算起始日期。
- `startDate` / `endDate`：`YYYY-MM-DD`。显式日期范围最长 `365` 天；只提供 `endDate` 时会按 `days` 回推起始日期；只提供 `startDate` 时结束日期默认为当天。

限流与缓存：

- 使用公开读接口限流策略，与公开列表读取共用轻量读请求保护。
- 成功响应包含 `Cache-Control: public, max-age=300`，缓存命中外的查询仍受默认 90 天窗口和最大 365 天范围限制。
- 参数校验失败返回 `400`，方法不支持返回 `405`。

示例响应：

```json
{
  "success": true,
  "data": {
    "overview": {
      "publicCounselingIssues": 2
    },
    "range": {
      "startDate": "2026-01-16",
      "endDate": "2026-04-15",
      "days": 90
    },
    "sceneHotspots": [
      { "scene": "dormitory", "total": 1, "pending": 1 }
    ],
    "distressTypes": [
      { "distressType": "sleep", "total": 1 }
    ]
  }
}
```

## 后台接口

所有后台接口需要：

- 请求头 `Authorization: Bearer <ADMIN_SECRET_KEY>`
- 受信任 `Origin`（生产允许 `https://issue.calvin-xia.cn`、`https://demo.calvin-xia.cn`、`https://web-message-board.pages.dev` 与单层 Pages 预览子域；允许来源在 `src/shared/corsConfig.js` 统一维护）

### `GET /api/admin/issues`

后台问题列表与聚合统计。

主要查询参数：

- `page` / `pageSize`
- `status` / `category` / `priority`
- `distressType` / `sceneTag`（仅命中心理咨询扩展字段）
- `assignedTo`
- `q`
- `startDate` / `endDate` / `updatedAfter`
- `hasNotes` / `hasReplies` / `isAssigned`
- `sortField` / `sortOrder`

### `GET /api/admin/issues/:id`

返回完整问题详情、内部备注、公开回复与操作历史。

### `PATCH /api/admin/issues/:id`

允许更新：

- `status`
- `category`
- `priority`
- `assignedTo`
- `publicSummary`
- `distressType`
- `sceneTag`
- `isPublic`

`distressType` 与 `sceneTag` 只能在最终分类为 `counseling` 时设置；当分类改为非心理咨询时，后台会自动清空这两个字段。

### `POST /api/admin/issues/:id/notes`

添加内部备注。

### `POST /api/admin/issues/:id/replies`

添加公开或私有回复。

### `GET /api/admin/actions`

分页查询后台操作审计日志。

### `GET /api/admin/export`

导出 CSV。当前仅支持 `format=csv`。
单次导出最多 `50000` 条，超过上限时会返回错误并提示缩小筛选范围。
CSV 包含 `distress_type` 与 `scene_tag` 两列。

### `GET /api/admin/metrics`

返回后台运营统计、分布、趋势与分位数指标。
心理困扰类别分布、场景分布和场景热区仅统计 `category = counseling` 且对应字段非空的数据。

查询参数：

- `startDate` / `endDate`
- `period`：`day` / `week` / `month`
- `refresh`：`true` 时强制刷新缓存
