# 桌面案件模拟游戏架构设计

**版本：** 1.0  
**日期：** 2026-09-14  
**状态：** 首版开发基线  
**技术方向：** React + TypeScript + Vite + Tauri 2 + SQLite  
**适用范围：** 本地运行、以桌面 App 为表现形式、由案件阅读与选项决策驱动的单人游戏。

> 本文整合已经确认的产品需求与架构审核结论。目标是让首版能直接开发，并给内容扩充留下清楚的边界；不是建设通用游戏引擎、通用工作流平台或在线服务架构。
>
> “必须”表示应保持的架构约束；“首版默认”表示为了完成设计而采用的具体行为约定，不表示这些交互细节此前已经逐项确认。类型与 SQL 示例用于明确实现契约，不代表项目已经完成集成或平台验证。

## 目录

1. 产品范围与首版默认行为
2. 总体架构与依赖方向
3. 技术栈与实现规模
4. 页面、组件与交互结构
5. 状态分类与数据所有权
6. 内容模型
7. 游戏状态与存档模型
8. 游戏操作与统一提交入口
9. 核心业务流程
10. SQLite 持久化与错误恢复
11. 内容加载、版本与兼容
12. 悬浮标注、播片与结局演出
13. 本地用户与安全边界
14. 建议目录与模块职责
15. 内容生产与校验
16. 测试与验收
17. 开发顺序
18. 扩展边界与实施约束

附录 A：案件内容示例  
附录 B：最小联调场景  
附录 C：技术依据

---

## 1. 产品范围与首版默认行为

### 1.1 已确认的产品形态

应用启动后显示纯本地登录／注册页面。进入主界面后，左侧是可折叠侧边栏，右侧是文档阅读和案件处理区域。

侧边栏包含三个可独立展开、收起的分区：属性、未处理文档、已处理文档。案件内容包括人物及简介、案件简介、正文与选项。选择一个选项后，原选项组被新的选项组替换，直到玩家确定最终决定。

案件完成后，保留静态正文，在独立区域展示最终决定，并在下方另一个区域展示案件结果及实际属性变化。随着进度推进，新的案件加入未处理列表；特定阶段播放应用内视频，满足条件后进入结局。结局可能包含模拟溅血等屏幕效果。

PC 首发确定，移动端暂不纳入首版交付。内容初版随应用本地提供，未来可能增加远程内容下载。

### 1.2 首版默认行为

| 事项 | 默认规则 |
| --- | --- |
| 运行形态 | 单窗口、单玩家会话；不设计多人同步 |
| 本地用户 | 登录表示进入本地 Profile；注册表示创建 Profile |
| 存档数量 | UI 首版每个 Profile 提供一局“继续游戏”；数据模型保留独立 saveId |
| 案件切换 | 允许中途切换，多个案件可以处于 active；分别保存进度 |
| 中间选择 | 只推进案件节点和选择历史，不直接改变全局属性 |
| 最终选择 | 一次性结算案件、属性、标记、解锁、剧情队列和结局状态 |
| 撤销选择 | 首版不提供撤销、回退、重判；不要自行加入 |
| 自动保存 | 开始案件、每次有效选择、完成重要剧情时立即提交 |
| 重要剧情 | 阻止继续处理案件；重启后从未完成的剧情单元开头恢复 |
| 普通特效 | 不写入存档，关闭、失败或丢失不影响游戏结果 |
| 结局之后 | 本局不能继续处理案件；允许查看已处理文档 |
| 内容版本 | 一局存档绑定一个完整内容包版本，不混用新旧案件 |
| 首发操作系统 | 以确定的 PC 目标系统为验收范围；Windows 可作为首个验证目标，不默认承诺所有桌面系统 |

这些默认规则可以在产品设计中调整，但调整时应同步修改相应状态、流程与测试。

### 1.3 首版不做

不做联网账号、云存档、多设备冲突合并、内容热更新下载器、运行时脚本执行、通用事件总线、事件溯源、通用演出编辑器、案件可视化编辑器、复杂物理或场景渲染。

不为“未来也许需要”创建空的 RemoteProvider、插件管理器、系统生命周期框架或多套数据存储方案。

---

## 2. 总体架构与依赖方向

### 2.1 总体结构

```text
React UI
  登录 / Sidebar / CaseReader / ResultPanel / StoryPlayer
          │ 玩家操作                      ▲ 已提交状态
          ▼                               │
Application：GameSession
  会话管理 / 防重复提交 / 调用规则 / 保存 / 发布状态
      │                 │                   │
      ▼                 ▼                   ▼
Game 纯逻辑        Content 内容读取      Storage 本地存储
  选项推进          JSON + 校验           Profile
  案件结算          只读规则目录          整局 JSON 存档
  解锁与结局        图片 / 视频索引        设置
      │                                     │
      └── 返回新状态和临时演出请求           ▼
                                     Tauri / SQLite
```

Tauri 提供桌面运行环境、数据库和必要的平台能力，不承载案件业务规则。React 渲染状态，不自行决定判决后果。内容描述案件和规则参数，不保存某个玩家的选择。

### 2.2 必须保持的边界

**案件定义与玩家进度分离。** 相同的案件定义可供多局游戏使用；某局的节点位置、选择记录和历史结果只存于该局状态。

**游戏规则与 React 分离。** 无 UI、无 Tauri、无数据库时，也应能用普通 TypeScript 测试完成一整个案件。

**持久化先于结果展示。** 有效操作先计算新状态，保存成功后再将其发布给 UI，并触发临时特效。保存失败不能表现为已成功判决。

**历史事实与表现分离。** 已处理文档读取结算时保存的稳定 ID、时间、顺序和实际属性变化；显示文字按当前 locale 从绑定内容版本读取。历史展示不重新施加或推导 effects。

**重要剧情与普通特效分离。** 前者有持久化完成状态，后者只是可丢弃的表现。

### 2.3 依赖约束

| 模块 | 可以依赖 | 不应依赖 |
| --- | --- | --- |
| `game/` | 自身模型、内容类型、纯函数 | React、Zustand、Tauri、数据库、DOM |
| `content/` 的模型与校验 | Schema 工具、纯数据 | React、用户存档修改入口 |
| `content/` 的加载实现 | 内容模型、资源读取适配 | React 组件 |
| `storage/` | 存档模型、SQL 插件 | 页面组件、具体案件分支规则 |
| `application/` | game、content、storage、会话 Store | 具体页面组件 |
| `ui/` | 会话读取接口、操作接口、内容展示类型 | SQL、具体内容文件路径 |
| `platform/` | 必需的 Tauri API | 案件与结局业务规则 |

这些是文件和函数层面的约束，不要求每个模块都成为 class、独立 npm 包或依赖注入服务。

---

## 3. 技术栈与实现规模

### 3.1 默认选型

| 用途 | 选择 | 使用限制 |
| --- | --- | --- |
| UI | React + TypeScript | 组件只处理展示与交互 |
| 构建 | Vite | 单页应用，不引入 SSR 服务 |
| 桌面容器 | Tauri 2 | Rust 层尽量薄 |
| 会话状态 | 一个小型 Zustand Store | 不把业务规则和数据库操作散落在 Store 各处 |
| 本地存储 | SQLite + Tauri SQL 插件 | 游戏状态先保存为整局 JSON |
| 数据结构校验 | Zod | 内容、存档导入与迁移边界使用 |
| 样式与普通动画 | CSS；必要时少量 Canvas | 不默认引入动画或渲染引擎 |
| 规则与校验测试 | Vitest | 优先覆盖纯逻辑和存档恢复 |

Tauri 官方将 Vite 列为 React 等 SPA 项目的推荐构建方案；SQL 插件提供 SQLite 接入。上述组合具有官方支持路径，但本项目具体的媒体、布局和打包表现仍需实测。[R1][R3]

