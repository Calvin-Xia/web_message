# 问题反馈系统

一个基于 Cloudflare Pages 和 D1 数据库的问题反馈系统应用。

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
- **后端**: Cloudflare Pages Functions
- **数据库**: Cloudflare D1 (SQLite)
- **部署**: Cloudflare Pages

## 部署方式

本项目支持两种部署方式：

### 方式一：Cloudflare Workers（推荐用于简单部署）
- 适合快速部署和测试
- 使用 `wrangler deploy` 命令
- 适合个人项目和小型应用

### 方式二：Cloudflare Pages（推荐用于生产环境）
- 适合生产环境和团队协作
- 支持自定义域名
- 支持 CI/CD 自动部署
- 提供 Preview 部署环境

## 项目结构

```
web_message/
├── src/
│   └── index.js        # Cloudflare Workers 主文件
├── index.html          # 前端页面
├── schema.sql          # 数据库表结构
├── wrangler.toml       # Cloudflare 配置文件
├── package.json        # 项目依赖配置
├── .gitignore         # Git 忽略文件配置
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

### 7. 部署到 Cloudflare Workers

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

## Cloudflare Pages 部署指南

### 环境准备

#### 前置要求

- Node.js 18.x 或更高版本
- Git 账户（GitHub、GitLab 等）
- Cloudflare 账户（免费账户即可）

#### 安装依赖

```bash
npm install
```

#### 登录 Cloudflare

```bash
npx wrangler login
```

### 项目配置要求

#### 1. 创建 D1 数据库

```bash
npx wrangler d1 create issue-board-db
```

将返回的 `database_id` 更新到 `wrangler.toml` 文件中。

#### 2. 初始化数据库表结构

```bash
npx wrangler d1 execute issue-board-db --remote --file=./schema.sql
```

#### 3. 配置文件说明

- **wrangler.toml**: 包含 D1 数据库绑定和环境变量配置
- **package.json**: 包含部署脚本和项目元数据
- **.gitignore**: 排除不需要提交的文件（node_modules、.wrangler 等）

### 部署方式

#### 方式一：直接部署（Direct Upload）

适合快速部署和测试：

```bash
npx wrangler pages deploy
```

**部署流程**：
1. Wrangler 会自动打包项目文件
2. 上传到 Cloudflare Pages
3. 自动构建和部署
4. 返回部署 URL

**特点**：
- 快速部署，无需 Git
- 适合个人项目
- 不支持自定义域名（需要通过 Cloudflare Dashboard 配置）

#### 方式二：Git 集成部署（推荐）

适合生产环境和团队协作：

##### 步骤 1：初始化 Git 仓库

```bash
git init
git add .
git commit -m "Initial commit"
```

##### 步骤 2：连接到远程仓库

```bash
git remote add origin https://github.com/your-username/web-message-board.git
git branch -M main
git push -u origin main
```

##### 步骤 3：在 Cloudflare Dashboard 创建 Pages 项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **Create application**
3. 选择 **Pages** → **Connect to Git**
4. 选择你的 Git 提供商（GitHub、GitLab 等）
5. 选择仓库 `web-message-board`
6. 配置构建设置：
   - **Build command**: 留空（静态 HTML，无需构建）
   - **Build output directory**: `/`（根目录）
   - **Root directory**: `/`（根目录）

##### 步骤 4：配置环境变量和绑定

在 Cloudflare Dashboard 中配置：

1. 进入 **Settings** → **Functions**
2. 添加 D1 数据库绑定：
   - **Variable name**: `DB`
   - **D1 database**: 选择 `issue-board-db`
3. 添加环境变量（可选）：
   - `ENVIRONMENT`: `production`

##### 步骤 5：部署

推送代码后，Cloudflare 会自动触发部署：

```bash
git add .
git commit -m "Update application"
git push
```

### CI/CD 集成

#### GitHub Actions 自动部署

创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to Cloudflare Pages

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy
```

#### 配置 Secrets

在 GitHub 仓库设置中添加以下 Secrets：

1. 进入 **Settings** → **Secrets and variables** → **Actions**
2. 添加以下 secrets：
   - `CLOUDFLARE_API_TOKEN`: 从 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) 获取
   - `CLOUDFLARE_ACCOUNT_ID`: 从 Cloudflare Dashboard 获取

### 本地开发

#### 启动 Pages 本地开发服务器

```bash
npm run pages:dev
```

或者：

```bash
npx wrangler pages dev
```

访问 `http://localhost:8787` 查看应用。

### 域名配置

#### 添加自定义域名

1. 进入 Cloudflare Dashboard
2. 选择你的 Pages 项目
3. 进入 **Custom domains**
4. 点击 **Set up a custom domain**
5. 输入你的域名（如 `feedback.yourdomain.com`）
6. 按照提示配置 DNS 记录

#### DNS 配置

Cloudflare 会自动为你添加 DNS 记录：

```
Type: CNAME
Name: feedback
Target: your-project.pages.dev
Proxy: Enabled (橙色云朵图标)
```

### 部署验证

#### 检查部署状态

1. 进入 Cloudflare Dashboard
2. 选择你的 Pages 项目
3. 查看 **Deployments** 标签页
4. 检查最新部署状态（✅ 成功 / ❌ 失败）

#### 测试应用功能

访问部署后的 URL，测试以下功能：

1. **页面加载**：确认页面正常显示
2. **提交问题**：填写表单并提交
3. **数据验证**：检查必填字段验证
4. **数据库查询**：使用 Wrangler 查询数据库
5. **响应式设计**：在不同设备上测试

#### 查看日志

在 Cloudflare Dashboard 中查看实时日志：

1. 进入 **Workers & Pages** → **你的 Pages 项目**
2. 点击 **Logs** 标签页
3. 查看实时日志和错误信息

### Pages Functions 配置

#### 创建 API 路由

在项目根目录创建 `functions/api/issues.js`：

```javascript
export async function onRequest(context) {
  const { request, env } = context;
  
  // API 逻辑
  return new Response('Hello from Pages Functions');
}
```

#### D1 数据库绑定

在 `wrangler.toml` 中配置：

```toml
[[d1_databases]]
binding = "DB"
database_name = "issue-board-db"
database_id = "your-database-id"
```

### 最佳实践

#### 1. 环境分离

- **Production**: 使用主分支
- **Preview**: 使用功能分支进行测试
- **Staging**: 使用独立的 Pages 项目

#### 2. 性能优化

- 启用 Cloudflare 缓存
- 使用 CDN 边缘节点
- 压缩静态资源

#### 3. 安全配置

- 启用 HTTPS（Cloudflare Pages 默认启用）
- 配置 CSP (Content Security Policy)
- 设置 CORS 策略

#### 4. 监控和告警

- 配置 Cloudflare Analytics
- 设置部署失败告警
- 监控 API 错误率

### 故障排除

#### 部署失败

**问题**: 构建失败

**解决方案**:
1. 检查构建命令配置
2. 查看构建日志
3. 确认依赖已安装

#### 数据库连接错误

**问题**: D1 数据库无法连接

**解决方案**:
1. 确认 `database_id` 正确
2. 检查 D1 数据库绑定配置
3. 查看实时日志

#### 自定义域名问题

**问题**: 自定义域名无法访问

**解决方案**:
1. 检查 DNS 配置
2. 确认 SSL 证书已生成
3. 清除 DNS 缓存

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
