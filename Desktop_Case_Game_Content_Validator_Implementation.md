# Content / Validator 线实施记录

**基线：** `Desktop_Case_Game_Architecture_v1.0.md`  
**当前状态：** Schema v2 校验、物理包 production Repository、GameSession 恢复入口和真实 SQLite vertical slice 已完成；Windows Tauri 实际 UI 与进程重启联调通过，详见本轮记录。  
**更新日期：** 2026-09-16

## 目标与边界

Content / Validator 线负责把 `content/<packageId>/<version>/` 下的规则与本地化 JSON
变成只读、精确版本绑定的内容目录，并在发布/加载边界提供稳定诊断。它不负责案件如何判决，
不负责保存 GameState，也不负责 React、SQLite、Tauri 或媒体播放。

当前正式格式是 Schema v2：

| 文件 | 职责 |
| --- | --- |
| `game.json` | 唯一规则目录：manifest、attributes、initial、cases、progression、stories、endings、assets |
| `locales/<AppLocale>.json` | 一个语言的全部展示文本；只通过稳定 ID 对齐规则目录 |
| `media/**` | `game.json` 中 asset path 指向的包内资源 |

同一 `packageId + version` 发布后视为不可变。旧 Schema v1 分文件格式只保留在历史 fixture
和 git 历史中，不再由正式 loader 或 CLI 接受；旧存档 v1→v2 是 Storage 线的独立迁移。

## Slice 计划与进度

| Slice | 范围 | 状态 | 审核门槛 |
| --- | --- | --- | --- |
| V0 | 对齐架构、Schema v2 与实现记录 | 已完成 | 文档与真实代码一致，明确旧格式不再发布 |
| V1 | Zod Schema、规则引用、progression、ending/story queue 诊断 | 已完成 | 结构错误先于语义遍历；诊断稳定且不修改输入 |
| V2 | 案件图 reachability、环和路径终止检查 | 已完成 | 允许 diamond 合流，区分不可达节点与可达非终止路径 |
| V3 | `game.json` + `locales/*.json` 纯内存 loader | 已完成 | 重复/缺失/未知源文件和 JSON 错误可定位；语言包 ID 完整对齐 |
| V4 | asset path、kind、inventory、package/version identity | 已完成 | 仅包内相对路径；可选 inventory 存在时检查文件；不猜媒体类型 |
| V5 | CLI、正式最小内容包和异常样本 | 已完成 | 成功/失败稳定退出码，多诊断不在首错处停止 |
| V6 | Fake Repository 边界与 Application 复验 | 已完成 | 非法内容不能进入运行态，引用不一致与非法内容分开报告 |
| V7 | 物理 Runtime Repository 与桌面 Bootstrap 接入 | 已完成 | Tauri 桌面从 bundled content 加载精确版本，browser 预览仍显式使用内存替身 |
| V8 | v2 异常 fixture、构建门禁与跨案件场景回归 | 待办 | CLI/构建覆盖真实 v2 包；固定路径行为有可重复回归 |

每个 slice 由 worker 实现后由主代理审核 diff、专项测试、边界检查和构建；文档只有在代码
与测试真实达到门槛后才标记完成。

## 当前实现

- `src/content/schema.ts` 是唯一类型源，规则和本地化目录分别由
  `GameContentCatalogSchema` 与 `LocalizedContentCatalogSchema` 推导。
- `validateGameContentCatalog` 和 `validateLocalizedContentCatalog` 是纯函数：输入不变，
  输出诊断按 source/objectId/path/code/message 稳定排序。
- Validator 检查 record key 与稳定 ID、case/node/resolution/attribute/flag/story/ending/asset
  引用、choice ID、progression 条件、ending priority/story、普通/ending story 隔离、案件图、
  asset 安全路径和视频 step 的显式 kind。
- `loadSplitContentPackage` 只接收 `{ source, text }[]` 和可选 inventory；Node 文件读取、目录发现、
  OS 分隔符转换均在 `scripts/validate-content.ts`，不进入纯核心。
- CLI 的无参数入口检查 `content/` 下的 package；也支持 package 目录、packageId 目录和多个参数，
  对 JSON 读取和非 JSON inventory 使用统一诊断输出。