Zustand 仅用于订阅和发布会话状态；这是本文的实现选择，不是游戏领域的依赖。熟悉 React Context 的团队也可以替换它，核心契约不变。[R5]

Zod 支持运行时结构校验及类型推导。实际实现建议以 Schema 为源推导内容和存档类型，避免人工维护两份逐渐不一致的定义。本文展示 TypeScript 类型是为了阅读方便。[R6]

### 3.2 不强制增加的依赖

只有登录和主界面时，可用顶层页面状态切换；不必仅为两个页面引入复杂路由。若团队已有熟悉的路由库，可以使用，但路由不保存案件进度。

按钮、对话框和标注可选用熟悉的组件库。不把 Tailwind、Radix、shadcn、Motion 等组合设为架构前提。需要处理复杂浮层定位时再引入专门工具。

依赖版本在开工时选择相互兼容的版本并提交锁文件；本文件不声称某个小版本是永久的“最新版本”。

---

## 4. 页面、组件与交互结构

### 4.1 页面结构

```text
App
├── BootstrapView             数据库与基础资源初始化
├── ProfilePage
│   ├── LoginForm
│   └── RegisterForm
└── AppShell
    ├── Sidebar
    │   ├── AttributeSection
    │   ├── PendingCaseSection
    │   └── ResolvedCaseSection
    ├── MainContent
    │   ├── EmptyView
    │   └── CaseReader
    │       ├── CharacterSection
    │       ├── CaseSummary
    │       ├── CaseBody
    │       ├── DecisionPanel       未完成时
    │       └── ResolutionPanel     已完成时
    │           ├── VerdictBlock
    │           └── ConsequenceBlock
    └── OverlayRoot
        ├── AnnotationPopover
        ├── FeedbackLayer
        ├── StoryPlayer
        └── EndingView
```

`CaseReader` 是通用组件。新增普通案件只增加内容文件，不增加 `Case001.tsx` 这样的专属页面。

`OverlayRoot` 表示共享的浮层挂载位置，不代表必须开发通用浮层管理框架。

### 4.2 案件展示状态

| 案件状态 | 主区域显示 | 可执行操作 |
| --- | --- | --- |
| pending | 打开时提交“开始案件”，成功后进入 active | 开始 |
| active | 静态正文 + 当前节点的选项组 | 选择、切换文档 |
| resolved | 静态正文 + 最终判决快照 + 后果快照 | 只读回看 |

选择中间选项后，只替换 `DecisionPanel`；不把每次选项都追加成聊天记录。选择历史保留在存档中，供恢复、测试或未来的历史详情使用。

案件完成后不自动跳到下一个案件。当前文档仍留在右侧，侧边栏将其归入已处理列表，玩家能看到刚刚的判决和结果。

### 4.3 侧边栏查询

未处理列表必须包含 `pending` 和 `active`，已处理列表只包含 `resolved`。尚未解锁的案件不显示。

列表从 `GameState.cases` 派生，不独立维护“未处理数组”“已处理数组”和另一份状态。

首版建议：未处理按内容配置的 `order` 排序，已处理按结算序号倒序排列。排序规则可以调整，但不能改变案件状态。

### 4.4 文本与标注交互

正文使用真实文本内容与语义化元素，不把整篇案件渲染成图片。首版至少支持正常滚动、键盘操作、文字选择及字号设置。

选项说明应支持鼠标、键盘焦点以及点击信息入口。不要把关键解释只放在 hover 中；点击标注入口不应误触发选项提交。

浮层锚定选项元素，而不是保存固定屏幕坐标。滚动、窗口缩放、侧边栏收起、选项替换后，应更新位置或关闭对应标注。

---

## 5. 状态分类与数据所有权

### 5.1 四类数据

| 类别 | 示例 | 所有者 | 持久化方式 |
| --- | --- | --- | --- |
| 内容规则 | 分支、effects、条件、顺序、资源 ID | GameContentCatalog | 随应用提供的内容包 |
| 内容表现 | 案件正文、人物、选项、裁定、剧情与结局文字 | LocalizedContentCatalog | 同一内容版本、按 AppLocale 加载 |
| 游戏状态 | 属性、节点、选择历史、结算结果、剧情队列 | GameSession 中的 GameState | SQLite 整局 JSON |
| 会话／临时 UI 状态 | 当前文档、提交中、错误提示、当前标注、视频播放进度 | 会话 Store 或局部组件 | 默认不保存 |
| 偏好设置 | 侧边栏折叠、三个分区折叠、音量、字号、减少动态效果 | 设置模块 | 同一 SQLite 中的设置记录 |

当前选中的文档属于 UI 状态；案件是否开始、选到了哪个节点属于游戏状态。两者不能混为一谈。

React 官方建议每份状态有明确的所有者，并避免重复保存可推导的信息。本架构据此只保存一个权威的案件进度集合，再生成 UI 所需列表。[R2]

### 5.2 Store 中保存什么

Store 保存当前 Profile 标识、已加载的存档封套、启动／加载／保存状态，以及少量跨组件 UI 状态。案件对象通过选中 ID 查找，不在 Store 里再复制一份 `selectedCase`。

打开的标注、某个按钮的 hover 状态等局部细节留在组件内。运行中的定时器、DOM 引用、视频元素、错误对象不能写入 GameState。

**禁止同时使用 Store 自动持久化和 SaveRepository 保存同一份 GameState。** 首版只有 SaveRepository 是正式存档写入入口；浏览器 localStorage 不作为第二份权威存档。

---

## 6. 内容模型

### 6.1 标识与文本

所有引用使用稳定 ID，不使用标题、列表下标或正文文本作为业务标识。不同内容包版本可以保留同一案件 ID，但运行时必须先选定完整的包版本。

以下类型是建议契约；可合并在少量文件中实现。

```ts
export type CaseId = string;
export type NodeId = string;
export type ChoiceId = string;
export type ResolutionId = string;
export type AttributeId = string;
export type FlagId = string;
export type StoryId = string;
export type EndingId = string;
export type AssetId = string;

export type TextBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "quote"; text: string };

export interface ContentRef {
  packageId: string;
  version: string;
}

export interface ContentManifest extends ContentRef {
  contentSchemaVersion: number;
  defaultLocale: AppLocale;
  supportedLocales: AppLocale[];
}
```

`ContentRef` 永远只有 `packageId + version`；locale 是独立的表现加载维度，不进入内容引用、存档或游戏命令。每个规则包只有一份事实图，并为 manifest 声明的每个 locale 提供完整语言包。

首版正文采用少量结构化文本块。不允许案件文件提供任意 React 组件、JavaScript、SQL 或可直接执行的 HTML。以后确有富文本需求时，再增加经过限制的格式能力。

### 6.2 案件与选项

```ts
export interface GameCharacterDefinition {
  id: string;
}

export interface ChoiceAnnotation {
  title?: string;
  body: TextBlock[];
}

export type ChoiceTarget =
  | { type: "node"; nodeId: NodeId }
  | { type: "resolution"; resolutionId: ResolutionId };

export interface GameChoiceDefinition {
  id: ChoiceId;
  hasAnnotation: boolean;
  target: ChoiceTarget;
}

export interface GameDecisionNode {
  choices: GameChoiceDefinition[];
}

export interface GameResolutionDefinition {
  effects: {
    attributeDeltas: Record<AttributeId, number>;
    setFlags: Record<FlagId, boolean>;
  };
}

export interface GameCaseDefinition {
  id: CaseId;
  order: number;
  characters: GameCharacterDefinition[];
  startNodeId: NodeId;
  nodes: Record<NodeId, GameDecisionNode>;
  resolutions: Record<ResolutionId, GameResolutionDefinition>;
}
```

