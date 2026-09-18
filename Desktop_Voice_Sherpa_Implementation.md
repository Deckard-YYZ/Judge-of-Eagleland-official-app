# Sherpa-ONNX 语音输入实施与人工验收

更新日期：2026-09-16。状态：四片实现与静态审核通过，自动化检查通过，等待人工语音验收。用户授权按原流程切 slice、efficient worker 实现、主代理审核；本轮未启动麦克风或人工语音测试。

## 目标与决策

- 本轮优先试验 sherpa-onnx 中英关键词检测（KWS），替代架构原先优先考察 Whisper 的顺序。只接一个离线后端。
- 语音是既有 actionInput 的 I/O 适配器；Core、submitStoryInput、checkpoint、CAS / publish 不改变。
- 当前正式 ActionId 只有 salute / wave，中文别名敬礼、行礼、挥手，英文 salute、wave。十几个动作的扩展须先增加正式词库与规则，不臆造 ID。
- 关键词配置来源为现有 actionLexicons，生成而非平行手工维护语音动作表。检测选定语种下全部动作，识别器不知道目标动作。
- 一轮开始/结束录音只产出一次最终结果；没有命中或多个不同动作命中均为 unknown，不处罚；技术失败独立显示。
- 权限只在主动录音时请求。取消、切语种/输入方式、切 Profile/Story/step、needsReload 或卸载会使轮次失效，迟到结果不提交，迟到授权流立即释放。
- PCM 只在内存短时保留，不进存档、日志或报告，不静默上传。最长录音和单在途推理有界。

## Slice

| Slice | 交付 | 状态 | 审核要求 |
| --- | --- | --- | --- |
| V1 | 固定 SDK/模型与资源准备、词库生成、共享语音契约 | 已审核 | 官方 API/版本可追溯，同源词库，资源可复现 |
| V2 | 本地 KWS 后端与受控桥接 | 已审核 | 后台推理、有界 PCM、unknown/歧义、取消/并发隔离、日志不含音频 |
| V3 | 麦克风采集、轮次控制与双语 UI | 已审核 | 一次消费、防迟到、释放设备、复用同一 dispatch、文字可用 |
| V4 | 静态审核、自动化回归与人工测试交接 | 已完成交接，人工待测 | 类型/边界/构建通过；人工项明确未测，不宣称准确率 |

## 使用与复现

本机已准备资源并生成 `src-tauri/target/debug/eagle-judge.exe`。可直接启动该开发包；不要单独移动 exe，
其同级 DLL、voice/ 和 content/ 都是运行所需资源。浏览器 `npm run dev` 仅提供文字预览，语音提示不可用。

新检出仓库首次准备（Windows x64，开发机需要 Python 3 / venv、Node、Rust 与 Tauri 构建工具）：

```powershell
npm ci
npm run voice:prepare
npm run tauri:dev
# 构建可直接启动的开发包，不生成安装器
npm run tauri:build -- --debug --no-bundle
# 不开麦克风、不启动 UI 的真实模型加载烟测
& './src-tauri/target/debug/eagle-judge.exe' --voice-model-smoke
```

只有开发资源准备需要下载；游戏运行不下载模型、不联网识别，也不需要 Python。
`artifacts/voice` 忽略版本控制；固定下载地址与 SHA-256 在 `scripts/voice-assets.json`。
模型 token 配置与逐文件哈希在 `src-tauri/voice/`，受版本控制。准备过程使用私有 venv，不修改系统 Python 包。
SDK 为官方 `sherpa-onnx =1.13.8` shared API，Windows x64 CPU 运行库；本轮未验收其他平台。
Rust 最低声明同步为 1.88（锁定依赖的要求），实际构建验证使用 1.94，未声称在 1.88 实测。

## 已定参数与生命周期

