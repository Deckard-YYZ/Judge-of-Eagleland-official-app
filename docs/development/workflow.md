# 开发与验证

核对日期：2026-10-15。命令以根 [package.json](../../package.json) 为准；当前入口和功能状态见 [文档索引](../README.md)。以下命令均从仓库根目录执行。

## 环境与启动

仓库 CI 使用 Node.js 24，`engines.node` 要求最低 22.12。使用 npm 和已提交锁文件安装依赖。桌面开发另需 Rust、MSVC C++ 工具链、Windows SDK 与 WebView2。

```powershell
node --version
npm ci
npm run dev
# 或启动桌面开发环境
npm run tauri:dev
```

两个开发命令择一运行，均使用 1420 端口。Node 版本不符合要求时先切换终端运行时，保留锁文件。

主流程短篇通过 DEV 诊断入口进入；操作与内存生命周期见 [当前入口](../README.md#当前入口)。正式内容生成另需 .NET SDK 和固定 Luban，详见 [作者说明](../../content-authoring/README.md)。

## 常用检查

```powershell
npm run typecheck
npm run voice:check
npm test -- --maxWorkers=2
npm run validate:content
npm run check:boundaries
npm run format:check
npm run build
```

`npm run check` 串行执行类型、词典、Vitest、依赖边界和代码格式检查；它不包含生产构建、内容 CLI 校验或真实导表门禁。`npm run build` 检查应用 TypeScript、词典并构建前端；作者工具的 TypeScript 检查仍需 `npm run typecheck`。

按改动选择验证范围：

| 改动               | 应验证的范围                                                                 |
| ------------------ | ---------------------------------------------------------------------------- |
| 文档与目录整理     | 本地 Markdown 链接、迁移路径、Markdown 格式、Git diff                        |
| 单纯 UI 呈现       | 相关 app/ui 测试、类型、依赖边界、代码格式、前端构建；交互变化另做浏览器验证 |
| 游戏契约或持久化   | 对应 Core/Application/SQLite 测试与旧包/旧档兼容；跨层变化再运行完整普通回归 |
| 作者输入或生成工具 | 类型、内容校验、真实导表、来源诊断与失败保护回归                             |
| 原生声音或发布资源 | 对应 Rust 检查、资源准备和模型烟测；设备效果与安装发布另记人工证据           |

Vitest 默认环境为 Node，UI 测试通过文件头的 `@vitest-environment jsdom` 使用 DOM 环境；Testing Library 与 jsdom 已在开发依赖中。

## 格式

```powershell
npm run format
cargo fmt --manifest-path src-tauri/Cargo.toml
npx prettier --write README.md "docs/**/*.md" content/README.md content-authoring/README.md
npx prettier --check README.md "docs/**/*.md" content/README.md content-authoring/README.md
```

现有 `format` / `format:check` 脚本覆盖代码，不覆盖 Markdown。文档使用上面的显式命令；`.prettierignore` 排除历史归档，保留原记录格式。生成的作者模型不手工格式化。

## 真实内容生成

```powershell
$env:LUBAN_ROOT = '你的干净 Luban checkout 路径'
npm run content:check-all
npm test -- --maxWorkers=1
```

固定工具版本来自 [luban.lock.json](../../content-authoring/luban.lock.json)，包注册表为 [packages.json](../../scripts/content/packages.json)，CI 定义见 [content-authoring.yml](../../.github/workflows/content-authoring.yml)。`content:check-all` 会真实重导全部注册包并比较模型、文件清单和内容；缺少工具配置时明确失败。

普通测试在未设置 `LUBAN_ROOT` 时会跳过可选真实工具集成。需要验证作者链时应设置环境并单独记录通过范围，使用一个 worker 避免竞争构建 Luban。样本编辑、生成新版本和来源诊断见作者说明。

## 桌面与声音

```powershell
npm run voice:prepare
npm run tts:prepare
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
npm run tauri:build -- --debug --no-bundle
```

声音准备命令下载已锁定资源，首次需要 Python 3 和网络；应用运行时离线使用已准备资源。Tauri 配置引用 KWS DLL/模型和 TTS 模型，缺失资源时应先按 [语音指南](voice.md) 准备。

当前 [Tauri 配置](../../src-tauri/tauri.conf.json) 关闭安装器打包。开发可执行文件位于 `src-tauri/target/debug/eagle-judge.exe`；运行需要一并保留资源和 DLL。开发构建、模型烟测与干净安装/设备效果分别记录，不能相互代替。

## 验收记录

新记录写明日期、命令、实际通过范围、跳过原因和人工验证环境。浏览器内存预览、真实 SQLite 测试、完整桌面启动和麦克风/TTS 设备测试分别说明。历史阶段证据见 [归档索引](../archive/README.md)，其中的通过数量不计入新改动验收。
