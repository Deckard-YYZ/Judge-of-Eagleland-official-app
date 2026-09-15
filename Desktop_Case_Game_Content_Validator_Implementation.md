# Content / Validator 线实施记录

**基线文档：** `Desktop_Case_Game_Architecture_v1.0.md`  
**协作契约：** `Desktop_Case_Game_Core_Implementation.md`、`src/content/schema.ts`  
**状态：** 已完成  
**开始日期：** 2026-09-15  
**完成日期：** 2026-09-15

## 目标

建立一条可独立于 UI、SQLite 和 GameSession 运行的内容生产与校验线：以现有
`ContentCatalog` 契约为唯一运行时数据模型，将架构规定的分文件 JSON 内容包组装为只读
Catalog，并在构建期、命令行和 Repository 加载边界统一执行结构与语义校验。

首版交付覆盖 Zod 结构入口、稳定诊断、ID/reference、progression、剧情队列、案件 DAG、
路径终止、资源与版本目录检查、CLI，以及两三个可穷举路径的 fixture 案件。错误必须能定位到
“源文件 + 对象 ID + 字段路径 + 问题”，使内容团队在 Schema 稳定后可以尽早开始案件生产。

## 当前基线

- `src/content/schema.ts` 已用 Zod 4 定义并导出 `ContentCatalogSchema` 及其推导类型；
  `strictObject`、非空 ID/文本、整数和少量局部值域已经生效。
- `src/content/repository.ts` 提供精确按 `packageId + version` 加载的
  `ContentRepository` 与 `FakeContentRepository`；注册与读取均执行统一结构/语义校验并隔离可变副本。
- `src/content/fixtures/minimalCatalog.ts` 是与 Game Core 联调的 TypeScript 内联 Catalog，包含
  两案、普通剧情、两个结局和一个视频索引；它不是架构规定的分文件 JSON 内容包，媒体文件也未落盘。
- Game Core 已完成，正式规则直接消费 `Readonly<ContentCatalog>`；其 invariants 是运行中
  `GameState` 与内容的一致性防线，不能替代发布前的完整内容包校验。
- C1 已新增纯函数 `validateContentCatalog(input, options?)` 与专项测试：Zod 结构错误和跨对象
  语义错误统一返回稳定诊断，不读取文件、不修改输入，也不依赖 UI、Game Core 或平台层。
- C2 已将案件图检查隔离到纯模块：只沿已声明 node 边分析 reachability，以迭代式三色 DFS
  区分真正的环和合法合流，并将 start 可达环标记为可选择的非终止路径。
- C3 已新增纯 `loadContentPackage(sources)`：解析固定布局的内存 JSON 文本、无覆盖地组装
  Catalog，并把 Schema、语义和图诊断按 Catalog path 回指到实际内容文件。
- C4 已补齐 asset path、video 引用/kind、可选文件 inventory 和预期 package/version 校验；
  这些检查继续保持纯函数，不读取磁盘，也不从扩展名猜测媒体类型。
- C5 已新增命令行磁盘 adapter、`validate:content` npm script、真实三案分文件内容包与静态
  多错误反例；CLI 提供 package-relative JSON source、完整 inventory 和目录身份给纯 loader。
- C6 已在 Repository 和 GameSession 内容加载边界接入同一个 Validator；任意 Repository 实现
  返回的非法内容都不能进入 ready 状态，manifest ref 不一致仍保留独立错误分类。
- 已安装 Zod、TypeScript、Vitest 和 Node 22；不需要为本线引入运行时框架。
- 2026-09-15 C0 基线：`npm run check` 通过，15 个测试文件、125 项测试通过；typecheck、
  依赖边界和 Prettier 均通过。
- **工作树已有未提交的前端线改动。Content / Validator 实施不得编辑、格式化、覆盖、删除或
  回滚这些改动；每个 slice 只能触碰其明确列出的内容/校验相关文件。**

