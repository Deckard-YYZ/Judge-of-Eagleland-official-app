# 主流程运行时契约

核对日期：2026-10-15。本文维护主控、聊天、新闻和教程的现行技术契约；产品语义见 [产品需求](../product/requirements.md)，当前入口和实施状态见 [文档索引](../README.md)。

原交付分工、样本验收计划和默认迁移要求保留在 [历史实施规格](../archive/design/main-flow-implementation-spec-2026-10-05.md)。

## 范围和版本边界

- 新运行包使用 content schema **6**，新增 `GameContentCatalog.mainFlow` 和对应本地化。运行时权威仍是 Zod，TypeScript 类型由 Schema 推导。
- 新存档使用 save schema **5**，新增可选 `GameState.mainFlow`。schema 6 内容必须有该状态，旧内容没有该状态。v1–v4 旧档只作结构迁移，不伪造主流程事实，读取不改数据库行，下一次成功 CAS 才保存 v5。
- schema 2–5 原包、精确 `contentRef` 绑定及旧查询语义继续保留。schema 5 的 `configuration.flow`、`chatLastNode`、`externalBranches` 仍是旧实验能力，不能作为新主流程执行入口。schema 6 禁止配置旧 `configuration.flow`，但复用已有 instructions、case action hooks、stories 和动作输入。
- 主图无后继只表示图走完，不等于整局结局。结局产品语义见 [产品需求](../product/requirements.md)；实施边界见 [文档索引](../README.md)。

## 内容接口

以下为现行字段契约，运行时定义以 [content Schema](../../src/content/schema.ts) 为唯一类型源。所有 ID 非空，所有对象禁止未声明字段。

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

主图使用有限 DAG（允许分支、汇合，不限定阶段数量），校验拒绝循环；不以访问次数上限或静默停止代替循环校验。一个主节点进入一次，其 onEnter 只执行一次。转移无匹配则等待，唯一匹配则进入后继并继续评估，多匹配保留 `needsDecision`，不按数组顺序选第一条。主图冲突不回滚此前有效案件选择，也不执行任何冲突后继。

池开放与派发分离：openPool 只记录开放；候选同时满足开放、member.when、案件尚未派发。dispatchPool 的 ordered 仅是样本显式选择策略，绝不是正式池规则默认值。dispatchCase 是明确指定案件。已派发案件不重复添加。一个节点不允许同时声明多个派发 intent，避免借 intent 排序暗中定义冲突规则；短流程样本每次派发唯一且池非空。运行时空池保留 `needsDecision: emptyPool` 的事实与诊断，不结束游戏，不伪造案件，不规定正式玩家界面文案。

schema 6 样本不混用旧 unlockRules/dispatchRules 与主控派发（为空）；配置器对此作校验，避免引入两套派发优先级。旧 case action hooks 和 instructions 可并存并复用。

本地化新增 `mainFlow: { chats, news }`：`chats[chatId] = { title, nodes: { [nodeId]: { blocks: TextBlock[], replies: { [replyId]: string } } } }`；terminal 也有 blocks。业务结束立即提交结果，UI 将终止消息保留 3–5 秒后被动关闭，不增加必须点击关闭的屏幕。`news[newsId] = { title, blocks: TextBlock[] }`。人物沿用案件中的 case.characters 定义及既有人物文案引用，按 characterId 聚合查找。每种声明语言完整校验消息、回复、新闻；规则对象无直接显示文案。

## 存档、结果与执行次序

`state.mainFlow` 字段如下：

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

通过既有 Session.dispatch 和 GameSessionView.dispatch 提交以下命令：

```ts
{ type: 'replyChat', instanceId: string, nodeId: string, replyId: string }
{ type: 'readNews', newsId: string }
{ type: 'dismissTutorial', storyId: string }
```

其余案件、story 和动作命令继续复用。相关失败码 `STALE_CHAT_REPLY`、`INVALID_CHAT_REPLY`、`NEWS_NOT_AVAILABLE`、`NEWS_ALREADY_READ`、`INVALID_TUTORIAL_DISMISSAL`。dismissTutorial 只允许 mainFlow.tutorialStoryId 指定且当前仍在队列的教程，原子移出队列、写 completedStoryIds 并清除该教程 checkpoint；允许未完成教程动作，绝不允许跳过普通 story。UI 不直接改 state 或调用内部 compute。

