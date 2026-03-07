# 代码审查报告

**审查日期**: 2026-03-07  
**审查范围**: 整个仓库实现，包括前端页面、Pages Functions、Worker 入口、共享模块、配置、数据库结构与文档  
**重点审查文件**: `package.json`、`wrangler.toml`、`schema.sql`、`index.html`、`admin.html`、`health.html`、`_worker.js`、`src/index.js`、`src/shared/auth.js`、`src/shared/rateLimit.js`、`functions/api/issues.js`、`functions/api/health.js`、`functions/api/admin/issues.js`、`README.md`  
**未深入展开**: `node_modules/`、生成产物 `styles.css` 的样式细节、`.dev.vars` 中的本地密钥  
**总体结论**: `REQUEST_CHANGES`

---

## 概览

这个仓库的核心问题不在单点 bug，而在于“运行面不唯一”与“安全边界不闭合”：

- 部署方式、入口文件和文档表述彼此不一致，导致同一项目在不同运行路径下返回不同 API 契约。
- 管理接口承载实名和学号等敏感数据，但 CORS 与环境隔离做得不够严。
- 限流、数据约束和统计逻辑表面上存在，实际边界没有完全收紧。

当前更适合先做一轮架构收敛和安全加固，再继续叠加功能。

---

## 发现的问题

### P1 - 高优先级

#### 1. Preview 环境复用了生产 D1 和 KV

**位置**: `wrangler.toml:21-40`

`env.preview` 和 `env.production` 绑定到了同一个 D1 `database_id`，同时也复用了同一个 `RATE_LIMIT_KV` 命名空间。

这带来的直接问题是：

- Preview 分支会直接读写线上反馈数据。
- Preview 流量会影响生产环境的限流计数。
- 预发布代码如果存在逻辑问题，会直接污染正式数据。

**风险等级判断**: 高。  
这不是“配置不优雅”，而是环境隔离失效。

**建议修复**:

1. 为 preview 单独创建 D1 数据库与 KV namespace。
2. 如果 preview 只是演示或联调环境，建议关闭写接口或改为只读。
3. 将 preview 的管理员密钥与 production 彻底分离。

---

#### 2. 管理接口的 Origin 校验可被绕过

**位置**: `src/shared/auth.js:36-60`

当前生产环境通过 `origin.startsWith(allowed)` 判断是否允许跨域。例如：

- 允许域名: `https://issue.calvin-xia.cn`
- 恶意域名: `https://issue.calvin-xia.cn.evil.example`

由于使用的是前缀匹配，后者也会被误判为合法来源。

同时，非 production 环境直接返回：

```http
Access-Control-Allow-Origin: *
```

而当前 `wrangler.toml` 中 preview 恰好就是一个非 production 分支。考虑到 `/api/admin/issues` 返回的是包含姓名、学号的敏感数据，这个策略明显过宽。

**风险等级判断**: 高。  
这是典型的边界校验不严问题，且管理接口涉及个人信息。

**建议修复**:

1. 使用 `new URL(origin).origin` 做标准化后再进行精确匹配。
2. 不要在 preview 环境使用 `*`，而是维护明确白名单。
3. 为管理接口增加 `Vary: Origin` 响应头，避免缓存层错误复用。

---

#### 3. 仓库声称支持 Workers 部署，但当前实际是 Pages-only

**位置**:

- `package.json:9-12`
- `README.md:30-37`
- `README.md:208-218`

`package.json` 中的：

```json
"deploy": "wrangler deploy"
```

仍然指向 Workers 部署命令。但我实际执行 `wrangler deploy --dry-run` 时，Wrangler 已明确将当前仓库识别为 Pages 项目，并拒绝 Workers 专用部署命令。

更关键的是，目前仓库里存在三套后端实现：

- `functions/api/issues.js`
- `_worker.js`
- `src/index.js`

而且它们并不等价：

- `functions/api/issues.js` 的 `GET /api/issues` 返回分页数据，并按 `created_at DESC` 排序。
- `_worker.js` 的同一路由不返回分页信息，并按 `created_at ASC` 排序。
- `_worker.js` 的管理接口也不返回分页元数据，但 `admin.html` 明确依赖分页字段。
- `src/index.js` 又是另一套不完整实现，甚至没有暴露 `/admin.html`。

**风险等级判断**: 高。  
这已经不只是文档问题，而是运行行为会随部署路径切换而变化。

**建议修复**:

1. 明确唯一受支持的运行模式。结合当前配置，更合理的是收敛到 Pages。
2. 选定一套权威 API 实现，其余入口删除或冻结。
3. 同步清理 `package.json` 脚本、`README.md` 和 `AGENT.md` 的错误表述。