对应 `LocalizedCase` 只保存 `title`、人物名称／简介、summary/body、node prompt、choice text／annotation、resolution verdict／result，并用稳定 ID record 对齐。严格 Schema 使语言包从结构上不能携带 target、effects、predicate、unlock、flag 等规则字段；人物、选项与剧情步骤的显示顺序只取规则层数组。

`ChoiceTarget` 是互斥联合：一个选项只能前往新节点或产生最终结果，不能两者都填，也不能都不填。首版选择节点图允许分叉与合流，但不允许环，保证玩家不会陷入无终点的选择循环。

中间选项没有 `effects`；效果集中在 `GameResolutionDefinition`。不要为了尚未出现的特殊案件预先引入任意步骤副作用。

人物简介首版可以内嵌在案件中。只有确实出现大量跨案件复用人物时，再增加全局人物定义与案件内覆盖字段，避免一开始就把每个文本块拆成独立实体。

### 6.3 属性、标记与初始状态

```ts
export interface AttributeDefinition {
  initial: number;
  min: number;
  max: number;
}

export interface InitialGameDefinition {
  caseIds: CaseId[];
  storyIds: StoryId[];
  flags: Record<FlagId, boolean>;
}
```

属性 `label` 属于 LocalizedContentCatalog；规则与存档始终只识别 `attributeId`。

首版属性使用整数。内容校验要求 `min <= initial <= max`；结算后限制在配置范围内。

`flags` 表示少量剧情事实，例如是否接受过某项要求。属性 ID 与标记 ID 都必须在内容定义中声明，未知名称应报错，不要默认为零后继续运行。

### 6.4 进度条件

不建设通用表达式语言。首版只提供确有用途的固定条件：

```ts
export type Predicate =
  | { type: "caseResolved"; caseId: CaseId; resolutionId?: ResolutionId }
  | { type: "resolvedCountAtLeast"; count: number }
  | { type: "attributeAtLeast"; attributeId: AttributeId; value: number }
  | { type: "attributeAtMost"; attributeId: AttributeId; value: number }
  | { type: "flagEquals"; flagId: FlagId; value: boolean };

export interface Condition {
  all: Predicate[];
}

export interface UnlockRule {
  id: string;
  when: Condition;
  caseIds: CaseId[];
}

export interface StoryRule {
  id: string;
  when: Condition;
  storyId: StoryId;
  order: number;
}

export interface EndingDefinition {
  priority: number;
  when: Condition;
  storyId: StoryId;
}
```

`all` 非空，所有条件成立才匹配。需要“或”时可以为同一目标编写多条规则；首版不引入任意深度的布尔表达式树。

案件解锁是单向的：一旦加入 `GameState.cases`，不会因为之后属性下降而消失。一个案件在同一局只解锁一次。

普通剧情规则中的同一 `storyId` 每局只播放一次。结局根据 `priority` 从高到低选择第一个匹配项；首版校验要求结局优先级互不重复，避免隐式歧义。

### 6.5 演出定义

```ts
export type GameStoryStep =
  | { id: string; type: "text" }
  | { id: string; type: "video"; assetId: AssetId }
  | { id: string; type: "effect"; effect: "blood" | "fade"; durationMs: number };

export interface GameStoryDefinition {
  skippable: boolean;
  steps: GameStoryStep[];
}

export interface AssetDefinition {
  kind: "image" | "video" | "audio";
  path: string;
}

export interface GameContentCatalog {
  manifest: ContentManifest;
  attributes: Record<AttributeId, AttributeDefinition>;
  initial: InitialGameDefinition;
  cases: Record<CaseId, GameCaseDefinition>;
  unlockRules: UnlockRule[];
  storyRules: StoryRule[];
  stories: Record<StoryId, GameStoryDefinition>;
  endings: Record<EndingId, EndingDefinition>;
  assets: Record<AssetId, AssetDefinition>;
}

export interface LocalizedContentCatalog extends ContentRef {
  locale: AppLocale;
  manifest: { title: string };
  attributes: Record<AttributeId, { label: string }>;
  cases: Record<CaseId, LocalizedCase>;
  stories: Record<StoryId, LocalizedStory>;
  endings: Record<EndingId, { title: string }>;
}
```

这里的步骤数组只是支持几种已知效果的配置。播放器用一个简单的分支渲染和当前位置即可实现，不需要图编辑器、脚本解释器或通用导演系统。

不把“加属性”“解锁案件”“执行命令”写进演出步骤。所有业务结果在演出开始前已提交；播放完成只更新剧情完成记录，以及必要的结局展示阶段。

---

## 7. 游戏状态与存档模型

### 7.1 案件进度

```ts
export interface ChoiceRecord {
  nodeId: NodeId;
  choiceId: ChoiceId;
}

export interface AttributeChangeSnapshot {
  attributeId: AttributeId;
  before: number;
  after: number;
  actualDelta: number;
}

export interface ResolutionSnapshot {
  attributeChanges: AttributeChangeSnapshot[];
  resolvedAt: string;
  resolvedOrder: number;
}

export type CaseProgress =
  | { status: "pending" }
  | {
      status: "active";
      currentNodeId: NodeId;
      history: ChoiceRecord[];
    }
  | {
      status: "resolved";
      history: ChoiceRecord[];
      resolutionId: ResolutionId;
      finalChoiceId: ChoiceId;
      snapshot: ResolutionSnapshot;
    };
```

`GameState.cases` 只收录已经解锁的案件。记录不存在表示未解锁，不再另外保存一份 `unlockedCaseIds`。

`history` 必须包含最终选项。选择 ID 可以是案件内唯一，但记录仍保存来源节点，便于验证路径与排查过期操作。

save schema v2 的结果快照只保存事实：`resolutionId`、`finalChoiceId`、历史路径、结算时间／顺序和每项 `actualDelta`。案件标题、选项文字、verdict/result 与属性 label 均不进入存档；回看时按稳定 ID 从当前 locale 的同版本语言包投影。静态文字变化不会重算或改写已保存的数值事实。

属性达到上下限时，实际变化可能小于内容配置值。例如属性从 98 增加 5、上限为 100，快照应记录 `actualDelta = 2`；结果面板与反馈飘字都显示实际变化，而不是再次读取模板中的 `+5`。

### 7.2 整局状态

```ts
export type RunPhase =
  | { type: "playing" }
  | { type: "ending"; endingId: EndingId }
  | { type: "ended"; endingId: EndingId };

export interface GameState {
  phase: RunPhase;
  attributes: Record<AttributeId, number>;
  flags: Record<FlagId, boolean>;
  cases: Record<CaseId, CaseProgress>;
  pendingStoryIds: StoryId[];
  completedStoryIds: StoryId[];
}

export interface SaveEnvelope {
  saveId: string;
  profileId: string;
  revision: number;
  saveSchemaVersion: 2;
  contentRef: ContentRef;
  createdAt: string;
  updatedAt: string;
  state: GameState;
}
```

`revision` 用于防止旧状态覆盖新存档，与 `saveSchemaVersion`、内容版本没有关系。它只存在于封套／数据库字段，不在 GameState 中重复维护。

GameState 必须可直接序列化成 JSON：不使用 Date 对象、Map、Set、函数、DOM 引用或非有限数值。时间存为字符串，数值合法性由 Schema 和规则共同约束。

### 7.3 核心不变量

| 编号 | 不变量 |
| --- | --- |
| S1 | 一个 caseId 只有一份 CaseProgress |
| S2 | active 必须有合法 currentNodeId；resolved 必须有结果快照 |
| S3 | resolved 案件不能再次接受选择或结算 |
| S4 | GameState 引用的案件、节点、结果与剧情必须存在于绑定内容版本 |
| S5 | pendingStoryIds 和 completedStoryIds 各自无重复，且互不相交 |
| S6 | 属性必须在已声明的合法范围内 |
| S7 | ending／ended 不能再开始或处理案件 |
| S8 | 有待播放的重要剧情时，不能推进案件 |
| S9 | 已确认的新状态必须对应一次成功的完整存档提交 |
| S10 | 同一 revision 的状态不能被两个不同操作先后当作有效起点覆盖保存 |

