# Voice test CMD tool

独立本地 WAV 关键词识别工具，不启动游戏、不访问存档。文件模式不使用麦克风；显式录音模式保存本地 WAV 后识别。
当前版本用于 Windows x64。模型分发许可仍待确认，当前产物仅供本地测试。

## 分段前后对照

双击 `voice-record-segment.cmd`：录制并保存原音，再分别识别整段和带词首缓冲的分段。
已有 WAV 可以直接重放：

```cmd
voice-test.cmd --segment "recordings\your.wav" > comparison.jsonl
```

这是一种按20ms窗口RMS检测活动的实验方法，不是训练过的语音VAD，也不做降噪。
使用低门限与连续活动确认，起点前保留500ms，终点后保留300ms；相邻缓冲重叠时合并。
处理后的WAV保存在原文件旁的新建目录，原始WAV不改动。JSON中的原始result和segmentation结果分别保留，
不要把原始result仍为unknown误读成分段也失败。所有分段都参与汇总，多个不同标签仍判为unknown。
背景噪声可能被保留，低能量词首仍可能漏掉；报告记录参数与范围，便于逐段试听。
本功能默认关闭，仅在CMD中实验，游戏语音流程保持原样。

## 录制自己的声音

双击构建目录中的 `voice-record.cmd`。按提示按 Enter 开始，看到 Recording 后说“敬礼”，
说完按 Enter 结束，或等默认 8 秒上限自动结束。录音使用 Windows 默认输入设备。
工具目录 `recordings` 内会保存时间戳命名的 `.wav` 和同名 `.jsonl` 识别结果。
即使返回 unknown，录音也会保留；可用播放器打开，与 `samples/salute-zh.wav` 对照。
文件仅保存在本机，不上传，不自动覆盖或清理。

```cmd
voice-record.cmd -Locale zh-CN -Seconds 8
voice-test.cmd --record "recordings\my-salute.wav" --record-seconds 8
voice-test.cmd "recordings\my-salute.wav" --threshold 0.15
```

直接使用 --record 时自行指定文件名，既有文件不会覆盖。录音必须从交互式 CMD/PowerShell 启动。
保存的是设备实际采样率的单声道 16-bit PCM（多声道取平均），不加入推理用尾部静音；识别读取保存后的同一份文件。
该工具不额外启用浏览器的回声消除、降噪或自动增益；系统/驱动仍可能有自己的处理。
这份录音并非游戏 WebView 的原始采集结果，因此两者差异仍需后续对照。

## 近音词表实验

双击 `voice-record-near.cmd`（或 `voice-record.cmd -SaluteNear`）录音，即可使用近音词表。
该实验保持识别参数不变，把 jing/jin + li/ni 的四声及轻声组合共 100 条路径映射为 salute，
加上原有行礼、挥手共 102 条。它也会接受“经理／经历／尽力”等同音或近音词，不适合直接作为正式游戏规则。
`keywords/salute-tones.txt` 是只扩展 jing li 声调的较窄版本，共 27 条（含原有行礼、挥手）。
这不是任意拼音模糊匹配，也没有加入单音节关键词。游戏正式词表保持原样。

```cmd
voice-test.cmd --keywords keywords\salute-near.txt "recordings\your.wav"
voice-test.cmd --keywords keywords\salute-tones.txt "recordings\your.wav"
```

构建时由 `scripts/voice-cli-variants.mjs` 生成并验证所有 token 存在。自定义词表结果为 `label: salute`。

从项目根目录构建：

```cmd
npm run voice:prepare
npm run voice:cli:build
cd artifacts\voice-cli
voice-test.cmd --help
voice-test.cmd --locale zh-CN samples\salute-zh.wav
voice-test.cmd --locale zh-CN samples\salute-zh.wav samples\wave-zh.wav > report.jsonl
voice-test.cmd --locale zh-CN --threshold 0.15 --score 1.5 --tail-ms 660 "D:\recordings\test.wav"
```

已有资源时无需重复 voice:prepare。复制工具时保留整个 artifacts/voice-cli 目录。
WAV 必须为单声道、16-bit PCM；建议 16kHz，其他采样率由 SDK 重采样。
它不模拟浏览器的回声消除、降噪或自动增益，因此离线成功不等于真实麦克风端到端通过。

默认内嵌当前项目词表：中文“敬礼／行礼／挥手”，英文 salute/wave。
修改项目词表后重新构建工具。也可用 --keywords 指定 UTF-8 的已编码关键词文件，
格式为模型 token 序列加 @标签，不接受直接写中文词的原始词表。

默认参数与桌面现有值一致；命令行参数只影响本次工具运行，不修改游戏配置。
每个 WAV 输出一条 JSON，包括信号幅度、有效参数、解码次数、命中标签和结果。
没有命中属于正常 unknown（退出码 0）；参数、文件或模型错误退出码 1。
报告不包含原始音频，但包含输入文件路径；分享前检查路径信息。

samples 中的音频为 Microsoft Huihui Desktop 离线合成，不是真人录音。
生成或重新生成这些样本：在项目根目录运行
`powershell -NoProfile -File scripts/generate-voice-cli-samples.ps1`。
需要本机安装 Microsoft Huihui Desktop 中文语音。该命令只写 WAV，不播放声音。
