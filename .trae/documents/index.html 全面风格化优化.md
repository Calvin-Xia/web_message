# 备案号风格化修改

## 修改目标

将128-137行的备案号从内联样式改为 Tailwind CSS 风格，与页面其他部分保持一致。

## 修改内容

### 1. 页脚容器
- 移除内联样式 `style="text-align: right;"`
- 使用 Tailwind CSS 类：`text-right`
- 添加合适的间距和内边距

### 2. 备案链接
- 保持链接样式与页面其他链接一致
- 使用 Tailwind CSS 类：`text-fb-gray text-sm hover:text-fb-blue`
- 添加过渡效果

### 3. 公安备案图标
- 优化图片样式
- 使用 Tailwind CSS 类控制大小和对齐
- 添加悬停效果

### 4. 整体布局
- 确保页脚在移动端也有良好显示
- 添加合适的背景色和间距