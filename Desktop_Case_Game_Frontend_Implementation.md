# 桌面案件模拟游戏：纯前端实施记录

**基线文档：** `Desktop_Case_Game_Architecture_v1.0.md`  
**实施范围：** 纯前端 UI 与内存演示会话；当前已接入正式 Game Core，仍不等待 SQLite 或 Tauri 存档。  
**当前状态：** 已完成  
**最后更新：** 2026-09-15

## 1. 目标与完成标准

完成以下可运行链路：

`ProfilePage → AppShell → Sidebar → CaseReader → DecisionPanel → ResolutionPanel → AnnotationPopover → FeedbackLayer → StoryPlayer → EndingView`

验收时应能依靠固定演示内容和内存 Profile/存储完成：本地演示登录/注册、开始案件、中间选择、最终结算、属性反馈、新案件解锁、已处理案件回看、阻塞剧情、视频失败替代文本、结局演出和结束后只读回看。游戏状态转换使用正式 Game Core。

UI 只通过 Application 层的 UI-facing contract 读取已确认状态和发送操作；不导入 SQL、Tauri API、存储仓库、具体内容路径或案件 fixture。

## 2. 架构边界

- `GameState` 是唯一权威游戏状态；未处理、已处理列表从 `state.cases` 派生。
- `selectedCaseId` 是会话/UI 状态，不进入 `GameState`。
- `chooseOption` 始终发送 `caseId + nodeId + choiceId`，用于拒绝旧选项组回调。
- 只有保存成功后的状态可以发布给 UI；反馈在发布之后产生且允许丢弃。
- `resolved` 案件读取保存的 `ResolutionSnapshot`，不重新计算后果。
- `pendingStoryIds[0]` 是唯一当前重要剧情；存在时阻塞案件操作。
- saving 期间禁用选项、切换文档和 Profile 操作。
- 保留 `needsReload` 的独立错误恢复语义，不压缩成普通 `error`。
- 组件负责展示、可访问性交互和临时表现，不在组件回调中实现规则。

## 3. Slice 台账

| Slice | 内容                                                                                   | 依赖      | 状态   | 验证重点                                                                  |
| ----- | -------------------------------------------------------------------------------------- | --------- | ------ | ------------------------------------------------------------------------- |
| S0    | UI-facing contract、selected case、selectors、演示 transition 接线、mock Profile、测试 | 无        | 已完成 | UI 边界；start/choose/resolve/unlock/story/ending 闭环；现已转接正式 Core |
| S1    | 视觉基础、ProfilePage、App 顶层会话切换                                                | S0        | 已完成 | 登录/注册演示；无云账户误导；错误与加载状态                               |
| S2    | AppShell、Sidebar、属性及三段独立折叠列表                                              | S0        | 已完成 | pending+active / resolved 派生排序；选择态不复制案件                      |
| S3    | CaseReader、TextBlocks、DecisionPanel、ResolutionPanel                                 | S0        | 已完成 | pending 开始；active 节点替换；resolved 快照只读                          |
| S4    | AnnotationPopover                                                                      | S3        | 已完成 | hover/focus/info；Escape/outside；锚点失效清理                            |
| S5    | FeedbackLayer                                                                          | S0、S2/S3 | 已完成 | 仅消费保存成功后的 actualDelta；卸载清理                                  |
| S6    | StoryPlayer、EndingView                                                                | S0        | 已完成 | 队首剧情；fallback/skip；ending→ended；减少动态                           |
| S7    | 集成、错误态、可访问性与视觉 QA、文档收口                                              | S1–S6     | 已完成 | 完整路径；busy/needsReload/error；长文与窗口缩放                          |

状态只使用：`待开始`、`进行中`、`已完成`、`阻塞`。

## 4. 重要决策

### D-001：在现有 GameSession 外增加薄 UI adapter

保留现有 `GameSession` 的持久化协调职责，在其外提供 React/UI 需要的订阅快照、`selectedCaseId`、`selectCase`、`dispatch` 与反馈入口。这样 UI 不需要知道 SaveRepository 或 demo composition root。

### D-002：正式规则位于 Game Core

演示 composition 通过兼容名 `demoTransition` 直接转发到正式 `game/transition`；不再维护第二套 mock 规则。UI 不根据 choice target、属性 delta 或 ending 条件自行算结果，UI-facing contract 保持不变。

