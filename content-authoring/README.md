# 内容配置作者工具

2026-10-05 普通入口恢复前的历史验收：当时默认切换后普通回归 617 项通过；五项真实 Luban 集成独立全部通过，合计 622 项唯一测试执行通过。双 TypeScript、voice、边界、格式和前端构建通过，当时的普通默认入口及两条三案浏览器路径已实际验证。622 项不是本轮恢复入口后的重跑数量。TTS 资源缺失仍限制完整桌面验证；最新入口验证与具体证据见 [实施记录](../Desktop_Case_Game_Configuration_Implementation.md)。

作者输入经过 `Luban → 生成的 TypeScript 作者模型 → 明确组装 → 严格物理包加载器`，生成 `game.json`、双语 `locales/*.json` 和声明的 `media/**` 原始文件。每表中间 JSON、生成代码与来源映射只保留在 `artifacts/content-authoring/run-*`。最新普通入口恢复原浏览器内存 Demo，桌面新存档使用 `minimal-test-package@1.2.0`，自动教程关闭。`mainflow-short/0.1.0`（schema 6）仅通过 DEV 诊断面板“主流程验证”或 `?mainFlowPreview=1` 进入独立内存预览，浏览器与桌面开发环境均不读写 SQLite，刷新或退出清空；聊天/新闻为 debug 实验呈现，正式 UI 接入暂缓。

产品规则以 [产品需求与核心流程](../Desktop_Case_Game_Product_Requirements.md) 为准，目标契约见 [配置系统架构](../Desktop_Case_Game_Configuration_Architecture.md)。schema 6 作者链与主控/聊天运行时已完成接入；schema 4/5 作者包保留兼容用途。本文保留现有工具命令和旧实验字段的操作说明，不把已有字段作为新内容制作规范；实际差距、分阶段接入及验收见 [实施记录](../Desktop_Case_Game_Configuration_Implementation.md)。

| 作者目录                 | 输出包                         | 示例范围                                                                  |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------- |
| `samples/schema4`        | `configuration-skeleton/0.1.0` | 六张 CSV、案件与状态效果，独立旧作者模型                                  |
| `samples/schema5`        | `configuration-pilot/0.1.0`    | XLSX 两轮案件、指示、判决 hook、资格池与确定性派发                        |
| `samples/mainflow-short` | `mainflow-short/0.1.0`         | schema 6 主控、独立聊天、三案、新闻动作与教程；DEV 独立内存主流程预览     |
| `samples/full`           | `configuration-complete/0.1.0` | 旧实验：XLSX 人物与媒体、分支阶段、聊天局部图、外部案件事件和直接流程后果 |

## 新产品模型与当前作者链的界线

新目标中，案件与聊天平行运行：案件是常态核心，聊天是非常态支线。主控剧情图读取案件判决、聊天最终结果及已明确状态条件，决定节点推进、开放池、派发特定案件或启动聊天。聊天只负责被动出现、内部交互推进局部树、被动结束并发布最终结果/终止节点；主控不读取进行中的聊天节点。普通场景一段聊天，特殊多段须由策划显式配置；玩家可搁置聊天判案，没有主动打开、收起或关闭操作。

无交互阈值按有效推进案件的选项选择数量配置，回复当前聊天重置其计数；达到阈值时被动结束并发布配置结果，由主控判断后续流程。案件事件不直接选择聊天局部分支，现实时间与离线时间不推进计数。主控、聊天局部状态、计数和已发布结果须保存并在重登时恢复。这些能力已由 schema 6 作者表、正式转换、保存和 debug 实验 UI 接入，正式 UI 适配暂缓；字段见本文“Schema 6 主流程短篇”。

现有 `externalBranches`、`chatLastNode` 及聊天/event 直接返回 `unlockCases/unlockChats/enterStage` 是旧实验能力。它们的生成与查询回归保留，不能把任意历史或进行中的聊天节点冒充已结束事件的最终结果，也不能用案件事件隐藏推进聊天来制作新目标内容。已结束事件的终止节点可以作为结果标识。旧 schema 5 池派发只接受 `CaseEvent`；schema 6 使用独立 mainFlow 意图与条件消费主控和聊天最终结果。

