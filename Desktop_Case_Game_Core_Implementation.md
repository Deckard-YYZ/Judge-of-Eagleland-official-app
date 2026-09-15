# Game Core 线实施记录

**基线文档：** `Desktop_Case_Game_Architecture_v1.0.md`  
**状态：** 已完成  
**开始日期：** 2026-09-15
**完成日期：** 2026-09-15

## 目标

在 `src/game/` 中完成确定性的纯 TypeScript 游戏核心。核心只接受
`ContentCatalog + GameState + GameCommand + TransitionContext`，返回
`TransitionResult`；不依赖 React、Tauri、SQLite、DOM、系统时间或随机数。

最终必须能在 Node + Vitest 中走完最小内容包的完整流程：开始案件、分支选择、
最终结算、属性截断、快照、解锁、普通剧情、结局选择及剧情完成。

## 当前基线

- `src/content/schema.ts` 已定义内容契约。
- `src/game/model.ts` 已定义状态与存档契约。
- `src/game/commands.ts` 已定义命令、错误码和 transition 签名。
- `src/game/selectors.ts` 是当前工作树中已有的领域 selector；审核后复用，不重写。
- `src/app/demoTransition.ts` 是前端线的完整 mock，只作为行为参考；正式规则必须位于
  `src/game/`，后续让 demo 装配转发到正式实现。
- 2026-09-15 基线验证：`npm run check` 通过，7 个测试文件、32 个测试通过。
- 开工时工作树已有前端线未提交修改；Game Core 实施不得覆盖或回滚这些改动。

## Slice 计划与进度

| Slice | 内容 | 依赖 | 状态 | 审核门槛 |
| --- | --- | --- | --- | --- |
| G0 | 架构盘点、边界确认、实施文档、基线测试 | 无 | 已完成 | 文档与现状一致；基线 `npm run check` 通过 |
| G1 | 初始状态工厂；内容感知的 GameState invariants | G0 | 已完成 | 覆盖 S1-S8 中可由纯核心验证的约束；无输入修改 |
| G2 | Predicate/Condition、resolved count、unlock/story/ending 规则 | G1 | 已完成 | 单元测试覆盖单向解锁、去重、稳定排序、优先级选择 |
| G3 | `transition` 路由、`startCase`、中间 `chooseOption`、`completeStory` | G1 | 已完成 | 错误码、旧节点拒绝、剧情阻塞、结束态、队首完成均有测试 |
| G4 | 最终 `chooseOption`、属性结算、snapshot、unlock/story/ending 原子组合 | G2、G3 | 已完成 | 属性截断记录 actualDelta；结算顺序正确；重复结算无副作用 |
| G5 | selectors 审核补测；demo/application 切换到正式 core；全流程 Vitest | G4 | 已完成 | 无 UI/Tauri/SQLite 完整走完两案和结局；现有前端 contract 不破坏 |
| G6 | 不变量与纯函数硬化、全量回归、边界/格式检查、文档收口 | G5 | 已完成 | `npm run check` 全通过；实施记录与代码一致 |

每个 slice 由 `efficient_worker` 实施。主代理逐个审查 diff、运行目标测试和全量检查；
只有审核通过后才把该 slice 标为完成并继续下一个。由于这些 slice 会连续修改相同的
状态与规则模块，本轮默认串行，不并行制造合并冲突。

## 重要决策

1. **正式规则归属 `src/game/`。** `src/app/demoTransition.ts` 不继续承载业务规则。
2. **所有操作统一经过 `transition()`。** UI 或 Application 不直接解释 choice target、
   属性效果、解锁条件或结局条件。
3. **纯函数与不可变更新。** 不修改传入的 state/content；时间只从 `context.nowIso` 注入。
4. **最终选择一次性原子计算。** history、属性、flags、resolution snapshot、解锁、剧情队列
   和 ending phase 必须出现在同一个 `nextState` 中。
5. **不变量分层。** Zod 负责 JSON 形状和局部集合约束；Game Core 的内容感知检查负责
   ID 引用、属性范围、案件进度、剧情队列及 phase 之间的一致性。S9/S10 属于
   Application/Storage 的提交与 revision 边界，不伪装成纯 GameState 检查。
6. **规则顺序确定。** 普通剧情按 `order`、再按 rule ID；结局按 priority 降序选择。
   内容校验仍应保证结局优先级唯一，运行时排序只提供确定性防线。
7. **历史快照不重算。** resolved 案件回看只读取保存的 snapshot；selector 不施加效果。
8. **复用现有 selector。** 只在审查发现契约缺口时做小幅补强，避免破坏前端线改动。

## 明确不做

- React 组件、Zustand 状态、Tauri 命令、SQLite 写入或迁移。
- 通用事件总线、事件溯源、脚本语言、规则插件系统或工作流引擎。
- 撤销、回退、重判、重复结算、操作排队或自动重试最终选择。
- 中间选择修改全局属性；首版效果只存在于 resolution。
- 运行时随机数、隐式系统时间、Date/Map/Set/函数等不可序列化状态。
- 内容远程更新、云账号、移动端或表现层动画/视频播放实现。
- 在 Game Core 内处理持久化成功、revision 冲突或 UI 反馈播放失败。

