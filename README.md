# 鹰国法官：开发骨架

这个阶段提供可替换的接口、开发替身和运行环境，供规则、内容、存储、Application 与 UI 分线开发。产品需求和业务规则以 [架构设计](Desktop_Case_Game_Architecture_v1.0.md) 为依据。

## 启动与检查

使用 Node.js 24 LTS（最低 22.12）和 npm。桌面开发还需要 Rust、MSVC C++ 工具链、Windows SDK 与 WebView2。

```powershell
npm ci
npm run dev           # 浏览器开发，内存样本
npm run tauri:dev     # 桌面开发，另含真实 SQLite 插件探针
npm run check         # 类型、Vitest、依赖方向与格式
npm run build         # 前端生产构建
npm run tauri:build   # 桌面可执行文件；目前关闭安装器打包
```

两个开发启动命令择一运行，它们都使用 1420 端口。当前机器默认 Node 18 不满足要求；已使用随工作环境提供的 Node 24 验证。若尚未切换终端的 Node，可在当前 PowerShell 会话执行以下命令，不修改系统全局配置：

```powershell
$env:Path = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;" + $env:Path
node --version
```

代码由 Prettier 统一格式；修改后运行 `npm run format`。Rust 代码使用 `cargo fmt --manifest-path src-tauri/Cargo.toml`。

## 模块边界

| 目录 | 职责 | 允许的项目依赖 |
| --- | --- | --- |
| `src/game` | JSON 状态、命令与同步纯规则契约 | game、content 类型；model 复用纯内容 Schema |
| `src/content` | 内容 Schema、精确版本读取、固定样本 | content、资源读取用的 platform |
| `src/storage` | 存档契约、内存替身、SQLite 接入 | storage、game、content |
| `src/application` | 会话加载、提交锁、保存后发布 | application、game、content、storage |
| `src/ui` | 展示和用户交互 | ui、application、content 类型 |
| `src/platform` | Tauri 环境与平台能力 | platform、必要的 Tauri API |

`src/main.tsx` 是装配入口：在这里选择实现并传给会话或页面。后续装配代码增多时可以移至 `src/app`。UI 不导入 SQL、具体案件文件或规则实现；规则不依赖 React、DOM 或 Tauri。目录中只保留实际使用的模块。

## 分线接入约定

- **规则线**实现 `Transition`，只接受状态、命令、已加载内容和注入时间，返回 `TransitionResult`。不得修改输入，也不得自行保存或触发表现。
- **内容线**以 `ContentCatalogSchema` 为结构源，交付精确 `packageId + version` 的内容包。已发布版本保持不可变；后续完整引用、无环图和资源存在性校验在这条线完成。
- **存储线**实现 `SaveRepository`，保留 `saveId + profileId` 归属校验及 `expectedRevision` 条件提交。内存契约测试可以复用于 SQLite 实现；正式 SQLite 实现还须增加真实数据库测试。
- **Application 线**通过构造参数接收仓储和规则，统一协调加载、提交、恢复与状态发布。
- **UI 线**订阅会话快照、发送 `GameCommand`。内容通过会话提供，历史结果读取存档快照，业务后果由规则决定。

公共 Schema、错误码与方法签名是分线基线。修改契约时应同步更新调用方、替身和对应测试，并说明兼容性影响。

## 最小会话接口

实现位于 [gameSession.ts](src/application/gameSession.ts)，装配实例见 [demoSession.ts](src/app/demoSession.ts)。`createGameSession` 接受 `saveRepository`、`contentRepository`、`transition` 与 `clock: () => string`，不绑定某个仓储或具体规则实现。