这些不变量应进入测试，而不只是写在文档中。

---

## 8. 游戏操作与统一提交入口

### 8.1 最小命令集合

```ts
export type GameCommand =
  | { type: "startCase"; caseId: CaseId }
  | {
      type: "chooseOption";
      caseId: CaseId;
      nodeId: NodeId;
      choiceId: ChoiceId;
    }
  | { type: "completeStory"; storyId: StoryId };

export type FeedbackRequest = {
  type: "attributeFeedback";
  caseId: CaseId;
  changes: AttributeChangeSnapshot[];
};

export type TransitionErrorCode =
  | "CASE_LOCKED"
  | "CASE_ALREADY_RESOLVED"
  | "CASE_ALREADY_STARTED"
  | "STALE_CHOICE"
  | "INVALID_CHOICE"
  | "STORY_BLOCKING"
  | "INVALID_STORY_COMPLETION"
  | "RUN_FINISHED"
  | "CONTENT_INVALID";

export type TransitionResult =
  | {
      ok: true;
      nextState: GameState;
      feedback: FeedbackRequest[];
    }
  | {
      ok: false;
      code: TransitionErrorCode;
      message: string;
    };

export interface TransitionContext {
  nowIso: string;
}

export type Transition = (
  state: Readonly<GameState>,
  command: GameCommand,
  content: Readonly<GameContentCatalog>,
  context: TransitionContext
) => TransitionResult;
```

`transition` 是同步纯函数：不读写文件，不触发播放，不修改输入。时间由外层注入，首版不依赖随机数。以后确实加入随机规则时，显式传入并保存随机状态，不能悄悄在逻辑里调用随机函数。

`nodeId` 用来拒绝来自旧选项组的点击。仅传 `choiceId` 不够，因为 UI 可能已发生替换，旧回调仍然到达。

### 8.2 GameSession 的职责

GameSession 不是游戏引擎框架，只是一个协调模块。可以用工厂函数实现，负责读取当前已提交状态、调用 transition、保存以及发布。

```text
dispatch(command)
  1. 同步取得提交锁；已有操作进行中则返回 BUSY，不排队执行旧点击。
  2. 确认当前会话、存档、内容已经加载且相互匹配。
  3. 从会话读取最新的已提交 SaveEnvelope，而不是组件闭包里的旧值。
  4. 调用 transition，规则拒绝时不写入数据库。
  5. 用旧 revision 作为预期版本，一次保存完整 nextState。
  6. 保存成功后，发布新的封套与 GameState。
  7. 再通知 UI 展示临时反馈；重要剧情从已保存队列读取。
  8. 释放提交锁。
```

提交锁必须在第一个 `await` 之前获得。仅依靠 React 下一次渲染后将按钮设为 disabled，不能作为唯一的防重复措施。

保存期间首版禁用选项、文档切换、注销、切换 Profile 和重开操作，避免正在提交时上下文发生变化。完成后再恢复交互，不建设复杂操作排队器。

### 8.3 保存与展示失败要分开处理

数据库提交成功是事实边界。保存后的飘字、动画、渲染或订阅回调失败，不应被显示成“存档失败”，更不能重新执行结算。

```text
规则错误 → 无状态变更，显示合适提示。
保存失败 → 不发布新状态，保留旧状态，进入错误恢复流程。
保存成功、特效失败 → 新状态仍然有效，丢弃特效并记录问题。
保存成功、UI 刷新异常 → 从数据库重新加载，不重放玩家命令。
```

持久化返回不确定错误时，先重新读取存档：比较 revision 和已保存内容，确认操作是否已提交，再决定是否恢复交互。不能直接自动重试最终选择。

### 8.4 不需要的机制

首版不要求 GameEvent 驱动所有状态变化，不保存可重放的全量事件日志，不引入全局事件总线。

将来需要分析日志时，可以额外记录摘要，但日志不成为恢复存档的必要条件。

---

## 9. 核心业务流程

### 9.1 启动、登录与读档

```text
初始化数据库与表结构
  → 显示本地登录／注册页
  → 确定 Profile
  → 读取该 Profile 的当前存档
  → 检查 saveSchemaVersion，必要时执行有测试的迁移
  → 按 contentRef 加载精确版本内容
  → 校验存档结构和内容引用
  → 发布会话状态
  → 若有待播放剧情，先进入 StoryPlayer
  → 否则进入 AppShell 或已结束视图
```

首次创建游戏时，使用内容定义构造初始属性、标记、案件和剧情队列，完成必要的初始规则检查，然后保存成功再进入主界面。

没有存档可以创建新游戏；有存档但读取失败不能伪装成“没有存档”，更不能直接覆盖为空白新局。

### 9.2 打开案件

`pending` 案件：提交 `startCase`，初始化 `currentNodeId` 和空历史，保存成功后显示选项。

`active` 案件：只切换 UI 选中 ID，恢复已保存节点，不重复初始化。若旧调用仍提交 startCase，规则返回 CASE_ALREADY_STARTED，不重置节点。

`resolved` 案件：只切换 UI，显示快照，不执行规则，不保存新的游戏进度。

未解锁案件：即使调用方手工提供 ID，也必须拒绝开始。

### 9.3 选择中间选项

检查当前处于 playing、无阻塞剧情、案件 active、来源节点一致、选项存在；随后将本次选择加入历史，移动到目标节点，整体保存。

提交成功后，选项面板显示新节点。原标注关闭，焦点移动到新选项组的标题或合适入口。首版不在此时修改属性，不触发全局解锁规则。

### 9.4 最终选择与结算顺序

最终选择与中间选择通过同一 `chooseOption` 入口，由目标类型决定是否结算。

结算必须按固定顺序完成：

1. 验证操作；将最终选择加入历史。
2. 根据选中的 resolution 计算属性与标记变化，限制属性范围。
3. 生成最终判决、案件结果和实际属性变化快照，将案件改为 resolved。
4. 用结算后的状态检查文档解锁规则；已解锁案件不重复添加。
5. 用同一结算后的状态检查普通剧情规则，按 `order` 排序，将未出现过的剧情加入队列。
6. 检查结局，若命中则固定 endingId、将阶段改为 ending，并把结局剧情排在本次普通剧情之后。
7. 对生成的新状态执行必要的不变量检查，一次保存完整快照。
8. 发布状态：案件移入已处理列表，右侧保留该案件结果，再进行反馈与重要剧情播放。

`resolvedOrder` 可用本次结算前 resolved 案件数加一生成；不需要再维护一个可能失配的独立完成计数。

普通剧情顺序相同的情况下按稳定的规则 ID 排序。结局剧情不同时用于普通剧情规则，也不能是本局已经完成的剧情，内容校验应拒绝这些配置。

如果结算同时触发结局与新案件解锁，新案件可以存在于状态中，但本局已锁定结局，不能继续处理。首版不追加复杂的“撤回解锁”规则。

### 9.5 完成重要剧情

StoryPlayer 读取 `pendingStoryIds[0]` 播放。播放完成、允许的跳过，或者玩家确认阅读视频故障时的替代文本后，提交 `completeStory`。

规则只接受队首剧情。成功时从队列移除并加入 completed；如果处于 ending 且队列已经清空，转为 ended。

完成剧情不重复计算属性、不结算案件、不再评估解锁。为保证剧情先展示、案件后可操作，依靠队列阻塞交互即可，不把业务效果放进播放器回调。

### 9.6 已处理案件回看

读取绑定内容中的静态正文，以及 CaseProgress 内的 ResolutionSnapshot。属性面板展示当前整局属性，结果区域展示该案结算时的变化，二者含义不同。

读历史案件不重新播放当时的剧情，不重复出现收益飘字，不触发新解锁。