## Slice 计划与进度

| Slice | 内容                                                                   | 依赖   | 状态   | 审核门槛                                                                                      |
| ----- | ---------------------------------------------------------------------- | ------ | ------ | --------------------------------------------------------------------------------------------- |
| C0    | 架构盘点、Schema 锁定、实施记录与基线验证                              | 无     | 已完成 | 本文与代码现状一致；只新增本文；`npm run check` 通过                                          |
| C1    | 统一诊断 contract；Zod 结构入口；ID/reference/progression/queue checks | C0     | 已完成 | 诊断含 source/object/path/code/message；所有架构列出的非图、非资源语义约束有正反测试          |
| C2    | 案件 DAG、起点可达、发布节点可达、所有路径最终进入 resolution          | C1     | 已完成 | 正确识别真环且允许合流；不可达节点、死端和不终止路径有独立诊断与测试                          |
| C3    | 架构规定的分文件 JSON 内容包 loader 与 source map                      | C1     | 已完成 | 按 `content/<package>/<version>/` 组装唯一 Catalog；重复/缺失文件明确报错；语义诊断回指源文件 |
| C4    | asset 路径、kind、文件存在性及版本目录检查                             | C3     | 已完成 | 拒绝绝对路径、越界路径、缺失文件、使用位置 kind 错误及目录/manifest 版本不一致                |
| C5    | CLI、npm script、3 个 fixture 案件、异常样本与路径穷举                 | C2、C4 | 已完成 | CLI 失败返回非零退出码且输出可操作诊断；固定样本全路径可验证并保留回归覆盖                    |
| C6    | Repository 运行时语义校验接入、全量回归与文档收口                      | C5     | 已完成 | 无效 Catalog 不能进入 GameSession；目标测试、`npm run check`、构建及 diff 检查通过            |

每个 slice 由 `efficient_worker` 实施，主代理审核 diff、专项测试和回归结果；只有审核通过后才
更新为“已完成”并继续。C1/C2 集中修改纯校验核心，C3/C4 集中修改包 I/O，默认按依赖串行；
仅对文件集合不重叠、契约已锁定的工作并行。

## 重要决策

1. **现有 Schema 是唯一类型源。** 不另写一套手工 TypeScript 内容接口；分文件 JSON 最终必须
   组装并通过 `ContentCatalogSchema`。新增文件级 envelope 只服务装载，并在 C3 记录格式。
2. **结构校验先于语义校验。** Zod 负责 JSON 形状与局部值域；Validator 负责 key/ID 一致性、
   跨引用、唯一性、图、进度规则、剧情队列、资源和版本约束。结构失败时不得让语义遍历崩溃。
3. **Validator 核心保持纯函数。** 文件枚举、JSON 读取和磁盘存在性位于适配层；给定 Catalog、
   source map 与资源清单时，诊断顺序确定、输入不变，Node + Vitest 可直接测试。
4. **诊断是公开 contract。** 至少固定 `code`、`message`、`source`、`objectId`、`path`；批量报告
   所有可安全继续发现的错误，并采用稳定排序，CLI 和 Repository 共享同一结果，不拼接另一套文案。
5. **Record key 也是身份。** `cases` key 必须等于 `CaseDefinition.id`；node、resolution、attribute、
   flag、story、ending、asset 等引用以 Catalog key 为准。choice ID 按架构在单个案件内唯一，不能
   只在各 node 内检查。
6. **图检查使用真正的有向图算法。** 从 `startNodeId` 检查可达性，以 DFS 颜色或等价算法检测环；
   多父节点合流合法。所有可达 choice 分支都必须在有限步内到达已声明 resolution。
7. **进度与队列规则按 Game Core 语义对齐。** Predicate 引用必须存在；unlock 目标存在；普通剧情
   与 ending 剧情隔离；每个结局使用独立 story；ending priority 唯一。Validator 不复制条件求值器。
