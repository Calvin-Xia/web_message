# API 文档

OpenAPI 3.0.3 规范见 [`docs/openapi.yaml`](./openapi.yaml)，交互式文档见
[`/docs/api.html`](/docs/api.html) 或 [`/docs/swagger/index.html`](/docs/swagger/index.html)。

当前规范版本为 v1。OpenAPI 的服务器地址为 `/v1`，因此本文中的 `/api/...`
路径实际通过 `/v1/api/...` 访问。旧 `/api/...` 非 OPTIONS 请求会以 `308`
跳转到对应 v1 路径；OPTIONS 保留在旧路径响应，确保跨域预检兼容。

**308 重定向说明**：308 Permanent Redirect 要求客户端保留原请求方法和请求体。
主流浏览器和 HTTP 客户端（curl、fetch、axios）均正确实现此行为。
旧客户端如遇请求体丢失问题，应直接使用 `/v1/api/...` 路径。

所有 API 响应采用统一 JSON 包装：

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

> **路径约定**：为简洁起见，本文档接口标题使用 `/api/...` 格式。
> 实际访问路径为 `/v1/api/...`（即 servers 前缀 `/v1` + 路径 `/api/...`）。
> 旧 `/api/*` 请求会通过 308 重定向到对应 v1 路径。

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
- 提交成功后，后台会按启用的自动分配规则尝试写入 `assigned_to` / `assigned_at`，并按优先级 SLA 规则写入响应与解决截止时间

### `GET /api/issues/:trackingCode`

根据追踪编号返回公开可见的问题详情与时间线。

### `GET /api/insights`

返回公开心理咨询反馈的脱敏聚合数据，用于校园心理压力热区与困扰类别展示。
默认统计最近 `90` 天，只统计 `isPublic = true` 且 `category = counseling` 的问题；未填写 `sceneTag` 的记录不进入场景热区。
首页校园矢量地图不会从该接口获取地点级数据；它只使用 `sceneHotspots` 按场景合并热度，并与静态地图资产 `/storage/campus-care-map.json` 在浏览器端渲染。

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

### `GET /api/knowledge`

返回首页公开知识库卡片。只返回已启用条目，按 `sortOrder` 与 `id` 升序排列。
首页在用户选择心理咨询分类且选择具体困扰类别时，会在浏览器端按 `tag` 匹配展示对应卡片；未选择具体困扰类别时展示全部已启用条目。

限流与缓存：

- 使用公开读接口限流策略。
- 成功响应包含 `Cache-Control: public, max-age=60`。
- 方法不支持返回 `405`。

示例响应：

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 1,
        "title": "学业压力",
        "tag": "academic_pressure",
        "content": "先把任务拆成今天能完成的一小步，给自己留出固定休息段。",
        "sortOrder": 10,
        "isEnabled": true,
        "createdAt": "2026-04-18T08:00:00.000Z",
        "updatedAt": "2026-04-18T08:00:00.000Z"
      }
    ]
  }
}
```

## 公开静态资产

### `/storage/campus-care-map.json`

校园矢量地图静态资产，由 `npm run build:map -- <geojson>` 从离线 GeoJSON 导出预处理生成，不通过后台 API 动态生成。
首页默认折叠地图面板，只有用户展开校园地图时才懒加载该文件。

字段契约：

```json
{
  "version": 1,
  "bbox": [114.30, 30.49, 114.39, 30.57],
  "features": [
    {
      "id": "way/1",
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [114.3301, 30.5301],
            [114.3304, 30.5301],
            [114.3304, 30.5304],
            [114.3301, 30.5304],
            [114.3301, 30.5301]
          ]
        ]
      },
      "scene": "classroom",
      "kind": "area",
      "name": "教学楼",
      "tags": { "building": "university", "name": "教学楼" }
    }
  ]
}
```

- `scene` 对应心理咨询场景标签：`dormitory` / `classroom` / `library` / `self_study` / `cafeteria` / `playground`。
- `kind` 用于前端 SVG 渲染，可为 `area` / `line` / `point` / `geometry`。
- `tags` 仅保留分类所需的公开地图标签，不包含用户提交的问题内容、身份信息或个案位置。
- 地图悬停信息展示的是 `/api/insights` 的场景级公开聚合数量，不代表该地点发生个案。

## 后台接口

所有后台接口需要：

- 请求头 `Authorization: Bearer <JWT>`；共享密钥 `Authorization: Bearer <ADMIN_SECRET_KEY>` 仍作为备用入口兼容
- 受信任 `Origin`（生产与预览允许 `https://issue.calvin-xia.cn`、`https://demo.calvin-xia.cn`、`https://web-message-board.pages.dev` 与单层 Pages 预览子域；允许来源在 `src/shared/corsConfig.js` 统一维护）

