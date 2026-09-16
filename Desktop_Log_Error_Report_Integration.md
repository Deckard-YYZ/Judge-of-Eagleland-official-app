# Log / Error Report 接入与实施记录

更新日期：2026-09-16。状态：L1 / L2 / L3 / L4 全部实现并经主代理审核通过。

## 目标与边界

本机开发与发布包共用结构化事件协议，串联输入、GameSession、内容、SQLite 与原生宿主。
已知错误保留原因与上下文；未知故障通过操作阶段、心跳和原生诊断缩小范围。
不保证进程卡死、强杀或断电时最后一条日志必然落盘；没有正常退出标记只代表异常终止，不能直接称为崩溃。
日志不改变 Game Core → GameSession → CAS Save → publish 的游戏语义，不触发命令重放或自动处罚。

## Slice 与审核门槛

| Slice | 交付 | 状态 | 主审门槛 |
| --- | --- | --- | --- |
| L1 | 事件契约、构建身份、前后端日志、限额轮转与故障隔离 | 已审核 | 日志失败不影响业务；身份一致；有界队列；异常序列化有界且安全 |
| L2 | 启动、内容、输入、Session、存档与全局异常接入 | 已审核 | operation 可关联；保存结果未知不误报失败；错误原因可追溯；Core 保持纯函数 |
| L3 | 心跳、原生异常、开发态独立挂起监测与 dump | 已审核 | 区分前端与宿主；避免休眠/后台误报；监视器不依赖被监视进程执行 |
| L4 | 查看/导出、临时详细模式、发布策略与故障验收 | 已审核 | 导出内容有界；默认排除输入原文/完整存档；发布配置与实测限制明确 |

用户授权 efficient worker 逐片实现，主代理审核、验证与维护本文件。当前代理工具不支持指定 custom agent 配置；efficient_worker 表示任务职责。

## 接入约束与示例

- 日志接口同步返回、不抛错，异步持久化不得阻塞 dispatch、CAS 或状态发布。
- Core 不导入 Logger；Application 在纯规则调用边界记录摘要与结果。
- 统一 runId、buildId、operationId、source、event、level、时间及进程内序号；耗时使用单调时钟。
- 前后端以关联 ID 与阶段因果关系串联，不能仅按墙钟推断严格顺序。
- 普通业务拒绝、unknown 与 known wrong 不等于系统错误。
- 写盘、日志 IPC、导出本身失败不得递归记录；必须提供降级状态、丢弃数量与有界缓冲。
- 默认不记玩家输入原文、显示名称、SQL 参数、完整存档或媒体；字段按白名单投影。
- 异常 message/stack/cause 做大小限制与敏感信息处理，不任意遍历不受信对象。
- 文件位于应用数据/日志目录，不依赖安装目录写权限，也不占用游戏数据库。
- 前端日志尚未送达宿主时可能丢失，不能把缺少日志当成动作未发生的证明。

### L1 基础接口与存储策略

业务依赖 `src/shared/diagnostics.ts`，只传明确摘要：

```ts
const diagnostics = getDiagnostics();
const operationId = diagnostics.operationId();
diagnostics.record({
  source: "application", event: "command.started", operationId,
  data: { commandType: "submitStoryInput", storyId, stepId, revision },
});
```

`record` 同步返回且隔离 sink 异常；Core 不调用它。跨 await 的 operationId 应显式保存在当前操作中，
不得使用全局 currentOperation。新增 data 字段需同时检查 TS 与 Rust 白名单，并补充隐私/故障测试。
异常对象通过 error 字段传入，保留有界 name/message/stack/code/cause；对 getter、循环、用户目录与常见凭据做防护。

前端传输队列最多 256 条，单批最多 32 条；握手最长等待 1.5 秒，传输 2 秒超时后停止本次运行的继续发送。
该策略避免累积无法取消的 IPC；status 暴露 unavailable、failures、dropped，不暗示游戏存档失败。
Rust 使用独立 writer + sync_channel(256)，每条最大 32 KiB，recent 内存窗口最多 128 条。
显式导出/退出可 bounded flush（最多 500ms）；业务操作不等待 flush。

