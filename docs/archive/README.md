# 历史文档归档

归档日期：2026-10-15。这里保留旧设计、实施计划、分阶段验收和实验记录；正文中的“当前”、默认行为、版本、待办、代理分工和测试数量均属于原记录阶段。现行入口和状态见 [文档索引](../README.md)。

历史正文保留原有表述；可点击的本地链接已更新。引用固定 Git 提交的外部来源链接保持原地址。归档后停止追加当前进展，新约定更新对应现行文档。

## 设计

| 归档                                                                   | 适用范围与后续入口                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [基础架构 v1.0](design/architecture-v1.0.md)                           | 2026-09-14 首版设计；现行分层与提交边界见 [架构总览](../architecture/overview.md)              |
| [ActionInput v1.0](design/action-input-v1.0.md)                        | 2026-09-16 扩展设计；已被 v1.1 完整替代                                                        |
| [ActionInput / TTS v1.1](design/action-input-tts-v1.1.md)              | 2026-09-18 设计；“TTS 未实施”仅是当时状态，后续见 [语音指南](../development/voice.md)          |
| [主流程原实施规格](design/main-flow-implementation-spec-2026-10-05.md) | 2026-10-05 四阶段交付计划、ownership 和验收；现行契约见 [主流程](../architecture/main-flow.md) |
| [旧内容包格式说明](design/content-package-format-v1-v2.md)             | 原 content README 的 v1/v2 格式；现行布局和兼容范围见 [内容包说明](../../content/README.md)    |

## 实施与验收

以下记录由原根目录的 `Desktop_*_Implementation.md` / `Desktop_Log_Error_Report_Integration.md` 迁入，文件名按主题缩短。

| 归档                                                                 | 原记录范围                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| [Core](implementation/core.md)                                       | 2026-09-15 初始纯规则交付                              |
| [Frontend](implementation/frontend.md)                               | 初始前端、主题与后续呈现时序调整                       |
| [Localization](implementation/localization.md)                       | 2026-09-15 双语与存档事实化                            |
| [Storage / Tauri](implementation/storage-tauri.md)                   | 2026-09-15–16 初始存储、桌面装配及其验收               |
| [Content / Validator](implementation/content-validator.md)           | schema 2/3 校验、物理包与 ActionInput 文字闭环         |
| [Log / Error Report](implementation/log-error-report.md)             | 本地诊断、报告、构建支持与接入记录                     |
| [Voice / Sherpa](implementation/voice-sherpa.md)                     | KWS、独立录音、词表、分段与 ASR 对照实验               |
| [TTS / Content / Validator](implementation/tts-content-validator.md) | 2026-09-18 content v4 与固定旁白交付                   |
| [Configuration](implementation/configuration.md)                     | 作者骨架、schema 5 实验、schema 6 主流程和普通入口恢复 |
| [表现层原交接](implementation/presentation-handoff-2026-10-07.md)    | 原交接、浮层验收及随后 CMD 样式调整的验证边界          |

## 原入口快照

| 快照                                                            | 用途                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| [原项目 README](implementation/project-readme-2026-10-07.md)    | 保留骨架验证、两案六路径样本、旧声音样本和阶段测试记录 |
| [原作者 README](implementation/content-authoring-2026-10-05.md) | 保留 schema 4/5 制表细节、旧 flow 查询 API 和实验操作  |

原 README 快照按该文件最后提交日期命名，正文中的记录日期仍按原文。日期不表示本次重新执行了相应验收。
