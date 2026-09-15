# 内容包编写与校验

内容包位于 `content/<packageId>/<version>/`。同一个已发布的 packageId/version 应视为不可变；
修改内容时创建新版本。Schema v2 将唯一的规则图与各语言表现严格分开；locale 是独立加载维度，
不进入只含 packageId/version 的 `ContentRef`。

## Schema v2 格式（正式新包）

| 文件 | 内容 |
| ---- | ---- |
| `game.json` | 唯一 `GameContentCatalog`：ID、顺序、规则、target/effects、资源与带稳定 ID 的 story step |
| `locales/<AppLocale>.json` | 一个严格 `LocalizedContentCatalog`：所有可显示文案，不允许任何业务字段 |
| `media/**` | `game.json` 的 asset path 引用的包内媒体 |

`game.json.manifest.supportedLocales` 中每个 locale 必须恰好有一个完整语言包。语言包以稳定 ID 覆盖
attribute、case/character/node/choice/resolution、story text/video fallback step 和 ending；人物、选项
与 story step 的顺序只由 `game.json` 决定。`content/minimal-test-package/1.0.0` 提供完整中英文示例。

旧 schema v1 分文件内容格式已经从正式 loader 与 CLI 删除；仓库中若仍有旧目录，只是迁移历史，
不能作为可发布内容包。旧存档兼容由 storage migration 独立处理，不会重新启用旧内容格式。

## Schema v1 历史格式（不可发布）

| 文件                     | 内容                                            |
| ------------------------ | ----------------------------------------------- |
| `manifest.json`          | 单个 `ContentManifest`                          |
| `attributes.json`        | attribute ID 到 `AttributeDefinition` 的对象    |
| `initial.json`           | 单个 `InitialGameDefinition`                    |
| `progression.json`       | `{ "unlockRules": [...], "storyRules": [...] }` |
| `cases/<caseId>.json`    | 单个 `CaseDefinition`                           |
| `stories/<storyId>.json` | 单个 `StoryDefinition`                          |
| `endings.json`           | ending ID 到 `EndingDefinition` 的对象          |
| `assets.json`            | asset ID 到 `AssetDefinition` 的对象            |
| `media/**`               | 清单引用的包内媒体文件                          |

case/story 的文件名（不含 `.json`）就是 Catalog key。case 文件内部的 `id` 必须与文件名一致。
不要在上述目录中增加其他 JSON 文件，也不要用重复文件覆盖对象。资源路径只使用 `/` 分隔的包内
相对路径；视频 StoryStep 必须提供 fallbackBlocks。

## 命令

```powershell
# 自动发现 content/<packageId>/<version>
npm run validate:content

# 校验一个 schema v2 package 目录、packageId 目录或内容根目录；可传多个路径
npm run validate:content -- content/minimal-test-package/1.0.0
```

校验失败返回非零退出码，并报告源文件、对象 ID、字段路径、诊断码和问题。示例包中的
`ending-placeholder.txt` 只是文件存在性回归占位，不是可播放视频；Validator 检查清单 kind、引用、
安全路径与文件存在性，不解码媒体，也不根据扩展名猜测格式。

结构与静态规则通过不代表叙事合理、选项有意义、法律判断正确或数值平衡。正式内容仍需人工评审
和试玩；Validator 也不宣称能够证明所有跨案件路线在全局规则下都可完成。
