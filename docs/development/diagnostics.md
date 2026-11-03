# 本地诊断与报告

核对日期：2026-10-15。本文维护日志查看、报告导出和构建符号归档的方法。历史实现、故障注入和验证证据见 [Log / Error Report 实施记录](../archive/implementation/log-error-report.md)。

## 查看与导出

界面右下角“诊断 / Diagnostics”在启动失败或 React 错误后仍可打开。面板提供构建身份、writer/transport/heartbeat 状态和近期事件，可按级别、事件及 operation 筛选。

“详细日志 5 分钟”按单调时钟到期恢复默认级别：debug 构建默认 debug，发布默认 info。该操作不会启用发布包 dump。心跳只表示观测点响应，不证明保存成功。

| 内容           | Windows 路径或范围                                                                      |
| -------------- | --------------------------------------------------------------------------------------- |
| 运行日志       | `%LOCALAPPDATA%/com.eaglejudge.app/logs/<runId>`                                        |
| 导出报告       | `%LOCALAPPDATA%/com.eaglejudge.app/reports/report-*.json`                               |
| 日志轮转       | 单文件约 2 MiB，最多当前文件加 3 个轮转文件；启动时尝试保留最近 8 个 run，活跃 run 保留 |
| 报告保留       | 尽力保留最近 8 份，权限或并发可能使清理不完全                                           |
| 报告大小与内容 | 最多 4 MiB，收集当前及近期已退出运行，最多 4 个 run                                     |

报告包含日志尾部、health/watchdog 摘要和缺失/截断/丢弃信息。不打开 SQLite，不默认附带原始输入、完整存档或 dump，不自动上传。异常文字做尽力脱敏，分享前检查内容。浏览器导出当前内存窗口 JSON，无法包含上一次浏览器运行。

诊断 IPC 超时后，对应通道在本轮停止继续请求。导出超时表示完成情况未知，后台仍可能写完；不能据此判定文件不存在。没有正常退出标记只能说明 unclean，不能单独认定崩溃。

## 保存与输入问题

按同一个 operationId 关联开始、计算、CAS、发布与结果事件，区分业务拒绝、确定失败、写入结果未知和已提交后发布失败。

- `needsReload` 按既有会话恢复路径处理，不自动重发业务命令。
- unknown、取消和技术性语音失败不等同于保存失败；原生 IPC 超时也不证明 SDK 已停止。
- 语音报告不含音频；短词效果和噪声问题结合 [独立语音工具](voice.md#独立录音与识别工具) 对照。
- 日志可能在强杀或断电时丢失，不能把缺少一条事件直接视为操作未发生。

## 构建支持与符号归档

```powershell
npm run tauri:build -- --debug --no-bundle
npm run diagnostics:archive -- debug
# release 构建与归档
npm run tauri:build -- --no-bundle
npm run diagnostics:archive -- release
```

[归档脚本](../../scripts/archive-diagnostics.mjs) 以 `--diagnostics-build-info` 读取实际 exe 的构建身份，不启动 UI；要求 exe 内嵌 frontendBuildId 与 `dist/build-info.json` 及支持文件一致，再核对 PE/PDB 的符号身份。

Vite hidden source map 保存在 `artifacts/build-support/<frontendBuildId>`，不留在 dist 或被 Tauri 内嵌。exe、PDB、manifest、maps 和现有归档校验清单写入 `artifacts/diagnostic-archives`；这些目录被 Git 忽略。

单独重跑 `npm run build` 会生成新的前端构建身份，此后需要重建 native 才能与同一批支持文件归档。发布资源准备和完整桌面验证见 [开发与验证](workflow.md#桌面与声音)。

## 接入新模块

业务通过 [shared diagnostics 契约](../../src/shared/diagnostics.ts) 发送明确摘要，Core 保持纯函数。沿用 runId、buildId、operationId、source、event、level 和时间字段，耗时使用单调时钟。

日志失败不阻塞 dispatch、CAS 或快照发布；诊断自身失败不递归记录。默认不记录玩家输入原文、显示名称、SQL 参数、完整存档或媒体。新模块应为 started 配对结果事件，保留稳定错误码与必要 cause，不在 Repository/Core 中加入网络上传或自动重试。

## DEV 独立模块验证

开发模式运行 `npm run dev`，在右下角诊断面板的模块验证区选择入口。每次进入或“重新验证”都全页加载一个独立内存会话，通过真实档案进入、初始声明与 Application 命令准备场景；无需登录或走完无关前置流程，不修改正式 SQLite 存档。语言与主题沿用界面设置。

以下 URL 参数仅在 DEV 生效，可追加到开发服务地址（默认 `http://localhost:1420/`）：

| 诊断按钮 | 参数 | 操作与核对 |
| --- | --- | --- |
| 验证选项指示框 | `?modulePreview=instructions` | 直接打开配置试验案卷，候选实际展示后观察延迟指示，再正常裁定。 |
| 验证教程 | `?modulePreview=tutorial` | 直接进入教程，继续并输入“挥手”完成；也可使用教程退出入口。 |
| 验证强制剧情 | `?modulePreview=story` | 继续到动作步骤，输入“敬礼”完成；错误动作保存后允许重试。 |
| 验证动作输入 | `?modulePreview=action` | 直接处于动作输入步骤，输入“敬礼”确认，成功保存即完成剧情。 |
| 验证新闻 | `?modulePreview=news` | 直接打开新闻，关闭后真实触发配置的敬礼动作；完成后诊断入口可操作。 |
| 验证单窗口聊天 | `?modulePreview=chat-single` | 对单一终端连续回复，确认终止消息显示并保留 4 秒后退场。 |
| 验证多窗口聊天 | `?modulePreview=chat-multiple` | 两个错位窗口分别回复，核对会话互不推进，各自正常结束并在 4 秒后退场。 |
| 验证无交互结束 | `?modulePreview=chat-ignored` | 不回复聊天，完成案卷 A 两次裁定；真实无交互计数达到 2 后结束聊天并保留 4 秒告别状态。 |
| 验证主线与池派发 | `?modulePreview=dispatch` | A 由主线直接派发；完成三次裁定后，主线条件触发池派发 B。核对 A 已归档、B 待开始。 |

无交互和派发的具体步骤同时呈现在案卷摘要，随内容语言切换。所有场景保留诊断入口，可重开当前场景、切换模块或“返回普通入口”；新闻与强制剧情遵循原有遮挡规则，先完成当前模块即可再次使用诊断。重开会清空当前试验进度，不复用上一个内存会话。导航会清理互斥的预览参数，已有主题试验/样式示例 URL 保持兼容，不另增重复按钮。

原“主流程验证”按钮仍保留（`?mainFlowPreview=1`），用于从头串联全部模块；独立验证不能替代完整主流程回归。未实现的结局不在本轮模块范围。

2026-10-15 验收记录：Slice 1 指示框直达、返回普通登录已主审通过；Slice 2 教程/强制剧情/动作/新闻由 capable_worker 接手完成升级修复后主审通过；Slice 3 单/多聊天、两次真实选择触发无交互结束、三次裁定后池派发已主审通过。定向自动化覆盖模块进入与真实提交、4 秒退场、重开隔离、DEV 路由及诊断入口，共 16 项通过；最终全量结果见本次交付记录。

本轮最终收口：`npm run check` 的类型、语音字典、测试及模块边界全部通过（82 个测试文件通过、2 个跳过；645 项通过、5 项跳过）。其末尾格式检查发现本轮文件格式问题，定向格式化后重新执行 `npm run format:check` 已通过；`npm run build` 与 `git diff --check` 通过。未重复运行全量测试，原开发服务保持运行。
