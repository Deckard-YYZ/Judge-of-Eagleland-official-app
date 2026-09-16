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
