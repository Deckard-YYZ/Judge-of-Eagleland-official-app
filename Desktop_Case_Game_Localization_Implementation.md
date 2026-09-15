# 桌面案件模拟游戏：本地化实施记录

**关联文档：** `Desktop_Case_Game_Frontend_Implementation.md`  
**实施原则：** 语言改变表现，不改变游戏事实。  
**首版语言：** `zh-CN`、`en-US`  
**当前状态：** L0–L3 已完成，本地化主链路闭环  
**最后更新：** 2026-09-15

## 1. Slice 台账

| Slice | 范围 | 状态 | 验证重点 |
| ----- | ---- | ---- | -------- |
| L0 | 类型安全消息目录、locale 解析与本地设置、React Provider、Intl helper、最小 smoke usage | 已完成 | 默认回退、插值失败、Portal Context、持久化与现有流程无回归 |
| L1 | 正式应用公共 UI 文案迁移与可访问的语言切换入口 | 已完成 | 登录前后即时切换、焦点与 aria 文案、Light/Dark 和窄屏 |
| L2 | Game Content 的 locale 表现层拆分与加载/校验契约 | 已完成 | 内容引用稳定、规则 ID 不变、缺失语言包回退与验证 |
| L3 | ResolutionSnapshot 事实化、旧存档迁移、正式内容动态切换与全链路 QA | 已完成 | 旧存档可读、GameState 不随语言变化、双语完整流程与打包环境 |

状态只使用：`待开始`、`进行中`、`已完成`、`阻塞`。

## 2. L0 已交付

- `AppLocale`、`DEFAULT_LOCALE`、`SUPPORTED_LOCALES` 与规范化解析/语言族协商。
- UI localStorage 读写适配；无效值回退且存储不可用时继续以内存运行。
- 中文默认消息目录作为 `MessageKey` 与插值参数的类型源；英文目录必须满足同一完整 shape。
- 类型安全 `t()`；开发环境缺失翻译抛错，显式生产回退使用默认目录；缺失插值参数始终抛出可定位错误。
- `I18nProvider/useI18n` 位于正式 `App` 根部，登录前、认证工作区和 React Portal 共享 Context。
- 基于 `Intl.NumberFormat`、`Intl.DateTimeFormat` 的最小 typed helper。
- Profile 登录标题作为正式入口的最小 smoke usage；其余文案留给 L1。

## 3. 边界

- locale 是应用 UI 设置，不进入 Profile、`GameState`、SaveEnvelope 或 Application command。
- i18n 模块位于 `src/ui/i18n`，不反向依赖 Application、Game、Storage、Platform 或具体内容 fixture。
- 消息 key 只来自默认目录，组件不能提交任意字符串 key，也不能以 locale 三元表达式维护两套文案。
- Theme Lab 保持独立 composition-root 分支，本阶段不挂载 Provider、不迁移文案。
- Game Content、CaseDefinition、ResolutionSnapshot 仍保持当前 shape，L0 不做预迁移。

## 3.1 L1 已交付

- Profile 与认证后 AppShell 均提供紧凑、可键盘操作的语言切换；切换即时更新正式 UI、`document.documentElement.lang` 与本地设置。
- 品牌、Profile、Shell、Sidebar、案件工作区、裁定、附注、反馈、剧情与结局的 UI chrome、状态、错误和 aria/title 文案已迁入 typed catalog。
- 组件只持有稳定错误 code，渲染时再翻译，避免切换语言后继续显示旧 locale 的异步错误文本。
- 归档日期、计数、属性值、步骤序号和变化量经 L0 的 `Intl` helper 格式化；稳定 ID 与 Game Content 值保持原样。
- 打开的 Annotation Portal 共享根 Provider，并随语言切换同步更新标题与关闭按钮可访问名称。

## 3.2 L2 已交付

- Schema v2 建立唯一 `GameContentCatalog` 规则层和按 `AppLocale` 加载的严格
  `LocalizedContentCatalog`；两者共享 packageId/version 身份，`ContentRef` 仍不含 locale。
- 规则层拥有 ID、顺序、target/effects、predicate/unlock/flag、资源、story effect/duration；语言包
  只拥有 manifest/attribute/case/character/node/choice/resolution/story/ending 的显示数据。
- story step 新增稳定 ID；人物、选项与 story step 顺序只由规则层数组决定，语言包使用 ID record 对齐。
- Validator 拒绝语言包缺失/额外 ID、非法 locale、包身份不符、非法 TextBlock、annotation shape 漂移，
  strict schema 同时拒绝语言包偷带规则字段与规则包夹带显示文案。
- 新物理格式为 `game.json` + `locales/<locale>.json` + `media/**`；CLI 自动识别并校验每个 manifest
  声明的 locale。`content/minimal-test-package/1.0.0` 是完整 zh-CN/en-US 示例。
- `SplitContentRepository` 明确分开 `loadGameContent(ref)` 与 `loadLocalization(ref, locale)`；组合只发生
  在命名明确的 presentation adapter。

## 3.3 L3 已交付