- `FakeSplitContentRepository` 在 register/load 两个边界复验规则和语言包，并返回独立副本；
  `GameSession` 对 Repository 返回的规则目录再次复验。
- `content/minimal-test-package/1.0.0` 是当前 Schema v2 的中英文样本；其中 MP4 是占位资源，
  路径存在不等于媒体可播放。

## 重要决策

1. Schema v2 规则与文本分离：规则目录不含可显示文案，locale 不进入只含 package/version 的
   `ContentRef`；语言切换只改变 presentation load，不改变 GameState。
2. 结构校验先于语义校验。结构失败时跳过依赖结构的遍历，避免级联异常；所有安全可继续发现的
   问题批量返回并稳定排序。
3. Validator 是纯函数。文件系统 inventory、JSON 读取和平台 URL 转换必须停留在 adapter 边界。
4. 记录 key 与对象内部 ID 都是身份的一部分；不把 JavaScript 原型属性当成已声明内容 ID。
5. 案件图用实际有向图算法：从 start 检查可达性，灰边才是环，合流合法；静态检查不复制
   Game Core 的 Predicate 求值或 transition。
6. asset kind 必须显式声明。Validator 不通过扩展名猜测 image/video/audio，不解码媒体；非法
   path 不再级联出 file-missing 诊断。
7. 运行时内容版本必须精确匹配 SaveEnvelope 的 `contentRef`。找不到存档绑定版本时不能静默替换
   最新包。
8. 已发布的 `packageId + version` 不就地修改。Schema 升级必须显式引入兼容版本或迁移。

## 明确不做

- 不实现 Compiler、可视化编辑器、通用规则引擎、脚本语言或任意代码执行。
- 不实现联网下载、热更新、签名分发、在线发布、远程 Provider 或旧包自动清理。
- 不让 Validator 判断叙事质量、法律合理性、选项意义或数值平衡。
- 不复制 Game Core 的 transition、Predicate 求值、属性结算、解锁执行和结局选择。
- 不接管 SQLite/SaveRepository、SaveEnvelope 迁移、Profile、Tauri capability 或媒体播放。
- 不声称静态引用检查能证明所有跨案件路线都可完成；只对固定 fixture 做有限场景回归。

## 后期 TODO

- [x] V7：实现只读物理包 Repository，使用平台提供的文本/目录读取能力，不把 Node `fs` 引入
  Content 核心；加入精确 package/version 和缺失文件错误。
- [x] V7：把桌面 Bootstrap 的 `FakeSplitContentRepository` 替换为 bundled content adapter，
  保留浏览器显式内存预览，且加载失败可见、不能降级吞错。
- [ ] V8：将旧 invalid fixture 改为 Schema v2 多错误样本，纳入正式 CLI 和构建门禁。
- [ ] V8：对三案固定样本补齐 Game Core 的路径穷举与 pending story/ending 回归。
- [ ] 统一 Content Validator 与 `src/platform/assets.ts` 的路径安全规则，避免纯校验通过而平台
  解析拒绝（或反向）的差异。
- [ ] 内容规模增长后，再根据数据决定增量校验、路径覆盖报告或编辑器集成。
- [ ] 发布前人工验证 Windows 安装包、断网、媒体编码/大小/分辨率、CSP 和重启恢复；这不由
  静态 Validator 自动保证。

## 验证命令

```powershell
npx vitest run tests/content
npm run validate:content
npm run typecheck
npm run check:boundaries
npm run build
git diff --check
```

本轮 Storage/Tauri 收口不修改 Content 核心代码；Content 线文档在本次更新中修正了 Schema v2
现状和未完成项，避免把旧 v1 loader 或 Fake Repository 误称为物理桌面运行时。

## 变更日志

- 2026-09-15：初始记录按 Schema v1 分文件 loader 切分 C0–C6。
- 2026-09-15：Localization 线切换到 Schema v2 `game.json + locales/*.json`，原实施记录未同步，
  产生文档漂移。
- 2026-09-16：依据当前 schema、loader、CLI、repository、desktop bootstrap 和 fixture 重新盘点，
  将 V0–V6 标为实际已完成，将物理 Runtime Repository、桌面接入、v2 invalid fixture 和路径规则
  统一列为后续 slice；确认 Storage/Tauri 不依赖 Content 是否已完成。