### `POST /api/admin/auth/login`

管理员账号密码登录。默认 JWT 有效期为 24 小时，`rememberMe=true` 时为 7 天。

请求体：

```json
{
  "username": "admin",
  "password": "admin123",
  "rememberMe": false
}
```

成功响应：

```json
{
  "success": true,
  "data": {
    "token": "eyJ...",
    "expiresAt": "2026-06-11T00:00:00.000Z",
    "user": {
      "id": 1,
      "username": "admin",
      "displayName": "管理员",
      "role": "admin"
    }
  }
}
```

错误响应：

- `401`：用户名或密码错误
- `403`：账号已禁用

### `POST /api/admin/auth/logout`

登出当前 JWT。JWT 会写入 KV 黑名单，黑名单 TTL 与令牌剩余有效期一致。共享密钥调用该接口也会返回成功，但不会写入黑名单。

### `POST /api/admin/auth/forgot-password`

发起密码重置。无论用户名是否存在，都返回相同响应，避免用户名枚举。

```json
{
  "username": "admin"
}
```

如果用户存在且已启用，系统会生成 1 小时有效的重置 token，仅保存 token hash，并通过 Resend 发送重置链接。由于 `admin_users` 表不保存邮箱，收件人由 `ADMIN_RESET_EMAIL` 配置；未配置时退回 `support@calvin-xia.cn`。

### `POST /api/admin/auth/reset-password`

使用邮件中的 token 重置密码。

```json
{
  "token": "reset-token",
  "newPassword": "NewPass123!"
}
```

新密码必须至少 8 位，并包含大小写字母、数字和 `?!@#$%^&*[]{}` 中的特殊字符。token 无效、过期或已使用时返回 `400`。

### `GET /api/admin/users`

获取后台用户列表。仅 `admin` 角色可访问；响应不包含 `password_hash`。

### `POST /api/admin/users`

创建后台用户。仅 `admin` 角色可访问。

```json
{
  "username": "handler1",
  "password": "Handler123!",
  "displayName": "处理员1",
  "role": "handler"
}
```

用户名只允许字母、数字和下划线；重复用户名返回 `409`。

### `PATCH /api/admin/users/:id`

更新后台用户显示名、角色或启用状态。仅 `admin` 角色可访问。

```json
{
  "displayName": "处理员一号",
  "role": "admin",
  "isEnabled": true
}
```

### `DELETE /api/admin/users/:id`

软删除后台用户，即设置 `is_enabled = 0`。仅 `admin` 角色可访问，不能删除当前登录用户。

### `GET /api/admin/issues`

后台问题列表与聚合统计。

主要查询参数：

- `page` / `pageSize`
- `status` / `category` / `priority`
- `distressType` / `sceneTag`（仅命中心理咨询扩展字段）
- `assignedTo`
- `slaStatus`：`normal` / `warning` / `violated`
- `q`
- `startDate` / `endDate` / `updatedAfter`
- `hasNotes` / `hasReplies` / `isAssigned`
- `sortField` / `sortOrder`

### `GET /api/admin/issues/:id`

返回完整问题详情、内部备注、公开回复与操作历史。

### `PATCH /api/admin/issues/:id`