### D-003：保留六态会话状态

UI 处理 `idle / loading / ready / saving / needsReload / error`。用户草案中的四态只是示意，不能丢失加载前状态和不确定写入后的显式 reload 状态。

### D-004：Profile 仅为本地演示入口

本 slice 的登录/注册只创建或选择内存中的演示 Profile，不声称存在密码认证、跨设备身份或云存档。

### D-005：视频资源缺失走设计内 fallback

当前样本视频文件不存在。StoryPlayer 必须能展示替代文本并继续流程，不把真实媒体播放作为本轮完成条件。

### D-006：Domain selector 通过 Application 只读 facade 提供给 UI

案件列表排序与筛选仍由 `game/selectors` 定义；Application 层只重导出稳定的读取面，UI 不直接增加对 `game/` 的运行时依赖，也不放宽现有模块边界检查。

### D-007：桌面使用单视口工作区，窄屏恢复自然页面流

桌面宽度下 AppShell 固定在一个 viewport 内，侧边栏和 CaseReader 正文分别管理内部滚动，避免顶栏被正文或上一个页面的滚动位置带出视口。`48rem` 以下切换为自然页面流；不设置会与经典滚动条冲突的全局最小宽度。

### D-008：Theme Lab 收敛为两种原创的制度权威语法

Theme Lab 只保留“01 绝对刻度 / Exactitude”与“02 纪碑留白 / Monument”，入口仍限定为 `?themeLab=1`，不进入正式 App tree。绝对刻度以水平审计线、编号、阈值和受记录状态表达数字化管束，并明确禁用竖向刻度与纵向分隔；纪碑留白以中轴、结构留白和仪式化边界表达中央权力。两套均维持白灰/黑灰双主题，不使用现实政权标志、仇恨符号或外部项目的复制语汇。

### D-009：Theme Lab 的文档层级以正文为先

案件标题、决策标题与段落内标题必须服务长文阅读，不能充当海报式主视觉。纪碑方案的权威由空间和轴线承担，绝对刻度的权威由规则和状态承担；两者都禁止以放大正文标题替代结构设计。

### D-010：正式 UI 定案为“绝对刻度”

正式入口采用“绝对刻度”的设计语法：黑、白、灰双主题，水平审计线、编号、阈值与明确状态构成秩序感；不使用装饰性竖线、纵向分隔、暖色纸张、金属色、圆角卡片或投影制造层次。案件正文标题保持克制，权威感来自规则密度和界面纪律，而不是标题尺寸。

主题选择由 UI 根节点的 `data-theme` 统一控制，并只持久化到浏览器 `localStorage`；它不进入 `GameState`、存档或 Application 命令。Profile、正式工作区与 portalled overlay 共用同一套 token 边界。

### D-011：Theme Lab 作为历史比较入口保留

`?themeLab=1` 继续保留两套候选，作为设计决策依据和回归参照；正式根入口不读取候选数据，也不提供运行时方案切换。后续正式 UI 的修改直接演进“绝对刻度”，不再维持“纪碑留白”的生产分支。

## 5. 明确不做

- SQLite、正式 SaveRepository、数据库迁移或真实 Profile 持久化。
- Tauri API、能力配置、打包媒体验证或操作系统级全屏。
- 正式内容生产、完整 Content Validator、运行时内容下载。
- 联网账户、密码、Token、云存档或多设备同步。
- 撤销、回退、重判、命令排队或事件溯源。
- 独立移动端产品形态、通用路由框架、通用浮层/动画/脚本引擎；仅保证窄窗口可用与无横向溢出。
- 为每个案件创建专属 React 页面。
- 将原候选“公理网格 / 档案铅印 / 静默仪表”的数据、UI 分支、专属 CSS 或旧编号保留为隐藏回退；本轮已彻底移除。
- 在 Theme Lab 使用现实政权标志、仇恨符号，或直接复刻参考项目的视觉语言。
- 将 Theme Lab 的“纪碑留白”或其他已淘汰候选接入正式运行时。
- 将主题偏好写入 `GameState`、Profile 存档或游戏命令。

## 6. 风险与处理