Windows 日志根目录为 `%LOCALAPPDATA%/com.eaglejudge.app/logs`，每 run 独立子目录，writer.lock 使用独占共享模式。
单文件约 2 MiB，最多当前文件加 3 个轮转文件；启动时尝试保留最近 8 个 run，活跃旧 run 不删除。
因此多个活跃 run 可以超过约 64 MiB；非 Windows 当前不自动清理历史 run。这是明确限制，不是全局硬配额。

选型：已核对 Tauri 官方日志插件的文件输出/轮转功能，本实现需要有界非阻塞队列、写失败状态和多进程隔离，
因此使用小型 Rust std writer；不另建日志框架。Vite 生成前端 build UUID；release 宿主读取构建 manifest，
debug 宿主采用独立 native 编译标识并记录 frontendBuildId，避免开发态把旧 dist 身份当成当前代码。
构建生成 hidden source map、保留 release 原生符号；实际归档流程见 L4。

### L2 操作上下文与事件语义

`DiagnosticContext` 包含 operationId 和可选 sessionId。UI 的已识别提交把 context 作为第二参数传给
`sessionView.dispatch(command, context)`；Session 给自身分配临时 sessionId，随后显式传入 Repository。
这些字段不进入 GameCommand、SaveCommitInput 的持久化数据或 GameState，不改变 Core 接口。

成功主链为 `input.recognized → command.started → command.validated → transition.succeeded →
save.commit.started → save.commit.succeeded → session.published → command.finished`。
SQLite 另记 CAS started/returned 与内存迁移版本；session.published 只记录有界 feedback 类型及 actualDelta。
unknown 只有本地输入事件，不调用 Session；focus/composition/change 仅 debug，change 以 500ms 限流。

| 事件/结果 | 含义 | 操作 |
| --- | --- | --- |
| save.commit.failed + not_committed | 仓储明确未提交 | 遵循已有 UI 错误处理 |
| save.commit.uncertain | 写异常或回复版本非法，无法确认写结果 | needsReload，禁止自动重试 |
| session.publication_failed | 已收到有效提交结果，但封套发布校验失败 | needsReload，不宣称回滚 |
| command.finished / needs_reload | 冲突、已有恢复要求或提交后发布失败 | 显式重载 |
| subscriber.failed / feedback.subscriber_failed | 表现层监听者异常 | 保留已提交游戏事实 |

内容校验日志记录版本与最多 16 个 code/path/source；先校验参数再提取日志摘要，保持 INVALID_REF 契约。
本地化异步请求记录发起时的 locale，避免切换语言后误归因。
全局 error/unhandledrejection 仅观察不 preventDefault；React ErrorBoundary 提供明确重载入口，
并为 L4 预留 onDiagnostics。原始异常始终传入 error 后统一处理。
现有视频仍是 placeholder，日志只记录 `video.placeholder_retry / player_not_implemented`，不宣称捕获真实解码错误。

### L3 存活观测与开发态转储

前端每 2 秒报告可见性，最多一个 pending IPC；5 秒无响应后停止本轮心跳发送，健康状态显式 degraded。
Rust 后台每秒运行；主线程 callback 最多一个 pending。默认 20 秒 overdue，启动/大间隔/检测到调试器时
采用 45 秒宽限。状态只在变化时记录，分为 responsive、background、frontend_unknown、frontend_overdue、
main_overdue、grace。responsive 仅表示这些观测点响应，不保证当前业务操作已完成。

Windows WebView2 使用原生 ProcessFailed 事件，并记录运行时版本；回调无法覆盖已经挂住的整个宿主。
Rust panic 记录有界 payload/location/backtrace。正常退出在 Tauri `RunEvent::Exit` 内写 clean marker，
不把代码放在永不正常返回的 App::run 后面。clean 写入和日志刷新均有等待上限；标记缺失只称 unclean。