- save schema 升级为 v2：`ResolutionSnapshot` 只保留 `attributeId/before/after/actualDelta`、`resolvedAt` 与 `resolvedOrder`；resolved progress 保存稳定 `resolutionId/finalChoiceId/history`，不保存任何本地化文案或 locale。
- v1→v2 迁移仅位于 storage/load 边界，从最后一项 history 推导 `finalChoiceId`，保留 revision、ContentRef、ID、数值、时间与顺序，丢弃旧标题、选项、裁定、结果和 attribute label。public schema 与 writer 只接受 v2。
- Game Core、transition、progression、invariants 与 session 直接消费唯一 `GameContentCatalog`；L2 `composeLocalizedContentView`、旧 mixed catalog/repository 与 schema-v1 物理 loader 已删除。
- Application 通过只读 `GameContentView` 为 React 投影当前语言内容；choice target、resolution effects 等规则字段不会跨过 UI 墙。locale 切换保留 GameState、revision、选择状态与命令语义。
- 正式案件标题、人物、正文、node/choice/annotation、归档裁定、属性、story、video fallback 与 ending 均可在 zh-CN/en-US 间实时切换；打开中的 Portal/overlay 同步更新。
- 内容加载失败与规则错误分开表示；请求语言缺失时尝试 manifest 默认语言并暴露 typed fallback/error 状态。

## 4. 重要决策

### D-L0-001：默认目录同时是类型契约

`zh-CN` 默认目录通过字面量 key 生成 `MessageKey`；其他 locale 使用 `satisfies MessageCatalog` 在编译期检查完整覆盖。带 `{parameter}` 的默认消息进一步推导 `t()` 所需参数名。

### D-L0-002：缺失数据必须可见

开发环境缺失翻译直接抛出带 locale/key 的错误；允许调用方显式选择默认语言回退，以覆盖生产容错。模板包含参数但调用缺失时始终抛错，避免将 `{name}` 或空值静默送到 UI。

### D-L0-003：本地设置优先，首版默认中文

Provider 优先读取有效持久化 locale；缺失或非法时使用 `DEFAULT_LOCALE`。解析函数另提供语言族协商能力，但正式入口不未经用户选择就根据浏览器语言改变现有默认。

### D-L0-004：Provider 包围正式 App，不包围 Theme Lab

Provider 在 `App` 导出根部建立，所以 Profile、认证工作区及其 Portal 都共享 locale；`main.tsx` 的 Theme Lab 分流仍位于 App 外，不受本地化工程影响。

### D-L1-001：UI chrome 与 Game Content 按所有权分离

组件拥有的标签、状态、错误和无障碍名称进入 UI catalog；案件标题、正文、人物、选项、判决、剧情和结局内容继续读取当前内容包。英文界面允许显示尚未本地化的中文内容值，但不混入中文 UI chrome。

### D-L1-002：语言切换是 App 根设置

Profile 与 AppShell 的切换入口操作同一个根 Context，不复制 locale 状态；语言不随登录退出重置，也不进入 Profile、GameState 或 command。Portal 内无需建立第二个 Provider。

### D-L1-003：错误先保留稳定 code，再于渲染期翻译

Application/Profile 返回的结构化错误由 UI 映射到 typed key。异步流程不缓存已翻译字符串，因此打开中的错误、剧情层和普通页面都会响应后续 locale 切换。

### D-L2-001：完整性是规则层 ID 集与语言包 ID 集的精确相等

覆盖校验不靠数组位置，也不允许 locale 自行排序。每个声明语言必须完整覆盖所有可显示对象；多余
ID 与缺失 ID 同样视为发布错误，诊断继续使用稳定 code/source/objectId/path/message。

### D-L2-002：迁移期兼容桥只能从双层数据单向生成

L2 曾由 `composeLocalizedContentView` 从规则与语言数据单向生成旧只读表现，规则字段始终只来自
`GameContentCatalog`。L3 已让 Core 与 UI 分别消费规则和只读表现投影，并删除该桥及 schema v1
物理内容加载路径；这里只保留决策历史，不再描述现行运行时。

### D-L2-003：共享 locale 常量不属于 UI

`AppLocale`/supported/default 常量移至无框架的 shared 层，UI i18n 与 Content schema 共同引用，避免
Content 反向依赖 React/UI，同时保持首版语言集合只有一个类型来源。

### D-L3-001：存档保存事实，静态文字按 ID 读取

历史回看使用保存的 `actualDelta`，绝不重新施加 effects；case/choice/resolution/attribute 的显示文案按保存的稳定 ID 从同一 ContentRef 的当前 locale 语言包读取。这样翻译修订不改变结算事实，语言也无需进入存档。

### D-L3-002：规则加载与表现加载保持两个维度

GameSession 只加载并冻结规则；GameSessionView 独立加载语言包并原子替换只读表现投影。快速切换使用请求版本阻止旧请求回写，语言失败可回退默认语言，整个过程不 dispatch、不 commit。

### D-L3-003：旧格式只存在于 save migration

旧 ContentCatalog、组合桥与 schema-v1 内容 loader 不再保留。旧本地化字段 Schema 只存在于 `storage/migrateSave.ts`，用于读取 v1 save，不能被 Core、UI 或正式 writer 导入。