---


---

### P2 - 中优先级



---

#### 6. 数据库层没有约束应用依赖的输入规则

**位置**: `schema.sql:6-13`

应用代码中默认依赖以下规则：

- `issue` 最长 1000 字符
- `name` 最长 20 字符
- `student_id` 必须为 4 位、5 位或 13 位数字
- `isInformationPublic` / `isReport` 只能是 `yes` 或 `no`

但数据库定义里实际上只有 `NOT NULL`，没有任何 `CHECK` 约束。

这意味着只要绕开应用层，例如：

- 手工执行 D1 SQL
- 将来新增另一个写入入口
- 运行分叉实现时漏校验

都可能插入非法数据。

**风险等级判断**: 中。  
这是典型的“应用层假定成立，数据库层不兜底”问题。

**建议修复**:

1. 为 `issue` 和 `name` 增加长度约束。
2. 为 `student_id` 增加格式约束。
3. 为 `isInformationPublic` 和 `isReport` 增加枚举约束。

---


---

### P3 - 低优先级

#### 8. 页面标注为 UTC，但实际显示的是浏览器本地时间

**位置**:

- `index.html:105-107`
- `index.html:334-343`
- `admin.html:126-135`
- `admin.html:352`

页面文案写的是：

- “所有问题（时间戳为UTC标准时间）”
- “提交时间(UTC)”

但前端格式化时间时，使用的是 `getFullYear()`、`getHours()` 这一类本地时区 API，而不是 `getUTCFullYear()`、`getUTCHours()`。

因此当前界面展示的是访问者浏览器所在时区的本地时间，而不是 UTC。

`admin.html` 里的 `isToday()` 也依赖本地时区，因此“今日新增”会随着浏览器所在时区变化。

**建议修复**:

1. 如果页面要坚持展示 UTC，就统一改为 `getUTC*()` 系列 API。
2. 如果业务上更想显示用户本地时间，就删除“UTC”相关文案，避免误导。

---

## 架构与收敛建议

当前仓库最值得优先处理的不是某一个局部 bug，而是运行面分叉。

建议按以下顺序推进：

1. 明确唯一部署模式
   - 建议收敛到 Cloudflare Pages
   - 废弃或冻结与当前模式不一致的 Worker 入口

2. 明确唯一 API 契约
   - 给 `GET /api/issues`
   - `POST /api/issues`
   - `GET /api/admin/issues`
   - `GET /api/health`
   建立稳定返回结构

3. 加一层数据库兜底
   - 把关键输入规则落到 schema 里

4. 补管理端安全边界
   - 精确 Origin 校验
   - preview / production 隔离
   - 后续考虑从静态 Bearer Key 迁移到更稳妥的登录方式

---

## 可移除 / 可延后整理项

### 需要后续计划后再移除

**对象**:

- `_worker.js`
- `src/index.js`
- `functions/api/issues.js`
- `functions/api/admin/issues.js`
- `functions/api/health.js`
- `package.json`
- `README.md`

**原因**:  
当前多套入口并存，但仓库文档仍然把它们描述为“可选方案”。如果没有先确定唯一运行模式，直接删文件可能会误删真实依赖路径。

**建议处理方式**:

1. 先确认线上实际部署方式。
2. 再确认本地开发命令和 CI/CD 使用的是哪条路径。
3. 用接口测试锁定契约后，再删除冗余入口。

---

## 额外建议

- 为核心 API 增加契约测试，避免不同入口再次漂移。
- 把输入校验从重复粘贴改成共享函数，减少三处后端实现重复维护。
- 如果后台功能后续继续增长，建议逐步淘汰单一 Bearer Secret 方案，改成会话制或接入 Cloudflare Access。

---

## 本次核验说明

本次审查过程中，我额外核验了以下事实：

- `git status --short` 为空，说明审查开始时仓库无待提交改动。
- 本地执行 `wrangler deploy --dry-run` 后，Wrangler 明确报错指出当前项目是 Pages 项目，而不是可直接使用 `wrangler deploy` 的 Workers 项目。

本次未执行：

- 真实线上部署
- 浏览器端 E2E 测试
- D1 迁移或数据修复

---

## 最终结论

本次共识别出 8 个问题：

- `P0`: 0
- `P1`: 4
- `P2`: 3
- `P3`: 1

建议优先处理顺序：

1. 拆分 preview / production 的资源绑定。
2. 修复管理接口 CORS 与 Origin 精确匹配。
3. 收敛为唯一部署模式与唯一后端实现。
4. 重做或修正限流策略。
5. 为数据库补齐约束，并修复错误码与统计口径问题。