## 工具与生成门禁

Node 满足根 `package.json` 的版本要求，先 `npm ci`；准备能构建 net8.0 的 .NET SDK。`LUBAN_ROOT` 或 `--luban-root` 指向 `luban.lock.json` 锁定的干净 Luban v5.1.0 checkout。工具检查 commit、已跟踪改动及所有未跟踪文件，重新构建 Release 并真实导表；未跟踪的 C# / MSBuild 文件也被拒绝，正常忽略的 bin/obj 可保留。不会下载或修改工具源码。

```powershell
$env:LUBAN_ROOT = '你的干净 Luban checkout'
npm run typecheck
npm run content:check-all
# 单包生成/核验；默认无参数是 schema4 骨架。
npm run content:build -- --source content-authoring/samples/full --output content/configuration-complete/0.1.0
npm run content:check -- --source content-authoring/samples/full --output content/configuration-complete/0.1.0
npm run validate:content -- content/configuration-complete/0.1.0
npx vitest run tests/content --maxWorkers=1
```

`scripts/content/packages.json` 明确列出四个作者包；全包门禁顺序核验每个已生成版本。CI 使用 Node 24、.NET 8 和固定 Luban。未设置 `LUBAN_ROOT` 时真实工具测试跳过，不能据此宣称完整生成门禁通过。

输出须以清单 `<packageId>/<version>` 结尾。不同内容使用新版本，已有版本只接受字节一致的重复生成。`--check` 比较完整文件清单与文本/二进制内容，缺失、额外文件或漂移均失败。验证通过后一次目录 rename 发布；失败保留暂存，不留下新包或改变已有包。暂存与输出须在同一磁盘。

资源 `path` 是包相对 `media/**` 路径，作者文件放在对应 `source/media/**`。图片、音频、视频按原始字节复制；路径穿越、大小写/NFC 别名、符号链接及 junction/reparse 路径均拒绝。多个资产 ID 可显式复用物理文件。缺失资源映射到资产行 `path` 单元格。

## 权威输入与模型

schema5/full 的 `Data/sample.xlsx` 是表格字段唯一编辑源，禁止另维护同字段 CSV。XLSX 用已安装 openpyxl 一次制作，日常生成只需要 Node、.NET 和 Luban，不依赖 Python。前 3 行是字段、类型和说明，数据从第 4 行开始；数值/布尔为相应单元格类型，ID/枚举为文字，枚举有下拉校验，表头冻结。

| 工作表                            | 有限业务字段                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| attribute / flag                  | 初值、属性范围、显式 `interactionOnly`                                                 |
| case / node / choice / resolution | 稳定 ID、案件所属、初始派发、轮次图、`Node/Resolution` 目标及 hover 标记               |
| effect                            | `Resolution/ActionInput` 所属、`AttributeDelta/SetFlag`、目标 key 与数值/布尔          |
| predicate                         | 稳定条件 ID、有限案件/属性/flag 谓词；组装为核心规则现有 `all` 条件                    |
| instruction                       | 本案件/节点/选项引用、1000–2000ms 明确延迟                                             |
| hook / actionInput                | 精确 `CaseStarted/ChoiceCompleted/CaseResolved`、信息→动作剧情引用、`Salute/Wave` 要求 |
| poolMember / dispatch             | 池成员资格、明确 rank、事件与派发条件、显式 `Ordered` 策略                             |
| character / caseCharacter         | 共享人物 ID、可选 portraitAssetId、案件人物引用；生成时内联至现有 `case.characters`    |
| asset                             | `Image/Audio/Video`、包相对路径                                                        |

每表 `id` 唯一，节点/判决引用位于指定案件；选项顺序取作者行顺序。同一判决/动作步骤的同类效果 key 不能重复，未使用列保持空/0/false。人物必须被案件引用，引用顺序保留；portrait 必须引用 image，聊天人物须已由案件人物声明。