Windows debug 可执行文件启动独立 watchdog，再以独立 dumper 调用 MiniDumpWriteDump；两个子进程均隐藏运行。
检查目标 PID + 创建时间，防 PID 复用；不会终止/重启游戏，不会重放命令。陈旧健康文件称为
observer_or_storage_overdue，明确可能是观察器或存储问题，并不是确定死锁。
陈旧判定使用 watchdog 自身的单调时钟累计 health 内容/generation 未变化的时间，墙钟只用于展示，
避免系统时钟回拨长期掩盖停更。
默认持续异常确认 10 秒后收集证据，每 run 最多两次、每个 dump 最多约 64 MiB、日志根目录下 dump 预算 256 MiB；
全局独占预算锁避免多实例同时突破配额，dumper 最长运行 15 秒，过大或失败的部分文件移除。
转储只包含宿主 minidump，不代表包含 WebView2 renderer 内存；默认报告不得附带 dump。
发布构建不编译这些 debug helper 路由。

复验命令（构建后，从仓库根目录）：

```powershell
cargo build --manifest-path src-tauri/Cargo.toml
& './src-tauri/target/debug/eagle-judge.exe' --diagnostics-self-test
```

self-test 用专门子进程模拟前端过期与宿主健康文件停止更新，并验证真实跨进程转储的 MDMP 头和监视记录。
不打开应用 UI、不读取/写入 Profile 或 SQLite；这不是实际 WebView 死锁复现，也不证明之前的自动输入挂起根因已修复。
fixture 证据写入系统 Temp 的 eagle-diagnostic-fixture-*，不进入默认用户日志目录。

### L4 查看、报告与构建支持

装配层 `DiagnosticsShell` 注入 `DiagnosticViewerService`；UI 不导入 native IPC 或文件 API。
正常页面与 React / 启动失败界面均保留诊断入口。面板按事件、operation 和级别筛选有界近期窗口，
显示前端传输、宿主 writer 和心跳观测状态；前后端可能各持有同一事件，不据此累计业务操作次数。

默认导出到应用数据目录的 `reports`，报告为 JSON，不自动上传。尝试保留最近 8 份，权限或并发可能使清理不完全，
并非整个报告目录的严格总配额。只读固定名称的诊断文件，
不打开 SQLite、不读取存档、不附带 dump；收集当前与近期已退出的运行，最多 4 个 run。
单文件最多读尾部 256 KiB / 保留 256 条记录，总报告最多 4 MiB；截断、坏行、缺失文件和 flush 状态写入报告。
超总限额时继续裁减日志窗口，并保留标记文件的最后一条摘要。文件读取和导出放在后台任务，拒绝路径链接；没有任意路径读取 IPC。
浏览器预览只能导出本次内存窗口，报告必须明确无法提供此前运行的文件证据。

开发态默认 debug；发布态默认 info，可临时启用 5 分钟详细日志。有效期由单调时钟控制，
到期自动恢复默认级别，不启用发布态 dump。诊断 IPC 超时意味着完成情况未知；停止该通道继续请求，
避免无法取消的原生调用在后台累积。snapshot / 级别更新等待 1.5 秒，导出等待 10 秒；导出超时后后台仍可能写完，
不能宣称文件必定未生成。每个诊断命令最多一个 pending 调用。

Vite 的 hidden source map 在构建阶段移至 `artifacts/build-support/<frontendBuildId>`，不进入 dist / 安装包。
构建支持归档保留匹配的前端 manifest / maps、原生 exe / PDB 和哈希清单，输出到忽略版本控制的 artifacts。
归档脚本先读取 exe 内嵌构建身份并核对前端版本，再读取 PE DebugDirectory 与 PDB info stream 的 GUID / age；
旧 exe 配新 dist 或错误 PDB 必须失败，不能生成看似正确的归档。写入归档的字节与哈希使用同一份读取结果。
开发归档不受运行日志轮转配额管理，需要随发布流水线另定保留期限。