## GameSession / 真实 Vertical Slice 收口（2026-09-16）

### 本轮目标与切片

在既有架构上补齐读档语义校验、生产内容读取、显式恢复动作，然后联调真实 SQLite 与桌面进程。
本轮沿用现有 `minimal-test-package@1.0.0`，不修改已发布内容版本。

| Slice | 交付范围 | 进度 | 审核门槛 |
| --- | --- | --- | --- |
| S1 | load 不变量检查、无参数 reload、View/UI 恢复入口 | 已审核通过 | 非法状态从不 ready；冲突/不确定提交通过重读恢复，绝不自动重放命令 |
| S2 / V7 | bundled 物理包读取、生产 Repository、桌面默认接线 | 已审核通过 | 精确版本、完整校验、受限文件访问、失败可见；browser preview 显式保留 |
| S3 | 真实磁盘 SQLite 的注册→开始→中间选择→结算→关闭重开 | 已审核通过 | 同一 save/profile，revision 0→1→2→3，history/result/attribute/unlock/story 恢复 |
| S4 | Windows Tauri 可执行程序联调与整体回归 | 已审核通过 | 实际资源/SQL IPC、退出 Profile/重启恢复；区分自动测试与实际运行证据 |

S1 与 S2 文件所有权独立，可并行实施；主代理逐 slice 检查 diff 和专项结果，审核通过后进入联调。
当前工具未暴露用户指定 custom agent 类型配置，使用现有子代理分别承担 custom_explorer（只读探索）
与 efficient_worker（有界实施）职责，没有声称实际加载了不存在的自定义配置。

### 本轮重要决策

- GameSession 在 SaveEnvelope、完整内容校验及 contentRef 匹配之后、ready 之前复用 Game Core
  的 `checkGameStateInvariants`，不复制状态语义规则。
- reload 的身份由 Application 记住；UI 只调用无参数动作，不取得 save/profile 选择权。
- 生产内容适配复用纯 `loadSplitContentPackage`；文件访问停留在 platform/Tauri，Rust 不承载游戏规则。
- 真实 SQLite 回归复用已有 `node:sqlite` 磁盘夹具和 Rust 同一迁移 SQL；关闭重开必须真正释放连接，
  不能只创建第二个对象后声称已验证重启。
- 保留既有 V8（异常 fixture、跨三案穷举）为后期工作，本轮不为完成 GameSession 扩大范围。

### 明确不做与后期 TODO

- 不新增内容编辑器、远程下载、版本迁移、命令队列、自动重试判决、云账号。
- 不把占位 MP4 的路径存在称为可播放验收；播放器/正式媒体属于后续发布验收。
- 不把 Node SQLite 回归称为 Tauri IPC 或安装包验收；分别记录证据。
- 发布安装器、干净机器/断网及真实媒体验收仍需独立验证。

### 验证与审核日志

- 基线：本轮修改前 `npm test`，34 文件 / 287 测试通过。
- 架构路径纠正：用户给出的嵌套路径不存在，实际使用根目录 `Desktop_Case_Game_Architecture_v1.0.md`。

- S1 主审：4 文件 / 41 tests 通过；读档非法属性/node/history 从不进入 ready，reload 共用锁，失败目标不回退旧 Profile。新增剧情提交失败回归，恢复期间移除模态遮挡，失败重读仍可再次点击。
- S2 主审：检查原生 command 与 production composition，相关 app/platform/content 9 文件 / 89 tests 通过，追加 malformed JSON 后定向检查通过；Rust 2/2 测试通过；typecheck 通过。初审发现 Windows junction 可产生包内递归环，worker 已改为显式拒绝所有 reparse points，包括 content/package/version 根目录。
- 原生物理包目录 ID 限制为 ASCII 字母/数字/点/下划线/连字符，并拒绝 Windows 设备名；不影响展示文案。后续如需 Unicode 包目录，应统一 validator/platform 规则后扩展。
- Repository 当前不缓存，读档和语言加载会复验整个不可变包；dispatch 不读取内容文件。缓存仅在内容规模证明有需要时引入，并须保留失败后重试能力。

