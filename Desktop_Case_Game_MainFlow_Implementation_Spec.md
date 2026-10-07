# 主流程一次交付实施规格

更新日期：2026-10-05。最新决定：底层已交付，正式 UI 接入暂缓；普通入口恢复原 Demo/minimal-test-package@1.2.0 与关闭自动教程。新流程通过 DEV 诊断面板的“主流程验证”按钮进入独立内存测试；聊天/新闻实验呈现仅供 debug，正式 UI 适配另开会话。此决定取代本规格先前的默认迁移要求。

2026-10-05 回退前历史验收（不代表当前默认入口）：默认切换后普通回归 617 项通过；五项真实 Luban 集成独立全部通过，合计 622 项唯一测试执行通过。双 TypeScript、voice、边界、格式和前端构建通过，普通默认入口及两条三案浏览器路径已实际验证。TTS 资源缺失仍限制完整桌面验证；具体证据与范围见 [实施记录](Desktop_Case_Game_Configuration_Implementation.md)。

本规格把实施记录中的四阶段合成一次可验收交付，依赖顺序为新内容契约与作者模型 → Core、Session 与存档 → UI 与账号入口 → 真实表格短流程及默认迁移。产品语义以 `Desktop_Case_Game_Product_Requirements.md` 为准；本规格只落实接口及验收，不补充待决定玩法。

## 范围和版本边界

- 新运行包使用 content schema **6**，新增 `GameContentCatalog.mainFlow` 和对应本地化。运行时权威仍是 Zod，TypeScript 类型由 Schema 推导。
- 新存档使用 save schema **5**，新增可选 `GameState.mainFlow`。schema 6 内容必须有该状态，旧内容没有该状态。v1–v4 旧档只作结构迁移，不伪造主流程事实，读取不改数据库行，下一次成功 CAS 才保存 v5。
- schema 2–5 原包、精确 `contentRef` 绑定及旧查询语义继续保留。schema 5 的 `configuration.flow`、`chatLastNode`、`externalBranches` 仍是旧实验能力，不能作为新主流程执行入口。schema 6 禁止配置旧 `configuration.flow`，但复用已有 instructions、case action hooks、stories 和动作输入。
- 普通新用户/新存档恢复 `minimal-test-package@1.2.0`，自动教程关闭；独立 `mainflow-short@0.1.0` 仅由 DEV debug 入口显式选择，使用内存仓库且保留教程；旧存档不重绑、不自动重开。pilot 和 complete 保持 schema 5 及原用途。
- 整套结局业务（新结局触发、清理在途交互、演出后注销接线、结局账号重登）**不在本次四阶段实现范围**。演出完成返回登录是已确认规则，留到结局接入实现；本轮短流程不配置结局，主图无后继只代表样本走完，不结束登录或游戏。不得把旧归档工作区行为描述为符合该规则。

## 冻结的内容接口

以下为字段规格，不是另立一份手写运行时类型。所有 ID 非空，所有对象禁止未声明字段。

`mainFlow = { initialNodeId, nodes, chats, casePools, news, tutorialStoryId? }`，各集合使用稳定 ID 作 record 键。tutorialStoryId 显式引用教程 story，正式初始内容中不自动排入教程，由账号入口按首次资格配置初始化队列。

| 对象               | 字段                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 主控 node          | `stageId: string`，`onEnter: MainFlowIntent[]`，`transitions: { id, when, targetNodeId }[]`                                                                                                                                    |
| 条件               | `{ all: MainFlowPredicate[] }` 或 `{ any: MainFlowPredicate[] }`，数组非空                                                                                                                                                     |
| predicate          | 复用已有 Predicate；另加 `{ type: 'mainNode', nodeId }`、`{ type: 'chatResult', instanceId, resultId }`                                                                                                                        |
| intent             | `{ type: 'openPool', poolId }`、`{ type: 'dispatchCase', caseId }`、`{ type: 'dispatchPool', poolId, strategy: { type: 'ordered', caseIds } }`、`{ type: 'startChat', instanceId, chatId }`、`{ type: 'publishNews', newsId }` |
| casePool           | `{ members: { caseId, when: MainFlowCondition }[] }`                                                                                                                                                                           |
| chat               | `{ characterId, startNodeId, nodes, inactivity?: { choiceThreshold, resultId } }`；阈值正整数、无默认值                                                                                                                        |
| chat message node  | `{ type: 'message', replies: { id, targetNodeId }[] }`，至少一条回复                                                                                                                                                           |
| chat terminal node | `{ type: 'terminal', resultId }`                                                                                                                                                                                               |
| news               | `{ actionStoryId?: string }`，若有则引用既有含 actionInput 的不可跳过 story                                                                                                                                                    |