8. **物理内容包遵循架构目录。** C3 以 `manifest.json`、`attributes.json`、`initial.json`、
   `progression.json`、`cases/`、`stories/`、`endings.json`、`assets.json` 和 `media/` 为基线；
   加载后目录细节不得泄漏给 Game Core。精确分文件 envelope 在 C3 实施时写入本文变更日志。
9. **资源路径只允许包内相对路径。** C4 先做静态安全与存在性/kind 校验；运行环境 URL 转换属于
   `platform/`，不塞进 Validator。
10. **构建期严格、运行时同语义。** 内置包通过 CLI 完整校验；Repository 至少重复 Schema 与关键
    语义校验。日常每次游戏操作不重新扫描内容包或磁盘。
11. **Application 只开放一个窄接入点。** C6 是本线唯一允许修改 Application 的例外：
    `GameSession.load` 不信任可替换的 Repository 实现，在内容装载后以同一纯 Validator 复验，
    且不传文件 inventory。UI、Game rules 与 Storage 继续保持不变。

## C3 文件格式契约

纯 loader 接收只读 `{ source, text }[]`；`source` 是由后续磁盘 adapter 提供的、以 `/` 分隔的
包内相对路径。C3 不读取目录、不解析系统路径，也不接收媒体二进制。各 JSON 文件直接承载以下
内容，不再增加无业务意义的通用 envelope：

| 文件                     | JSON 内容                                                         |
| ------------------------ | ----------------------------------------------------------------- |
| `manifest.json`          | `ContentManifest`                                                 |
| `attributes.json`        | `Record<AttributeId, AttributeDefinition>`                        |
| `initial.json`           | `InitialGameDefinition`                                           |
| `progression.json`       | 严格对象 `{ unlockRules: UnlockRule[], storyRules: StoryRule[] }` |
| `cases/<caseId>.json`    | 一个 `CaseDefinition`；文件 stem 是 Catalog case key              |
| `stories/<storyId>.json` | 一个 `StoryDefinition`；文件 stem 是 Catalog story key            |
| `endings.json`           | `Record<EndingId, EndingDefinition>`                              |
| `assets.json`            | `Record<AssetId, AssetDefinition>`                                |

根文件全部必需且各只能出现一次；任意相同 source 不能选择“最后一个覆盖前一个”。只接受上述根
文件及单层 `cases/*.json`、`stories/*.json`，未知 JSON、嵌套对象文件和不安全 stem 均拒绝。
成功结果附带只读 source map 与 `sourceForPath` 定位函数；Catalog path 的首段决定根文件，case/
story 的第二段 key 决定对象文件。物理包根目录和文件枚举仍由未来 adapter 提供。

## C4 资源与包身份契约

- `asset.path` 必须是非 URL 的包内相对文件路径，只使用 `/`。绝对路径、盘符、反斜杠、空 segment、
  `.`/`..` segment、Unicode 控制字符、query 和 fragment 均拒绝。
- `video` StoryStep 的 `assetId` 必须存在，且对应清单项的显式 `kind` 必须为 `video`。不从扩展名
  推断 kind，不检查媒体编码，也不因 asset 未被 StoryStep 使用而报错。
- `loadContentPackage` 的 `fileInventory` 可选。提供时，每个路径合法的 asset 都必须在 inventory
  中精确存在；省略时代表此纯校验边界没有物理文件信息，不推断文件缺失。路径非法时不再级联
  `ASSET_FILE_MISSING`。
- `expectedPackageId`、`expectedVersion` 可选，供未来 CLI 从 `content/<package>/<version>/`
  目录得出后传入。与 manifest 不符时，诊断回指 `manifest.json`。

## C5 CLI 与 fixture 契约

- `npm run validate:content` 无参数时从 `content/<packageId>/<version>/` 发现包；参数可为一个或
  多个明确 package 目录、packageId 目录或内容根目录。重叠参数发现的相同 package 只校验一次。
