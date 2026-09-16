# Content / Validator 线实施记录

**基线：** `Desktop_Case_Game_Architecture_v1.0.md`  
**当前状态：** Schema v2 的纯校验、分文件 loader、CLI 和 Fake Repository 已完成；物理内容包运行时接入尚未完成。  
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
| V7 | 物理 Runtime Repository 与桌面 Bootstrap 接入 | 待办 | Tauri 桌面从 bundled content 加载精确版本，browser 预览仍显式使用内存替身 |
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

- [ ] V7：实现只读物理包 Repository，使用平台提供的文本/目录读取能力，不把 Node `fs` 引入
  Content 核心；加入精确 package/version 和缺失文件错误。
- [ ] V7：把桌面 Bootstrap 的 `FakeSplitContentRepository` 替换为 bundled content adapter，
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