`chatResult` 的 `instanceId` 指本图某一条 startChat 意图声明的完整事件实例，避免同一聊天模板后续再次使用时混淆结果。每个 instanceId 在图中唯一声明，一局启动一次；可用不同 instanceId 重用模板。终止节点 resultId 与 inactivity.resultId 是此模板的合法结果全集。主控不能读取 active node、聊天回复或临时计数；聊天节点没有主控 intent、外部案件分支或任意 effects。

主图使用有限 DAG（允许分支、汇合，不限定阶段数量），校验拒绝循环；本次不用访问次数上限或静默停止解决循环。一个主节点进入一次，其 onEnter 只执行一次。转移无匹配则等待，唯一匹配则进入后继并继续评估，多匹配保留 `needsDecision`，不按数组顺序选第一条。主图冲突不回滚此前有效案件选择，也不执行任何冲突后继。

池开放与派发分离：openPool 只记录开放；候选同时满足开放、member.when、案件尚未派发。dispatchPool 的 ordered 仅是样本显式选择策略，绝不是正式池规则默认值。dispatchCase 是明确指定案件。已派发案件不重复添加。一个节点不允许同时声明多个派发 intent，避免借 intent 排序暗中定义冲突规则；本轮样本每次派发唯一且池非空。运行时空池保留 `needsDecision: emptyPool` 的事实与诊断，不结束游戏，不伪造案件，不规定正式玩家界面文案。

schema 6 样本不混用旧 unlockRules/dispatchRules 与主控派发（为空）；配置器对此作校验，避免引入两套派发优先级。旧 case action hooks 和 instructions 可并存并复用。

本地化新增 `mainFlow: { chats, news }`：`chats[chatId] = { title, nodes: { [nodeId]: { blocks: TextBlock[], replies: { [replyId]: string } } } }`；terminal 也有 blocks。2026-10-05 表现层确认：业务结束立即提交结果，UI 将终止消息保留 3–5 秒后被动关闭，不增加必须点击关闭的屏幕。`news[newsId] = { title, blocks: TextBlock[] }`。人物沿用案件中的 case.characters 定义及既有人物文案引用，按 characterId 聚合查找。每种声明语言完整校验消息、回复、新闻；规则对象无直接显示文案。

## 存档、结果与执行次序

`state.mainFlow` 冻结字段如下：

```ts
{
  currentNodeId: string;
  enteredNodeIds: string[];
  openPoolIds: string[];
  chats: Record<string, {
    chatId: string;
    currentNodeId: string;
    history: { nodeId: string; replyId: string }[];
    inactivityChoices: number;
  }>;
  chatResults: Record<string, {
    chatId: string;
    resultId: string;
    terminalNodeId: string | null;
    reason: 'normal' | 'inactivity';
  }>;
  publishedNewsIds: string[];
  readNewsIds: string[];
  dispatches: { nodeId: string; caseId: string }[];
  needsDecision: null | {
    reason: 'transitionConflict' | 'emptyPool';
    nodeId: string;
    candidateIds: string[];
  };
}
```

`chats` 只含活动实例，完成后原子移出并写 chatResults；两者键不能重叠，完成结果不可改写。history 存稳定节点/回复引用，UI 由内容重建已收到消息和玩家回复；不保存翻译文字或现实时间定时器。normal 结果保存真实 terminalNodeId，inactivity 为 null，绝不伪造抵达某个局部终止节点。案件判决事实复用 cases 中 resolved progress，不能另建可漂移的判决副本。

新游戏初始化进入 initialNode，执行其意图和唯一可达转移；完整候选首次保存成功后才能呈现。恢复只校验和投影已存状态，绝不重新执行 onEnter 或重放结果。

