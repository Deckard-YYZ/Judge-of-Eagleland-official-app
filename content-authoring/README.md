# 内容配置作者工具

最近核对：2026-10-15。本文维护编辑来源、生成命令、主流程制表和诊断方法。产品规则见 [需求](../docs/product/requirements.md)，技术边界见 [配置架构](../docs/architecture/configuration.md)，当前入口和实施状态统一见 [文档索引](../docs/README.md)。

## 编辑来源

作者输入经过 `Luban → 生成的 TypeScript 作者模型 → TS 组装 → 严格物理包加载器`，输出 `game.json`、双语 `locales/*.json` 和声明的 `media/**`。中间 JSON、生成代码及来源映射保存在 `artifacts/content-authoring/run-*`，不进入游戏运行时。

同一字段只有一个编辑来源：

- `Data/sample.xlsx`：案件、选项、效果、条件引用、触发绑定、人物/资源和主控表。
- `rules.json`：故事步骤、结局及对应版本的结构化分支；schema 6 的 `chatNodes` 仅定义聊天局部消息、回复和终止节点。
- `locales/zh-CN.json`、`locales/en-US.json`：独立长文与显示文案，通过稳定 ID 关联。
- `media/**`：原始图片、音频和视频资源，按字节复制。
- `generated/schema*.ts`：固定 Luban 导出的作者模型，运行时权威类型仍来自 `src/content/schema.ts`。生成模型和运行包不手工编辑或格式化。

schema4 骨架使用 CSV；XLSX 作者包不另维护同字段 CSV。工作簿前三行为字段、类型与说明，数据从第 4 行开始；数值/布尔使用相应单元格类型，ID/枚举使用文字。

## 作者包

下表的 source 相对本目录，output 相对仓库根目录：

| source                   | output                                 | Schema 与用途                                   |
| ------------------------ | -------------------------------------- | ----------------------------------------------- |
| `samples/mainflow-short` | `content/mainflow-short/0.1.3`         | schema 6 新主流程：主控、聊天、三案、新闻和教程 |
| `samples/schema4`        | `content/configuration-skeleton/0.1.0` | schema 4 CSV 作者骨架，兼容回归                 |
| `samples/schema5`        | `content/configuration-pilot/0.1.3`    | schema 5 XLSX 多轮案件、指示框、hook 和显式派发 |
| `samples/full`           | `content/configuration-complete/0.1.0` | schema 5 人物/媒体及旧阶段/聊天实验             |

全包注册表为 [packages.json](../scripts/content/packages.json)。制作新主流程内容使用 schema 6；旧模型用于复导和兼容测试，其样本数值、错误后果和派发策略不构成全局需求。

## 工具与生成

从仓库根目录运行，Node 版本要求见 [开发指南](../docs/development/workflow.md)。作者环境另需能构建 net8.0 的 .NET SDK，以及 [luban.lock.json](luban.lock.json) 锁定的干净 Luban v5.1.0 checkout。

```powershell
npm ci
$env:LUBAN_ROOT = '你的干净 Luban checkout 路径'
npm run typecheck
npm run content:build -- --source content-authoring/samples/mainflow-short --output content/mainflow-short/0.1.3
npm run content:check -- --source content-authoring/samples/mainflow-short --output content/mainflow-short/0.1.3
npm run content:check-all
npm run validate:content
npx vitest run tests/content --maxWorkers=1
```

`LUBAN_ROOT` 或 `--luban-root` 指向固定工具。工具检查锁定提交、已跟踪改动和未跟踪文件，构建 Release 并真实导表；正常忽略的 bin/obj 可保留。不会下载或修改工具源码。不带 source/output 的单包命令默认处理 schema4 骨架。

未设置 `LUBAN_ROOT` 时可选真实工具测试会跳过，而 `content:check-all` 明确失败。作者链验收必须实际运行导表并记录结果；CI 使用 Node 24、.NET 8 与固定 Luban。

输出路径须以清单中的 `<packageId>/<version>` 结尾。新内容使用新版本；已有版本只接受字节一致的重复生成。`--check` 比较完整文件清单与文本/二进制内容，缺失、额外文件或漂移均失败。

生成先在同一磁盘的临时目录完整组装、校验，再以目录 rename 发布；失败保留暂存和原有有效输出。模型漂移报 `AUTHOR_MODEL_DRIFT`，应审查暂存 `code/schema.ts` 后更新对应模型。