- CLI 递归枚举所选 package 的普通文件，所有文件构成 inventory，`.json` 文件作为 UTF-8 文本
  交给纯 loader；操作系统分隔符在边界转换为 package-relative `/` source。package 目录末两段
  分别作为 expected packageId/version。
- 每条失败输出固定包含 package、源文件、objectId、字段 path、诊断 code 和 message；合法包退出
  0，usage、I/O 或任一 validation 错误退出非零。多个包和同包多诊断不会在首错处停止。
- `content/validator-fixture/1.0.0` 是真实分文件回归包，恰好三个 DAG 案件、一个普通 story、两个
  独立 ending story；三案二选一的全部 8 种组合由正式 Game Core 推进并处理阻塞 story 后到达
  ending。`tests/fixtures/content/invalid/1.0.0` 是稳定 CLI 多错误反例。
- fixture 的 video step 使用明确命名的文本占位文件并带 fallback；这只验证清单、路径和存在性，
  不声称占位文件可播放或经过媒体解码。

## C6 运行时加载契约

- `FakeContentRepository.register` 和 `load` 都调用 `validateContentCatalog`。结构或语义非法统一抛出
  `ContentRepositoryError`，code 为 `INVALID_CONTENT`，cause 保留只读、稳定排序的完整 issues；
  精确 `packageId + version` 查找规则不变。
- Repository 存储 Validator 产出的副本，每次 load 再校验并返回新副本；注册方和不同调用方都
  不能借共享可变对象污染已注册内容。
- `GameSession` 在任意 `ContentRepository.load` 返回后再次调用同一 Validator，运行时不提供
  file inventory。非法内容映射为 `CONTENT_INVALID`，Session 保持 error 且不发布 ready；合法内容
  的 manifest ref 与请求不一致仍单独映射为 `CONTENT_MISMATCH`。
- 这是 Content / Validator 线唯一对 Application 的窄接入例外；没有在 Application 中复制
  Schema、语义规则或诊断逻辑，也没有修改 UI、Game rules 或 Storage。

## 明确不做

- 除 C6 在 `GameSession` 内容加载边界调用 Validator 的窄接入外，不修改 React、CSS、前端 demo、
  Application 其他逻辑、Game Core、SQLite、Tauri 配置或现有前端改动。
- 不建设 Compiler、可视化案件编辑器、通用工作流/规则引擎、脚本语言或任意代码执行能力。
- 不实现联网下载、远程热更新、签名分发、在线发布、旧包清理或内容迁移服务。
- 不让 Validator 自动评判叙事质量、法律合理性、选项是否有意义或数值是否平衡。
- 不宣称仅靠静态引用检查即可证明所有跨案件游玩路线都可完成；首版只穷举固定 fixture 路径并
  对主要路线做场景回归。
- 不实现图片/视频转码、尺寸优化、运行时 URL 解析、媒体播放或播放失败 UI。
- 不重复实现 Game Core 的 transition、Predicate 求值、属性结算、解锁执行或结局选择。
- 不支持撤销/重判、中间选项副作用、任意布尔表达式树、远程 Provider 或移动端专用格式。

## 审核清单

- 变更文件属于当前 slice，且未触碰或格式化工作树中的前端线文件。
- `src/content/` 的模型/校验不依赖 React、UI、Application、Storage、Tauri 或 DOM。
- 类型从 Zod 推导；输入对象和数组未被修改；输出与诊断顺序确定。
- Schema 错误与语义错误都能报告源文件、对象 ID 和字段路径，不只返回“JSON 无效”。
- case/key、choice、rule、priority 等唯一性范围与架构一致。
- 所有起点、node/resolution、attribute/flag、case/story/ending/asset 引用均有正反测试。
- DAG 校验允许合流，并覆盖真环、自环、不可达节点、死端和所有路径终止。
- progression、ending 与 story queue 的限制与 Game Core 行为一致，不引入第二套执行规则。
- 资源校验防绝对路径与目录穿越，检查存在性和视频使用位置的 kind。
- package/version、Schema 版本和物理目录一致；已发布版本不可变原则有文档说明。
- CLI 对成功/失败使用稳定退出码，适合本地与 CI；输出不吞掉多个诊断。
- fixtures 同时包含合法闭环和明确预期的异常样本；三案路径可穷举且结果确定。
- Repository 不再让只通过形状校验、却含悬空引用的 Catalog 进入运行时。
- 专项测试、全量检查、生产构建与 `git diff --check` 通过，且实施记录同步更新。