一次有效 `chooseOption`：先验证并完成既有案件转换；仅对**该命令开始时已活动**的每个聊天各加一，终判选项也只加一（不因 choiceCompleted + caseResolved 两事件加两次）；达到阈值者同时发布结果；复用案件 hook；随后主控读取全部新判决/结果，求出推进、开放、派发和新聊天。该次选择新启动的聊天计数为零。打开案件、失败/过期选择、浏览、等待、退出及离线时间均不计数。

一次有效 `replyChat`：匹配 instanceId/current node/reply；保存选中文本对应的 history 记录，当前实例计数归零，进入目标节点；若为 terminal 则发布正常结果，随后主控评估。非终止回复只推进局部，不能触发基于聊天临时位置的主控变化。回复一个实例不重置其他实例。多个同时阈值结束的结果先全部形成，再评估主控，避免遍历顺序成为玩法。

所有候选案件、聊天、计数、结果、主图位置、已进入节点、news read、story 队列和派发事实，沿现有 Session 一次 CAS 共同保存。CAS 成功后才发布新快照和 feedback；失败或版本竞争保留原快照且不提前关闭聊天、显示新案件或动作。重发过期回复使用 `STALE_CHAT_REPLY`，已读新闻重发使用 `NEWS_ALREADY_READ`，不重复提交业务结果。不是通过重试或吞异常实现幂等。

## commands 与 UI projection

保持现有 Session.dispatch 和 GameSessionView.dispatch 签名，增加：

```ts
{ type: 'replyChat', instanceId: string, nodeId: string, replyId: string }
{ type: 'readNews', newsId: string }
{ type: 'dismissTutorial', storyId: string }
```

其余案件、story 和动作命令继续复用。新增失败码 `STALE_CHAT_REPLY`、`INVALID_CHAT_REPLY`、`NEWS_NOT_AVAILABLE`、`NEWS_ALREADY_READ`、`INVALID_TUTORIAL_DISMISSAL`。dismissTutorial 只允许 mainFlow.tutorialStoryId 指定且当前仍在队列的教程，原子移出队列、写 completedStoryIds 并清除该教程 checkpoint；允许未完成教程动作，绝不允许跳过普通 story。UI 不直接改 state 或调用内部 compute。

`src/application/gameContentView.ts` 的 `GameContentView` 增加可选 `mainFlow`，形状为上述本地化的 `chats`、`news`，并在 chat view 追加 `characterName: string`，mainFlow view 同时给 `tutorialStoryId?: string`。这只是呈现数据，不暴露 target、condition、intent。`src/application/gameSessionView.ts` 不另改快照顶层形状；UI 用 `snapshot.state.mainFlow.chats` 和 `snapshot.content.mainFlow` 重建 transcript，用当前节点的 replies 显示按钮；实例键为 React identity。commands 定义在 `src/game/commands.ts`，state 在 `src/game/model.ts`。若后续抽出纯投影 helper，由 core 线提供，字段语义不变。

聊天 Overlay 是工作区内非 modal 层，不加入阻塞案件的 `modalActive` 条件；无打开、折叠、关闭或输入文本入口。活动多个实例全部可用，各自滚动和回复。save pending 复用全局提交禁用行为，保存失败仍显示原节点。语言切换不改存档、计数或指示框计时。真正强制 ActionInput 仍按现有阻塞交互规则处理，不用聊天 Overlay 绕过。

新闻在 publishNews 后可阅读。2026-10-05 表现层确认：新闻为最高层大型 Overlay，关闭按钮、框外点击（以及键盘 Escape）统一提交 readNews，替代此前独立的“阅读完成”按钮；成功保存 readNewsIds 并把 actionStoryId 排入既有 story 队列后才关闭并出现 ActionInput。只是打开新闻不触发动作；无 actionStoryId 则只记录阅读。重登已读新闻不重复入队，未完成动作沿 storyCheckpoint 恢复。发布新闻与完成阅读是两个不同事实。UI 按发布顺序展示首条未读新闻；已有教程或强制动作时暂缓下一条，保持 readNews 的 STORY_BLOCKING 约束。