## 审核清单

- `game/` 只依赖自身和内容类型/纯数据，不依赖 app/application/ui/storage/platform。
- 所有失败返回现有 `TransitionErrorCode`，且失败不修改输入状态。
- 成功结果能通过 `GameStateSchema` 和内容感知 invariants。
- resolved history 含最终选择；`resolvedOrder` 等于结算前 resolved 数量加一。
- attribute snapshot 使用实际变化；文本快照不共享可变数组引用。
- unlock 单向且去重；普通 story 每局一次；ending story 不被重复排队。
- pending story 阻塞案件推进；只能完成队首；ending 队列清空后进入 ended。
- selector 只从权威 `state.cases` 派生，不维护重复列表。
- 关键规则写“为什么”的标准注释，避免逐行翻译代码。
- 目标测试、`npm run typecheck`、`npm run check:boundaries`、`npm run format:check` 通过。

## 后期 TODO（不属于本轮 Game Core）

- Content Validator：跨文件引用、节点图无环/可达/终止、结局 priority 唯一、剧情与资源约束。
- Save Schema 迁移与加载时内容版本引用验证。
- Application 层保存成功后发布、未知提交结果重载、revision 冲突处理。
- 至少一组真实 SQLite 条件提交测试。
- 正式内容包路径穷举和实际桌面安装包验收。
- 若以后引入中间选择效果或随机规则，先扩展显式契约、存档和测试，不在 UI 回调中旁路。

## 最终验证

| 检查 | 结果 |
| --- | --- |
| Game Core 测试 | 7 个文件、86 项测试通过 |
| 最小内容包路径 | 3 个第一案结果 × 2 个第二案结果，共 6 条路径全部通过 |
| 全仓 `npm run check` | 15 个文件、125 项测试；typecheck、边界与 Prettier 全通过 |
| `npm run build` | 通过；Vite 生产构建成功 |
| `git diff --check` | 通过 |

正式实现位于 `src/game/initialization.ts`、`invariants.ts`、`progression.ts`、
`resolution.ts`、`transition.ts` 与 `selectors.ts`。`src/app/demoTransition.ts` 只保留
指向正式 `transition` 的兼容导出，不再维护第二套规则。

## 变更日志

- 2026-09-15：建立实施记录；确认工作树已有前端线改动；完成基线检查与 slice 切分。
- 2026-09-15：G1 审核通过。新增 `initialization.ts` / `invariants.ts` 和 12 个专项测试；
  初始引用使用显式 issue list，状态检查复用 `GameStateSchema` 并增加内容感知约束。
  主代理复跑专项测试、typecheck、依赖边界和 G1 文件格式检查均通过。全仓格式检查
  受同期前端线 3 个文件影响，未对这些非 G1 文件做批量格式化。
- 2026-09-15：G2 审核通过。新增 `progression.ts` 和 24 个专项测试；条件求值不会
  用短路隐藏损坏引用，unlock/story/ending 分别固定去重、稳定排序和优先级行为。
  主代理复跑专项测试、typecheck、依赖边界和 G2 文件格式检查均通过。
- 2026-09-15：G3 审核通过。新增正式 `transition.ts` 及 15 个专项测试；固定 phase、
  story blocking、案件状态、stale node 和 choice 的拒绝顺序，中间选择与剧情完成均为
  不可变更新且成功输出重新检查 invariants。最终 resolution 只保留单一 seam，等待 G4。
  主代理复跑专项测试、typecheck、依赖边界和 G3 文件格式检查均通过。
- 2026-09-15：G4 经一次 review fix 后审核通过。新增 `resolution.ts` 和最终结算测试；
  属性变化按 ID 确定排序并记录 actualDelta，快照、解锁、普通剧情与 ending 在一个候选
  状态中原子生成。审核发现并修正 settlement 信任调用方自报 `choiceText/resolutionId` 的
  问题，现在只接受 case/node/choice ID 并从 Catalog 派生结果。主代理复跑 37 个
  G4/transition 测试、75 个 Game Core 测试、typecheck、依赖边界和格式检查均通过。
- 2026-09-15：G5 审核通过。app demo 的重复规则被替换为正式 `transition` 兼容导出，
  demo 新局改用正式初始化工厂；selectors 完成确定排序和防御行为补测；新增两条详细
  无 UI 端到端路径。主代理复跑专项测试、全量 `npm run check` 与生产构建均通过。
- 2026-09-15：G6 审核通过并收口。progression 不再依赖 locale 排序，invariants 增加
  ending story 与 phase 的静态一致性检查，固定内容包 3×2 六路径矩阵全部通过。
  最终由主代理确认 86 项 Game Core 测试、125 项全仓测试、typecheck、依赖边界、
  Prettier、Vite build 与 `git diff --check` 全部通过。