使用入口与构建命令：

```powershell
# 日常开发：右下角“诊断 / Diagnostics”查看状态、启用详细日志或导出
npm run tauri:dev
# 构建 release 可执行文件并归档；此命令不产出安装器
npm run tauri:build -- --no-bundle
npm run diagnostics:archive -- release
# 开发包使用 --debug，归档参数对应 debug
npm run tauri:build -- --debug --no-bundle
npm run diagnostics:archive -- debug
```

单独 `npm run build` 会生成新的 frontendBuildId，此后须重建 native 才能归档。
运行日志：`%LOCALAPPDATA%/com.eaglejudge.app/logs/<runId>`；报告：同级 `reports/report-*.json`。
UI 已无法响应时不能依赖页面导出，可先保留日志目录中的证据；开发包的 watchdog 在独立进程中运行。
host minidump 需使用对应归档中的 PDB 分析，前端堆栈需使用同 frontendBuildId 的 maps。

## 故障诊断策略

前端异常捕获覆盖脚本与渲染错误；Rust panic 与 WebView2 进程事件覆盖部分原生故障。
心跳只能证明某个观测点存活，不等于整个应用健康。后台、休眠恢复、调试暂停应作为判定上下文。
开发态独立监视器用于宿主挂起时保留证据；转储用于分析线程栈，不纳入默认用户报告。
不自动重启、不改变已有 needsReload 行为，不根据超时自动重发命令。

## 事件接入与严重级别

以下为 L2 接入清单，具体名称以最终 API 与测试为准。每个异步操作至少有 started 和一个结果事件；
结果未知使用 uncertain，不用 failed 暗示数据未提交。长期无结果由监测判为 pending/overdue，而不篡改业务结果。

| 边界 | 必需信息 | 级别约定 |
| --- | --- | --- |
| 启动 | runtime、buildId、阶段、耗时、原始异常 cause | 正常 info；初始化失败 error |
| 内容加载/校验 | package/version、资源标识、校验 code/path、耗时 | 错误 error；语种回退 warn |
| 输入 | story/step、locale、known/unknown、ActionId、文本长度 | 识别结果 info；输入原文禁止 |
| Session | operationId、command kind、revision、checkpoint、状态发布 | 拒绝 info；契约错误 error |
| 存档 | operationId、expected/actual revision、CAS outcome、迁移版本 | 冲突 warn；确定错误 error；uncertain error |
| 临时反馈/订阅 | 对应 operationId、异常 stack/cause | error，但不撤销成功提交 |
| 心跳 | 可见性、探测年龄、暂停/恢复、进程身份 | 状态变化 info；超时 warn，不逐次刷屏 |

## 故障注入验收矩阵

| 场景 | 必须保持的行为 | 需要的诊断证据 |
| --- | --- | --- |
| 日志 sink 抛异常、IPC 拒绝或永不返回 | 游戏操作可完成，无无界队列/重试 | 降级、丢弃计数可见 |
| 内容不存在或 Schema 不匹配 | 不使用其他版本冒充成功 | 精确版本、阶段、问题 code/path |
| 存档明确拒绝 | 原 revision 与已发布事实不变 | 同 operation 的确定失败 |
| 写入成功后回执丢失 | needsReload，不能自动重试 | uncertain 与原始 cause，不能出现错误的成功发布 |
| CAS 冲突 | 显式 reload | expected revision 与 conflict |
| unknown | 不写盘、不增加 revision | 识别结果，不记录文本 |
| 订阅者抛错 | 已保存事实不变 | 订阅错误与对应操作 |
| 前端挂起 / 宿主挂起 | 外部监测还能运行，不自动重启 | 各观测点与独立监视记录 |
| 正常退出 / 强杀 / 休眠间隔 | 不把强杀或睡眠统一称作崩溃 | clean / unclean / gap 的不同语义 |
| 日志目录不可写 / 配额耗尽 | 游戏仍可运行 | writer 状态、有限回退行为 |
| 导出 | 不包含完整存档/用户原文、不无限读取 | 包内清单、丢失/截断信息 |

