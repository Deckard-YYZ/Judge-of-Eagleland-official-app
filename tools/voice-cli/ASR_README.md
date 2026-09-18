# SenseVoice ASR CMD 测试工具

本地离线ASR对照工具，先输出转写文字，再精确匹配动作别名。首版使用SenseVoiceSmall INT8，
通过sherpa-onnx 1.13.8 CPU推理，不是Whisper，也不是原有KWS模型。游戏后端未修改。

## 使用

双击 `asr-record.cmd`，按Enter准备，等RECORDING出现后说话，再按Enter结束（默认最多8秒）。
原始WAV和同名UTF-8 JSONL保存在工具目录recordings下，即使unknown也保留。
控制台显示Transcript和Action result。可以传 `-Locale en-US` 测试英文。

已有录音可直接对比，不必重录：

```cmd
asr-test.cmd --locale zh-CN "D:\recordings\test.wav" > asr-report.jsonl
asr-test.cmd --locale en-US "D:\recordings\salute.wav"
asr-test.cmd --help
```

输入为单声道16-bit PCM WAV，8k–192kHz，最多60秒/32MiB。ASR整段识别，不启用实验近音词表或分段。
只按当前项目明确别名匹配；去除首尾空白/标点及大小写差异，不把“经理”强行视为“敬礼”。
rawText保留真实转写，normalizedText展示匹配输入，result是动作匹配结果；两者不能混淆。
例如转写“经理”可说明ASR输出了文字，但动作结果仍应unknown。报告还含PCM统计与推理耗时。
返回unknown退出0；参数/设备/文件/模型错误退出1。不要覆盖或只复制exe，保留整个工具目录。

## 开发重建

```cmd
npm run voice:prepare
npm run asr:prepare
npm run asr:cli:build
```

首项仅在尚未准备sherpa DLL时需要；模型只需首次下载，使用GitHub官方release SHA-256核验。
构建产物在artifacts/asr-cli；源文件和模型来源清单在仓库tools/voice-cli与scripts/asr-assets.json。
模型原始LICENSE/README随model目录保留。本工具不上传音频；报告包含实际转写和路径。
真实麦克风效果需要人工验收，合成音或少量录音对照不代表普遍准确率。
