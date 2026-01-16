# 修复 Cloudflare Pages D1 数据库绑定问题

## 问题分析

1. **配置警告**: D1 数据库绑定在顶层，但需要在环境配置中
2. **运行时错误**: "Cannot read properties of undefined (reading 'prepare')" - D1 数据库未正确绑定

## 解决方案

### 1. 修复 wrangler.toml 配置

将 `[[d1_databases]]` 从顶层移到环境配置中：
- `[env.production]` 环境添加 D1 绑定
- `[env.preview]` 环境添加 D1 绑定

### 2. 创建 Pages Functions

在 `functions/` 目录创建 API 函数：
- `functions/api/issues.js` - 处理 API 请求
- 使用 Pages Functions 语法（export async function onRequest）

### 3. 更新项目结构

创建 `functions/` 目录用于存放 Pages Functions

### 4. 重新部署

使用修复后的配置重新部署