`rules.json` 保存严格故事步骤、结局及可选 `initialStoryIds`、legacy `unlockRules/storyRules` 和 `flow` 结构。schema5 的 `assets` 兼容占位必须为空，实际资产只写表格。动作要求与错误效果由表注入，不在 JSON 维护第二份。`locales/zh-CN.json` / `en-US.json` 独立保存长文、人物显示文案、阶段和聊天/回复文案。覆盖必须精确完整，终止节点也有文案，不能夹入业务字段。

schema4 使用 `generated/schema.ts`；schema5/full 共用扩展 XML 与 `generated/schema5.ts`。pilot 新人物/引用/资源表为空，缺省 flow 不输出，旧 pilot 运行包字节不变。模型不一致报 `AUTHOR_MODEL_DRIFT`；审查暂存 `code/schema.ts` 后更新对应版本模型，不手工格式化生成文件。

## 已接入真实玩法的小样配置

pilot/full 的 `intake` 有两轮。首轮两项都有效，指示建议 `comply`，允许选择 `review`。该轮选项实际呈现后独立延迟 1500ms，语言投影不重置，成功选择清除，快选取消定时器，保存失败保留本轮；旧 hover 注释独立存在。

判决 `approved` 使 `authority +1`、`judged=true`；真实 Core/Session 在同一次 CAS 保存判决、精确事件 ledger、hook、通知队列与实际派发。通知严格一屏信息接必完成的 `salute`；错误 `wave` 只增加 `input_errors`、设置 `action_mistake`，仍须重试敬礼。所有核心业务条件和阶段/聊天/外部分支条件禁止读取 `interactionOnly`，判决禁止写入，动作错误只能写这些专用字段。有限 flow 后果不支持任意属性/flag 写入。

上述错误效果和隔离是旧小样已经实现的能力。ActionInput 错误机制现已搁置，可能不保留，不是新模型的交付前提；新小样的指示框、配置动作与同次保存链路可复用，新闻阅读后的动作 hook 仍待接入。

资格池独立查询：`followup` 要求 `authority >= 1`，`deferred` 要求 `>= 5`。完整 ordered rank 明确派发顺序，当前仅发 followup。旧 `unlockRules` 仍是“满足即派发”，不能当新池资格。多规则命中或空池保存 `needsDecision(ruleConflict/emptyPool)`，不擅自选第一条、随机、全部或结束；本阶段无处理待决的产品 UI。

save4 保存事件/hook/派发事实，恢复不重复；v1/v2/v3 读取迁移保留内容引用，SQLite 不在读取时改盘，下一次成功 CAS 才写 v4；v3 拒绝混入 ledger。Session 回归覆盖 caseStarted、普通 choiceCompleted、最终 choiceCompleted→caseResolved 的 queue/ledger 顺序及恢复一次性。

现存结局流程在最终判决时锁定 ending，同次通知 hook 的故事排在 ending story 之前，输入错误不改变已锁定 ending。结束演出后仍返回归档工作区，尚不符合已确认的“演出完成后返回登录”需求。该差距在结局业务接入时处理；结局后再次登录的流程及触发结局时未完成交互的处置，留待该阶段决定。

## 旧阶段与聊天纯查询（实验兼容说明）

本节描述当前可调用的旧查询 API，供旧样本复导与回归使用，不是新主控/聊天内容的编写指引。

`configuration.flow` 使用稳定阶段 ID 与聊天局部节点 ID，不限定三个阶段或线性顺序。条件严格为 `{all:[...]}` 或 `{any:[...]}`，不能混写、为空、含脚本/自由 payload。谓词包括案件判决/判决数量、属性上下界、flag、当前阶段和此前聊天最后节点。full 有 registration/review/appeal/completed 分支；`transitions:[]` 是阶段无后继，不等于游戏 ending。

聊天 message 有预制回复，目标为本聊天 node 或声明的对话外 event；terminal 有有限 `unlockCases/unlockChats/enterStage` 后果。message 的 `externalBranches` 另声明精确 CaseEvent、条件、本聊天目标节点及后果：full greeting 搁置期间收到真实 followup 判决后可走到 done。跨组引用、重复局部 ID、不可达节点、无结构性退出路径、多个隐含阶段后果均失败。允许有出口的局部循环；条件导致暂时无候选则明确待决。