| 接口 | 语义 |
| --- | --- |
| `load(saveId, profileId)` | 加载已存在存档及其精确内容版本；失败不创建新局 |
| `getSnapshot()` | 返回引用稳定且递归冻结的快照，可直接供 `useSyncExternalStore` 使用 |
| `subscribe(listener)` | 订阅加载、保存与已提交状态变化；返回取消订阅函数 |
| `dispatch(command)` | 同步取得锁，计算、条件保存、发布；重复点击返回 `BUSY` |
| `subscribeFeedback(listener)` | 保存成功后通知临时反馈；返回取消订阅函数 |

会话状态为 `idle / loading / ready / saving / needsReload / error`。只有 `ready` 接受命令；`saving` 仍展示旧的已提交封套。`load` 与 `dispatch` 的返回值均以 `ok` 判别，失败提供 `code / message`。UI 在 `loading / saving` 期间禁用会话切换操作。

未知写入异常与 revision 冲突进入 `needsReload`，必须显式 `load` 后才能继续；不会自动重放命令。订阅与反馈回调应为同步通知，异常与保存事实分开处理。当前没有正式新游戏入口；开发页直接为内存仓储提供一份明确的样本封套。

## 开发页验证方法

启动后应看到内容版本 `1.0.0`、两案件、revision `0` 和首案 `pending`。点击“验证开始案件”后显示 revision `1`、`active`，再次开始按钮禁用。点击“重新读取样本”仍保持 `1 / active`；刷新页面恢复 `0 / pending`。

浏览器与桌面的**样本会话都使用内存仓储**。桌面另外执行一次 SQLite 参数化写入与读回，并核对标记和时间；页面显示“SQLite 已连接”才表示这个真实插件探针成功。该探针不等于正式游戏存档已经接入 SQLite。SQL 插件注册、迁移与显式写权限采用 [Tauri 官方接入方式](https://v2.tauri.app/plugin/sql/)。

## 阶段检查记录

最终复查：2026-09-15，Windows、Node 24.19.0、Rust 1.94.0。

| 阶段 | 检查结果 |
| --- | --- |
| 契约与替身 | 人工审查通过，11 项 Schema / 内容仓储 / 存档仓储测试通过 |
| 工程与桌面 | 前端构建、Tauri debug 可执行文件构建通过；未启动 Vite 时原生窗口独立运行，SQLite 探针写入后从真实数据库读回，完整性检查为 `ok` |
| 会话与分线联调 | 人工审查通过，12 项会话测试通过；浏览器开始 / 重读 / 刷新行为符合约定 |

全套 `npm run check` 通过（23 项测试、类型、依赖方向、格式）；Rust 格式检查通过。Tauri 与 SQL 插件的 JS / Rust 依赖已对齐，npm 和 Cargo 锁文件均已生成。

已验证构建命令：`npm run tauri:build -- --debug --no-bundle`。输出为 `src-tauri/target/debug/eagle-judge.exe`。这验证开发可执行文件，不包含 release 优化构建或安装器验收。

## 范围

两案件固定样本覆盖附录 B 的属性、标记、解锁、阶段剧情及两个结局配置。视频引用用于后续播放器的失败降级联调，不代表已经交付视频资源。

规则线实现后的样本预期如下（当前开发页只执行开始案件探针）：

| case_001 结果 | case_002 结果 | 最终 restraint / authority | 结局 |
| --- | --- | --- | --- |
| close_with_note | review_required | 58 / 48 | balanced |
| warning | review_required | 56 / 51 | balanced |
| suspension | review_required | 53 / 53 | balanced |
| close_with_note | temporary_access | 48 / 48 | fallback |
| warning | temporary_access | 46 / 51 | fallback |
| suspension | temporary_access | 43 / 53 | fallback |

第一案结算应同时解锁 `case_002` 并排入 `story_after_case_001`；确认该剧情完成前不得处理第二案。`confirm_violation` 是用于中途恢复测试的中间选项，不应改变属性。

当前阶段不实现正式账号、完整案件结算与结局规则、完整内容 Validator、正式 SQLite 存档仓储、视频播放器、存档迁移或安装包验收。它们可以分别依赖这里的契约继续开发。