既有 story 队列按 storyId 唯一消费，本次不引入 story 实例框架。因此 schema 6 校验每个 news.actionStoryId 必须为该新闻独占，禁止与其他新闻、initial.storyIds、storyRules、case action hooks、tutorialStoryId 或 ending.storyId 共用，冲突给来源诊断。tutorialStoryId 同样必须独占，不可与 initial、storyRules、case action hooks、新闻或 ending 共用，以免教程完成吞掉正式动作。样本 N 使用专用 action story。不可通过队列去重静默吞掉第二次业务动作。

指示框复用 instructions 和现有 DecisionPanel：每轮选项呈现后启动配置的 1000–2000ms delay，选择后移除，不强制服从；hover 注释保留。ActionInput 复用 StoryOverlay、ActionInput 与 submitStoryInput；样本不配置 wrongEffects，不新增错误处罚，不把动作结果写入主控条件。

## 账号教程

教程标记是账号属性，不能藏在某个 save、临时认证 UI 或仅内存变量。在 ProfileRepository 增加 `getTutorialCompleted(profileId): Promise<boolean>`、`markTutorialCompleted(profileId): Promise<void>`，SQLite 和浏览器账号适配器都必须实现。新增持久表 `profile_tutorials(profile_id PRIMARY KEY REFERENCES profiles(profile_id), completed INTEGER NOT NULL)`；迁移将已有账号标记已完成，新增账号从未完成开始。数据库 schema 版本按现有迁移序号递增，与 save schema 分开。

首次新账号进入：检查未完成，将配置教程加入初始候选队列并成功保存，**先持久 markTutorialCompleted 成功，再呈现教程**，把“进入即消耗首次机会”定义为工程完成标记时机。这样正常完成、显式退出、关应用/崩溃发生在教程呈现后都不重复出现，符合中途退出视为完成。存储失败不进入教程/工作区并显示既有入口错误；不能先显示再异步丢标记。用户尚未进入系统只注册账号则仍未完成。沿用现有教程组件和输入练习，不套用正式 ActionInput 的不可退出规则。

入口读取 completed=true 但已存队列仍残留教程时，必须先经 Session.dispatch(dismissTutorial) 成功清理，再把 session 返回 UI，故异常关应用也不会恢复阻塞教程。completed=false 且已有教程队列（上次账号标记写失败）保留该队列，重试账号完成标记后才公开 session。正常教程结束沿用 completeStory；中途“退出教程”或“退出登录”先成功提交 dismissTutorial 才关闭教程/退出 UI。CAS 失败保留当前界面并提示已有保存错误，不先注销。本规则与账号完成标记搭配，账号标记不是替代存档队列清理。

## 作者链和短流程

新增独立作者包 `mainflow-short`，使用真实 XLSX 定义主控节点、转移、意图、池成员、聊天模板/实例、无交互阈值、新闻；复杂局部图与双语长文可用结构化文件，但字段权威只有一处。Luban 中间模型 → TS 组装 → schema 6 校验 → 正式加载器。注册 `content:check-all`；生成错误提供源文件、对象与字段，表格尽量带 sheet/row/column。沿用现有原子目录发布，不以直接覆盖有效产物或 hash 清单替代失败保护。

最低短流程采用显式互斥分支：

1. initial 主节点派发至少三轮案件 A、启动 chat-a/instance-a，并发布新闻 N（读完需一次动作）。首轮可配置一个指示框和 hover。三轮包含最终判决选择，确保首轮后回复重置仍有两次选择达到阈值，不依赖尚未派发的 B。
2. chat-a 有至少两轮回复，首条回复不结束；样本阈值明确为 2。搁置选 A 第一轮计数 1；回复归零；继续案件有效选项可达到阈值，也可回复到 normal result。
3. 主控分别以 instance-a 的 normal/ignored 结果进入互斥节点，开放池 P 并显式 ordered 派发 B；不能把“normal 已出现”和一个可能同时成立的泛属性条件当作互斥。
4. 进入特殊节点同时启动 instance-b 与 instance-c，二者样本阈值为 2；B 至少三轮，第一轮各加一，回复 b 后 b=0/c=1，第二轮 c 阈值结束而 b=1，第三轮 b 阈值结束。两个结果再决定后续主节点，显式派发 C。样本选择轮数须足以实际演示重置后再次达到阈值，不能只靠测试注入。
5. 另一路实际点击完成正常聊天终止，显示结果驱动内容；末节点无后继、无结局配置。mainFlow 图可有多个节点共用 stageId，至少展示一次跨阶段。

