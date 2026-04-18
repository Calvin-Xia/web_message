# 安全文档

## 输入安全

- 所有公开与后台写接口均使用 Zod 校验。
- D1 查询全部使用参数绑定，避免 SQL 注入。
- 前端展示统一使用 HTML 转义，避免 XSS 注入。
- 后台接口通过受控 CORS + Bearer Token 组合降低 CSRF 风险。
- 后台生产 CORS 允许来源集中维护在 `src/shared/corsConfig.js`，当前不再允许旧的 `issue-origin.calvin-xia.cn`。

## 传输安全

- API 中间件在生产环境对非 HTTPS 请求执行 `308` 跳转。
- 统一附加 `Strict-Transport-Security`、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`。
- 静态页面通过 `_headers` 文件附加 CSP 与基础安全头。

## Cookie 策略

- 当前应用不签发认证 Cookie。
- 后台登录态仅存储在浏览器 `sessionStorage`，因此不存在 `Secure` / `HttpOnly` / `SameSite` Cookie 配置面。
- 这同时降低了 Cookie 被错误跨站携带的风险面。

## 邮箱通知边界

- 提交者邮箱仅作为通知渠道使用，不作为身份认证凭证。
- 公开接口与追踪页不会返回提交者邮箱。
- 当前不会基于邮箱签发登录态、验证码或 magic link。

## 日志安全

- `/api/health` 仅返回脱敏后的错误概要，不返回堆栈、SQL、密钥或原始异常对象。
- 健康检查趋势与日志快照存储在 KV 中，便于快速排障。
- 管理端行为通过 `admin_actions` 保留审计记录。

## 公开地图边界

- 校园地图静态资产 `/storage/campus-care-map.json` 只包含公开地图几何、分类场景、地点名称和少量地图标签。
- 地图悬停信息只展示 `/api/insights` 的场景级公开聚合数量，不展示用户身份、提交内容或精确个案位置。
- 地图文件由折叠面板懒加载，前端只按场景合并聚合热度，不会把用户提交记录映射到具体建筑或区域。
- 前端文案明确提示“公开聚合，不代表该地点发生个案”，避免把场景热度误解为地点级事件记录。
- 生成地图资产时应继续使用预处理脚本过滤行政边界、异常城市要素和校园范围外要素，不要直接发布完整 GeoJSON 导出。

## 后台导出边界

- `GET /api/admin/export` 默认导出完整运营字段，包含姓名、学号、问题正文和指派信息，便于内部复核、归档和追责。
- `format=json` 会额外在每条问题下嵌套内部备注与回复，敏感级别不低于 CSV 导出。
- 该能力仅限后台鉴权用户使用，并继续受受控 CORS、Bearer Token、限流和审计记录保护。
- 导出文件属于敏感运营资料，不应转发到公开渠道；如需对外共享，应先做人工脱敏。

## 运营建议

- 定期轮换 `ADMIN_SECRET_KEY`
- 对生产环境启用最小权限的 Cloudflare 访问控制
- 发布前查看 `/health.html` 与最近 CI 覆盖率 artifact
- 地图源数据更新时，先在本地重新运行预处理脚本并检查输出要素数量，再发布静态资产。
- 若要引入 Cookie，会话方案必须补充 `Secure`、`HttpOnly`、`SameSite=Strict` 与 CSRF token