| 项目 | 当前值/语义 |
| --- | --- |
| 模型 | zh-en-3M-2025-12-20；chunk 16；int8 encoder/joiner + fp32 decoder |
| 推理 | CPU，1 thread；只缓存当前 locale 的一个模型实例 |
| KWS | max_active_paths=4，num_trailing_blanks=1，keywords_score=1，keywords_threshold=0.25 |
| 参数含义 | 原生检测参数，未经真实样本校准，0.25 不等于 25% 置信度 |
| 采集 | 主动开始，单声道，最多 8 秒；工作线程与界面双层上限 |
| PCM | 根据实际采样率低通重采样至 16 kHz，最多 128000 点；不足 200ms unknown |
| 等待 | 权限 15 秒；AudioContext/Worklet/重采样阶段各 10 秒；原生桥接推理 15 秒 |
| 取消 | 立即使 UI 轮次失效并释放采集资源；原生为合作取消，SDK create/decode 内无法强制打断 |
| 并发 | 同一采集服务/原生后端各一个在途槽；取消或超时不代表原 IPC 已结束，结束前维持 BUSY |
| 歧义 | 整轮结束后聚合，重复同 ActionId 只算一次；无命中/多个动作/未知标签均 unknown |

录音先停止所有 tracks，再交独立 Worker 重采样；AudioWorklet 输出静音，不将麦克风声音回放到扬声器。
worklet 强制生成同源独立文件，避免 Vite 内联 data URL 被现有 CSP 拦截；没有扩大 CSP。
若权限弹窗尚未结束时取消，必须等待其完成才可开始另一轮；晚到授权流会立即停止，可随时切回文字。
若原生 SDK 或 IPC 卡住，BUSY 可一直维持到进程重启，不能通过连续点击累积推理。
模型缺失/哈希不匹配属于 UNAVAILABLE，不是错误动作；静音烟测仅证明加载和推理链路，不验证短词效果。

模型文件合计约 5.2 MiB，三个运行库 DLL 约 21.5 MiB（不含 exe、构建符号与开发缓存）；
打包白名单只有 4 个模型文件与 3 个 DLL，不包含 en.phone、tokenizer、venv 或下载归档。

## 后续如何扩词与接 Log / Error Report

1. 先扩正式 ActionId、当前语种 actionLexicons 与内容可达性，不直接改生成的关键词文件。
2. 运行 `npm run voice:prepare` 重新调用官方 phone+ppinyin tokenizer；缺少可用发音会失败，不能跳过词。
3. 审查生成的中英关键词与 ActionId 标签，再运行 `npm run check` / `npm run validate:content` 并重建 native。
4. 新增短词、相近词和多音字后重新做人工混淆测试；不要为提高命中率强制选择某个动作。

`voice.round_started`、`capture_completed`、`voice.inference_started/finished`、`input.recognized` 及原 Session 保存事件
沿同一个 operationId 关联。失败/取消只记录稳定 code，采样日志只有 sampleRate/sampleCount/modelId/inputMode 摘要。
诊断面板可按 operation 过滤并导出报告；报告没有音频，因此仅凭报告不能判断发音或噪声问题。
静态期保留原规则：unknown/技术失败无 dispatch，known 才交 Core 判定；不得在识别层修改属性或重试保存。

## 明确不做

Whisper 双后端、云识别、永久监听、摄像头、自动语音处罚重试、语音身份识别、为凑数量扩充 ActionId、正式准确率承诺。
本轮不执行真实麦克风录制、播放测试语音或 GUI 人工验收；模型推理的无麦克风自动化烟测与构建验证可执行。

## 人工验收步骤与记录（全部待测）

1. 启动上述桌面开发包，使用绑定 `minimal-test-package@1.1.0` 的新局，完成首案并推进到敬礼输入点 B。
   旧 1.0.0 存档保持旧内容绑定，不会自动增加语音输入点。
2. 选择“语音输入”，点击“开始录音”，明确授权麦克风；说当前语言的动作词后点击“结束录音并识别”，也可等待 8 秒自动结束。
3. 在 B 正确后继续到 D，验证相同 salute 目标仍需独立完成；用错误动作验证一次录音只扣一次。
4. 需要重复正确测试时另建测试局或使用尚未完成的输入点；不要手工重放旧提交。失败时记录 operationId 并导出诊断报告。

待测覆盖：