请求体必须包含 `updatedAt`，用于乐观并发校验；如果提交时记录已被其他操作更新，会返回冲突错误。

允许更新：

- `status`
- `category`
- `priority`
- `assignedTo`
- `assignedAt`
- `publicSummary`
- `distressType`
- `sceneTag`
- `isPublic`

`distressType` 与 `sceneTag` 只能在最终分类为 `counseling` 时设置；当分类改为非心理咨询时，后台会自动清空这两个字段。
`assignedTo` 发生变化且未显式传入 `assignedAt` 时，后台会自动写入当前分配时间。

### `POST /api/admin/issues/batch`

批量更新问题。`handler` 与 `admin` 可访问，一次最多 100 条。
请求体必须包含 `updatedAt`，用于乐观并发校验；如果问题在列表加载后被其他管理员更新，该问题会出现在 `failedIds` 中。

```json
{
  "issueIds": [1, 2, 3],
  "updates": {
    "status": "in_review",
    "priority": "high",
    "assignedTo": "handler1"
  },
  "updatedAt": "2026-06-12T08:00:00.000Z"
}
```

响应包含成功数量与失败 ID：

```json
{
  "success": true,
  "data": {
    "updatedCount": 2,
    "failedIds": [3]
  }
}
```

### `GET /api/admin/sla/rules`

获取 SLA 规则列表。仅 `admin` 可访问。

### `POST /api/admin/sla/rules`

创建 SLA 规则。每个优先级只能有一条规则。

```json
{
  "name": "普通问题 24 小时响应",
  "priority": "normal",
  "responseHours": 24,
  "resolutionHours": 72,
  "isEnabled": true
}
```

### `PATCH /api/admin/sla/rules/:id`

更新 SLA 规则。请求体必须包含 `updatedAt`；并发冲突返回 `409`。

### `GET /api/admin/sla/violations`

获取即将超时或已超时问题。仅 `admin` 可访问。

查询参数：

- `status`：`warning` / `violated`
- `startDate` / `endDate`

