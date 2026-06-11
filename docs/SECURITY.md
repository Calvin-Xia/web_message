# 安全文档

## 输入安全

- 所有公开与后台写接口均使用 Zod 校验。
- D1 查询全部使用参数绑定，避免 SQL 注入。
- 前端展示统一使用 HTML 转义，避免 XSS 注入。
- 后台接口通过受控 CORS + Bearer Token 组合降低 CSRF 风险。
- 后台账号登录、用户创建、密码重置等认证输入均使用 Zod 校验。
- 后台生产 CORS 允许来源集中维护在 `src/shared/corsConfig.js`，当前不再允许旧的 `issue-origin.calvin-xia.cn`。

## 传输安全

- API 中间件在生产环境对非 HTTPS 请求执行 `308` 跳转。
- 统一附加 `Strict-Transport-Security`、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`。
- 静态页面通过 `_headers` 文件附加 CSP 与基础安全头。

## 后台认证

- 当前应用不签发认证 Cookie，因此不存在 `Secure` / `HttpOnly` / `SameSite` Cookie 配置面。
- 常规后台登录使用用户名密码换取 JWT，前端存储在 `localStorage` 的 `admin_token`，请求时通过 `Authorization: Bearer <token>` 发送。
- 共享密钥 `ADMIN_SECRET_KEY` 仍作为备用 Bearer 登录入口，前端只在 `sessionStorage` 保留备用密钥。
- JWT 使用 HMAC-SHA256 签名，签名密钥来自 `ADMIN_JWT_SECRET`；默认有效期 24 小时，勾选“记住登录状态”后为 7 天。
- 登出时 JWT 的 SHA-256 hash 会写入 KV 黑名单，TTL 与令牌剩余有效期一致。
- 密码使用 bcrypt 算法存储，当前实现采用纯 JS bcrypt 依赖以兼容 Cloudflare Pages Functions 运行时。
- 管理员密码重置 token 只保存 hash，原始 token 仅通过邮件链接发送，成功使用后会标记失效。
- 当前 `admin_users` 表不保存邮箱；密码重置邮件收件人由 `ADMIN_RESET_EMAIL` 配置，未配置时退回支持邮箱。

## 前端导航边界

- 首页与后台页的侧边菜单只提供页面内锚点和公开页面入口，不承载权限判断。
- 后台侧边菜单登录前隐藏后台分区入口，登录后由前端状态显示；这只是界面状态，后台 API 仍必须通过受控 CORS、JWT/备用共享密钥与角色权限鉴权。
- 侧边菜单不会展示姓名、学号、邮箱、内部备注、导出链接或其它敏感运营字段。
- 移动端侧边菜单使用遮罩与 `Escape` 关闭，不改变后台问题详情抽屉的鉴权、焦点管理或数据加载逻辑。

## 邮箱通知边界

- 提交者邮箱仅作为通知渠道使用，不作为身份认证凭证。
- 公开接口与追踪页不会返回提交者邮箱。
- 当前不会基于邮箱签发登录态、验证码或 magic link。

## 日志安全

- `/api/health` 仅返回脱敏后的错误概要，不返回堆栈、SQL、密钥或原始异常对象。
- 健康检查趋势与日志快照存储在 KV 中，便于快速排障。
- 管理端行为通过 `admin_actions` 保留审计记录。
- 登录成功、登录失败、登出、密码重置、用户创建/更新/禁用都会写入 `admin_actions`。
- 后台鉴权接口响应默认携带 `Cache-Control: no-store`，避免姓名、学号、备注和导出元数据被浏览器或中间层缓存。

## 公开地图边界

- 校园地图静态资产 `/storage/campus-care-map.json` 只包含公开地图几何、分类场景、地点名称和少量地图标签。
- 地图悬停信息只展示 `/api/insights` 的场景级公开聚合数量，不展示用户身份、提交内容或精确个案位置。
- 地图文件由折叠面板懒加载，前端只按场景合并聚合热度，不会把用户提交记录映射到具体建筑或区域。
- 前端文案明确提示“公开聚合，不代表该地点发生个案”，避免把场景热度误解为地点级事件记录。
- 生成地图资产时应继续使用预处理脚本过滤行政边界、异常城市要素和校园范围外要素，不要直接发布完整 GeoJSON 导出。

## 后台导出边界

- `GET /api/admin/export` 默认导出完整运营字段，包含姓名、学号、问题正文和指派信息，便于内部复核、归档和追责。
- `format=json` 会额外在每条问题下嵌套内部备注与回复，敏感级别不低于 CSV 导出。
- 单次导出最多 5000 条，避免同步生成超大文件占用过多 Worker 内存。
- CSV 导出会中和以公式触发字符开头的单元格，降低电子表格打开时的公式注入风险。
- 该能力仅限后台鉴权用户使用，并继续受受控 CORS、Bearer Token、限流和审计记录保护。
- 导出文件属于敏感运营资料，不应转发到公开渠道；如需对外共享，应先做人工脱敏。

## 运营建议

- 定期轮换 `ADMIN_SECRET_KEY` 与 `ADMIN_JWT_SECRET`
- 上线后立即更改迁移插入的默认管理员密码
- 对生产环境启用最小权限的 Cloudflare 访问控制
- 发布前查看 `/health.html` 与最近 CI 覆盖率 artifact
- 地图源数据更新时，先在本地重新运行预处理脚本并检查输出要素数量，再发布静态资产。
- 若要引入 Cookie，会话方案必须补充 `Secure`、`HttpOnly`、`SameSite=Strict` 与 CSRF token