- 中文：敬礼/行礼正确，挥手为明确错误；英文：salute 正确，wave 明确错误。
- 无语音、环境噪声、无关词、同时说两个动作、重复同一动作、短促/截断语音。
- 权限拒绝/延迟授权、设备缺失/拔出、取消、切语言、切输入方式、切存档、关闭面板。
- unknown 不增 revision，known wrong 一轮只扣一次，正确后恢复到下一位置；输入 B 与 D 均需独立完成。
- 离线运行、模型缺失/损坏、冷启动/热启动时延、CPU/内存、中文用户名/安装路径、游戏自身音频误触发。
- 记录逐项结果、机器/麦克风/系统/WebView/模型版本；短词阈值需基于真实样本调整。

| 类别 | 人工验收标准 | 当前结果 |
| --- | --- | --- |
| 中文/英文正确词与别名 | B/D 正确推进且重启恢复正确 | 未测 |
| 另一已知动作 | 一轮仅一次错误效果，仍停当前 step | 未测 |
| 静音/噪声/无关话/多动作 | unknown，不改 revision | 未测 |
| 同一动作重复 | 最多一次提交，不重复扣分 | 未测 |
| 权限/设备/模型故障 | 可解释技术提示、可回文字、无处罚 | 未测 |
| 取消/切语种/切 Profile/卸载 | 无迟到提交，系统麦克风指示及时关闭 | 未测 |
| 离线/真实设备/长时间反复尝试 | 无网络依赖、无资源持续增长 | 未测 |
| 性能与质量 | 记录冷/热时延、CPU/RAM、误报/漏报，不先设已达标结论 | 未测 |

## 后期 TODO 与已知限制

- 人工确认短词/多音字、噪声和媒体回声；根据记录校准阈值，当前没有准确率数据。
- 模型权重/词典的正式分发许可尚未确认，不能以框架 Apache-2.0 推定模型许可；正式发布前澄清。
- 本轮只构建 Windows x64 debug no-bundle 验证包，release 安装器、干净机器、其他平台另验收。
- 当前内容视频仍是 placeholder；未来真音频播放器进入输入阶段应停止含口令的播放，再测回声误触发。
- 原生取消不能强制中断 SDK 内单次调用，卡住时继续用文字并保留日志；必要时显式重启。

## 官方依据

