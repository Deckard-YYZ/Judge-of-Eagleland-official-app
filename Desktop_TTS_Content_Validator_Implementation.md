# TTS / Content / Validator 线实施记录

更新日期：2026-09-18。状态：T0–T4 骨架与基本功能测试全部完成并经主审，真实设备/安装发布验收见后期 TODO。基线：`Desktop_Case_Game_Architecture_v1.0.md`、`Desktop_Case_Game_Architecture_Extension_ActionInput_TTS_v1.1.md`，重点第 21–25 节。用户给出的分层路径在仓库中实际为上述根目录文件。

## 目标与验收范围

完成 TTS 骨架与基本功能测试：内容配置 → 只读旁白投影 → 单实例旁白服务 → sherpa 本地合成 → Web Audio 播放；与 KWS 录音互斥。声音为可失败、可停止的表现，不更改 GameState、revision、save schema v3 或输入处罚语义。真实硬件试听、回声与干净安装必须另记证据，不能由 Fake 测试推定通过。

## Slice 进度与审核

每个 slice 由 efficient_worker 职责子代理实施，主代理审查 diff、边界与专项测试后才能标记通过；独立内容和原生适配可并行。当前工具没有自定义 agent 类型参数，使用命名子代理承担 custom_explorer / efficient_worker 职责。

| Slice | 范围 | 进度 | 主审门槛 |
| --- | --- | --- | --- |
| T0 | 文档、骨架调查、实施记录 | 已完成 | 已定位内容、StoryPlayer、VoiceInputShell、sherpa 1.13.8 接点；无仓库 AGENTS.md / Mistakes.md |
| T1 | content v4、严格校验、投影、新版本双语样本 | 主审通过 | N01–N08；旧 v2/v3 拒新字段，所有发布语言完整，无存档/Core 改动 |
| T2a | Rust sherpa TTS、固定资源与真实合成 | 主审通过 | 有界参数、PCM、单原生槽、取消后不播放、缺资源降级、锁定 SDK |
| T2b | TS 服务、Web Audio、原生桥接、根级声音互斥 | 主审通过 | preparing/playing/ended 区分，迟到结果失效，麦克风预留早于停止输出 |
| T3 | Story 自动一次、停止/重播、语言与本地偏好 | 主审通过 | same-step 保存不重播，切页/语种清理，StrictMode 与错误降级 |
| T4 | 组合回归、构建、运行证据与交接 | 主审通过 | 专项与既有回归、边界/格式/内容检查、明确真实设备验收差距 |

## 重要决策

1. content Schema v4 新增 narration/narrationText，旧包保持原语义；发布包不就地修改，新增独立样本版本。
2. `system` 是唯一逻辑声音；TTS locale 来自实际加载的内容投影，独立于玩家选择的 KWS locale。
3. 单一正式播放路径使用 Web Audio mono PCM；Rust 只合成，JSON IPC 显式校验并转换 Float32Array。
4. 取消对用户生效与原生计算结束分开；超时/取消不能释放仍在计算的原生槽。旧 requestId 的 stop 不能停止新请求。
5. 输入轮次先同步占位，静音确认及有界尾音保护后才申请麦克风；录音权限/推理仍在途时不启动旁白，不排队。
6. 当前 StoryPlayer 视频仅文字 fallback，没有视频或配音输出。接入实际媒体时必须纳入同一静音边界。
7. 保持 sherpa 1.13.8 与已有 shared DLL，不为 TTS 升级或覆盖 KWS 运行库。模型资源与 KWS 词典分开。
8. 初始工作树只有用户未跟踪的 TTS v1.1 设计文档；保留该文档，不回滚、不改写。

## 明确不做

- 不新增规则命令、听完奖励、强制收听、存档旁白进度。
- 不做云合成、语音对话、声纹克隆、多音色管理、流式输出、SSML、音频磁盘缓存、逐字字幕。
- 不修改 KWS 模型、动作词典、识别阈值或既有独立 ASR 实验。
- 不实现摄像头识别、完整视频播放器或多声道混音器。
- 不把自动化模拟结果写成真人听感、硬件回声或干净安装通过。

## 测试证据

### T1 主审

- `npx vitest run tests/content tests/game/storyInput.test.ts --reporter=dot`：12 文件、96 测试通过，其中新增 15 项旁白契约测试。
- `npm run validate:content`：1.0.0、1.1.0、1.2.0 全部通过。旧版本包零修改。
- worker 的 TypeScript 检查通过；主代理审查 schema、validator、只读投影和真实 transition 等价测试。
- 1.2.0 教程入口 `tutorial_voice_order`：intro 读 blocks；order 读“请敬礼。”/“Please salute.”；after_order 无旁白。
- N06 在内容线验证 actual locale 投影；完整切语种/fallback/保留输入语种的 UI 验证继续在 T3。

### T2a / T2b 主审

