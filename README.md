# 鹰国法官：开发骨架

项目提供纯 TypeScript Game Core、内容校验、Application 与 UI，以及本地 SQLite 存储实现。产品需求和业务规则以 [架构设计](Desktop_Case_Game_Architecture_v1.0.md) 为依据；Storage / Tauri 当前进展、验证结果及未包含事项见 [存储实施记录](Desktop_Case_Game_Storage_Tauri_Implementation.md)。

## 启动与检查

使用 Node.js 24 LTS（最低 22.12）和 npm。桌面开发还需要 Rust、MSVC C++ 工具链、Windows SDK 与 WebView2。

```powershell
npm ci
npm run dev           # 浏览器开发，内存样本
npm run tauri:dev     # 桌面开发，使用本地 SQLite
npm run check         # 类型、Vitest、依赖方向与格式
npm run build         # 前端生产构建
npm run tauri:build   # 桌面可执行文件；目前关闭安装器打包
```

两个开发启动命令择一运行，它们都使用 1420 端口。项目要求 Node 22.12+；当前工作区使用 Node 22 验证。若本机终端仍指向旧版 Node，请先切换到满足 `engines.node` 的版本，不修改系统全局配置：

```powershell
$env:Path = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;" + $env:Path
node --version
```

不要删除锁文件来绕过运行时版本问题。

代码由 Prettier 统一格式；修改后运行 `npm run format`。Rust 代码使用 `cargo fmt --manifest-path src-tauri/Cargo.toml`。

## 模块边界

| 目录 | 职责 | 允许的项目依赖 |
| --- | --- | --- |
| `src/game` | JSON 状态、命令与同步纯规则契约 | game、content 类型；model 复用纯内容 Schema |
| `src/content` | 内容 Schema、精确版本读取、固定样本 | content、资源读取用的 platform |
| `src/storage` | 存档契约、内存替身、SQLite 接入 | storage、game、content |
| `src/application` | 会话加载、提交锁、保存后发布 | application、game、content、storage |
| `src/input` | 双语动作词典、纯文字匹配与能力校验 | input、shared |
| `src/ui` | 展示和用户交互 | ui、application、content 类型、input、shared |
| `src/platform` | Tauri 环境与平台能力 | platform、必要的 Tauri API |

`src/main.tsx` 是装配入口：在这里选择实现并传给会话或页面。后续装配代码增多时可以移至 `src/app`。UI 不导入 SQL、具体案件文件或规则实现；规则不依赖 React、DOM 或 Tauri。目录中只保留实际使用的模块。

## 分线接入约定

- **规则线**已在 `src/game` 实现正式 `Transition`，只接受状态、命令、已加载内容和注入时间，返回 `TransitionResult`。它不修改输入，也不自行保存或触发表现。
- **内容线**以 `ContentCatalogSchema` 为结构源，交付精确 `packageId + version` 的内容包。已发布版本保持不可变；后续完整引用、无环图和资源存在性校验在这条线完成。
- **存储线**实现 `SaveRepository`，保留 `saveId + profileId` 归属校验及 `expectedRevision` 条件提交。固定 fixture 和真实 SQLite 测试不依赖 Game Core 计算；具体接口与检查结果见存储实施记录。
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

## 最初开发骨架验证记录（历史）

启动后应看到内容版本 `1.0.0`、两案件、revision `0` 和首案 `pending`。点击“验证开始案件”后显示 revision `1`、`active`，再次开始按钮禁用。点击“重新读取样本”仍保持 `1 / active`；刷新页面恢复 `0 / pending`。

