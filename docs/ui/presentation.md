# 表现层约定

核对日期：2026-10-15。本文维护呈现、交互时序与公开接口；产品规则以 [需求](../product/requirements.md) 为准，当前挂载入口、实施状态和待办统一见 [文档索引](../README.md)。原交接、验收流水及会话背景保留在 [历史记录](../archive/implementation/presentation-handoff-2026-10-07.md)。

## 原有界面与接线

以现有案卷布局、主题、正文层级、阅读滚动和选项节奏为基础接入配置能力。聊天与新闻脱离页面文档流，不挤压或改变案件工作区排版。保留人物、案件回看、hover、声音输入、TTS、语言切换与错误恢复。

主要装配与呈现入口：

| 入口                                                                                                                              | 职责                             |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [App.tsx](../../src/ui/App.tsx)                                                                                                   | 工作区、强制剧情、新闻与聊天挂载 |
| [CaseWorkspace](../../src/ui/case/CaseWorkspace.tsx) / [CaseReader](../../src/ui/case/CaseReader.tsx)                             | 案卷切换、可见性、阅读与交互门控 |
| [DecisionPanel](../../src/ui/case/DecisionPanel.tsx)                                                                              | 选项、hover、指示框与提交        |
| [ChatOverlay](../../src/ui/presentation/chat/ChatOverlay.tsx)                                                                     | 独立聊天浮窗、滚动与被动退场     |
| [NewsPanel](../../src/ui/presentation/NewsPanel.tsx)                                                                              | 最高层新闻阅读与已读提交         |
| [StoryOverlay](../../src/ui/presentation/story/StoryOverlay.tsx) / [StoryPlayer](../../src/ui/presentation/story/StoryPlayer.tsx) | 教程、正式动作、故事与旁白承载   |

内容默认、教程开关和聊天/新闻挂载分别由装配决定。改变某一个开关时还需核对完整入口、旧存档及持久路径，当前组合见文档索引。

## 聊天浮窗

[chat.css](../../src/ui/presentation/chat/chat.css) 正式默认采用 hybrid 单框布局：顶部凸出“外来消息”文件签可拖动，正文与底部选择共用一个实底边框。窗口固定 32rem 高度并受视口高度限制，消息日志独立滚动、新消息自动滚到底；底部回复使用共用 ActionChoiceButton 长按钮，21rem 内居中。已发送玩家回复是居中只读记录，来信左对齐。按钮文字始终来自正式内容配置，replyId 和规则不变，不引入 DEV 演示的敬礼／挥手映射。无关闭、最小化或自由输入。

浮窗为非 modal 层。玩家可以搁置聊天继续判案；通常一段聊天，策划显式配置时多个实例同时可用。标题栏支持指针拖动和键盘方向键移动，位置受视口约束；多个窗口错位出现，可点选置前。位置不写存档。

选中的回复文本进入对话历史。正常终止呈现配置终止节点；无交互结束没有终止节点时显示系统结束状态，不伪造对方回复。结果已经提交后保留终止消息 4 秒可见时间再消失；被新闻或强制交互遮挡时暂停退场计时。退场不阻塞主控推进，重新登录不重播旧结果。

计数、结果、恢复和并行语义由 [主流程契约](../architecture/main-flow.md) 决定；UI 不按现实时间关闭活动聊天，不代替玩家回复。保存失败保留原节点并显示错误。

## 新闻与正式动作

[news.css](../../src/ui/presentation/news.css) 与原生 dialog 顶层呈现新闻页，宽 86vw、高 84dvh，约占窗口面积 72%；窄窗保留边距、正文独立滚动。顶层覆盖工作区、聊天和诊断，背景不可交互。

未读阶段的关闭按钮、框外点击或 Escape 统一提交 `readNews`，有动作新闻另提供底部“确认阅读并继续”。该次框外点击不执行背景操作。无动作新闻保存成功后关闭；有动作新闻保存成功后在同一个 dialog 底部内嵌轻量 StoryPlayer/ActionInput，保留正文、滚动与真实多步 checkpoint。动作阶段隐藏关闭入口，Escape/框外点击不退出、不重复提交；成功完成后才退出或显示下一新闻。保存中禁用重复操作，失败保留新闻并允许重试。

打开新闻、挂载组件或切换语言不标记已读。按发布顺序展示首条未读新闻；教程或强制动作进行时暂缓下一条。已读新闻不保留展开 tab 或折叠列表；已读且队首动作未完成时，从真实已读状态与 actionStoryId 关联恢复原新闻。其他强制故事优先，只有新闻拥有的队首故事转入内嵌呈现，避免重复 StoryOverlay。整个阅读与动作阶段持续遮挡候选及聊天表现计时。