- S3 主审：新增 `tests/app/desktopVerticalSlice.test.ts`，3 个集成测试独立复跑通过。直接查询原始 SQLite 行验证 revision 0→1→2→3、完整历史、warning 结果、属性 51/51、case_002 解锁、待播剧情；两次真正关闭全部当前连接后重建 bootstrap，保持同 save/profile 且只有一条存档。真实双连接 CAS 冲突恢复与损坏节点无写入拒绝均通过。
- 整体回归：37 文件 / 305 tests、typecheck、模块边界、content CLI、Rust fmt 通过。新 S3 文件格式检查首次失败，交回 worker 修正后复验。
- Windows：`npm run tauri -- build --debug --no-bundle` 成功，生成内嵌 frontendDist 的 debug 可执行文件；实际启动显示 SQLite 本地档案入口，证明 SQL 初始化和 bundled 内容读命令真实通过。完整 UI 操作/重启证据继续记录，不用这一启动结果代替完整验收。


### Windows 真实桌面验收结果（2026-09-16）

使用本轮构建的 `src-tauri/target/debug/eagle-judge.exe`（内嵌生产前端，不依赖 Vite dev server），
通过 Windows UI 真实操作，原生资源读取和 SQL 插件均走正式实现。数据库只读核对使用
`%APPDATA%/com.eaglejudge.app/judge.db`，未通过 SQL 写入代替玩家操作。

| 步骤 | UI / 持久化证据 | 结果 |
| --- | --- | --- |
| 注册 | 新建本地 `Vertical Slice 20260916` Profile；实际 SQL 保存 pending case_001、属性 50/50 | revision 0 |
| 开始案件 | 点击「开始案件」，SQL currentNodeId=assessment、history=[] | revision 1 |
| 中间选择 | 点击「确认违规，继续确定处理方式」，SQL node=disposition、history保留confirm_violation | revision 2 |
| 退出 Profile 再进入 | UI恢复「确定最终处理方式」，同一档案且属性仍50/50 | 不重复开始、不重置历史 |
| 最终选择 | 点击「给予书面警告」，SQL resolutionId=warning、finalChoiceId=formal_warning、resolvedOrder=1、实际变化各+1 | revision 3 |
| 结算联动 | 属性51/51、first_case_closed=true、case_002 pending、story_after_case_001待播；UI弹出「档案室流程调整」 | 原子保存完整状态 |
| 真正关闭进程 | Alt+F4，独立 Get-Process 确认 eagle-judge 已不存在 | 无活进程保留会话 |
| 重启并进入原Profile | 新窗口启动，选择原Profile登录，UI重新呈现待播「档案室流程调整」 | load恢复正确 |
| 重启后只读核对 | 精确saveId、revision=3、属性51/51、warning、case_002 pending、待播队列；只有一条该Profile存档 | 无重复结算/无额外revision |

验收存档 identity：
- profileId：`profile-cf93bbd9-b293-467f-98bd-ef45fb8e5636`
- saveId：`save:profile-cf93bbd9-b293-467f-98bd-ef45fb8e5636:default`
- contentRef：`minimal-test-package@1.0.0`
- 最终结算时间：`2026-09-16T08:05:28.108Z`

测试 Profile 留在本机供复核；未删除用户数据。最终验收点保留待播剧情，未将剧情完成额外计入
本轮0→3的revision链路。工具过程中遇到鼠标主键映射与UIA焦点读取差异，通过窗口重选、键盘
和实际可用主键操作继续完成；这属于自动化输入适配，没有修改应用业务逻辑。

最终验证：37 个测试文件 / 305 tests、TypeScript、模块依赖边界、Prettier、content CLI、
Rust 2 个资源读取测试、Rust fmt、git diff 检查通过；Tauri debug build 通过。
首次格式检查仅新集成测试文件失败，worker 格式化后全量格式复查通过。

### 本轮完成后保留的 TODO

- V8 异常 v2 fixture 与跨三案路径穷举，仍按原计划后续推进。
- 统一纯 Validator 与平台路径规则，尤其包目录ASCII约束与资源路径规则。
- 安装器/干净Windows环境/断网发布验收；本轮验证是带打包资源的真实debug桌面进程，
  不是安装器验收（现有 `bundle.active=false` 未改动）。
- 替换54字节MP4占位资源并完成真实媒体播放验收。
- 观察包规模后再决定是否缓存，当前按精确版本完整读取校验、失败可重试。