---

## 10. SQLite 持久化与错误恢复

### 10.1 存储粒度

使用同一 SQLite 保存 Profile、存档和设置。游戏状态不拆成属性表、案件节点表、选择记录表等多套关系表。

首版核心表可采用：

```sql
CREATE TABLE profiles (
  profile_id TEXT PRIMARY KEY,
  login_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE saves (
  save_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  save_schema_version INTEGER NOT NULL,
  content_package_id TEXT NOT NULL,
  content_version TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_saves_profile ON saves(profile_id);

CREATE TABLE settings (
  scope TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (scope, setting_key)
);
```

`state_json` 只保存 GameState。其余字段组成 SaveEnvelope，不在 JSON 内重复存一份。

`scope` 可为 `app` 或 `profile:<profileId>`。全局音量放 app，侧边栏偏好可以放 Profile；具体归属保持一致即可。

示例未设置依赖连接级开关的外键。首版由 Profile／SaveRepository 验证归属，暂不提供删除 Profile 功能。以后增加删除或多表写入时，应在同一数据库连接的事务内处理，并验证约束配置，不用多个互不关联的调用拼接“事务”。

### 10.2 SaveRepository 契约

```ts
export interface SaveRepository {
  load(saveId: string, profileId: string): Promise<SaveEnvelope | null>;
  create(save: SaveEnvelope): Promise<void>;
  commit(input: {
    saveId: string;
    profileId: string;
    expectedRevision: number;
    nextState: GameState;
    updatedAt: string;
  }): Promise<{ revision: number }>;
}
```

首版每个 Profile 只展示一份当前存档，但 `saveId` 独立于 `profileId`。重复点击“新游戏”必须被同一会话锁挡住；新局写入成功之前，不删除旧局。读到多份存档时不能静默猜测，应通过保存的当前存档设置或明确的选择规则处理。

### 10.3 一次更新完整状态

```sql
UPDATE saves
SET state_json = $1,
    revision = revision + 1,
    updated_at = $2
WHERE save_id = $3
  AND profile_id = $4
  AND revision = $5;
```

Repository 必须检查受影响行数恰好为 1。为 0 表示存档不存在、归属不匹配或版本冲突，不能视作成功。

这是一条包含全部业务状态的写语句，不是分别保存案件和属性。SQLite 的隐式事务及原子提交机制是这一方案的基础；数据库原子性不替代应用侧的重复操作检查。[R4]

不要先删除旧记录再插入新记录，也不要让 UI 组件直接提交 SQL。参数必须绑定，不能把用户输入或内容文本拼接进 SQL。Tauri SQL 插件官方给出了参数化调用与迁移方式。[R3]

### 10.4 存档位置与插件配置

数据库位于应用的用户可写目录，不放在程序安装目录或内容资源目录。使用 SQL 插件相对数据库地址时，遵循插件实际解析位置；官方文档将该相对路径说明为 AppConfig，不应随意写死为项目目录或笼统假定的 AppData。[R3]

Rust 层只需初始化 SQL 插件、启用 SQLite、注册迁移和配置必需权限。插件默认权限不包含所有写入能力，应按官方权限说明显式允许需要的操作。[R3][R11]

业务规则仍然在 TypeScript 中执行。未来确有多记录原子写入需求时，可增加一个薄 Rust 存储命令；这不是把整个游戏逻辑搬到 Rust 的理由。

### 10.5 错误恢复

| 故障 | 行为 |
| --- | --- |
| 操作在计算阶段被拒绝 | 不写盘，不改状态，解释原因 |
| 写入失败，确认未提交 | 保持旧状态，允许用户重试或退出 |
| 写入结果不确定 | 锁定推进操作，重新读档核对，不能盲目重试 |
| revision 冲突 | 重新加载有效存档，告知状态已变化，不自动覆盖 |
| 存档 JSON 损坏 | 保留原记录，显示恢复入口，不自动创建新局覆盖 |
| 内容版本缺失 | 阻止继续该局并说明缺失版本，不替换成最新版 |
| Schema 版本过新 | 提示需要兼容应用版本，不尝试降级读取 |
| 普通动画失败 | 不影响已经保存的状态 |
| 重要视频失败 | 显示故障信息和替代文本，提供明确继续路径 |

每次有效操作即时保存，不依赖关闭窗口事件作为唯一保存机会。进程在提交后、发布 UI 前退出时，下次直接读取已经提交的状态，不再次执行该命令。

### 10.6 迁移与备份

区分三种版本：数据库表结构迁移版本、`saveSchemaVersion`、`contentRef.version`。它们不能用同一个数字代替。

改变存档 JSON 结构时提供明确的旧到新转换，并用旧版存档样本测试。当前在 storage/load 边界执行 v1→v2：从 resolved history 最后一项推导 `finalChoiceId`，保留 ID、数值、时间、顺序和 revision，丢弃旧本地化字符串与 attribute label；正式 writer 只写 v2。迁移后再次读取是幂等的，失败则返回稳定诊断且不修改原记录。

正式发布前至少提供已提交存档的 JSON 导出／导入或等效备份路径；做迁移与覆盖操作前保留原始数据。首版开发阶段不必建设多代自动备份系统，但不能把“损坏后自动重开”当作恢复方案。

---

## 11. 内容加载、版本与兼容

### 11.1 一个统一加载入口

```ts
export interface SplitContentRepository {
  loadGameContent(ref: ContentRef): Promise<Readonly<GameContentCatalog>>;
  loadLocalization(
    ref: ContentRef,
    locale: AppLocale,
  ): Promise<Readonly<LocalizedContentCatalog>>;
}
```

GameSession 在开始或恢复一局时按 `ContentRef` 加载并校验精确规则版本；Game Core 只接收只读 `GameContentCatalog`。Application 的 UI-facing adapter 再按根 locale 加载 `LocalizedContentCatalog` 并生成不含 target/effects 的只读 `GameContentView`。切换语言不 dispatch GameCommand、不写存档、不改变 revision 或 GameState；缺失语言包明确报错并可回退 manifest 默认语言。

不让每次选项点击都触发文件或网络请求。首版文本内容可整体加载，媒体只保存索引，按需播放；若实测文本规模造成明显启动问题，再做索引与按案加载。

Repository 内部可以直接 import 内置 JSON，也可以读取资源文件。禁止的是 UI 直接 import `case_001.json`，不是禁止所有 JSON import。

### 11.2 内容包布局

```text
content/
└── base-story/
    └── 1.0.0/
        ├── game.json
        ├── locales/
        │   ├── zh-CN.json
        │   └── en-US.json
        └── media/
            ├── images/
            └── videos/
```

`game.json` 是唯一结构／规则目录，语言文件只含严格显示字段。Validator 要求每个声明 locale 对规则层所有可显示 ID 完整且精确覆盖，拒绝缺失、额外 ID、身份不匹配、非法 TextBlock 和夹带业务字段。规则层不关心物理目录结构，UI 不直接读取内容路径。

图片和视频使用 assetId 引用，AssetResolver 将包内相对路径解析成当前运行环境可用的 URL；不能把开发机绝对路径写入案件或存档。

### 11.3 一局绑定一个完整版本

新局使用当前默认内容版本；旧局始终使用存档记录的精确版本。即使某个案件尚未开始，也不在这局里自动换用更新版本。

**版本绑定必须同时保证对应内容仍然可获得。** 正式发布后，应用更新不能只留下新内容并删除旧包。首版可将仍受支持的旧包继续随安装包分发；以后再决定下载保留或明确迁移策略。

结算快照只保存历史事实，不包含静态正文、裁定文字或未完成分支。因此历史与进行中内容都需要绑定版本的规则包及语言包，“保存了结果快照”不意味着可以删除旧内容包。

已发布的相同 `packageId + version` 必须内容不可变。修正文案或规则时也产生新版本，不能悄悄修改原版本后继续使用相同标识。

