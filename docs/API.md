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
  "category": "facility",
  "content": "图书馆空调故障，需要尽快处理。",
  "isPublic": false,
  "isReported": false
}
```

### `GET /api/issues/:trackingCode`

根据追踪编号返回公开可见的问题详情与时间线。

## 后台接口

所有后台接口需要：

- 请求头 `Authorization: Bearer <ADMIN_SECRET_KEY>`
- 受信任 `Origin`（生产仅允许配置域名与 Pages 预览子域）

### `GET /api/admin/issues`

后台问题列表与聚合统计。

主要查询参数：

- `page` / `pageSize`
- `status` / `category` / `priority`
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
- `isPublic`

### `POST /api/admin/issues/:id/notes`

添加内部备注。

### `POST /api/admin/issues/:id/replies`

添加公开或私有回复。

### `GET /api/admin/actions`

分页查询后台操作审计日志。

### `GET /api/admin/export`

导出 CSV。当前仅支持 `format=csv`。

### `GET /api/admin/metrics`

返回后台运营统计、分布、趋势与分位数指标。

查询参数：

- `startDate` / `endDate`
- `period`：`day` / `week` / `month`
- `refresh`：`true` 时强制刷新缓存
