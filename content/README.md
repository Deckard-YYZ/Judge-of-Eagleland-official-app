# 运行时内容包

最近核对：2026-10-15。这里保存 `content/<packageId>/<version>/` 形式的运行时内容包和校验 fixture。内容编辑与生成见 [作者说明](../content-authoring/README.md)，当前游戏入口见 [文档索引](../docs/README.md#当前入口)。

## 包布局

| 文件                       | 内容                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| `game.json`                | 唯一规则 Catalog：manifest、稳定 ID、顺序、条件、目标、效果与资源引用 |
| `locales/<AppLocale>.json` | 对应语言的完整呈现文案，禁止混入业务字段                              |
| `media/**`                 | `game.json` 中声明的包相对资源                                        |

`game.json.manifest.supportedLocales` 声明的每个语言均需有完整语言包。人物、选项、剧情步骤和回复的顺序由规则内容决定；语言不进入 `ContentRef = { packageId, version }`。

## Schema 与版本

正式加载器支持内容 Schema **2–6**，以 [content/schema.ts](../src/content/schema.ts) 为准。新主流程使用 schema 6，旧包按其版本保持读取语义。

| 内容包                         | 内容 Schema | 用途                                   |
| ------------------------------ | ----------- | -------------------------------------- |
| `minimal-test-package/1.0.0`   | 2           | 两案基础内容与兼容回归                 |
| `minimal-test-package/1.1.0`   | 3           | ActionInput 旧样本与恢复回归           |
| `minimal-test-package/1.2.0`   | 4           | 带旁白的基础内容                       |
| `configuration-skeleton/0.1.0` | 4           | 作者工具骨架                           |
| `configuration-pilot/0.1.0`    | 5           | 多轮案件、指示框、hook 与派发小样      |
| `configuration-complete/0.1.0` | 5           | 人物/媒体及旧阶段/聊天纯查询实验       |
| `mainflow-short/0.1.0`         | 6           | 主控、聊天最终结果、新闻动作和教程短篇 |
| `validator-fixture/1.0.0`      | 1           | 历史分文件 fixture，正式 loader 不接受 |

内容 Schema、内容包 version、存档 Schema 和数据库迁移序号分别管理。当前存档写入格式见 [架构总览](../docs/architecture/overview.md#版本与存储)，不能从某个内容包版本推断存档版本。

旧 schema 1 分文件格式已从正式 loader 与 CLI 移除，旧说明保留在 [历史格式文档](../docs/archive/design/content-package-format-v1-v2.md)。`validator-fixture/1.0.0` 仍保留这种历史布局；CLI 自动发现只识别带 `game.json` 的包，不将该目录作为可发布内容。

## 编辑与发布

同一 `packageId + version` 发布后视为不可变。修改内容创建新版本；已存在版本只接受逐字节一致的重新生成。生成包不是人工编辑源，作者输入、包注册与来源诊断见作者说明。

规则对象使用有限类型，引用必须有效；各声明语言的显示字段完整覆盖。资源 path 使用包相对 `media/**` 路径，资源清单的 kind 与引用匹配。

schema 6 的运行时执行和独占新闻动作/教程约束见 [主流程契约](../docs/architecture/main-flow.md)。schema 5 的 `configuration.flow` 仅用于旧实验兼容。

## 校验命令

从仓库根目录运行：

```powershell
# 自动发现 content/<packageId>/<version>
npm run validate:content
# 指定一个包、packageId 目录或内容根目录；可传多个路径
npm run validate:content -- content/mainflow-short/0.1.0
# 配置好固定 Luban 后核验全部作者输入与生成包一致
npm run content:check-all
```

校验失败返回非零退出码，报告源文件、对象 ID、字段路径、诊断码和问题。静态校验检查结构、引用、图、安全资源路径与文件存在性，不解码媒体；fixture 或旧样本中的占位视频不能据此视为可播放资源。

结构与规则校验不能证明剧情合理、数值平衡或所有跨案件路线可完成，内容仍需对应人工评审与试玩。历史验收见 [归档](../docs/archive/README.md)。

### 三项属性版本来源（2026-10-22）

- minimal-test-package/1.3.0：该历史基础包没有 Luban 作者源，因此从完整 1.2.0 包派生新不可变版本（含原媒体），只更新清单版本、属性显示标签及新增 axis_three。原 restraint/authority 定义和全部剧情规则保留。
- configuration-pilot/0.1.3、mainflow-short/0.1.3：由现有 XLSX 作者源新增属性行、更新双语标签和 package version，经锁定 Luban 正常生成并通过 content:check。旧版本全部保留。

新档按对应新版本初始化全部属性；旧档保持原 contentRef，不重写历史属性。