内容版本绑定不等于冻结应用代码。修改条件、效果或节点的解释方式时，必须验证旧内容包与旧存档仍能按约定运行；不兼容的改动需要对应的 Schema 支持或显式迁移，不能仅保留旧 JSON 就假定兼容。

### 11.4 将来的热更新

首版只保留 SplitContentRepository、ContentRef、Schema 校验和资源 ID 边界，不实现下载器。

真正增加远程内容时，在仓库后面新增下载、验证、安装和版本管理流程。新包先完整下载并通过验证，再激活供新局使用；下载失败不能破坏现有包。旧局仍使用旧版本，除非存在显式迁移。

内容包只能包含受支持的数据和媒体，不能借“热更”执行任意脚本。应用程序更新与内容更新是两个独立问题，更新渠道在真正确定发布平台时再决定。

---

## 12. 悬浮标注、播片与结局演出

### 12.1 选项说明标注

数据来自 `ChoiceDefinition.annotation`，在悬停、聚焦或点击信息入口时显示。它解释选项，不修改任何游戏状态，也不通过属性变化事件生成。

说明中若要展示某个已知数值含义，应使用明确的设计文本或只读预览逻辑。不要为了 tooltip 直接调用正式提交函数。

### 12.2 操作反馈

属性飘字等反馈来自保存成功后的 FeedbackRequest，显示实际变化。反馈不存档、不参与恢复，不阻止下一次操作。

最终选择会卸载原选项组，因此按钮坐标不能作为长期依赖。首版可将反馈锚定到稳定的判决结果区或属性栏；确需从按钮位置飘出时，在提交前捕获一次临时锚点，不能保存进 GameState。

无论反馈被关闭、丢弃或播放失败，属性数值已经在存档中确定。

### 12.3 重要剧情的恢复规则

`pendingStoryIds` 的顺序就是播放顺序；不再保存第二份“当前剧情 ID”作为独立权威状态。播放器当前位置和视频播放秒数只属于临时 UI 状态。

默认一次 StoryDefinition 是一个恢复单元。播放中退出，下次从该单元开头播放，可能重放部分内容，但不能漏掉尚未确认完成的剧情。

如果单段剧情长到“从头播放”不可接受，可以先把它拆成几个短的 StoryDefinition；只有确实需要精细续播时，再添加持久化步骤游标。

完成记录也要保存成功才离开阻塞状态。播放器可以显示“已播放，正在保存”，但保存失败不能假定剧情已经完成。

### 12.4 视频失败与跳过

每个视频步骤必须有替代文本。处理资源缺失、解码失败、播放失败和加载异常时，显示原因，提供重试以及阅读替代文本后继续的路径，不允许空白播放器永久卡住游戏。

允许跳过的剧情可直接结束当前剧情；不允许正常跳过的剧情，在技术故障下仍允许阅读替代文本后继续。跳过与降级只改变观看方式，不改变已提交的案件后果。

视频可能需要用户明确点击后才开始播放；播放失败时保留可点击入口，不把自动播放成功当作状态机前提。

Tauri 在 Windows 使用 WebView2，macOS／Linux 使用不同的 WebKit 集成。因此必须在实际目标系统的打包应用内验证编解码、声音、全屏覆盖及资源访问，不以开发浏览器验证代替。[R8]

### 12.5 资源接入

内置媒体可由 Tauri 资源打包系统分发，平台层解析实际资源位置。若通过 `convertFileSrc` 暴露本地媒体，需要配置对应的资源访问范围和 CSP 媒体来源；不能只转换路径却忽略访问配置。[R9][R10]

不在案件内容中使用任意本地绝对路径，不为播片开放整个文件系统。资源地址由 AssetResolver 提供，播放器只接收 URL。

### 12.6 溅血与结局画面

溅血、淡入淡出等效果放在覆盖主界面的表现层，优先使用图片、CSS 或简单 Canvas。只影响应用内部，不需要操作系统级全屏接管。

进入结局时先保存 `phase = ending`、endingId 与剧情队列，再播放演出。剧情完成后保存 `phase = ended`，最后展示结局视图。

减少动态效果设置可跳过震动、闪烁和非必要动画，但不能改变结局。影片和动效卸载时清理播放、监听器及定时器，切换 Profile 时不允许旧会话的回调修改新会话。

---

## 13. 本地用户与安全边界

### 13.1 本地 Profile，而不是联网认证

注册创建稳定 profileId 和本地显示身份；登录选择该 Profile 并加载其存档。用户名规范化规则必须明确，例如统一去掉两端空白；不要由不同页面各自处理。

首版默认不建设密码、Token、刷新令牌、邮箱验证或密码找回服务。登录界面的世界观表现可以保留，但不应给用户造成已经有云账号或跨设备同步的误解。

如果最终要求真正的本地密码锁，再单独增加成熟的凭据校验实现；不把用户密码作为普通文本保存在存档或设置中。它也不等于对拥有本机文件访问权限的用户提供完整防篡改保护。

### 13.2 会话隔离

所有存档读写同时使用 saveId 和 profileId 验证归属。注销后清理游戏会话、选中文档、标注和演出实例。

初始化与读档应有明确的加载状态，迟到的旧请求不能覆盖新 Profile 的状态；可采用请求序号核对，不必引入复杂任务系统。

### 13.3 内容与平台权限

内容按数据处理，不执行脚本或任意 HTML；平台 API 只开放应用真正需要的能力。远程内容将来接入时也不能继承任意文件访问权或 SQL 执行权。

Tauri 的 capability 机制用于限定窗口／WebView 能使用的命令与权限；配置应只授予当前功能需要的范围。[R11]

---

## 14. 建议目录与模块职责

```text
src/
├── app/
│   ├── App.tsx
│   └── bootstrap.ts
├── application/
│   ├── gameSession.ts           操作、保存、发布的统一协调入口
│   ├── sessionStore.ts          会话与少量共享 UI 状态
│   └── profileService.ts        Profile 创建、进入与退出
├── ui/
│   ├── profile/                 登录与注册
│   ├── shell/                   主窗口、侧边栏
│   ├── case/                    正文、选项、判决和结果
│   ├── presentation/            标注、反馈、视频与结局
│   └── common/                  真正复用的基础控件
├── game/
│   ├── model.ts                 GameState、CaseProgress、快照
│   ├── commands.ts              命令与返回类型
│   ├── transition.ts            开始、选择、完成剧情
│   ├── progression.ts           条件、解锁、结局检查
│   └── selectors.ts             未处理、已处理、统计查询
├── content/
│   ├── schema.ts                内容 Schema 与类型
│   ├── repository.ts            加载内置内容并组装 Catalog
│   └── validate.ts              跨文件引用与图结构校验
├── storage/
│   ├── database.ts              SQL 插件封装
│   ├── saveSchema.ts            存档 Schema 与版本迁移
│   ├── saveRepository.ts        整局读取、创建、条件提交
│   ├── profileRepository.ts
│   └── settingsRepository.ts
└── platform/
    └── assets.ts                资源路径和媒体 URL 解析

content/                         实际内容数据与媒体
scripts/
└── validate-content.ts          命令行校验入口

tests/
├── game/
├── content/
├── storage/
└── fixtures/                    两三个案件、旧版本存档、异常样本

src-tauri/
├── src/lib.rs                   插件、迁移和应用初始化
├── migrations/                  表结构 SQL
├── capabilities/                必需权限
└── tauri.conf.json              应用与资源打包配置
```

文件小的时候可以合并。目录体现职责边界，不要求一开始创建所有空文件。

只有被复用的组件才进入 `common/`。只有存在真实差异实现的边界才需要接口；不要给每个纯函数增加 Factory、Manager、Service 和 Adapter 四层包装。

---

## 15. 内容生产与校验