## 明确不做

云端上传、第三方错误平台账号配置、玩家行为分析、全量键盘/鼠标录制、完整存档默认采集、
把日志当作权威事件库、发布包默认自动收集全内存 dump，以及无法验证的“捕获所有问题”承诺。

## 后续模块如何接入 Log / Error Report

1. 在拥有操作生命周期的边界生成 operationId；调用下游时显式传递 context。同一次重试生成新 ID，不能把两次提交混为一次。
2. 使用稳定 event 名称与可判别 code；界面文案和翻译不能当聚合错误的唯一键。保留原 error/cause，不另抛只有字符串的新错误覆盖原因。
3. 只发送调用方明确构造的摘要；新字段先加入白名单，再用测试证明实际持久化后仍存在，不能只测试 record mock。
4. 为 started 配对结果事件；确定失败、结果未知、已提交但发布失败分开。超时本身不证明事务回滚。
5. 业务层只依赖 shared 契约；平台传输/文件/压缩/上传放在外围适配器。新增日志后必须继续通过依赖边界检查。
6. 覆盖成功、失败、日志系统失败三个方向；对游戏提交还要覆盖日志异常时 revision/publish 不变更其原有语义。
7. 对可能回显原始数据的解析异常（例如 JSON.parse 的 SyntaxError），在解析边界生成安全诊断原因，
   不直接沿 cause 上传原始 message/stack 首行。异常属性只读数据描述符，不执行自定义 getter。

未来接远程 Error Report 的建议接口边界为“读取已脱敏本地报告 → 用户主动提交 → 传输适配器”，
不要在 Core/Repository 的 catch 内直接 HTTP 上传。报告清单应带协议版本、buildId/runId、截断/丢弃/缺失信息，
服务端按 buildId + event/code + 规范化堆栈聚合，并允许本地 reportId 关联后续反馈。
原始输入、存档与 dump 均不得因增加上传后端而自动加入默认报告；传输失败也不能改变游戏状态。

### 遇到故障时如何判断

- 先确认 runId / buildId / frontendBuildId，再按 operationId 和 sessionId 找同一次操作。
- 找到最后一个已完成阶段；只有 started 而缺结果时，结合传输健康状态判断是否可能是日志丢失。
- save.commit.uncertain 或 needsReload 必须读档核对，不能凭最后一条日志手工重放提交。
- 宿主无响应时优先看独立监视器证据与线程转储；前端日志停止不能单独证明前端死循环。
- 诊断归档必须使用匹配构建的 source map / PDB；用当前源码解释旧包行号可能误判。

## 后续 TODO

- 后续接云端 Error Report 时复用事件协议与脱敏投影，另定用户主动提交、保留期限与服务端分组规则。
- 将已实现的归档命令接入正式发布 CI，补充内容包哈希清单、产物访问权限与开发归档保留期限。
- 安装器、真实桌面 UI 与实际 WebView 挂起的端到端人工验收；本轮完成的是无 GUI 测试和 debug/release 可执行文件构建。
- 自动识别长期 pending 业务操作、面板去重与一键定位最后阶段可后续增强；当前通过 operationId 和阶段事件人工关联，
  不把心跳 responsive 当成命令成功，也不把日志缺失当成未执行。
- 真实用户机器上的 WebView2/系统版本差异、杀毒软件干预与长期磁盘限额验收。
- ActionInput 原生验收中曾发生一次自动输入时宿主无响应；重启后同路径未复现，根因未确认。本轮系统不能追溯生成此前不存在的线程栈。

## 验证记录