`src/application/gameContentView.ts` 的 `GameContentView` 提供可选 `mainFlow`，形状为上述本地化的 `chats`、`news`，chat view 同时提供 `characterName: string`，mainFlow view 同时给 `tutorialStoryId?: string`。这只是呈现数据，不暴露 target、condition、intent。UI 用 `snapshot.state.mainFlow.chats` 和 `snapshot.content.mainFlow` 重建 transcript，用当前节点的 replies 显示按钮；实例键为 React identity。commands 定义在 `src/game/commands.ts`，state 在 `src/game/model.ts`；投影 helper 保持这些字段语义。

聊天 Overlay 是工作区内非 modal 层，不加入阻塞案件的 `modalActive` 条件；无打开、折叠、关闭或输入文本入口。活动多个实例全部可用，各自滚动和回复。save pending 复用全局提交禁用行为，保存失败仍显示原节点。语言切换不改存档、计数或指示框计时。真正强制 ActionInput 仍按现有阻塞交互规则处理，不用聊天 Overlay 绕过。

新闻在 publishNews 后可阅读。新闻为最高层大型 Overlay，关闭按钮、框外点击（以及键盘 Escape）统一提交 readNews，替代此前独立的“阅读完成”按钮；成功保存 readNewsIds 并把 actionStoryId 排入既有 story 队列后才关闭并出现 ActionInput。只是打开新闻不触发动作；无 actionStoryId 则只记录阅读。重登已读新闻不重复入队，未完成动作沿 storyCheckpoint 恢复。发布新闻与完成阅读是两个不同事实。UI 按发布顺序展示首条未读新闻；已有教程或强制动作时暂缓下一条，保持 readNews 的 STORY_BLOCKING 约束。

既有 story 队列按 storyId 唯一消费。因此 schema 6 校验每个 news.actionStoryId 必须为该新闻独占，禁止与其他新闻、initial.storyIds、storyRules、case action hooks、tutorialStoryId 或 ending.storyId 共用，冲突给来源诊断。tutorialStoryId 同样必须独占，不可与 initial、storyRules、case action hooks、新闻或 ending 共用，以免教程完成吞掉正式动作。不可通过队列去重静默吞掉第二次业务动作。

指示框复用 instructions 和现有 DecisionPanel：每轮选项呈现后启动配置的 1000–2000ms delay，选择后移除，不强制服从；hover 注释保留。ActionInput 复用 StoryOverlay、ActionInput 与 submitStoryInput；样本不配置 wrongEffects，不新增错误处罚，不把动作结果写入主控条件。

## 账号教程

教程标记是账号属性，不能藏在某个 save、临时认证 UI 或仅内存变量。ProfileRepository 提供 `getTutorialCompleted(profileId): Promise<boolean>`、`markTutorialCompleted(profileId): Promise<void>`，SQLite 和浏览器账号适配器都必须实现。持久表为 `profile_tutorials(profile_id PRIMARY KEY REFERENCES profiles(profile_id), completed INTEGER NOT NULL)`；迁移将已有账号标记已完成，新增账号从未完成开始。数据库 schema 版本按现有迁移序号递增，与 save schema 分开。

首次新账号进入：检查未完成，将配置教程加入初始候选队列并成功保存，**先持久 markTutorialCompleted 成功，再呈现教程**，把“进入即消耗首次机会”定义为工程完成标记时机。这样正常完成、显式退出、关应用/崩溃发生在教程呈现后都不重复出现，符合中途退出视为完成。存储失败不进入教程/工作区并显示既有入口错误；不能先显示再异步丢标记。用户尚未进入系统只注册账号则仍未完成。沿用现有教程组件和输入练习，不套用正式 ActionInput 的不可退出规则。

入口读取 completed=true 但已存队列仍残留教程时，必须先经 Session.dispatch(dismissTutorial) 成功清理，再把 session 返回 UI，故异常关应用也不会恢复阻塞教程。completed=false 且已有教程队列（上次账号标记写失败）保留该队列，重试账号完成标记后才公开 session。正常教程结束沿用 completeStory；中途“退出教程”或“退出登录”先成功提交 dismissTutorial 才关闭教程/退出 UI。CAS 失败保留当前界面并提示已有保存错误，不先注销。本规则与账号完成标记搭配，账号标记不是替代存档队列清理。

## 作者链与验证

作者使用独立的 schema 6 模型，经 Luban 导表、TypeScript 组装和正式内容加载器校验。字段来源、生成命令和可操作短流程见 [内容作者说明](../../content-authoring/README.md)。

Core、Session/SQLite、UI 和真实导表的验证范围见 [开发与验证](../development/workflow.md)。历史执行结果见 [配置实施记录](../archive/implementation/configuration.md)，不能将其测试数量视为后续改动的重跑证据。
