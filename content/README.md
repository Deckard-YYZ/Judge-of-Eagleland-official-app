# 内容包编写与校验

内容包位于 `content/<packageId>/<version>/`。同一个已发布的 packageId/version 应视为不可变；
修改内容时创建新版本。运行时统一消费 `ContentCatalog`，物理文件仅用于作者协作和发布校验。

## 分文件格式

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

# 校验一个 package 目录、packageId 目录或内容根目录；可传多个路径
npm run validate:content -- content/validator-fixture/1.0.0
```

校验失败返回非零退出码，并报告源文件、对象 ID、字段路径、诊断码和问题。示例包中的
`ending-placeholder.txt` 只是文件存在性回归占位，不是可播放视频；Validator 检查清单 kind、引用、
安全路径与文件存在性，不解码媒体，也不根据扩展名猜测格式。

结构与静态规则通过不代表叙事合理、选项有意义、法律判断正确或数值平衡。正式内容仍需人工评审
和试玩；Validator 也不宣称能够证明所有跨案件路线在全局规则下都可完成。
