# 架构总览

核对日期：2026-10-15。项目使用 React、TypeScript、Vite、Tauri 2 和 SQLite；游戏规则由同步纯 TypeScript Core 实现。产品语义见 [产品需求](../product/requirements.md)，当前入口和功能接入状态见 [文档索引](../README.md)。

## 模块与依赖

| 目录                      | 职责                                           | 允许的项目依赖                              |
| ------------------------- | ---------------------------------------------- | ------------------------------------------- |
| `src/game`                | JSON 状态、命令、同步纯规则与不变量            | game、content、shared                       |
| `src/content`             | Zod 内容契约、校验、精确版本加载、本地化内容   | content、platform、shared                   |
| `src/storage`             | Profile/Save/Settings、迁移、内存替身与 SQLite | storage、game、content、shared              |
| `src/application`         | 账号进入、会话加载、提交协调、UI 内容投影      | application、game、content、storage、shared |
| `src/input`               | 动作词典、纯文字匹配与输入能力                 | input、shared                               |
| `src/ui`                  | 展示、用户操作与临时呈现状态                   | ui、application、content、input、shared     |
| `src/platform`            | Tauri、内容资源、语音、旁白与诊断平台能力      | platform、shared                            |
| `src/shared`              | 跨层纯契约与公共定义                           | shared                                      |
| `src/main.tsx`、`src/app` | 装配实现、入口与根级平台协调                   | 按装配职责选择各层实现                      |

依赖门禁以 [check-boundaries.mjs](../../scripts/check-boundaries.mjs) 为准。UI 通过 Application 的公开视图读取内容和发送命令，不导入 SQL、具体内容包或规则实现。Core 不依赖 React、DOM、Tauri、系统时间或随机数。

[demoTransition.ts](../../src/app/demoTransition.ts) 是正式 `game/transition` 的兼容导出名，不另维护一套演示规则。

## 游戏事实与提交边界

`GameState` 是已提交游戏事实；选中的案件、浮窗位置、退场计时等属于会话或 UI 呈现状态。内容包定义规则、文案和资源；存档只保存事实和稳定引用。

一次操作沿以下路径完成：

```text
UI GameCommand
    → GameSession 取得提交锁
    → transition(state, command, content, context) 计算候选
    → SaveRepository 按 expectedRevision 条件保存
    → 发布新快照
    → 通知临时反馈
```

规则接受已加载内容及注入时间，不修改输入、不自行保存、不触发表现。案件判决、聊天结果、主控推进、新闻已读、剧情队列和派发事实共同形成一次候选，并通过一次 CAS 提交。

提交成功前继续显示旧的已提交状态。重复操作返回 `BUSY`；未知写入结果或 revision 冲突进入 `needsReload`，由显式重载恢复，不自动重放命令。心跳、动画或反馈不能作为保存成功的证据。

## 会话与 UI 视图

[GameSession](../../src/application/gameSession.ts) 接收 `saveRepository`、`contentRepository`、`transition` 和 `clock`。会话状态为 `idle / loading / ready / saving / needsReload / error`。

| 接口                           | 语义                                             |
| ------------------------------ | ------------------------------------------------ |
| `load(saveId, profileId)`      | 加载已有存档及其精确内容版本，失败不创建新局     |
| `reload()`                     | 按上一次接受的身份重新加载                       |
| `getSnapshot()`、`subscribe()` | 提供引用稳定、递归冻结的已提交快照和订阅         |
| `dispatch(command)`            | 同步取得锁，计算、条件保存、发布；返回可判别结果 |
| `subscribeFeedback()`          | 在保存与快照发布成功后通知临时反馈               |

React 消费 [GameSessionView](../../src/application/gameSessionView.ts) 和 [GameContentView](../../src/application/gameContentView.ts)。视图提供本地化内容、案件选择与语言切换，不暴露案件 target/effects 或主控条件/意图供 UI 重新执行。

## 版本与存储

| 版本维度    | 定义来源                                                                                 | 约定                                             |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 内容 Schema | [content/schema.ts](../../src/content/schema.ts)                                         | 正式加载支持 2–6；新主流程使用 6                 |
| 存档 Schema | [game/model.ts](../../src/game/model.ts)                                                 | 当前写入 5；旧档读取迁移后在下一次成功提交时保存 |
| 内容包版本  | `ContentRef = { packageId, version }`                                                    | 精确绑定且发布后不可变；内容更新创建新版本       |
| 数据库结构  | [SQL migrations](../../src-tauri/migrations/) 与 [Rust 注册](../../src-tauri/src/lib.rs) | 按独立序号递增；已有初始表与账号教程表迁移       |

这些版本分别管理。旧存档迁移保留身份、revision 和精确 `contentRef`，读取不改数据库行，不补造新主流程事实。

SQLite 仓库校验 `saveId + profileId` 归属及 `expectedRevision`，原子保存整局 JSON，不解释游戏规则。桌面初始化失败应显示明确错误，不静默切换内存存档。浏览器内存预览的生命周期见 [当前入口](../README.md#当前入口)。

账号教程资格属于 Profile，通过 `profile_tutorials` 保存；完整首次进入和队列清理次序见 [主流程契约](main-flow.md#账号教程)。备份导入导出通过存储层契约提供。

## 内容与语言

[配置系统](configuration.md) 通过固定 Luban 和 TypeScript 组装生成版本包；运行时不读取 Excel。规则与本地化文案分离，语言不进入 `ContentRef` 或 `GameState`。历史判决显示来自存档中的稳定事实引用，切换语言不重新计算状态效果。

主剧情、聊天与新闻的现行执行契约见 [main-flow.md](main-flow.md)。schema 5 的旧阶段/聊天纯查询只保留兼容语义，不能用于新主流程接线。

声音与诊断在平台或装配边界接入；Core 不导入 Logger，也不由识别层修改属性或重试保存。具体操作见 [语音与旁白](../development/voice.md) 和 [诊断指南](../development/diagnostics.md)。

## 设计与验收来源

原始详细设计和各线验收保留在 [历史归档](../archive/README.md)。现行验证范围见 [开发与验证](../development/workflow.md)；历史 Schema、测试数量和会话工作树说明只适用于记录当时。