公共入口统一从 `src/application/configurationQueries.ts` 导入，门面验证 catalog、GameState 不变量及 FlowFacts。`src/game/flowQueries.ts` 的 `compute*` 是内部纯计算，只接受已验证输入。查询不读写数据库、不修改 state/facts、不排故事或派案件。

| API                                                                        | 返回                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `queryCaseCharacters(content, caseId)`                                     | 已内联人物及 portrait 资产 ID/kind/path，异常引用诊断                                                   |
| `queryStageTransitions(state, content, facts)`                             | 所有候选、每个谓词与目标资格解释；0/多条 needsDecision，唯一 matched，无后继 terminal                   |
| `queryChatAvailability(state, content, facts)`                             | 每个聊天的出现资格与 all/any 谓词解释，不指定出现顺序                                                   |
| `queryChatNode(state, content, facts, chatId, nodeId)`                     | 已激活节点的回复候选或终止后果，无回复/不合格目标明确待决                                               |
| `queryFlowEvent(state, content, facts, eventId)`                           | event 条件与目标阶段资格解释及可用后果，未满足不输出执行后果                                            |
| `queryChatExternalEvent(state, content, facts, chatId, nodeId, caseEvent)` | 已激活节点的业务事件分支；事件须存在该状态 ledger；0/多条 needsDecision，唯一 matched 返回本地目标/后果 |

旧 FlowFacts 是调用方提供的 `{currentStageId,lastChatNodeIds,activeChatNodeIds?}`。lastChatNodeIds 是此前记录的聊天最后节点，尚不具备新目标的最终结果发布语义；activeChatNodeIds 是已激活聊天停留节点。旧查询的出现资格只用于激活候选，不是持续交互门禁：即使判决改变阶段让 chat.when 变 false，已激活节点仍可回复或命中外部分支。缺少或不匹配的激活事实返回 chatNotActive，不自动开启/关闭/重开或猜测节点。

条件使用传入快照及应用查询结果之前的 FlowFacts；本次 target/后果不会先修改事实再倒过来满足条件。调用方应提供已提交 Session state，外部 CaseEvent 须实际存在 ledger。FlowFacts 尚未进 save4，查询结果尚未接入 Session/UI 自动推进，调用方负责记录后续事实、去重及持久化。unlock 返回后果意图，不能当成已保存派发。回复与外部事件同时可用时仍无业务优先级，本轮分别返回候选。

## 来源、测试与浏览器

工作簿诊断含文件、工作表、行、列、对象和字段，例如 `Data/sample.xlsx [asset!D4] object=portrait field=path`。flow 条件、分支、目标和后果逐字段映射，例如 `rules.json object=clerk_intro field=flow.chats.clerk_intro.nodes.greeting.externalBranches.0.targetNodeId`。语言诊断保留实际 locale 文件和字段路径；Luban 原始类型/文件/行列错误保留。schema4 CSV 用稳定对象 ID 定位，不猜测多行单元格物理行。

```powershell
npx vitest run tests/game/configurationPilot.test.ts tests/game/flowQueries.test.ts tests/storage/configurationPilotSqlite.test.ts tests/ui/configurationPilot.test.tsx --maxWorkers=2
# LUBAN_ROOT 已设时验证真实生成、来源和失败保护。
npx vitest run tests/content/authoringComplete.test.ts --maxWorkers=1
npm run dev
```

开发浏览器打开 `http://localhost:1420/?configurationPilot=1`：演示档案员登录→登记复核两轮→选项后约 1.5 秒常显指示/hover→允许不服从→判决通知→挥手错误仍须敬礼→后续听证→无重复通知。它开发时动态加载 pilot，使用真实 Core/Session/View/App；内存预览刷新重置，生产构建不包含小样依赖。