## schema 6 主流程表

`samples/mainflow-short/Data/sample.xlsx` 在基础案件、选项、人物、指示框和动作表之上增加以下主控表：

| sheet            | 权威字段                                                               |
| ---------------- | ---------------------------------------------------------------------- |
| `mainNode`       | 节点 ID、stageId、唯一 initial 标记                                    |
| `mainTransition` | ID、nodeId、when 条件 JSON、targetNodeId                               |
| `mainIntent`     | ID、nodeId、definition 意图 JSON，显式 ordered 策略也在这里            |
| `mainChat`       | 模板 ID、characterId、startNodeId、choiceThreshold、inactivityResultId |
| `mainPoolMember` | ID、poolId、caseId、when 条件 JSON                                     |
| `mainNews`       | 新闻 ID、独占 actionStoryId，可为空                                    |
| `mainSetting`    | tutorialStoryId                                                        |

JSON 单元格由运行时 Zod 的有限条件/意图 Schema 解析。`rules.json.chatNodes` 不重复定义阈值或主控意图。Luban 模型为 `generated/schema6.ts`，组装入口为 [assemble6.ts](../scripts/content/assemble6.ts)。

主图只读取案件判决、已有状态和已结束聊天结果。聊天局部节点只由回复推进；案件选择影响各活动实例的无交互计数。字段、结果、执行次序和保存约束见 [主流程契约](../docs/architecture/main-flow.md)。

主图校验拒绝循环、未知引用、重复实例、同节点多个派发、不可达或无终止路径的聊天，以及 schema 6 中旧 flow/外部分支/局部 effects/旧派发入口。新闻动作 story 与教程 story 必须独占，不能与其他新闻、initial、storyRules、case hook 或 ending 共用。双语覆盖所有新闻、聊天节点（含 terminal）和回复键。

## 资源与来源诊断

资源 path 为包相对 `media/**` 路径，作者文件位于对应 `source/media/**`。多个资产 ID 可以显式复用同一物理文件。路径穿越、大小写/NFC 别名、符号链接以及 junction/reparse 路径均拒绝，缺失资源定位到资产行的 path 单元格。

诊断包含文件、工作表、行、列、对象和字段，例如 `Data/sample.xlsx [asset!D4] object=portrait field=path`。语言和结构化分支诊断保留实际文件与字段路径，Luban 原始类型/文件/行列错误保留。schema4 CSV 以稳定对象 ID 定位，不猜测多行单元格物理行。

## 短流程试玩

通过 [DEV 主流程入口](../docs/README.md#当前入口) 体验生成包，以下阈值和 ordered 仅属于该样本：

1. 初始派发 `case-a`、启动 `instance-a`、发布 `news-n`。A 有三轮选择：第一轮后计数为 1，回复 `hello/ack` 归零，再做第二、三轮达到 2 得到 ignored；也可回复 `detail/finish` 得到 normal。
2. normal / ignored 分别进入互斥主节点，开放 `pool-p`、显式 ordered 派 B，并发布结果新闻。A 结案后进入 special，同步启动 `instance-b`、`instance-c`。
3. B 第一轮后 b/c 均为 1；回复 b 的 `hello/ack` 后 b=0/c=1；第二轮 c 达到 ignored、b=1；第三轮 b 达到 ignored。主控等待 B 判决及两个结果，按四种互斥结果组合派 C。
4. 关闭 `news-n` 并成功保存已读后，才排入独占 `news-ack` 敬礼动作；没有独立“阅读完成”按钮。`tutorial` 先文字后挥手练习，由账号首次资格决定是否排入。样本不配置错误效果或结局，C 结束后仍可留在工作区。

## 旧模型兼容

schema4 使用 `generated/schema.ts`；schema5/full 使用 `generated/schema5.ts`。旧 `configuration.flow`、`chatLastNode`、`externalBranches`、聊天节点直接产生流程后果等字段仅用于旧生成与纯查询回归。

旧查询入口位于 [configurationQueries.ts](../src/application/configurationQueries.ts)，不会自动推进 Session 或保存。旧接口、工作表细节和实验操作见 [原作者说明](../docs/archive/implementation/content-authoring-2026-10-05.md)，不能用旧聊天节点事实代替 schema 6 的最终结果。

存档写入格式由统一运行时决定，使用旧内容模型不等于继续写旧 save schema。历史生成和验收证据见 [配置实施记录](../docs/archive/implementation/configuration.md)。