### 15.1 首版流程

```text
人工／AI 编写案件
  → 写成统一内容格式
  → Schema 校验
  → ID、引用、分支图与规则校验
  → 在现有 CaseReader 中试玩
  → 人工确认叙事与选项质量
  → 随内容包发布
```

首版工具叫 Content Validator 即可。没有格式转换、资源加工或编译优化需求时，不建设 Compiler。

AI 生成管线不直接操作存档，不直接发布内容。它与人工写作使用同一份 Schema、示例和校验入口，生成结果同样需要人工审阅。

### 15.2 自动检查范围

| 类别 | 必须检查 |
| --- | --- |
| 结构 | 必填字段、枚举、类型、非空选项、整数范围 |
| ID | 案件 ID 全局唯一；节点／结果 ID 在案件内唯一；选项 ID 在案件内唯一 |
| 引用 | 起点、目标节点、结果、属性、标记、剧情、结局和资源都存在 |
| 图结构 | 所有发布节点可达、无环、每条路径最终进入 resolution |
| 属性 | 初始值和上下限合法，效果引用已声明属性 |
| 规则 | 条件字段有效、目标案件存在、结局优先级不重复 |
| 剧情 | steps 非空；视频引用视频资源且有替代文本；时长配置有效 |
| 队列设计 | 结局剧情不作为普通剧情；每个结局使用独立剧情 ID |
| 资源 | 清单路径合法、文件存在、类型符合使用位置 |
| 版本 | 包版本与目录一致，Schema 版本受支持 |

校验器应报告“文件 + 对象 ID + 字段路径 + 问题”，例如 `case_003.nodes.review.choices[1].target.nodeId 指向不存在的节点`，而不是只报 JSON 无效。

对于允许合流的分支图，不能把“某节点被多条路径访问”误报为环；应使用真正的有向图环检测。

### 15.3 自动校验的边界

结构合法不代表叙事合理、选择有意义或难度合适。数值结果与解锁规则之间也可能产生复杂的全局死路，单纯引用校验无法证明所有游玩路径都可完成。

首版对两三个测试案件穷举选择路径，并对主要剧情路线做场景测试。之后根据内容规模增加覆盖，不宣称 Validator 自动保证故事质量或全部全局可达性。

### 15.4 运行时校验

内置内容在构建时完整校验，运行时仍检查 Schema 与关键引用。加载存档时校验其结构和引用；以后下载内容时执行与构建期同等级别的校验。

日常每次点击不必重新扫描整个包。操作入口检查与本次行为有关的合法性即可。

---

## 16. 测试与验收

### 16.1 纯逻辑测试

使用 Vitest 运行规则与校验测试，不启动 Tauri 也应能够完成。[R7]

| 场景 | 预期 |
| --- | --- |
| 初始游戏 | 属性、标记、初始案件与内容配置一致 |
| 开始 pending 案件 | 变为 active，并指向起点 |
| 选择中间选项 | 替换节点、追加历史，不改变全局属性 |
| 提交不存在的选项 | 拒绝且不修改输入状态 |
| 提交旧节点的选项 | 返回 STALE_CHOICE |
| 最终结算 | 属性、结果快照、解锁和剧情队列同时进入新状态 |
| 重复最终选择 | 拒绝，不重复加减属性 |
| 属性达到边界 | 限制结果值，快照记录实际变化 |
| 多条规则解锁同一案件 | 只出现一份案件进度 |
| 多个结局同时匹配 | 按确定优先级选中一个 |
| 有重要剧情待播放 | 开始与选择案件均被拒绝 |
| 完成非队首剧情 | 拒绝 |
| 结局剧情完成 | 队列清空后进入 ended |
| 已处理文档回看 | 不产生状态变化或演出请求 |

### 16.2 存档与恢复测试

必须覆盖 active 节点恢复、最终结果恢复、待播放剧情恢复、已完成剧情不自动重播、Profile 隔离、旧 revision 写入被拒绝、写入失败不发布新状态、旧版存档迁移失败不破坏原记录。

特别验证两个中断点：结算已经提交但 UI 尚未刷新；视频已经播放完但完成记录尚未提交。前者恢复已结算状态，后者允许重播未确认完成的剧情，但都不能重复结算案件。

Repository 测试至少有一组使用真实 SQLite；替身只适合验证调用顺序，不能证明 SQL 的条件更新和失败处理正确。

### 16.3 UI 与实际打包验收

在目标 PC 系统的实际安装包中测试：干净环境启动、离线使用、注册与读档、三个列表折叠、长文滚动、选项替换、键盘标注、窗口缩放、视频声音、播放失败降级、结局覆盖层，以及应用重启后的进度恢复。[R8]

保存期间快速双击和切换文档不应产生多次提交。正文缩放后浮层仍应位于可见区域，不因选项卸载停留在旧位置。

退出和重新进入应用后，已处理案件继续只读；结束本局后不能通过残留按钮继续选择。

### 16.4 首版验收底线

两三个案件必须完整走通：

```text
注册 → 新游戏 → 开始案件 → 中间选择 → 退出恢复
  → 最终判决 → 属性变化 → 新案件解锁 → 历史回看
  → 重要播片 → 播放中退出 → 恢复 → 结局 → 只读回看
```

此闭环通过后，再增加案件数量和美术表现，而不是先扩展架构层数。

---

## 17. 开发顺序

### 阶段一：真实运行环境与最小样本

搭建 React、Tauri、SQLite；制作主窗口与一个长文样本，验证本地视频、字体、窗口缩放与资源打包。同步编写两三个代表性案件，作为后续测试基准。

交付标准：打包应用可离线启动、读取本地资源、保存并重新读取一份测试状态；视频无法播放时有可工作的替代路径。

### 阶段二：领域规则与内容校验

完成内容和存档 Schema、transition、结算快照、解锁与结局规则，建立 Validator 和纯逻辑测试。界面可以暂时简陋，不先追求动画。

交付标准：无 UI 时可完成所有样本案件并得到确定结果，非法分支和重复结算被拒绝。

### 阶段三：完整交互与存档闭环

接入 Profile、GameSession、侧边栏、CaseReader、结果面板以及整局保存。实现提交锁、条件版本写入、错误提示、重新读档和历史回看。

交付标准：每次选项选择后退出并重启，都恢复到正确位置；不同 Profile 不互相影响。

### 阶段四：剧情、表现与交付验证

接入重要剧情队列、播放失败降级、结局、选项标注、临时反馈与设置。用实际安装包执行完整验收，再扩大内容生产。

交付标准：关键剧情不丢失，普通特效不改变业务结果，所有样本路径能稳定到达预期结局。

不设立“先建设通用基础设施”的独立大阶段。每阶段都应形成可以运行或验证的具体闭环。

---

## 18. 扩展边界与实施约束

### 18.1 未来需求怎样接入

| 后续需求 | 届时增加的内容 | 现在不做的工作 |
| --- | --- | --- |
| 更多案件 | 新 JSON、资源与测试样本 | 每案独立页面或脚本 |
| AI 批量产出 | Schema、示例、生成与人工验收管线 | 运行时 AI 改写游戏规则 |
| 中间选择影响属性 | 明确新增效果类型、快照与保存测试 | 偷偷把副作用塞进按钮回调 |
| 长篇剧情精确恢复 | 剧情步骤游标或更细恢复单元 | 首版保存视频每秒位置 |
| 内容远程更新 | 下载、可信校验、原子安装、旧版本保留 | 空的在线 Provider 家族 |
| 更多桌面系统 | 目标系统打包与媒体／布局验收 | 默认宣称 PC 等于全平台完成 |
| Mobile | 窄屏布局、触摸交互、生命周期及存储适配 | 首版为未确定平台重写 UI |
| 云账号和云存档 | 独立认证、同步和冲突策略 | 把本地 Profile 当作云账号 |
| 模拟计算明显变重 | 测量后增加 Worker 或专用计算模块 | 未测量就迁移到 Rust |

