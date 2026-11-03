# 本地语音与旁白

核对日期：2026-10-15。本文维护资源准备、使用和排查方法；功能接入和待验收范围见 [文档索引](../README.md)。命令从仓库根目录执行。

## 能力与输入边界

Windows x64 使用 sherpa-onnx 1.13.8 本地 KWS 识别动作词。浏览器预览提供文字输入，不提供原生识别。中文词为“敬礼／行礼／挥手”，英文为 `salute / wave`，按当前输入语言匹配。

文字匹配、KWS 输出都转换为稳定 ActionId，再交正式 Core。空白、未匹配或多个不同动作属于 unknown，不提交游戏命令；权限、设备、模型或推理故障属于技术失败，不作为错误动作。旧样本中的已知错误动作后果见归档，产品错误机制的决定见 [需求](../product/requirements.md#完成要求与暂缓的错误机制)。

## 准备与运行

```powershell
npm run voice:prepare
npm run tts:prepare
npm run tauri:dev
```

首次准备需要 Python 3 / venv 和网络。`voice:prepare` 准备共享 DLL、KWS 模型和同源词典；`tts:prepare` 准备固定旁白模型，不替换共享 DLL。准备完成后应用离线推理，不在运行时下载资源。

模型和来源分别由 [voice-assets.json](../../scripts/voice-assets.json)、[tts-assets.json](../../scripts/tts-assets.json) 以及 [TTS 资源说明](../../src-tauri/tts/README.md) 管理。资源准备沿用已有固定来源核验流程。

需要测试动作时，在配置了 ActionInput 的内容位置选择“语音输入”，点击开始、说词、结束并识别。最长录音为 8 秒，整轮多个不同动作仍为 unknown。普通入口和 DEV 短篇所用内容不同，测试路径见 [当前入口](../README.md#当前入口)，旧档仍读取原绑定内容。

取消或超时会使当前 UI 轮次失效；原生调用采用合作取消，结束前仍可能保持 BUSY。权限迟到时授权流会被停止，不能通过连续点击累积推理。文字输入继续作为可用入口。

## 固定声音旁白

TTS 使用 Melo 中英模型，唯一逻辑声音为 `system`，speaker 0、speed 1，资源约 177.5 MB。Story 旁白支持自动朗读、停止、重播与设置中的开关。浏览器没有原生合成时保留文字并显示不可用。

```powershell
npm run tts:smoke
```

该烟测编译桌面程序并生成固定中英文 WAV 与 JSON 合成报告，不开启麦克风。它证明资源加载和合成链路，真实音色、回声及设备效果另记验收。

录音会先停止旁白并等待尾音保护；权限或原生识别仍在途时不能重播。语言切换、切页或卸载清理旧播放。旁白失败或关闭不改变 GameState、存档 revision 或游戏进度。后续视频/配音接入应复用根级声音协调。

## 独立录音与识别工具

| 工具               | 作用                                        | 入口                                              |
| ------------------ | ------------------------------------------- | ------------------------------------------------- |
| KWS CLI            | 本地 WAV 重放、显式录音、分段和词表参数对照 | [工具 README](../../tools/voice-cli/README.md)    |
| SenseVoice ASR CLI | 离线转写后匹配动作别名，与 KWS 对照         | [ASR README](../../tools/voice-cli/ASR_README.md) |

```powershell
npm run voice:cli:build
npm run asr:prepare
npm run asr:cli:build
```

产物分别位于 `artifacts/voice-cli` 与 `artifacts/asr-cli`。这些工具不访问游戏存档；ASR、近音词表和分段实验没有切换游戏的正式 KWS 后端。工具报告可能包含录音路径或实际转写，按工具说明在本机对照。

## 扩词与排查

1. 修改正式 ActionId、当前语言词典与内容可达性，避免直接编辑生成的关键词文件。
2. 运行 `npm run voice:prepare`、`npm run voice:check` 和内容校验，检查中英关键词与 ActionId 标签，再重建桌面程序。
3. 用同一份原始 WAV 对照参数、词表和后端，区分转写错误、别名未命中、噪声与多动作歧义。
4. 通过诊断中的 operationId 关联采集、推理、识别和保存；导出报告不包含音频，声音问题需结合显式录音判断。

新增短词、近音或多音字后单独记录误触发、漏检和延迟，不由少量合成音样本推定普遍准确率。真实设备与发布验收待办集中见文档索引。

历史决策和实验数据见 [KWS 实施记录](../archive/implementation/voice-sherpa.md)、[TTS 实施记录](../archive/implementation/tts-content-validator.md)；ActionInput/TTS 的旧设计见 [历史设计](../archive/design/action-input-tts-v1.1.md)。