- [KWS 概述](https://k2-fsa.github.io/sherpa/onnx/kws/index.html)
- [中英模型与关键词生成](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html)
- [官方 Rust KWS 示例](https://github.com/k2-fsa/sherpa-onnx/blob/master/rust-api-examples/examples/keyword_spotter.rs)

## 实施记录

- 本轮开始 git 工作区干净；未发现 AGENTS.md 或 Mistakes.md。既有日志交付已成为基线。
- 已派 custom_explorer 职责 agent 只读梳理接入点，efficient_worker 核实后端与固定资源。
- V1 共享契约审核通过：`shared/voiceInput.ts` 与 `recognizedAction.ts`；matcher 保持原导出兼容。
  recognize 的 signal 取消整轮，stopSignal 仅结束录音进入推理；phase 为 requesting / recording / recognizing。
  PCM 是实际转换后的 16 kHz 单声道有限浮点 [-1,1]，最长 128000 samples。技术错误使用稳定 code。
- 契约确定后采集与 UI 独立并行；app 的 VoiceInputShell 保持跨 Profile 单例服务，避免切页绕过在途推理锁。
- 语音诊断允许 modelId/sampleRate/sampleCount/inputMode 摘要，已同步前端、原生与报告白名单；不允许音频/设备名称/转写。
- SDK 拟固定官方 sherpa-onnx 1.13.8；模型为 zh-en-3M-2025-12-20。权重分发许可尚待确认，不能以 SDK 仓库 Apache-2.0 推定模型许可。
- V1 资源主审通过：`scripts/voice-assets.json` 固定官方 runtime/model/tokenizer 的 URL 与 SHA-256；
  `voice:prepare` 仅解包明确普通文件，使用私有 venv 中固定版本依赖调用官方 phone+ppinyin tokenizer。
  `src-tauri/voice/keywords.json` 是从同一份 actionLexicons 生成的五个别名，不是另一份手写动作表；
  `voice:check` 以 aliasHash / rows 校验漂移。主代理复跑检查与 input 3 文件 / 37 tests 通过。
- UI 主审通过：同一 submitStoryInput 提交入口；round 先失效再 abort；消费前核对 session/profile/save/story/step/locale/mode/service。
  保存版本与媒体轮次分离，取消录音不撤销已提交命令。主代理复跑 storyInput / i18n / diagnostics 共 3 文件 / 32 tests 通过。
- 采集初审修复要求：统一竞态等待清理 timer/listener；未返回的权限/原生任务保持门控，避免重复请求堆积；
  停止设备后异步重采样。主代理纯合成零 PCM 8 秒转换基准：48k 约 260ms，192k 约 1068ms，
  因此不接受原先同步占用 UI 线程的实现。该基准不是麦克风或识别准确率测试。
- 修复主审通过：专用 Worker 转换、先停设备、取消 terminate；权限已返回但 await 尚未接手时的资源竞态有专项覆盖。
  raw native invoke 在取消/超时后仍占槽，避免外层 Promise.race 提前结束导致新 IPC 排队。
- 主代理最终全量：54 文件 / 424 tests、typecheck、voice:check、依赖边界、Prettier 全通过；两个内容版本校验通过。
  首次全量仅旧资源清单断言失败，已改为精确 4 模型/3 DLL 白名单后全量通过。
- Rust 15 tests / fmt 通过；最新 Tauri debug no-bundle 构建成功，主代理独立执行 `--voice-model-smoke` 双语静音推理通过。
  主审第一次并行执行 cargo 与 smoke 触发 Windows DLL 占用，停止并行后顺序复跑 Rust 测试通过；不是识别故障。
- 已核对真实输出的 3 DLL / 4 模型，以及独立 Worklet / Worker 文件；dist 无 source map。
  未启动 GUI、未调用真实麦克风、未操作用户存档、未创建 git commit。人工栏位保持未测。


### 2026-09-18：语音 unknown 诊断细化

默认 info 日志按同一 operationId 查看 `voice.capture_settings` → `voice.pcm_captured` →
`voice.pcm_resampled` → `voice.pcm_received` → `voice.kws_config` / `voice.model_load` → `voice.decode_summary`。
三个 PCM 摘要分别对应重采样前、16k 重采样后、原生收到的数据，可比较 count/duration/RMS/peak/20ms maxFrameRms。
RMS dBFS 下限为 -120，`dbfsFloored` 标记触底；nearZeroRatio 使用绝对幅度 ≤0.0001，clippedRatio 使用 ≥0.999。
这些是幅度统计，不是 VAD、语音占比或质量结论；短词后长静音会拉低整段 RMS，应同时看 maxFrameRms。

采集设置仅记录实际采样率、声道数、echoCancellation/noiseSuppression/autoGainControl 及 AudioContext 采样率；
不包含设备 ID/名称、原始 PCM、录音或转写。原生记录既有 KWS 参数、词条数、冷/热加载耗时、decode 次数/耗时、
命中次数及去重 ActionIds；SDK 没有提供置信度，因此不生成评分。
unknown 原因为 empty_audio（前端未收到帧）、too_short、no_keyword、multiple_actions 或 unrecognized_label。
本次仅增强观测，没有调整识别阈值、规则或保存语义；尚不能据此确认用户实录持续 unknown 的根因。

本轮主审验证：类型、词表一致性、模块边界、Prettier、Rust fmt 和 diff 检查通过；Rust 19 tests 通过。
此前一次主审记录的全量前端统计为 429 tests 中 428 通过；唯一失败来自
decisionReveal.test.tsx 仍期待旧版提供商署名。中英文文案已统一为 powered by EncryptAI，
该断言现已同步更新，以上失败不再代表当前状态。
最新 debug no-bundle 构建及双语静音模型 smoke 通过；未操作麦克风，人工识别准确率仍待测。
下次人工测试：分别在对应语言下录入“敬礼”和“salute”，结束后导出诊断报告，按 operationId 对照三处 PCM 摘要和 decode_summary。

### 2026-09-18：真人连续 no_keyword 调查

custom_explorer 只读核查后由主代理复核关键配置和离线实验。最新真人轮次 `op-mu6fvoiz-12`
录入 2.72 秒，RMS -22.99 dBFS、峰值 0.994，三处统计一致，解码 9 次无命中；不能以幅度推断人声内容完整。

- 官方 tokenizer 重算与项目词表一致；中文 token 在 tokens.txt 中存在；Rust buffer 长度为 UTF-8 字节数。
- 主代理核对官方模型说明：支持当前 int8 encoder/joiner + fp32 decoder，参数与官方默认一致。
- 主代理在 ignored `artifacts/voice/probe` 建立独立 Rust 探针，使用同版本 SDK、本地 DLL、相同模型、参数、keywords_buf 和解码流程。
  官方 en_0/en_1、zh_3..zh_6 命中对应关键词；zh_0..zh_2 未命中，不将其统计为准确率或无条件正样本。
- Windows 离线 Huihui Desktop 合成 16k 单声道“敬礼／行礼／挥手”，项目原样词表分别返回 salute/salute/wave。
  另将 48k 合成“敬礼”经过实际 `resampleVoicePcm` 转成 16k，再送入探针，仍命中 salute。
- 这些实验没有覆盖真实 WebView 麦克风端到端，也不能证明用户实录的失败原因；未改产品代码、参数或使用麦克风。

后续 TODO：显式开启的本地单次录音回放与同一 PCM 重放实验，先确认词首词尾和目标人声，再受控比较音频处理设置及识别参数。
默认日志继续不保存音频。不要直接把 unknown 当作低音量或阈值过高。应用补静音 0.5 秒，固定版本 Python 示例 0.66 秒，
当前正样本在 0.5 秒已命中；该差异仅保留为靠近停止边界时的待验证项，不认定根因。

依据：[官方模型说明](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html)、
[固定版本解码示例](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/python-api-examples/keyword-spotter.py)。

### 2026-09-18：独立 CMD 诊断工具交付

- efficient_worker 实现 `tools/voice-cli`，主代理审核、构建并验证。共用生成词表和 PCM 统计模块；独立进程、独立构建目录，不访问游戏事实或保存。
- `npm run voice:cli:build` 生成 `artifacts/voice-cli/voice-test.cmd` 及 exe、DLL、模型；支持多 WAV、语言、自定义已编码词表、threshold/score/tail 参数及 JSONL 输出。
- `scripts/generate-voice-cli-samples.ps1` 离线生成中文合成样本，不调用麦克风或播放音频。用户可直接试听 samples 中的 WAV。
- 主审通过 3 个 Rust 单元测试及格式检查；真实 CMD 入口验证“敬礼／行礼／挥手”分别命中 salute/salute/wave，静音 no_keyword 且退出 0；非法参数和缺失文件退出 1。
- CLI 目前读取单声道 16-bit PCM WAV，不含麦克风录制；非 16k 输入使用 SDK 重采样，并在结果标注，不能替代真实浏览器采集路径验收。
- 未修改桌面识别阈值。后续 TODO：显式本地单次实录导出，交给该工具做同一 PCM 的参数对照。

### 2026-09-18：独立工具显式录音与保存

用户要求保存自己录制的声音以便对照合成音。工具新增 `--record OUTPUT.wav --record-seconds 8`，
默认输入设备、实际采样率、多声道平均为单声道 16-bit PCM；录音保存后再由现有 WAV 识别路径读取。
开始/停止均由交互式控制台提示，自动时限最多 60 秒，不允许覆盖已有文件，不附加推理尾部静音到录音文件。
双击 `voice-record.cmd` 即可使用；封装入口为每轮生成唯一文件名，在工具目录 recordings 中成对保存 WAV / UTF-8 JSONL。
unknown 不删除录音。不上传，不改游戏默认日志保存规则；这不是 WebView 采集链路的直接导出。
后续 TODO 仍是游戏内显式导出与录制工具的处理差异对照，以及用户的真实麦克风验收。

主审验证：独立工具构建成功；6 个单元测试通过（录音参数、混音有界、WAV roundtrip/防覆盖、识别分类、统计等），
录音入口脚本语法、Rust fmt 通过；非交互 stdin 被拒绝且未创建录音，既有合成“敬礼／挥手”识别回归通过。
未启动真实麦克风或 UI；用户需在交互式 CMD/PowerShell 中验收开始/停止、回放与设备权限。

### 2026-09-18：首份真人 WAV 重放

用户主动录制 `20260918-125102-477-f1ab85a1.wav`（16k、5.17 秒）。默认重放仍 no_keyword。
同一录音对照 threshold .25/.1/.01/.001、score 1/2/3/5 的若干组合及 tail 1000ms，10 组均未命中；
单独保存的 gain2/4/8 副本在默认参数下也未命中，原文件未修改。真人 maxFrameRms .0693、peak .1948，
与成功合成音 .0706/.1917 相近，不能仅用音量解释。
仅本地诊断探针使用同一声学模型无关键词 greedy 解码：真人输出单个 ń，合成音输出 j/ìng/l/ǐ；
该输出不是可信转写或用户发音结论，只提示未形成预期 token 路径。真实回放清晰度/完整性仍待用户确认。

确认并修复 PowerShell 5 原生 stdout 编码错误：设置 Console.OutputEncoding / OutputEncoding 为 UTF-8，
避免正确的内嵌拼音在显示和 JSONL 保存时损坏。修复已复制到独立工具产物，Windows PowerShell 实际管道验证通过。
此前错误影响报告显示，不影响 exe 内嵌词表或识别结果；旧报告保留原样，新的对照报告使用正确 UTF-8。

### 2026-09-18：短词与降噪资料核查

官方模型说明确认现有 16k/80维、paths4、trailing1、score1、threshold.25 为有效默认起点，
不是经过真人“敬礼”校准的中文专用最优参数。phone+ppinyin 将中文转为带声调的声母/韵母 token。
官方示例可命中“法国／落实／女儿”，因此不能宣称两字中文词本质不受支持。

- [官方 KWS 原理](https://k2-fsa.github.io/sherpa/onnx/kws/index.html)：boost帮助候选路径保留，threshold是触发的声学概率门限，两者不是麦克风音量阈值。
- [Issue 3809](https://github.com/k2-fsa/sherpa-onnx/issues/3809)，2026-07-28，同款中英模型：作者报告短英文 CALL 4–5/10、TEXT 8–10/10；短词调低阈值仍无改善。GTCRN预处理还降低其召回。
  属于小样本用户报告，无维护者确认的最短词长定律；英文结果不能直接推导中文“敬礼”失败根因。
- [Issue 920](https://github.com/k2-fsa/sherpa-onnx/issues/920)：旧中文模型音节级漏检/切片和阈值讨论，只作短单位识别困难的历史线索。
- [Discussion 2429](https://github.com/k2-fsa/sherpa-onnx/discussions/2429)：作者讨论唤醒词数据中的音色/口音/韵律覆盖；不是当前模型的测评或维护者结论。

决策：不默认叠加降噪，不因合成正样本通过就认定真人适配完成。下一步应在固定真人正/负样本上对照
原音/降噪、模型变体或中文专用模型，以及通用ASR后映射ActionId的候选方案；同时统计漏检和误触发。
这些为建议，尚未实施或证明改善；参数搜索历史仅覆盖第一份5.17秒真人样本，不泛化为所有录音。

### 2026-09-18：用户要求的近音词表实验

独立 CMD 工具新增两档：salute-tones 为 jing li 的五种声调组合（含轻声），salute-near 再加入
jing/jin 与 l/n 变化，共 100 条候选路径。均映射 salute，并保留原有行礼和挥手；总行数分别27/102。
构建时验证 token 存在，阈值等参数不变，正式游戏词表不变。提供 voice-record-near.cmd 双击入口和 -SaluteNear 开关。
主代理对两份真人录音（125102、125720）、合成敬礼、合成挥手、静音在三档词表下重放共15项：
两份真人均 no_keyword；合成分别命中 salute/wave；静音 no_keyword。结果保存在 artifacts/voice-cli/recordings/salute-variants-comparison.jsonl。
这次扩词未解决已有真人漏检。会放宽“经理／经历／尽力”等词的接受范围，不能把近音命中等同严格动作意图；
未进行真实麦克风录制，后续人工实验使用独立入口。

后续用户实录 `20260918-131043-525-19aad7e3.wav` 在102条词表下仍 no_keyword。主代理使用同一声学模型
greedy诊断解码得到 q/ǐng/n/ǐ，合成对照仍为 j/ìng/l/ǐ。该结果只代表模型假设，不证明用户说了“请你”。
临时增加独立诊断标签 probe_qingni（不映射salute）后，默认及5组score/threshold对照仍未触发KWS。
这说明greedy产生token序列不等于KWS触发条件满足，不能仅按该假设扩大动作别名。诊断词表及报告仅在ignored artifacts中。

用户新增 `20260918-131723-073-738dc747.wav`（2.46秒）：同模型greedy诊断输出正确 j/ìng/l/ǐ，
但原始及102条近音词表各7组参数重放均 no_keyword（含tail1000ms）；独立探针 paths1/2/8/16 也未命中。
此样本说明不能把全部真人失败归于发音候选缺失。KWS官方源码同时检查最优路径的图匹配、尾blank和平均声学概率；
现有日志未暴露具体失败门槛，尚未确认库bug。未改正式参数。

### 2026-09-18：worker 调查与主代理独立核实——前导上下文敏感

efficient_worker_kws_trigger 与主代理分别复现：原合成敬礼可命中，前加3秒纯零样本后不命中。
0/0.5/1/1.5/2秒前导均命中，因此不是“超过1.5秒必失败”的规律。原音与产品代码均未修改。
主代理对真人副本仅裁剪开头、保持正式3条词表与默认参数：

| 原文件时刻 | 原结果 | 裁剪对照 |
| --- | --- | --- |
| 13:17:23 | no_keyword | 裁1.0/1.3秒后salute；裁0.5秒仍空 |
| 13:10:43 | no_keyword | 裁1.0/1.3秒后salute；裁0.5秒仍空 |
| 12:57:20 | no_keyword | 裁0.5/1.0秒后salute；裁1.3秒仍空 |
| 12:51:02 | no_keyword | 裁0.5/1/1.3/1.75/2/2.25秒仍空 |

证据目录：`artifacts/voice-cli/recordings/leading-silence-probe`（results、synthetic-padding-results、first-recording-additional-results JSONL及副本）。
结论：至少3份真人样本具有可恢复的正确命中路径，合成音也呈前导时间敏感，不能笼统认定中文不支持或用户发音错误。
同样不能宣称所有失败已解决，或固定裁剪N秒可作为修复；裁剪可能损坏词首。

双方源码复核：
- [keyword-spotter-transducer-impl.h](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/csrc/keyword-spotter-transducer-impl.h) DecodeStreams在尾blank折合>1.5秒时Reset，InitOnlineStream重置encoder/decoder状态。是候选机制，未用修改DLL或内部插桩验证因果。
- [online-zipformer2-transducer-model.cc](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/csrc/online-zipformer2-transducer-model.cc) RunEncoder忽略外部processed_frames，进度包含在states里；所以不能以Reset未清外部计数器推断bug。
- 每次decode后get_result，只有命中后才显式reset，未发现应用吞掉首个命中的证据。

建议下一步：在独立工具验证带前置缓冲的语音分段/窗口处理，保存原音，记录截取范围；用现有真人、合成加静音、负样本一起验收。
本轮仅调查，未修改游戏或CLI生产推理流程，未使用麦克风，未切换模型。

### 2026-09-18：CMD 分段对照实施与验收

用户批准后 efficient_worker_voice_segment 实现 --segment，主代理审核并构建产物。
采用能量启发式（非神经VAD/降噪）：20ms窗、RMS>=0.0005、连续60ms、pre500ms/post300ms，重叠合并。
原始结果保留在 result，全部段识别并汇总在 segmentation.result；每段保存WAV后重新读取识别，唯一目录create_new防覆盖。
记录门限、所有活动及拒绝短脉冲范围、截取位置、文件与结果；无活动返回no_speech，分段错误保留原结果并exit1。
新增双击 voice-record-segment.cmd 入口，控制台额外展示Original result/Segmented result。

主代理独立回归12个样本，报告 artifacts/voice-cli/segmentation-fixtures/comparison.jsonl：
- 最新13:10:43、13:17:23真人从no_keyword恢复salute；较早12:51:02、12:57:20仍no_keyword，明确未全部解决。
- 合成敬礼/挥手保留正确命中；合成敬礼+3秒前导零恢复salute。
- 静音no_speech；合成“你好”、固定随机噪声仍unknown。
- 敬礼后接挥手检测到两者，汇总multiple_actions；重复敬礼汇总单一salute。
- 10个Rust单元测试、Rust fmt、入口PowerShell语法、diff检查通过；已核对原始录音SHA256全部未变。

仅在独立工具启用，正式游戏未接入、未调阈值、未扩大正式词表；未进行新真人麦克风操作。
后续TODO：用户实录验收，噪声/弱词首与被拒绝短活动区间的风险评估；有证据再考虑模型VAD或上游reset插桩。

### 2026-09-18：独立 ASR CMD 对照工具

进度：efficient_worker_asr_cli 完成 Rust 实现；主代理审核识别、别名匹配、录音复用，完成资源准备、包装与回归。
采用 sherpa-onnx 1.13.8 + SenseVoiceSmall INT8（非 Whisper），CPU 2线程，按 locale 指定 zh/en，use_itn=false。
整段 WAV 推理，不裁剪、不补静音、不降噪；只跳过不足200ms或精确全零输入。低音量仍推理。
精确匹配现有别名，仅规范化首尾标点/空白和大小写；不把经理/定理等近音扩充为 salute。
ASR 的 rawText、normalizedText 与动作 result 分开保留，支持区分识别错误和字典未命中。

Slice 状态：Rust CLI、固定哈希模型下载、CMD录音/重放入口、主审和既有录音回归均完成。
模型来源及官方 SHA256 固定在 scripts/asr-assets.json，下载/提取使用大小上限和普通文件白名单；附带模型原始许可说明。
双击 artifacts/asr-cli/asr-record.cmd，等待 RECORDING 后说话，Enter结束；原音与UTF-8 JSONL保存在 recordings。
已有 WAV 可通过 asr-test.cmd 重放。工具不会上传音频，且不访问存档或游戏 dispatch。

主代理独立重放17项，完整报告 artifacts/asr-cli/comparison.jsonl：

| 原录音时刻 | ASR 原始转写 | 动作结果 |
| --- | --- | --- |
| 12:51:02 | 定理 | unknown/no_alias |
| 12:57:20 | 敬礼 | salute |
| 13:10:43 | 经理 | unknown/no_alias |
| 13:17:23 | 经理 | unknown/no_alias |

另：首份录音gain2/4/8仍为定理；合成敬礼/挥手和英文salute/wave正确匹配；合成行礼转写为行李而unknown。
合成你好为你好、固定随机噪声转写我，均unknown；纯零静音跳过；敬礼挥手/敬礼敬礼整段输出不匹配单一别名。
这些结果说明ASR也有短词歧义与噪声转写，不能凭少量样本宣称优于KWS。
Rust ASR 5项 + KWS 10项单测、fmt、脚本格式、PowerShell语法及独立打包通过。

明确不做：本批不切换游戏后端、不加同音宽松匹配、不加入Whisper或神经VAD、不自动操作麦克风。
后续TODO：用户人工实录对比；继续用同一WAV比较两种后端，分别统计转写正确率、动作漏检/误触发及延迟。
若后续考虑拼音匹配，需先明确同音非指令的接受边界，不能将其作为无风险纠错。