## 5. 明确不做

- 不引入 ICU、复数规则框架、远程翻译平台、运行时消息下载或第三方 i18n 依赖。
- 不把 locale 写入 Profile、游戏状态、存档、内容包引用或游戏命令。
- 不修改 Theme Lab，也不增加其语言切换。
- 不接入 Tauri/SQLite、远程内容下载、云账号或远程翻译；平台持久化仍是后续独立工程。
- 不在迁移时重新执行 effects、改变历史数值，或把 v1 文案复制到 v2。

## 6. 风险与处理

- **任意 key 或目录漂移：** 默认目录生成联合类型，英文目录使用完整 shape 编译检查，并有 key 集合测试。
- **缺失参数/翻译静默泄漏：** 插值与开发翻译缺失抛出包含 key 的错误；测试覆盖显式 fallback。
- **Portal 丢失 locale：** Provider 位于所有正式 overlay 之上，DOM 测试使用真实 `createPortal` 验证。
- **存储受限或污染：** localStorage 读写均捕获异常；非法值不会进入 Context。
- **语言改变业务事实：** L0 只处理 UI message 和 Intl 格式，不接触 Game/Application/存档模型。
- **异步语言请求乱序：** GameSessionView 使用递增 request version，只允许最新请求发布；切换时保留上一份已提交表现直到新投影完成，避免打开中的 Portal 闪退。
- **旧存档混入新模型：** legacy Schema 局限在 migration 文件，repository load 统一输出 v2，create/commit 只写 public v2。
- **历史文案与事实错配：** invariant 校验最终 history choice、`finalChoiceId` 与 `resolutionId` 的结构图一致；历史数值只取 snapshot actual changes。

## 7. 验证记录

| 日期 | Slice | 命令/检查 | 结果 |
| ---- | ----- | --------- | ---- |
| 2026-09-15 | L0 | `npm run check` | 通过：26 个测试文件、218 项测试；typecheck、boundary、Prettier 全部通过 |
| 2026-09-15 | L0 | `npm run build` | 通过：Vite 生产包生成成功 |
| 2026-09-15 | L0 | `git diff --check` | 通过 |
| 2026-09-15 | L1 | 定向 DOM/单元测试 | 通过：语言登录前后切换与持久化、document lang、真实 Annotation Portal、aria、Intl 与既有完整流程 |
| 2026-09-15 | L1 | `npm run check` | 通过：26 个测试文件、220 项测试；typecheck、boundary、Prettier 全部通过 |
| 2026-09-15 | L1 | `npm run build` | 通过：Vite 生产包生成成功 |
| 2026-09-15 | L1 | `git diff --check` | 通过 |
| 2026-09-15 | L2 | Content/Game/Application 定向回归 | 通过：双层 schema、严格字段、完整覆盖、身份、顺序、分维度 repository 与新物理 loader |
| 2026-09-15 | L2 | `npm run check` | 通过：27 个测试文件、229 项测试；typecheck、boundary、Prettier 全部通过 |
| 2026-09-15 | L2 | `npm run validate:content` | 通过：schema-v2 双语 2-case 包与 schema-v1 兼容 3-case 包均有效 |
| 2026-09-15 | L2 | `npm run build` / `git diff --check` | 通过 |
| 2026-09-15 | L3 | `npm run check` | 通过：28 个测试文件、218 项测试；typecheck、boundary、Prettier 全部通过 |
| 2026-09-15 | L3 | `npm run validate:content` | 通过：仅发现并校验 schema-v2 双语 2-case 包，旧内容格式不再进入 CLI |
| 2026-09-15 | L3 | `npm run build` / `git diff --check` | 通过：Vite 生产包生成成功，diff 无 whitespace 错误 |

## 8. 后续 TODO

- 在 Tauri/WebView2 环境验证 localStorage、系统字体、日期/数字格式与双语长文布局。
- SQLite adapter 接入时复用 `parseStoredSaveEnvelope` 作为 read boundary，并增加真实数据库 v1 row 迁移与 writer-v2 集成测试。
- 正式内容增加语言时继续要求 manifest 声明与完整 Validator 覆盖，不增加 locale 到 ContentRef。

## 9. 变更日志

- 2026-09-15：创建 L0–L3 台账；完成应用级类型安全 i18n 骨架、根 Provider、Portal/持久化/Intl 测试与一个登录前 smoke usage。
- 2026-09-15：完成 L1 正式 UI catalog 迁移、Profile/AppShell 语言切换、结构化错误翻译、Intl 展示与 Portal 动态语言回归覆盖；Game Content 保持原模型等待 L2。
- 2026-09-15：完成 L2 Game Content 规则/表现拆分、稳定 story step ID、完整双语 fixture、严格覆盖
  Validator、分维度 Repository、新物理包/CLI 与单向兼容桥；ResolutionSnapshot 和正式 UI 动态内容
  切换保留给 L3。
- 2026-09-15：完成 L3 save v2 事实化、v1 read migration、Core/Presentation 解耦、旧 Content 桥删除、正式 Game Content 双语实时投影，以及进行中／归档／Portal／Story／Ending 全链路回归。