- **边界泄漏：** 运行 `check:boundaries`，并审查 `src/ui` 不得直接导入 fixture、storage、platform。
- **陈旧点击：** DecisionPanel 的 handler 捕获并提交当前 `nodeId`；正式 Game Core 测试 `STALE_CHOICE`。
- **重复提交：** 依赖 Application 层首个 `await` 前的锁，并在 saving 时禁用交互。
- **已结算案件被重算：** 结果面板只读 snapshot；测试回看不触发 dispatch/feedback。
- **旧锚点与定时器泄漏：** 选项替换、Popover/Feedback/Story 卸载时显式清理。
- **测试环境：** 当前 Vitest 为 Node 环境；优先测试 selectors、adapter 和 transition。若增加 DOM 测试，再以最小依赖引入 jsdom/Testing Library。

## 7. 验证记录

| 日期       | Slice          | 命令/检查                           | 结果                                                                                                                                             |
| ---------- | -------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-15 | 基线           | 工作树检查                          | 干净                                                                                                                                             |
| 2026-09-15 | 基线           | `npm run check`                     | 未安装 `node_modules`，`tsc` 无法启动；不是代码测试失败                                                                                          |
| 2026-09-15 | S0             | `npm run check`                     | 通过：7 个测试文件、31 项测试；typecheck、boundary、Prettier 全部通过                                                                            |
| 2026-09-15 | S0             | `npm run build`                     | 通过                                                                                                                                             |
| 2026-09-15 | S1             | `npm run check`                     | 通过：7 个测试文件、32 项测试；typecheck、boundary、Prettier 全部通过                                                                            |
| 2026-09-15 | S1             | `npm run build`                     | 通过                                                                                                                                             |
| 2026-09-15 | S2–S3          | `npm run check`                     | 通过：7 个测试文件、32 项测试；typecheck、boundary、Prettier 全部通过                                                                            |
| 2026-09-15 | S2–S3          | `npm run build`                     | 通过                                                                                                                                             |
| 2026-09-15 | S7             | `npm run check`                     | 通过：最终工作树 11 个测试文件、69 项测试；typecheck、boundary、Prettier 全部通过                                                                |
| 2026-09-15 | S7             | `npm run build`                     | 通过；Vite 生产包生成成功                                                                                                                        |
| 2026-09-15 | S7             | `git diff --check`                  | 通过                                                                                                                                             |
| 2026-09-15 | S7             | 浏览器完整演示流程                  | 通过：Profile、两案、标注、反馈、剧情、视频 fallback、结局、历史回看、退出重进                                                                   |
| 2026-09-15 | S7             | 视口检查                            | 通过：默认桌面单视口；768px 堆叠布局；320px 无横向滚动                                                                                           |
| 2026-09-15 | S7             | 浏览器 console                      | 无 warning/error                                                                                                                                 |
| 2026-09-15 | Theme Lab      | `npm run check`                     | 通过：15 个测试文件、125 项测试；typecheck、boundary、Prettier 全部通过                                                                          |
| 2026-09-15 | Theme Lab      | `npm run build`、`git diff --check` | 通过                                                                                                                                             |
| 2026-09-15 | Theme Lab      | 双主题视觉与对比度检查              | 5 套候选的 Light / Dark 均通过；正文、弱化文字及主按钮对比度不低于 WCAG AA 基线                                                                  |
| 2026-09-15 | Theme Lab      | 视口与浏览器 console                | 默认桌面与 320px 无横向溢出；无 warning/error                                                                                                    |
| 2026-09-15 | Theme Lab 收敛 | `npm run check`                     | 通过：16 个测试文件、136 项测试；typecheck、boundary、Prettier 全部通过                                                                          |
| 2026-09-15 | Theme Lab 收敛 | `npm run build`、`git diff --check` | 通过；生产包生成成功，差异空白检查无报错                                                                                                         |
| 2026-09-15 | Theme Lab 收敛 | 双主题视觉与层级检查                | 两套 Light / Dark 均通过；案件标题约 23px / 27px、决策标题 16px，正文层级优先；正文、弱化文字及主按钮对比度均达到 WCAG AA 基线                    |
| 2026-09-15 | Theme Lab 收敛 | 视口与浏览器 console                | 默认桌面与 320px 无横向溢出；无 warning/error                                                                                                    |
| 2026-09-15 | 正式 UI 定案   | `npm run check`                     | 通过：19 个测试文件、175 项测试；typecheck、boundary、Prettier 全部通过；新增 Light / Dark 切换与持久化回归测试                                    |
| 2026-09-15 | 正式 UI 定案   | `npm run build`、`git diff --check` | 通过；Vite 生产包生成成功，差异空白检查无报错                                                                                                     |
| 2026-09-15 | 正式 UI 定案   | 浏览器完整演示流程                  | 通过：Profile、正式工作区、决策、标注、反馈、剧情、视频 fallback、结局和结束后回看；Light / Dark 共用同一正式 token 边界                         |
| 2026-09-15 | 正式 UI 定案   | 窄窗口视觉检查与浏览器 console      | 320px 下剧情、结局与案件回看无横向溢出；正文标题维持阅读层级；无装饰性竖线；最终重载无 warning/error                                               |

