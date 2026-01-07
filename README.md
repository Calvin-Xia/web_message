# 问题反馈系统

一个基于 Cloudflare Workers 和 D1 数据库的问题反馈系统应用。

## 功能特性

- 用户可以提交问题反馈（包括问题内容）
- 实名信息（姓名、学号）为必填项
- 支持选择是否公开实名信息
- 支持问题上报选项
- 实时显示历史问题列表（仅显示问题内容和时间，保护隐私）
- 显示问题提交时间（智能格式化）
- 响应式设计，支持移动端
- 基于 Cloudflare D1 数据库存储
- 防 XSS 攻击
- 表单验证（内容长度限制、实名信息必填验证）

## 技术栈

- **前端**: HTML + CSS + JavaScript
- **后端**: Cloudflare Workers
- **数据库**: Cloudflare D1 (SQLite)
- **部署**: Cloudflare Workers

## 项目结构

```
web_message/
├── src/
│   └── index.js        # Cloudflare Workers 主文件
├── index.html          # 前端页面
├── schema.sql          # 数据库表结构
├── wrangler.toml       # Cloudflare Workers 配置
├── package.json        # 项目依赖配置
└── README.md           # 说明文档
```

## 数据库表结构

### issues 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| issue | TEXT | 问题内容（必填） |
| isInformationPublic | TEXT | 是否公开实名信息（yes/no，必填） |
| name | TEXT | 姓名（必填） |
| student_id | TEXT | 学号（必填） |
| isReport | TEXT | 是否上报（yes/no，必填） |
| created_at | DATETIME | 创建时间 |

## 部署步骤

### 1. 安装依赖

首先确保你已经安装了 Node.js (推荐 18.x 或更高版本)。

```bash
npm install
```

### 2. 登录 Cloudflare

```bash
wrangler login
```

这会打开浏览器让你登录到 Cloudflare 账户。

### 3. 创建 D1 数据库

```bash
wrangler d1 create issue-board-db
```

执行后，命令会返回数据库的 ID，类似：

```
✅ Successfully created DB 'issue-board-db'

[[d1_databases]]
binding = "DB"
database_name = "issue-board-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 4. 更新 wrangler.toml

将上一步获得的 `database_id` 复制到 `wrangler.toml` 文件中，替换 `YOUR_DATABASE_ID`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "issue-board-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # 替换为实际的 ID
```

### 5. 初始化数据库表结构

执行 SQL 脚本创建数据库表：

```bash
wrangler d1 execute issue-board-db --remote --file=./schema.sql

// 或本地
wrangler d1 execute issue-board-db --local --file=./schema.sql
```

你应该看到类似输出：

```
🌀 Executing on issue-board-db (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx):
🚣 Executed 2 commands in 0.123ms
```

### 6. 本地开发测试

启动本地开发服务器：

```bash
npm run dev
```

或者：

```bash
npx wrangler dev
```

访问 `http://localhost:8787` 查看应用。

### 7. 部署到 Cloudflare

```bash
npm run deploy
```

或者：

```bash
wrangler deploy
```

部署成功后，你会看到应用的 URL，类似：

```
Published web-message-board (0.12 sec)
  https://web-message-board.your-account.workers.dev
```

## 常用命令

```bash
# 本地开发
npm run dev

# 部署到生产环境
npm run deploy

# 查询所有问题（不包含个人信息）
npx wrangler d1 execute issue-board-db --command "SELECT id, issue, created_at FROM issues ORDER BY created_at DESC"

# 查询包含个人信息的问题
npx wrangler d1 execute issue-board-db --command "SELECT * FROM issues ORDER BY created_at DESC"

# 查询实名提交的问题
npx wrangler d1 execute issue-board-db --command "SELECT * FROM issues WHERE isInformationPublic = 'yes'"

# 查询需要上报的问题
npx wrangler d1 execute issue-board-db --command "SELECT * FROM issues WHERE isReport = 'yes'"

# 清空问题（谨慎使用）
npx wrangler d1 execute issue-board-db --command "DELETE FROM issues"
```

## 数据库管理

### 查看所有问题（公开信息）

```bash
npx wrangler d1 execute issue-board-db --command "SELECT id, issue, created_at FROM issues ORDER BY created_at DESC"
```

### 查看包含个人信息的问题

```bash
npx wrangler d1 execute issue-board-db --command "SELECT * FROM issues ORDER BY created_at DESC"
```

### 删除特定问题

```bash
npx wrangler d1 execute issue-board-db --command "DELETE FROM issues WHERE id = 1"
```

### 查看问题数量

```bash
npx wrangler d1 execute issue-board-db --command "SELECT COUNT(*) as total FROM issues"
```

### 查看实名提交统计

```bash
npx wrangler d1 execute issue-board-db --command "SELECT isInformationPublic, COUNT(*) as count FROM issues GROUP BY isInformationPublic"
```

### 查看需要上报的问题

```bash
npx wrangler d1 execute issue-board-db --command "SELECT id, issue, name, student_id, created_at FROM issues WHERE isReport = 'yes'"
```

## 自定义配置

### 修改项目名称

在 `wrangler.toml` 中修改 `name` 字段：

```toml
name = "your-custom-name"
```

### 修改问题限制

在 `src/index.js` 中修改：

```javascript
// 内容长度限制（默认 1000 字符）
if (issue.length > 1000) {
  // ...
}

// 问题列表数量限制（默认 100 条）
SELECT ... LIMIT 100
```

## 安全说明

- 所有用户输入都经过 HTML 转义，防止 XSS 攻击
- 内容长度限制
- 实名信息（姓名、学号）为必填项
- 前端仅显示公开信息（问题内容和时间），不显示个人信息
- CORS 已配置，允许跨域访问

## 故障排除

### 数据库连接错误

确保 `wrangler.toml` 中的 `database_id` 正确。

### 部署失败

检查是否已登录：

```bash
npx wrangler whoami
```

### 本地开发数据库问题

本地开发时，Wrangler 会自动创建本地数据库。如果遇到问题，确保已执行 schema.sql：

```bash
npx wrangler d1 execute issue-board-db --local --file=./schema.sql
```

## License

MIT