纯 TypeScript 逻辑便于在相容的 TypeScript／JavaScript 客户端和测试环境复用；这不等于以后换成 Flutter／Dart 时可直接复用原代码。跨语言重用需要额外方案，不能作为当前架构的无条件承诺。

### 18.2 实施时必须保持

每个普通案件是数据；一局只有一个权威 GameState；每次游戏操作走同一提交入口；已完成案件只读；重要剧情有持久化记录；旧局读取绑定内容版本。

UI 可以增加组件，规则可以增加普通函数，内容可以增加文件，但不能绕过这些边界。

### 18.3 不应自行扩大的设计

不要把本项目变成事件溯源系统，不要给每种规则增加一个运行系统，不要实现通用脚本语言，不要提前完成移动端，不要因为目录里有 Repository 就加入多层抽象工厂。

**首版的完成标志不是“架构模块齐全”，而是样本案件闭环在实际打包应用中稳定运行，并能安全保存和恢复。**

---

## 附录 A：案件内容示例

以下是便于作者阅读的“规则 + zh-CN 文案”合并展示稿，不是可加载的物理格式。发布时必须按稳定 ID 拆到 `game.json` 与 `locales/zh-CN.json`：前者保留 order、target、effects，后者保留 title、正文、人物、选项、verdict/result；不得把第二份规则写入语言文件。它不代表真实法律程序或量刑标准。

```json
{
  "id": "case_001",
  "title": "第 001 号：夜间档案室事件",
  "order": 10,
  "characters": [
    {
      "id": "clerk_lin",
      "name": "林记录员",
      "description": [
        { "type": "paragraph", "text": "在档案室任职三年的记录员。" }
      ]
    }
  ],
  "summary": [
    { "type": "paragraph", "text": "一份未获授权带离的档案在次日清晨归还。" }
  ],
  "body": [
    { "type": "paragraph", "text": "记录员承认将档案带回住处补录，但否认复制或转交其中的内容。" },
    { "type": "paragraph", "text": "值班簿存在一处时间涂改，现有材料无法确认由谁修改。" }
  ],
  "startNodeId": "assessment",
  "nodes": {
    "assessment": {
      "prompt": "你如何评价现有材料？",
      "choices": [
        {
          "id": "insufficient_evidence",
          "text": "现有材料不足以支持进一步处分",
          "annotation": {
            "title": "材料限制",
            "body": [
              { "type": "paragraph", "text": "这一决定承认程序违规，但不推定存在材料以外的行为。" }
            ]
          },
          "target": { "type": "resolution", "resolutionId": "close_with_note" }
        },
        {
          "id": "confirm_violation",
          "text": "确认违规，继续确定处理方式",
          "target": { "type": "node", "nodeId": "disposition" }
        }
      ]
    },
    "disposition": {
      "prompt": "确定最终处理方式。",
      "choices": [
        {
          "id": "formal_warning",
          "text": "给予书面警告",
          "target": { "type": "resolution", "resolutionId": "warning" }
        },
        {
          "id": "suspend_access",
          "text": "暂停档案访问权限",
          "target": { "type": "resolution", "resolutionId": "suspension" }
        }
      ]
    }
  },
  "resolutions": {
    "close_with_note": {
      "verdict": [
        { "type": "paragraph", "text": "保留程序违规记录，本次不追加处分。" }
      ],
      "result": [
        { "type": "paragraph", "text": "档案室接受了决定，同时提出修订外借登记流程。" }
      ],
      "effects": {
        "attributeDeltas": { "restraint": 3, "authority": -2 },
        "setFlags": { "first_case_closed": true }
      }
    },
    "warning": {
      "verdict": [
        { "type": "paragraph", "text": "给予书面警告，并要求完成内部流程培训。" }
      ],
      "result": [
        { "type": "paragraph", "text": "记录员继续留任，后续材料交接将由两人签字。" }
      ],
      "effects": {
        "attributeDeltas": { "restraint": 1, "authority": 1 },
        "setFlags": { "first_case_closed": true }
      }
    },
    "suspension": {
      "verdict": [
        { "type": "paragraph", "text": "暂停档案访问权限，等待后续内部安排。" }
      ],
      "result": [
        { "type": "paragraph", "text": "档案室调整了当周排班，一部分积压工作被转交其他记录员。" }
      ],
      "effects": {
        "attributeDeltas": { "restraint": -2, "authority": 3 },
        "setFlags": { "first_case_closed": true }
      }
    }
  }
}
```

该文件单独只是一个案件，不是完整可运行内容包。对应包还需声明 `restraint`、`authority` 两个属性，初始标记 `first_case_closed`，以及初始案件和后续规则。

---

## 附录 B：最小联调场景

建议建立一个专用于验证架构的小内容包，使用以下固定配置。它不是正式故事设计，只用于验证机制。

| 项目 | 配置 |
| --- | --- |
| 属性 | restraint、authority，初始均为 50，范围 0–100 |
| 初始标记 | first_case_closed = false |
| 初始案件 | case_001 |
| 后续解锁 | case_001 完成后解锁 case_002 |
| 阶段剧情 | case_001 完成后播放 story_after_case_001 |
| 第二个案件 | 一个简单决策案件，包含可以改变 restraint 的不同结果 |
| 结局一 | 完成两个案件且 restraint >= 50，优先级 100 |
| 兜底结局 | 完成两个案件，优先级 10 |
| 剧情资源 | 两个结局使用不同的剧情 ID，至少一个包含视频与替代文本 |

用这个包验证三类路径：正常连续完成；在中间节点退出再恢复；在结算后或播片中退出再恢复。额外制作视频资源缺失、非法节点、旧 revision 和损坏存档四类异常样本。

所有样本均应有明确预期结果。正式案件继续扩充时，不删除这些固定回归样本。

---

## 附录 C：技术依据

以下为本次设计核对的官方资料，核对日期为 2026-09-14。文中的产品行为、状态模型、默认规则和取舍是本项目的设计决策，不是这些资料强制要求的唯一实现。

| 引用 | 官方资料 | 本文对应内容 |
| --- | --- | --- |
| R1 | [Tauri — Frontend Configuration](https://v2.tauri.app/start/frontend/) | SPA 与 Vite 的接入方式 |
| R2 | [React — Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure)；[Sharing State Between Components](https://react.dev/learn/sharing-state-between-components) | 状态所有权、避免冗余与重复状态 |
| R3 | [Tauri — SQL Plugin](https://v2.tauri.app/plugin/sql/) | SQLite、参数化调用、迁移、路径与权限 |
| R4 | [SQLite — Transactions](https://www.sqlite.org/lang_transaction.html)；[Atomic Commit](https://www.sqlite.org/atomiccommit.html) | 单次写入的事务与原子提交基础 |
| R5 | [Zustand — 官方仓库](https://github.com/pmndrs/zustand) | 轻量会话 Store 的可选实现 |
| R6 | [Zod — Basic Usage](https://zod.dev/basics) | 运行时 Schema 校验和类型推导 |
| R7 | [Vitest — Getting Started](https://vitest.dev/guide/) | TypeScript 规则测试工具 |
| R8 | [Tauri — Webview Versions](https://v2.tauri.app/reference/webview-versions/) | 目标平台 WebView 差异与实机验证 |
| R9 | [Tauri — Embedding Additional Files](https://v2.tauri.app/develop/resources/) | 媒体资源打包与路径解析 |
| R10 | [Tauri — Core API / convertFileSrc](https://v2.tauri.app/reference/javascript/api/namespacecore/#convertfilesrc) | 本地资源 URL、asset protocol 与 CSP |
| R11 | [Tauri — Capabilities](https://v2.tauri.app/security/capabilities/) | 窗口与 WebView 的平台能力授权 |