- 开始时 git 工作区仅有用户未跟踪的 ActionInput 架构文档；上一轮实现已成为当前基线，本轮不覆盖该文档。
- 当前源码无统一日志后端；GameSession 已有错误码和明确 CAS/publish 边界可接入。
- 未发现仓库 AGENTS.md 或 Mistakes.md。
- 主代理复跑当前基线：44 个测试文件 / 368 tests 全通过。
- 原生电脑操作上轮被用户 Escape 停止；本轮不继续该轮 UI 自动化。优先采用代码、测试与独立诊断 fixture 验证。
- L1 主审：TypeScript 与 4 项传输/异常/脱敏专项复验通过；检查了有界队列与多实例轮转隔离。
  发现原生启动失败曾被日志包装后正常返回，已交回 worker 修复，日志不得把失败改成 exit 0。
- L1 修复审核通过：启动失败记录与 bounded flush 后保留原有 expect；主审独立跑 Rust 3 项诊断测试通过。
  worker 的构建、cargo check、格式、边界检查通过；允许进入 L2。
- L2 主审通过：主代理复跑 Session、输入 UI、全局/React 异常与 bundled content 共 4 文件 / 43 tests 通过；
  worker 全量 46 文件 / 379 tests、类型、Rust check、边界与格式通过。
  审核修正了反馈异常误记读档失败、未知写入误标拒绝、非法 ref 日志读取改变原契约、旧语种请求误归因等问题。
- L3 主代理复验：heartbeat 2 tests 通过；独立 exe self-test 通过，证据目录
  `C:\Users\admin\AppData\Local\Temp\eagle-diagnostic-fixture-1789553304606`。
  worker 的另一次独立 fixture 同样通过，两种模式分别生成有效约 34 KiB minidump；Rust 8 tests、cargo check 通过。
  发布条件检查与最终审核继续进行。
- L3 最终审核通过：debug / release cargo check、Rust fmt、8 项 Rust 测试通过；修正单调时钟判定后
  worker 再跑独立 fixture 通过，最新产物 `C:\Users\admin\AppData\Local\Temp\eagle-diagnostic-fixture-1789553391995`。
  release 条件排除自动转储 helper，允许进入 L4。
- L3 后主代理复跑完整 `npm run check`：47 文件 / 381 tests、类型、依赖边界、格式全部通过；
  Rust 8 tests 再次通过。这是 L4 开始前基线，不代替最终验收。
- L4 期间交叉审核复现：坏存档 JSON 的原始 SyntaxError 可回显输入片段，Error 自定义 getter 可被序列化触发。
  已分派解析边界与安全属性读取修复，要求对应回归测试后再验收。
- 追加修复主审：SQLite / Settings / Backup 使用安全 JSON 解析边界，原业务错误码不变；
  transition Schema 失败新增 error 级 `transition.invalid`，仅记录最多 16 项 code/path。
  主代理独立复跑 3 文件 / 48 tests 通过，覆盖坏 JSON 无原文回显、无意外写入与快照不变。
- L4 冻结后主代理完整复验：50 文件 / 389 tests、类型、边界、Prettier 全通过；新旧内容包校验通过，git diff 检查通过。
  debug 归档 `artifacts/diagnostic-archives/native-dev-1789554248833-1789554280070` 的 6 份文件逐一 SHA-256 核对通过，
  dist 无 `.map`。release 构建和最终原生复验尚在进行。
- L4 最终审核通过：debug / release Tauri `--no-bundle` 均构建成功，旧 exe / 新 dist 的负例归档拒绝；
  PE / PDB GUID-age 正例、错 age、其他位置伪匹配 GUID 与越界测试通过。
  release 归档 `artifacts/diagnostic-archives/cb3e0187-f03e-4718-81d7-91e66cb71bd1-1789554372300`，
  主代理独立核对全部 6 份产物 SHA-256 通过，内嵌 development=false 且前后端 buildId 相同。
- 主代理最终 Rust 12 tests / fmt 通过，包含历史日志、坏行、真实 junction 拒绝、满 4 run 的全局截断及 health 标记保留。
  最新 debug exe 独立监视 fixture 再次通过：`C:\Users\admin\AppData\Local\Temp\eagle-diagnostic-fixture-1789554343613`。
  没有操作真实用户存档，没有继续此前中止的 UI 自动化，没有创建 git commit。