正式 ActionInput 必须完成，教程允许中途退出，聊天允许搁置，三者使用各自规则。动作识别与提交复用 [ActionInputPanel](../../src/ui/presentation/story/ActionInputPanel.tsx)、Core 和根级声音协调；UI 不自行比较目标动作并提前推进。

## 选项与指示框

hover 展开内容与非 hover 指示框同时保留。指示框包裹配置指定的选项并提供明确提示，玩家仍可自由选择。

候选实际展示后，指示框先显示居中的加载文案；配置延迟完成前不挂载指示正文或框内品牌署名。正文打字完成后框内右下显示现有品牌署名和图标，与选项区域下方署名共用右侧对齐基准；加载时仅保留空的署名高度。外框通过正常布局内边距包围内缩的目标选项，选项键盘焦点环向内绘制，避免相邻 hover/focus 覆盖指示框边界。新闻遮挡期间隐藏指示框并暂停其可读计时。

`ContentNodeView.instruction = { id, choiceId, delayMs, blocks }` 定义一轮提示。计时从本轮选项实际呈现开始，延迟为配置的 300–2000ms，新版 configuration-pilot/mainflow-short 0.1.2 配置为 800ms，旧包维持原值；成功完成选择后移除，后续轮按自身配置重新出现。语言投影不重启本轮计时，保存失败保留已提交状态。

保留案卷与选项的可见性门和呈现策略。提示延时不从开案时计算，不因等待提示而禁止选择；快速呈现策略只影响既有人为准备时间，业务提交与可见性仍须满足原契约。

## 教程与主控呈现