响应示例：

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "issueId": 5,
        "trackingCode": "ABCD23EF",
        "priority": "high",
        "assignedTo": "handler1",
        "slaStatus": "violated",
        "responseDeadline": "2026-06-05T16:00:00.000Z",
        "resolutionDeadline": "2026-06-07T08:00:00.000Z",
        "createdAt": "2026-06-05T08:00:00.000Z"
      }
    ]
  }
}
```

### `GET /api/admin/assign-rules`

获取自动分配规则。仅 `admin` 可访问。

### `POST /api/admin/assign-rules`

创建自动分配规则。

```json
{
  "name": "学业压力分配",
  "category": "academic",
  "keywords": ["考试", "成绩"],
  "assignTo": "handler1",
  "priority": 10,
  "isEnabled": true
}
```

### `PATCH /api/admin/assign-rules/:id`

更新自动分配规则。请求体必须包含 `updatedAt`；并发冲突返回 `409`。

### `DELETE /api/admin/assign-rules/:id`

删除自动分配规则，并记录审计动作。

### `GET /api/admin/assign-stats`

获取分配统计。仅 `admin` 可访问。

查询参数：

- `period`：`week` / `month`，默认 `week`
- `startDate` / `endDate`

响应包含汇总、按处理人分组的统计与趋势数据：

```json
{
  "success": true,
  "data": {
    "summary": {
      "totalIssues": 10,
      "pending": 3,
      "inProgress": 2,
      "resolved": 5
    },
    "handlers": [
      {
        "username": "handler1",
        "displayName": "处理员1",
        "pending": 2,
        "inProgress": 1,
        "resolved": 3,
        "avgResponseTime": 2.5,
        "avgResolutionTime": 48.0
      }
    ],
    "trend": [
      { "period": "2026-W23", "created": 4, "resolved": 2 }
    ]
  }
}
```

### `POST /api/admin/issues/:id/notes`

添加内部备注。

请求体：

```json
{
  "content": "已联系相关老师跟进。"
}
```

### `POST /api/admin/issues/:id/replies`

添加公开或私有回复。

请求体：

```json
{
  "content": "该问题已进入处理流程。",
  "isPublic": true
}
```

### `GET /api/admin/actions`

分页查询后台操作审计日志。

### `GET /api/admin/knowledge`

返回全部知识条目，包括禁用条目。按 `sortOrder` 与 `id` 升序排列。

### `POST /api/admin/knowledge`

创建知识条目，并记录 `knowledge_created` 审计动作。

请求体：

```json
{
  "title": "学业压力",
  "tag": "academic_pressure",
  "content": "先把任务拆成今天能完成的一小步。",
  "sortOrder": 10,
  "isEnabled": true
}
```

字段说明：

- `tag`：心理困扰类别，取值为 `academic_pressure` / `relationship` / `adaptation` / `mood` / `sleep` / `other`
- `sortOrder`：非负整数，默认 `0`
- `isEnabled`：默认 `true`；禁用后后台仍可见，首页不展示

### `PATCH /api/admin/knowledge/:id`

更新知识条目，并记录 `knowledge_updated` 审计动作。请求体必须包含 `updatedAt` 进行乐观并发校验；记录已被其他管理员更新时返回 `409`。

允许更新：

- `title`
- `tag`
- `content`
- `sortOrder`
- `isEnabled`

### `DELETE /api/admin/knowledge/:id`

硬删除知识条目，并记录 `knowledge_deleted` 审计动作。请求体必须包含 `updatedAt`；记录已被其他管理员更新时返回 `409`。

### `GET /api/admin/export`

导出后台问题数据。`format` 支持：

- `csv`：默认格式，返回扁平表格文件。
- `json`：返回结构化 JSON 文件，适合与其他系统对接。

单次导出最多 `5000` 条，超过上限时会返回错误并提示缩小筛选范围。
CSV 包含 `distress_type` 与 `scene_tag` 两列。
JSON 使用 camelCase 字段，并在每条问题下包含关联的 `internalNotes` 与 `replies`：

```json
{
  "metadata": {
    "format": "json",
    "exportedAt": "2026-04-18T12:00:00.000Z",
    "rowCount": 1,
    "nestedRowCounts": { "internalNotes": 1, "replies": 1 },
    "filters": { "format": "json", "status": ["in_review"] }
  },
  "issues": [
    {
      "id": 1,
      "trackingCode": "ABCD23EF",
      "name": "张三",
      "studentId": "2024001001001",
      "content": "图书馆空调故障，需要尽快处理。",
      "category": "facility",
      "distressType": null,
      "sceneTag": null,
      "priority": "high",
      "status": "in_review",
      "isPublic": true,
      "isReported": false,
      "assignedTo": "admin1",
      "firstResponseAt": "2026-03-11T09:00:00.000Z",
      "resolvedAt": null,
      "createdAt": "2026-03-11T08:00:00.000Z",
      "updatedAt": "2026-03-11T09:30:00.000Z",
      "publicSummary": "已安排后勤团队处理",
      "internalNotes": [
        {
          "id": 10,
          "content": "已联系后勤团队。",
          "createdBy": "admin1",
          "createdAt": "2026-03-11T10:00:00.000Z"
        }
      ],
      "replies": [
        {
          "id": 20,
          "type": "public_reply",
          "oldValue": null,
          "newValue": null,
          "content": "该问题已进入处理流程。",
          "isPublic": true,
          "createdBy": "admin1",
          "createdAt": "2026-03-11T11:00:00.000Z"
        }
      ]
    }
  ]
}
```

### `GET /api/admin/metrics`

返回后台运营统计、分布、趋势与分位数指标。
心理困扰类别分布、场景分布和场景热区仅统计 `category = counseling` 且对应字段非空的数据。

查询参数：

- `startDate` / `endDate`
- `period`：`day` / `week` / `month`
- `refresh`：`true` 时强制刷新缓存
