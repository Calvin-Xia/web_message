# 修复 Cloudflare Pages 部署配置

## 问题分析

1. **警告**: wrangler.toml 检测到 Pages 配置，但缺少 `pages_build_output_dir` 字段
2. **错误**: 必须指定要部署的资产目录

## 解决方案

### 1. 更新 wrangler.toml

添加 `pages_build_output_dir` 配置，指定静态文件目录：
- 对于静态 HTML 项目，设置为 `./`（根目录）
- 添加 Pages 相关配置

### 2. 验证配置

确保配置包含：
- `pages_build_output_dir`: 指定静态文件目录
- `[[d1_databases]]`: D1 数据库绑定
- 环境变量配置（可选）

### 3. 重新部署

使用更新后的配置重新部署：
```bash
npx wrangler pages deploy
```