## 后期 TODO（不属于本轮）

- 将现有 `content/README.md` 扩充为完整字段词典、诊断码索引与内容评审 checklist。
- 内容规模增长后，按数据决定是否增加增量校验、路径覆盖报告或编辑器集成。
- 对正式主要剧情路线增加跨案件场景测试；必要时再研究全局可达/死锁分析，不提前承诺完备证明。
- 远程内容出现时增加可信校验、原子安装、旧版本保留、签名与回滚策略。
- 根据实机打包结果补充媒体编码、大小、分辨率、CSP 与平台兼容约束。
- 若 Schema 升级，显式增加兼容版本或迁移策略，不就地改写已发布的相同
  `packageId + version`。
- 存档加载边界继续负责 save Schema、内容版本可获得性和旧存档迁移；不并入内容 CLI。

## 验证命令

```powershell
# C0 基线与每个 slice 的全仓回归
npm run check

# C1-C6 Content 专项测试
npx vitest run tests/content

# C5 起由 package.json 提供的正式内容包入口
npm run validate:content

# C6 收口
npm run build
git diff --check
git status --short
```

审核时还应对 CLI 分别运行一个合法包和一个多错误异常包，确认退出码、诊断定位与稳定顺序；
命令的最终参数形式由 C5 在 `package.json` 和 CLI 帮助中锁定。

## 变更日志

- 2026-09-15：完成 C0。核对架构 6、11、14、15、16 节与已完成 Game Core；确认现有 Zod
  Catalog 契约、Repository 和最小联调 fixture 基线；切分 C0-C6，记录边界、决策、审核门槛、
  明确不做项和后期 TODO。`npm run check` 通过（15 个测试文件、125 项测试）。C0 已完成。
- 2026-09-15：实施 C1。新增纯 `validateContentCatalog`、discriminated success/failure 结果和
  固定 `code/source/objectId/path/message` 诊断；结构错误安全映射并稳定排序。新增 case key/ID、
  案件内 choice ID、initial 引用与重复、start/choice target、resolution effect、全部 progression
  predicate、unlock/story target、规则 ID、ending priority/story 与队列隔离检查。引用判断只接受
  record own key，避免把 `toString`、`__proto__` 等原型属性误判为已声明 ID。明确未实现 DAG、
  资源路径/kind/存在性、文件 loader 或 CLI。专项 14 项测试、typecheck、依赖边界和 Prettier
  通过；C1 已完成。
- 2026-09-15：实施 C2。新增独立纯图校验模块；从有效 start 计算 node 可达集，对每个发布 node
  报告不可达，并用无递归深度风险的三色 DFS 检测自环和多节点环。灰边才构成环，指向已完成黑
  节点的 diamond 合流合法；可从 start 到达的环同时产生明确非终止路径诊断。悬空 start/node/
  resolution 引用仍由 C1 精确报告，图检查跳过不完整边并抑制派生不可达级联。未使用 resolution
  与 asset 合法，不纳入图可达性。C1+C2 专项 21 项测试、typecheck、依赖边界和 Prettier 通过；
  全仓 `npm run check` 通过（17 个测试文件、143 项测试），生产构建通过。C2 已完成。