只有用于样本的阈值、ordered、动作和剧情数值可固定，不提升为全局玩法。

## 依赖并行与文件 ownership

| 工作线                | 独占文件与职责                                                                                                                                                                                | 依赖                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| spec/core worker      | 本规格；`src/content/schema.ts`；`src/game/**`；`src/application/**`；`src/storage/**`；对应 game/application/storage tests                                                                   | spec 审核后先落公共 Schema/commands/view/账号接口，再完整 Core 与 CAS    |
| UI/entry worker       | `src/app/**`、`src/ui/**`、`src/main/**`、bootstrap/auth 入口、app/ui tests                                                                                                                   | 冻结字段即可并行；browser profile adapter按账号接口接入；新默认最后开关  |
| author/content worker | `scripts/content/**`、`content-authoring/**`、`content/**`、`src/content/validate*.ts` 及其他内容加载/本地化校验文件、content tests、package scripts、实施记录、bundledRepository.ts 默认引用 | 按冻结 schema 制表；不得与 core 同改 schema.ts；默认引用等验收通知再切换 |
| root 协调             | 最终回归与浏览器验收、默认迁移批准，不改源码                                                                                                                                                  | 各线停写后统一验收                                                       |

数据库 Rust migration 注册与 SQL migration 文件交由 UI/entry worker实现（schema 定义与 ProfileRepository 由 core），落笔前通报迁移编号与表结构。共同触及文件先发消息确认 owner，禁止相互覆盖。已有 dirty/untracked 均保留；不 reset、commit、push，不作常规 hash 检查。

## 一次交付验收门槛

1. 审核 spec，冻结上述跨线接口；允许实现过程中经三线通报修正文档，不允许静默漂移。
2. Schema/作者：实际 XLSX 成功生成 schema 6，双语完整；未知引用、chat 内主控效果、旧 externalBranches、非法主图循环、坏结果引用、缺语言拒绝且已有输出不被破坏；schema 2–5 回归保持。
3. Core：回复推进/重置、选项计数一次、阈值结果、两个并行实例独立、新启动实例不吃本次选择、主控只读结束结果、池资格不等于派发、冲突待决、无后继非结局。
4. Session/SQLite：真实 CAS 覆盖保存失败与竞争；在进行中、回复后、阈值结果后、派发后、news read 后恢复不重放；离线不推进；v1–v4 读不写、成功提交升 v5且 contentRef 不变。
5. UI/entry：普通单聊天和显式多聊天可搁置判案，无主动开关；当前聊天回复文本入记录；强制动作完成；新闻读完触发一次；新账号首次教程及中途退出后不重复；旧账号不强制重放教程。
6. root 在真实生成包、真实 Session/SQLite 与浏览器完成上述短流程及两种结束分支，再切换默认包并复核新账号绑定。未经该门槛默认仍为 1.2.0。

标准命令（Node 24 PATH，LUBAN_ROOT 由环境指定，不提交本机路径）：

```powershell
npm run typecheck
npm test -- --maxWorkers=2
npm run content:check-all
npm run validate:content
npm run check:boundaries
npm run voice:check
npm run format:check
npx prettier --check Desktop_Case_Game_MainFlow_Implementation_Spec.md
npm run build
```

普通测试跳过的真实 Luban 集成必须在设置 LUBAN_ROOT 后单独运行，并在实施记录列实际文件、命令、通过数量和跳过原因。新验收不得复用历史 572 项数量声明完成。生产产物不得静态携带 pilot/complete 作者生成模型或开发入口。

## 保留的待决边界

正式池策略、多个派发规则冲突、空池玩家体验、主控多条件同时满足的选择规则、ActionInput 错误机制、结局重登以及结局时未完成交互处置仍待决定。当前样本用唯一派发、非空池及互斥转移走通，异常输入或运行时冲突明确暴露原因，不自动补优先级、随机、派发全部、默认结局或静默返回。