计划使用：

- `npm ci`
- `npm run typecheck`
- `npm run test`
- `npm run check:boundaries`
- `npm run format:check`
- `npm run build`
- `npm run dev` 后人工验证完整演示流程

## 8. 后期 TODO

- 补完整 Content Validator，包括跨引用、节点图和资源约束。
- 接入真实 Profile 与 SQLite 存档后验证重启恢复、revision 冲突和 `needsReload`。
- 在 Tauri 安装包内验证 WebView2 视频、声音、资源 URL、CSP 与窗口缩放。
- 为完整 DOM 交互补充 Testing Library 测试，覆盖焦点移动、Popover 和 Story fallback。
- 在真实目标 PC 和 Tauri WebView2 中复核“绝对刻度”Light / Dark 的长文节奏、系统字体回退与高对比设置。
- 内容与品牌素材定稿后替换当前演示文案和占位媒体，但保持已锁定的中性色 token 与正文层级。
- 内容规模扩大后增加更多路径穷举与跨内容包兼容测试。

## 9. 变更日志

- 2026-09-15：创建实施记录；根据架构文档与骨架探索拆分 S0–S7；启动 S0。
- 2026-09-15：S0 完成并验收；启动 S1。
- 2026-09-15：S1 完成并验收；并行启动文件边界互不重叠的 S2 与 S3。
- 2026-09-15：S2 发现 selector 所在层与 UI 边界冲突；新增 Application 只读 facade，保持原依赖方向。
- 2026-09-15：S2、S3 并行完成并验收；按互不重叠目录并行启动 S4、S5、S6。
- 2026-09-15：S4–S6 完成；启动 S7 顶层集成与 QA。复核发现 EndingView 必须可退出到 ended 局的只读历史，而非永久阻塞工作区。
- 2026-09-15：S7 完成。增加完整 DOM 回归测试；浏览器手验完整闭环；修复桌面双滚动、屏幕外 sr-only 元素扩大页面及 320px 横向溢出。
- 2026-09-15：新增隔离的 Theme Lab（`?themeLab=1`），先以五套原创权威极简方案探索 Light / Dark 方向；正式 UI 暂不替换，等待视觉方向决策。
- 2026-09-15：Theme Lab 收敛为“01 绝对刻度 / Exactitude”与“02 纪碑留白 / Monument”，删除 02–04 候选数据和专属 CSS 分支；改写为原创的档案、监察与命令微文案。降低案件及决策标题层级，以正文阅读优先；正式 App 与 `?themeLab=1` 入口保持不变。
- 2026-09-15：按视觉复核意见移除“绝对刻度”的全部装饰性竖线，包括竖向刻度背景、侧栏粗竖条、纵向分隔与引文左线；保留横向登记线和状态对比。Light / Dark 浏览器复核通过。
- 2026-09-15：正式 UI 定案为“绝对刻度”。将双主题 token、排版、水平审计线、方形控件和状态语法迁入 Profile、AppShell、案件、反馈与剧情/结局全链路；加入主题持久化及回归测试。Theme Lab 仅作为历史比较入口保留。
- 2026-09-15：移除决策选项旁独立的“注”按钮及其预留列；附注仅由整个选项的悬浮或键盘聚焦触发，不占用额外视觉控件，也不改变选项的游戏命令语义。
