# 鹰国法官

以案件阅读、选项决策和剧情交互为核心的本地桌面游戏。项目使用 React + TypeScript + Vite + Tauri 2 + SQLite，包含纯 TypeScript Game Core、配置作者链、内容校验和本地语音能力。

## 快速启动

仓库 CI 使用 Node.js 24，最低要求 22.12。桌面开发另需 Rust、MSVC C++ 工具链、Windows SDK 与 WebView2。

```powershell
npm ci
npm run dev          # 浏览器内存预览
# 或
npm run tauri:dev    # 桌面开发
```

两种开发启动方式均使用 1420 端口，择一运行。桌面声音资源准备、完整检查和构建方法见 [开发与验证](docs/development/workflow.md)。

```powershell
npm run check
npm run build
```

## 文档入口

- [文档索引、当前入口与实施状态](docs/README.md)
- [产品需求](docs/product/requirements.md)
- [架构总览](docs/architecture/overview.md)
- [内容作者说明](content-authoring/README.md)
- [历史设计与验收记录](docs/archive/README.md)

仓库协作约束见 [AGENTS.md](AGENTS.md)。