- 2026-09-15：实施 C3。新增纯 `loadContentPackage`，按固定根文件、`cases/*.json` 和
  `stories/*.json` 解析内存文本并组装唯一 Catalog；明确锁定上述文件 envelope。缺失根文件、
  同 source 重复、JSON 语法错误、未知或非法 JSON 文件均使用 C1 诊断 contract 批量稳定报告，
  重复文件不会静默覆盖。成功结果返回只读 Catalog、source map 和 path 定位函数；Catalog 的
  Schema、引用、progression、queue 与图诊断均回指 manifest/attributes/initial/progression/
  case/story/endings/assets 的实际源文件，case key 固定取文件 stem，内部 `id` 不一致继续复用
  `CASE_KEY_ID_MISMATCH`。C3 不使用 Node fs/path，不检查资源存在性/类型，不接入 CLI。
  C1-C3 专项 31 项测试、typecheck、依赖边界和 Prettier 通过；全仓 `npm run check` 通过
  （18 个测试文件、153 项测试），生产构建通过。C3 已完成。
- 2026-09-15：实施 C4。新增规范化包内 asset path 校验，拒绝绝对路径、Windows drive/反斜杠、
  URL-like、`.`/`..`、空 segment、Unicode 控制字符、query 和 fragment。StoryStep video 必须引用
  已声明且 kind 为 video 的 asset；未使用 asset 不报错，也不根据扩展名猜测 kind。纯 package
  loader 新增可选只读 `fileInventory`、`expectedPackageId` 和 `expectedVersion`：inventory 存在时
  才检查每个合法 asset 文件，manifest 身份与目录期望不符时回指 `manifest.json`；非法路径不会
  级联 missing-file 诊断。C4 不读取磁盘、不检查媒体编码、不接入 CLI。C1-C4 专项 52 项测试、
  typecheck、依赖边界和 Content 线 Prettier 通过；全仓 19 个测试文件、175 项测试与生产构建
  通过。`npm run check` 的最终全仓 Prettier 步骤当前被并行前端线未格式化的
  `src/ui/presentation/story/story.css` 阻塞；C4 未修改该文件。C4 已完成。
- 2026-09-15：实施 C5。新增 Node CLI 磁盘边界与 `validate:content` script，精确增加
  `tsx@4.23.13` devDependency。CLI 默认发现 `content/<packageId>/<version>`，也支持多个 package/
  packageId/content-root 参数；递归 inventory、UTF-8 JSON 读取、source 分隔符和目录身份均在
  调用纯 loader 前处理。输出包含 file/object/path/code/message，validation、I/O、usage 失败均
  返回非零且继续报告可处理的其他包和诊断。新增作者 README、恰好三案的真实分文件包、video
  fallback 与非播放占位文件，以及静态多错误反例；使用正式 Game Core 穷举三案全部 8 种组合并
  处理 pending story 直至 ending/ended。C1-C5 Content 专项 66 项与 valid/invalid CLI 实跑通过；
  全仓 `npm run check` 通过（21 个测试文件、189 项测试），生产构建通过。C5 已完成。
- 2026-09-15：实施 C6。`FakeContentRepository` 在 register/load 两个边界复用统一 Validator，
  非法内容以 `INVALID_CONTENT` 和只读 issues cause 拒绝；存储与每次 load 都使用独立副本，保留
  精确 ref 查找。`GameSession` 对任意 Repository 返回值复验并将非法内容映射为
  `CONTENT_INVALID`，不进入 ready；合法 manifest ref 不一致仍为 `CONTENT_MISMATCH`。新增结构、
  start/target/progression/graph/asset 语义反例，以及 Repository 被绕过时的 Application 回归。
  C6 是本线唯一对 Application 的窄接入例外。Content + Application 专项 92 项、valid/invalid CLI
  实跑（退出码分别为 0/1）、全仓 `npm run check`（22 个测试文件、203 项测试）、生产构建与 diff
  检查全部通过。Content / Validator 线已完成。