full 保持 schema 5 的配置生成、严格验证和旧纯查询语义。主控/聊天实验 UI、保存推进、账号教程和新闻动作由 schema 6 的 mainflow-short 实现，当前仅通过 DEV 独立内存主流程预览体验；普通入口恢复旧 Demo/minimal-test-package@1.2.0，自动教程关闭，正式 UI 适配暂缓。结局演出后返回登录及结局重登仍在本次范围外。

## Schema 6 主流程短篇

`mainflow-short@0.1.0` 是独立主流程包，作者目录为 `samples/mainflow-short`，输出为 `content/mainflow-short/0.1.0`。它不改变 pilot / complete 的 schema 5 语义，也不重绑旧存档。

`Data/sample.xlsx` 复用基础案件、选项、人物、指示框与动作表，并增加七张主控表：

| sheet          | 权威字段                                                               |
| -------------- | ---------------------------------------------------------------------- |
| mainNode       | 节点 ID、stageId、唯一 initial 标记                                    |
| mainTransition | ID、所属 nodeId、when 条件 JSON、targetNodeId                          |
| mainIntent     | ID、所属 nodeId、definition 意图 JSON（显式 ordered 策略也在此）       |
| mainChat       | 模板 ID、characterId、startNodeId、choiceThreshold、inactivityResultId |
| mainPoolMember | ID、poolId、caseId、when 条件 JSON                                     |
| mainNews       | 新闻 ID、专用 actionStoryId（允许为空）                                |
| mainSetting    | tutorialStoryId                                                        |

JSON 单元格直接以运行时 Zod 的有限条件／意图 schema 解析。`rules.json.chatNodes` 只持有模板的局部消息、预制回复与终止节点，不能再定义阈值或主控意图。双语长文独立保存在 `locales/zh-CN.json` 和 `locales/en-US.json`。表格头前三行遵循现有 Luban 约定，数据从第 4 行开始。Luban 实际导出模型为 `generated/schema6.ts`，TS 组装入口为 `scripts/content/assemble6.ts`；不能手改模型或正式输出绕过导表。

运行（先设置指向固定版本工具 checkout 的 `LUBAN_ROOT`）：

```powershell
npm run content:build -- --source content-authoring/samples/mainflow-short --output content/mainflow-short/0.1.0
npm run content:check-all
npx vitest run tests/content/mainFlow.test.ts --maxWorkers=1
```

新包沿用先在临时目录完整组装、校验后 rename 发布，已存在版本只允许逐字节一致，不覆盖。`content:check-all` 已注册四个作者包。未设置 `LUBAN_ROOT` 时普通测试跳过真实工具集成；发布验收必须另外设置环境变量运行，不能用跳过结果冒充真实导表通过。

可操作短流程：

1. 初始节点派 `case-a`，启动 `instance-a`，发布 `news-n`。A 有三轮选择。第一轮后聊天计数为 1，回复 `hello/ack` 归零，再做第二、三轮达到 2 并得到 ignored；也可回复 `detail/finish` 得到 normal。
2. normal / ignored 结果分别进入互斥主节点，各自开放 `pool-p`，显式 ordered 派 B，并发布不同结果新闻。A 结案后进入 special，同步启动 `instance-b`、`instance-c`。
3. B 也有三轮：第一轮后 b/c 都为 1；回复 b 的 `hello/ack` 后 b=0、c=1；第二轮 c=ignored、b=1；第三轮 b=ignored。主控等待 B 判决和两个结果，四种 normal/ignored 组合分别明确配置为互斥转移，然后派 C。
4. 新闻 `news-n` 只有点击阅读完成后才排入独占 `news-ack` 敬礼动作；教程独占 `tutorial`，先文字后挥手练习，由账号入口决定首次排入。样本不配置错误效果或结局，C 结束后仍可留在工作区。

主图校验拒绝循环、未知引用、重复实例、同节点多个派发、无法终止或不可达的聊天节点、旧 flow/外部分支/局部 effects、旧派发入口，以及新闻动作 story 被其他新闻、initial、storyRules、case hook、教程或 ending 共用。每种语言校验全部新闻、聊天节点（含 terminal）和回复键。