浏览器预览明确使用内存替身，桌面运行时使用 SQLite；SQL 插件注册、迁移与显式写权限采用 [Tauri 官方接入方式](https://v2.tauri.app/plugin/sql/)。Storage / Tauri 当前自动化验收已完成，实际安装包与媒体仍需发布前人工验收。

## 阶段检查记录

最终复查：2026-09-15，Windows、Node 24.19.0、Rust 1.94.0。

| 阶段 | 检查结果 |
| --- | --- |
| Storage / Tauri | 真实 `node:sqlite` 执行 Rust 注册的 `001_initial.sql`；Profile、Save、Settings、v1→v2、CAS 并发、备份、资源解析与 capability 均有回归覆盖 |
| 桌面装配 | 浏览器只走内存预览；桌面初始化失败可见且不回退内存；Profile 装配失败会关闭数据库连接 |
| 全量自动化 | 34 个测试文件、287 项测试通过；typecheck、依赖边界、Prettier、生产 build 与 Rust check/fmt 通过 |

全套 `npm run check` 通过；Tauri 与 SQL 插件的 JS / Rust 依赖已对齐，npm 和 Cargo 锁文件均已生成。详细 slice、决策和后期 TODO 见 [Storage / Tauri 实施记录](Desktop_Case_Game_Storage_Tauri_Implementation.md)。

已验证构建命令：`npm run tauri:build -- --debug --no-bundle`。输出为 `src-tauri/target/debug/eagle-judge.exe`。这验证开发可执行文件，不包含 release 优化构建或安装器验收。

## 范围

两案件固定样本覆盖附录 B 的属性、标记、解锁、阶段剧情及两个结局配置。视频引用用于后续播放器的失败降级联调，不代表已经交付视频资源。

正式 Game Core 的固定样本六路径预期如下：

| case_001 结果 | case_002 结果 | 最终 restraint / authority | 结局 |
| --- | --- | --- | --- |
| close_with_note | review_required | 58 / 48 | balanced |
| warning | review_required | 56 / 51 | balanced |
| suspension | review_required | 53 / 53 | balanced |
| close_with_note | temporary_access | 48 / 48 | fallback |
| warning | temporary_access | 46 / 51 | fallback |
| suspension | temporary_access | 43 / 53 | fallback |

第一案结算应同时解锁 `case_002` 并排入 `story_after_case_001`；确认该剧情完成前不得处理第二案。`confirm_violation` 是用于中途恢复测试的中间选项，不应改变属性。

各分线已在骨架之后继续实施，最新范围以对应 `Desktop_Case_Game_*_Implementation.md` 为准。Storage / Tauri 不包含联网账号、远程内容下载或实际安装包人工验收。

## ActionInput 固定架构样本

`minimal-test-package@1.1.0` 使用 content schema v3，保留两案，并在每案后安排一次检查：
文字 A → 敬礼输入 B → 文字 C → 敬礼输入 D → 文字 E。B、D 均要求 `salute`，输入
`wave` 分别使 authority 减少 2、1；它们按 Story/Step 位置独立完成。

中文输入「敬礼／行礼」或「挥手」，英文输入 `salute` 或 `wave`。匹配使用当前选择语言；
空白、不匹配和多个不同动作均为 unknown，不写存档。采用字面包含规则，不理解否定语义。
文字入口可用；Windows x64 已接入 sherpa-onnx 中英语音试验入口，静态检查通过、真实设备效果待人工验收。摄像头留待后续接入。

Save schema v3 增加 `storyCheckpoint`：正确后从下一步恢复，错误后从当前输入恢复。
普通内容的继续不写存档；最后一步是输入时，通过与完成 Story 原子保存。
旧 v1/v2 存档在读取边界迁移，revision 和精确 contentRef 保持不变；原 `1.0.0` v2 包继续保留。

运行 `npm run validate:content` 同时检查新旧包及所有发布语言的文字完成路径。
恢复、失败与 CAS 的固定回归见 `tests/app/storyInputVerticalSlice.test.ts`；
进度、审核证据与后期 TODO 见 [Content / Validator 实施记录](Desktop_Case_Game_Content_Validator_Implementation.md)。


## 本地诊断与符号归档

运行界面右下角“诊断 / Diagnostics”在启动失败和 React 错误后仍可打开。
面板显示身份、writer/transport/heartbeat 状态和近期记录，可按级别、事件或 operation 筛选。
“详细日志 5 分钟”采用单调时钟自动恢复默认级别（debug 构建默认 debug，发布默认 info），不会打开发布包 dump。
心跳只表示观测点响应，不证明保存成功。

桌面“导出报告”写入 `%LOCALAPPDATA%/com.eaglejudge.app/reports/report-*.json`，尽力保留最近 8 份（权限失败或并发可能超额）。
报告最多 4 MiB，含当前和最近已退出运行（最多 4 个 run）的日志尾部、health/watchdog 摘要、缺失/截断/丢弃计数；
不读游戏数据库，不默认附带原始输入、完整存档或 dump，不自动上传。
异常文字做尽力脱敏，分享前应检查。浏览器预览下载内存窗口 JSON，无法包含上一次浏览器运行。
诊断 IPC 超时后对应通道本轮停止重试；导出超时可能仍在后台完成，不代表文件必定未写入。

```powershell
npm run tauri -- build --debug --no-bundle
npm run diagnostics:archive -- debug
# 正式构建后使用 release
npm run diagnostics:archive -- release
```

归档脚本先以 `--diagnostics-build-info` 读取实际 exe 的构建身份（不启动 UI），要求嵌入的 frontendBuildId
与 dist/build-info.json 和支持文件一致，再读取 PE CodeView 与 PDB info-stream GUID/age 校验符号。
Vite source map 只写入 `artifacts/build-support/<frontendBuildId>`，不会留在 dist 或被 Tauri 内嵌。
exe、PDB、manifest、maps 及 SHA-256 清单归档到 `artifacts/diagnostic-archives`（均 gitignored）。
重新单独运行 npm build 会使旧 exe 与 dist 不匹配，此时归档拒绝，须重新构建 native。
详细接入约束与后续 Error Report 扩展见 [实施文档](Desktop_Log_Error_Report_Integration.md)。

## 语音试验：sherpa-onnx KWS

首次在开发机运行 `npm run voice:prepare` 准备固定版本运行库、模型与同源关键词（需要 Python 3 / venv）。
随后运行 `npm run tauri:dev`，或 `npm run tauri:build -- --debug --no-bundle` 生成桌面开发包。
运行时离线推理，不需要 Python；不要只复制 exe，旁边的 DLL、voice/ 和 content/ 也需要保留。

在 1.1.0 内容包的 actionInput 页面切到“语音输入”→“开始录音”→说词→“结束录音并识别”。
中文支持“敬礼/行礼/挥手”，英文支持 `salute/wave`；最长 8 秒，整轮有多个不同动作则 unknown，
权限/设备/模型故障不处罚，文字始终可用。浏览器预览不提供原生语音。

真实模型静音烟测：`src-tauri/target/debug/eagle-judge.exe --voice-model-smoke`，不使用麦克风或 UI，不能当作准确率验收。
人工测试清单、参数、资源来源、分发许可待确认项与扩词流程见 [语音实施与验收文档](Desktop_Voice_Sherpa_Implementation.md)。

独立 CMD 工具：`npm run voice:cli:build`，随后使用 `artifacts\voice-cli\voice-test.cmd --help`。
支持 WAV 离线识别、参数对照与 JSONL 结果，不启动游戏。详见 [工具说明](tools/voice-cli/README.md)。
需要保存自己的声音时，双击构建目录中的 `voice-record.cmd`，按提示开始/结束录音；WAV 和识别报告保存在同目录 `recordings` 下。

ASR 对照工具：`npm run asr:prepare` → `npm run asr:cli:build`，双击 `artifacts\asr-cli\asr-record.cmd`。
使用 SenseVoiceSmall INT8 输出实际转写，再精确匹配动作；保存 WAV/JSONL，也可重放 KWS 的旧录音。
详见 [ASR 工具说明](tools/voice-cli/ASR_README.md)，此实验尚未接入游戏。