- `npx vitest run tests/platform --reporter=dot`：15 文件、113 测试通过；依赖边界检查通过。
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib`：24 测试通过；Rust fmt 检查通过。
- 主审指出并由 worker 修复：AudioContext 构造失败错误归类、停止失败后再次停止的资源释放、输入静音失败应归 CAPTURE_FAILED、阶段诊断及 operationId 关联。
- 播放测试区分合成与实际 ended；覆盖停止/拒播/迟到 resume、断开失败后重试。输入组合测试确认停止输出成功并等待 150ms 后才申请麦克风；迟到授权/原生 cancel drain 期间旁白不能启动。
- 后端及前端均限制 500 Unicode 字符、8–48 kHz、30 秒 mono finite PCM；服务等待上限 60 秒。原生时限为协作检查，不能抢占正在执行的 ONNX 调用；取消/超时期间计算槽保持占用。
- 模型：Melo 中英、system / speaker 0 / speed 1 / CPU 2 线程。新增资源 177,481,452 bytes，档案 SHA-256 与单文件 SHA-256 固定。仅首次模型加载校验，进程缓存后的磁盘变更需重启再检。
- worker 的五次真实合成（中英口令、两种 intro、中文热启动重复）均 44.1 kHz、有限非零 PCM；首次 4151ms、后续 225–844ms。真实计算取消时 BUSY，退出后成功恢复。证据见 `src-tauri/tts/smoke-evidence.json`，这些指标不是性能承诺。
- 资源来源、已保留的 LICENSE/README 和许可核查范围见 `src-tauri/tts/README.md`。准备脚本不替换共享 DLL；KWS 原生静音烟测仍为 unknown。
- 主代理另行运行 `npm run tts:smoke`，五段音频和取消恢复再次通过；首次 3945ms、后续 223–832ms。原始报告及 WAV 在 `src-tauri/target/debug/tts-smoke.json` 同目录，无麦克风或输出设备操作。

### T3 主审

- `npx vitest run tests/ui tests/content/bundledRepository.test.ts --reporter=dot`：12 文件、64 测试通过；旁白专项 9 项使用真实 GameSession / 存储及 FakeNarrationService。
- StrictMode 自动一次、实际 ended 前保留播放状态、局部继续/正确输入停止、same-step 错误保存不重播、Profile 归属、卸载、静音持久化、未配置不播、异常和拒播保留文字全部覆盖。
- 切换 UI 语言先取消并禁止用旧投影重播，ready/fallback 后只接受手动重播。主审修复 locale 与新投影同一 render 到达导致永久禁用的边界。
- stop 失败显示稳定错误；迟到停止失败不能覆盖新请求状态。所有按钮/状态经双语 i18n；没有新增模型参数给 UI。
- 新游戏及浏览器样本使用 1.2.0；旧存档版本绑定不变。旧 UI 测试按真实命令完成新增教程后继续原场景，没有在生产代码中自动通过教程。
- 关闭全部旁白仍可通过文字完成教程；验证仅既有输入和完成剧情各产生一次 revision，旁白不新增保存。

### T4 构建及资源复验

- worker 重跑 `npm run tts:prepare` 成功，8 项资源与固定 manifest SHA-256 全部一致。
- KWS 三项 DLL 与锁定归档对应成员一致；`.cargo/config.toml`、voice-assets、Cargo 依赖及锁文件没有改动。
- `npm run build` 通过（TypeScript、voice:check、Vite）；主 JS chunk 约 557.75 kB，仍有超过 500 kB 的体积提示，不影响构建。未为此引入无关拆包改造。
- `cargo build --locked --manifest-path src-tauri/Cargo.toml` 通过，无警告。当前 `bundle.active=false`，属于桌面可执行文件构建，不是安装器验收。
- 最终 `npm run check` 完整通过：TypeScript、语音资源词典、61 文件 / 483 项 Vitest、模块边界与 Prettier 全部通过；`npm run validate:content` 三版本再次通过。
- 全量回归首次发现 7 项旧默认预期：v4 不支持断言改为 v5；新游戏教程使用真实输入与 completeStory，明确验证新增两次 revision；旧 1.1.0 垂直测试继续读取旧物理包，并断言未注入新教程。主审检查全部修正，无规则行为放宽。
- 格式门禁发现三个原有文件行尾差异，Prettier 归一后 Git diff 为空；没有附带案件 UI 功能变更。最终 `git diff --check` 通过，Core/Storage 与旧包均无代码差异。

## 本地验证入口

```powershell
npm run tts:prepare
npm run tts:smoke
npm run validate:content
npm run check
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
cargo build --locked --manifest-path src-tauri/Cargo.toml
```

首次机器还需要 `npm run voice:prepare` 提供锁定的共享运行库。测试新旁白时创建新 Profile / 新游戏读取 1.2.0；已有 1.0.0 / 1.1.0 存档仍按原内容版本恢复，没有新增自动旁白。浏览器预览无原生合成，旁白不可用时仍可完成文字流程。

## 后期 TODO

- 固定中英音色的人工试听与人名、数字、英文词覆盖核对。
- 扬声器/耳机/不同房间尾音实测；当前尾音保护参数不代表已证明无回声。
- 干净 Windows 安装、断网、损坏/缺失 TTS 资源、不同输出设备与恢复场景。
- 发布前分别核查 SDK、模型、词典及附带资源的许可与再分发要求。
- 后续视频/配音接入必须通过根级声音互斥，不另建绕过录音预留的播放路径。