教程资格属于账号，在首次公开教程前持久标记；中途退出通过 `dismissTutorial` 清理存档队列，成功后才退出。已有教程退出入口不提供给正式动作。具体执行和异常中断恢复见 [账号教程](../architecture/main-flow.md#账号教程)。

主控推进后的案件列表、聊天和新闻都读取已提交结果。`stageId` 是主图组织信息，不自动要求新增阶段页或进度条；当前公开内容投影没有阶段名称。池开放与实际派发分开，不在 UI 自行抽取案件或用配置顺序解决冲突。主图无后继不渲染为整局结局。

结局产品语义见 [需求](../product/requirements.md#整局结局)。旧 [EndingView](../../src/ui/presentation/story/EndingView.tsx) 的返回归档行为及视频占位属于既有承载，结局业务接入状态见文档索引。

## 公共接口与保存

主要入口是 [GameSessionView](../../src/application/gameSessionView.ts) 和 [GameContentView](../../src/application/gameContentView.ts)。

| 用途                       | 读取或提交                                                               |
| -------------------------- | ------------------------------------------------------------------------ |
| 案件列表与当前案件         | 会话 view、既有 selectors 和 sidebar model                               |
| 聊天进度与历史             | `snapshot.state.mainFlow.chats[instanceId]`                              |
| 聊天消息、回复、标题和人物 | `snapshot.content.mainFlow.chats[chatId]`                                |
| 聊天回复                   | `dispatch({ type: 'replyChat', instanceId, nodeId, replyId })`           |
| 新闻发布/已读与文案        | `state.mainFlow.publishedNewsIds / readNewsIds`、`content.mainFlow.news` |
| 完成阅读                   | `dispatch({ type: 'readNews', newsId })`                                 |
| 教程退出                   | `dispatch({ type: 'dismissTutorial', storyId })`                         |

保留未加载、错误、saving 和 needsReload 生命周期。旧内容可以没有 `mainFlow`。保存 pending 使用既有禁用规则；失败不乐观删除聊天、关闭新闻或展示新案件。UI 不直接写 GameState、不调用内部 compute、不重放 onEnter。

双语剧情走内容投影，不在组件中复制文案。存储模式与硬件能力分别判断，桌面内存预览仍可能具有原生声音能力。聊天与新闻当前复用文本块，不含独立朗读控件或语音回复；对应产品需求仍以需求文档为准。

内容制作通过 [作者链](../../content-authoring/README.md) 新增版本，布局调试不覆盖已绑定的生成包。验证范围见 [开发与验证](../development/workflow.md#常用检查)，既往执行结果留在历史记录。

### 指示框默认 A 与 DEV 布局比较

诊断面板提供三种独立试验入口，均直接进入相同的配置指示场景。也可打开以下开发地址：

| 方案         | 表现                                                                                | 开发入口                                                                       |
| ------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A · 批示括框 | 透明文书括框包围目标选项，下接“审阅意见”，以强水平边界和细侧线组织。                | `http://localhost:1420/?modulePreview=instructions&instructionVariant=bracket` |
| B · 建议先行 | 候选上方显示“审阅建议”并引用目标选项，目标行仅标记“建议采纳”，不改变顺序。          | `http://localhost:1420/?modulePreview=instructions&instructionVariant=advice`  |
| C · 侧栏附笺 | 桌面在目标选项右侧显示“审阅附笺”，视窗不超过 64rem 时改至下方；使用正常 grid 布局。 | `http://localhost:1420/?modulePreview=instructions&instructionVariant=memo`    |

三版均使用透明意见区，共享唯一指示内容、加载/计时、新闻遮挡、失败保留及提交逻辑。加载时不挂载正文或框内署名，加载完成后逐字显示真实内容，打字完成后显示现有品牌图标；玩家始终可选择其他选项。附注 hover 与键盘焦点继续使用原约定。

`instructionVariant` 仅在 DEV 且 `modulePreview=instructions` 时解析，由装配层通过表现属性传入 UI；模块切换或返回普通入口会清理参数。未指定参数的指示场景与正式流程默认采用 A 批示括框；B/C 保留为 DEV 比较方案。重开入口使用新的独立内存会话，适合逐版比较相同内容。

三版均已逐 Slice 主审；C 的桌面右栏与 900px 窄窗下置已浏览器验收。自动化覆盖 DEV 参数隔离、清理与真实指示场景加载、自由选择及唯一描述关联。

指示正文在配置等待结束后以字素渐进显示，通常每秒稳定显示 15 个字素，长文按全文长度提高均匀速度，打字总时长不超过 3000ms。候选自身的 750ms 首次准备不变。新闻遮挡或不可读时暂停打字；语言切换替换当前语言全文并保留已耗表现时间，不混合字符、不重启准备等待。完整语义副本保留文段结构并为视觉层预留高度，读屏不逐字播报；减少动态效果时立即显示全文。框内署名仅在打字完成后出现，选择提交不等待动画。

## 动作按钮与聊天对比预览（2026-10-22）

动作输入在提示之后新增仅含正确动作名称的长按钮（敬礼／挥手，Salute／Wave），文字和语音输入继续可用。按钮复用真实 `submitStoryInput` 保存流程，先取消当前语音轮，保存失败可重试；不提前推进剧情。纯展示 `ActionChoiceButton` 同时用于下列聊天实验，提交处理仍分别属于各模块。

原三种聊天布局保留为 DEV 比较；正式默认已采用用户确认的 hybrid 合并版：

- A 预置命令终端：`http://localhost:1420/?modulePreview=chat-single&chatVariant=terminal`
- B 被接管的机构面板：`http://localhost:1420/?modulePreview=chat-single&chatVariant=takeover`
- C 错位界面碎片：`http://localhost:1420/?modulePreview=chat-single&chatVariant=fragments`
- hybrid 显式演示：`http://localhost:1420/?modulePreview=chat-single&chatVariant=hybrid`
- 正式默认布局与原内容回复验证：`http://localhost:1420/?modulePreview=chat-single`

诊断入口可直达、重开或返回。参数仅在 DEV 聊天模块生效，亦可搭配 `chat-multiple` 或 `chat-ignored`；切换其他模块会清理参数。三版使用同一独立内存内容副本，发信人解释借用动作按钮的含义；敬礼继续／确认，挥手主动断联。两条回复均走真实 `replyChat`，主动断联为正常结束，不冒充无交互结束。原内容包不修改，历史、多实例、遮挡暂停和四秒结束停留共用原流程。C 的透明片段间隙允许点击底层应用，片段自身可交互并整体拖动。

## 正式属性单点三角图（2026-10-22）

正式三项属性采用 A 单点定位，外三角宽高比 3:1；顶点显示内容投影的实际名称与原值，不再显示下方三条旧刻度。范围和原值保留读屏定义列表。点表示各项范围归一后再取相对比例，不代表绝对总量；全为零时无点并说明暂无比例。旧版本只有一／两项时保留紧凑数字及可访问范围，不补造第三极。

当前入口新内容使用 minimal-test-package/1.3.0、configuration-pilot/0.1.3、mainflow-short/0.1.3，双语显示一／二／三（One／Two／Three）。保留原稳定 ID、初始数值、范围、effects 与错误计数规则；新增中性项初始 50、范围 0–100。泛称标签不改变 input_errors 的计数用途。旧存档按精确 contentRef 继续载入旧包，不迁移或注入新属性。
