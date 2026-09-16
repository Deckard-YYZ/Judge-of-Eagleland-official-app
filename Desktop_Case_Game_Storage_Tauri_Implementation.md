# Storage / Tauri 线实施记录

基线：`Desktop_Case_Game_Architecture_v1.0.md`（原目录路径已展平）。
日期：2026-09-15 开始，2026-09-16 继续。负责人：主代理审查；开发子代理使用 GPT-5.6 luna / max。

## 目标与边界

存储层只接收符合 Schema 的 SaveEnvelope / GameState，原子保存整局 JSON，不解释案件、量刑、属性结算、解锁或剧情规则。数据库表结构版本、存档 Schema 版本、内容包版本分别管理。

### 本次包括

- SQLite migrations、数据库初始化与失败处理。
- Profile、Save、Settings 仓库，Profile 隔离和 revision compare-and-swap。
- 固定 fixture 驱动的真实 SQLite 测试，损坏／旧版本数据的无损读取检查。
- JSON 备份库接口：从仓库导出已提交快照，导入为新 ID 的副本；不含文件选择 UI。
- Tauri 资源解析、打包资源路径、asset protocol、CSP 和窗口 capability。
- 桌面启动装配及必要集成回归；浏览器预览继续使用明确的内存模式。

### 明确不做／不包括

- Game Core 判决与结算规则；不为存储测试调用规则引擎。
- 云账号、密码认证、云同步、远程内容下载、冲突合并、Profile 删除。
- 设置面板扩展、头像文件持久化、媒体编解码功能开发。
- 不将浏览器 localStorage 用作正式存档，不在数据库初始化失败后静默切换内存。
- 本线自动化检查不等于实际 Windows 安装包的离线、音视频及重启人工验收。

## 阶段与审查门槛

| 阶段 | 内容 | 主代理检查 | 状态 |
| --- | --- | --- | --- |
| 1 | 数据库、迁移、三类仓库、固定 fixture 和真实 SQLite 测试 | SQL 参数绑定、CAS 原子性、迁移无损、错误语义、测试 | 开发中 |
| 2 | 资源解析、Tauri 资源配置与权限 | 路径限制、版本绑定、资源范围、配置编译和测试 | 开发中 |
| 3 | 桌面装配、全量回归和文档收尾 | 初始化失败行为、恢复路径、构建、边界与格式 | 开发中 |

阶段 1、2 可并行开发；阶段 3 的最终接线依赖仓库契约稳定。每阶段必须由主代理阅读实现并执行验证，不能只据子代理报告标记通过。

## 决策记录

1. 保持现有 SaveRepository 契约；整局状态用单条条件 UPDATE 写入，检查受影响行数。
2. 已知 SaveRepositoryError 表示确认没有提交；不能把未知数据库／IPC 异常伪装成安全重试，交给 GameSession 重新读档核对。
3. v1 → v2 迁移在 load 边界内存执行，读取不覆盖原数据；正式提交写 v2。
4. 保持 SQL 插件相对地址 `sqlite:judge.db`；位置由插件解析到应用用户配置目录，不写死开发机路径。
5. 现有 001 migration 已存在，任何新增结构采用新增版本，不修改已发布迁移的含义。
6. 系统默认 Node 为 18.12.1，不符合项目要求；本轮验证使用本机 bundled Node 24.19.0。
7. 真实 SQLite 测试读取 Rust 注册的实际 SQL 文件；不在 TypeScript 复制第二套建表语句。测试连接上的迁移使用事务，正式迁移由 SQL 插件管理。
8. Profile 名称规范化放在 `src/shared/profileName.ts`，表单与仓库共用；稳定 ID 不承担显示名称规范化职责。

## 审查记录

- 第一轮：移除测试专用的重复迁移实现，避免测试与生产 SQL 漂移。
- 第一轮：删除无消费者的旧数据库探针；该探针会关闭数据库，不适合与正式共享连接并用。
- 第一轮：要求 Save 创建验证 Profile 存在，防止孤立存档；要求提交先复制输入快照，校验 revision 上限和存档版本。
- 第一轮：收敛资源解析 API，去掉无消费者的别名及双参数顺序重载；补充 Windows 路径别名与浏览器跨来源路径检查。
- 继续实施：`7c32128` 为部分实现检查点，并非通过验收的完整版本。继续修复未完成的导出／类型改动、补齐真实 SQLite 测试和桌面启动装配。

## 验证记录

- 基线：Node 24.19.0 执行 `tsc --noEmit` 成功；Vitest 28 文件 / 218 测试通过。
- 环境修复：按原 lockfile 执行 npm ci；必须由 Node 24 直接执行 npm-cli.js。本机 npm.cmd 会优先使用其同目录的 Node 18，单纯前置 PATH 不足以切换 npm 本身。
- 备份接口：`vitest run tests/storage/saveBackup.test.ts`，6 项通过。验证已提交快照导出、Profile 隔离、独立副本、禁止覆盖及非法／过新 Schema 拒绝。
- 其余阶段结果待主代理检查后补充。
- 阶段 2 首次主代理验证：`vitest run tests/platform` 2 文件 / 35 项通过；`cargo check --manifest-path src-tauri/Cargo.toml --locked` 通过。
- 启用 `protocol-asset` 后 Cargo 锁文件新增 `http-range 0.1.5`；没有升级已有 Tauri／SQL 版本。
- 编译后 `src-tauri/target/debug/content` 已生成；示例 MP4 源文件与复制文件 SHA-256 均为 `97A94FD41DF1EF2C741F522BC5B2556FFE3017461B63AB28AFC957E56C3DA711`，验证资源映射实际生效。
- 为 Node SQLite 测试新增锁定的 `@types/node 24.13.5`，删除原测试中“不提供 Node 类型”的抑制注释；生产模块依赖方向保持不变。

## 接口与模块

| 文件 | 职责 |
| --- | --- |
| `src/storage/index.ts` | 正式初始化入口 `initializeStorage`、共享连接仓库装配及公共导出 |
| `src/storage/database.ts` | SQL 插件适配、打开数据库、只读校验必要表和列；失败关闭本次连接 |
| `src/storage/schema.ts` | SQL 连接窄接口与必要表结构描述；不复制迁移 SQL |
| `src/storage/profileRepository.ts` | Profile 创建、查询、规范化与数据库唯一约束 |
| `src/storage/sqliteSaveRepository.ts` | 整局 JSON 读取、创建、原子 CAS；不执行游戏规则 |
| `src/storage/settingsRepository.ts` | `app` / `profile:<id>` JSON 设置；损坏读取明确报错 |
| `src/storage/migrateSave.ts` | 内存中的 v1 → v2 纯数据迁移 |
| `src/storage/saveBackup.ts` | 已提交快照 JSON 导出、只创建不覆盖的导入 |
| `src/platform/assets.ts` | 内容包资源 ID → 精确版本的资源 URL |
| `src-tauri/migrations/001_initial.sql` | 数据库初始表结构，Rust 注册的唯一 SQL 来源 |

设置的 `null` 值与缺失键均由 `get` 返回 `null`；需要区分两者时使用 `list` 检查键是否存在。设置仓库只负责 JSON 存储，各设置键的业务值范围由消费模块验证。

## 集成限制与发布前验收

- `StoryPlayer` 目前使用已有的视频替代文本界面，资源解析器交付不等于播放器已接入真实媒体。
- `content/minimal-test-package/1.0.0/media/videos/ending-balanced.mp4` 当前仅 54 字节，是测试占位资源；路径与打包成功不能证明它可播放。
- 发布前需以实际 Windows 安装包验证干净环境首次启动、断网、注册、开始案件、退出重启、待播剧情恢复与 Profile 切换。
- 使用正式媒体验证图片显示、视频声音和失败降级；检查安装后资源只从打包目录读取。
- 备份库接口只返回／接受 JSON 字符串；仍需用户可见的文件导入导出入口，不会为此预先开放整个文件系统。

## TODO

- [ ] 阶段 1 主代理审查与针对测试。
- [ ] 阶段 2 主代理审查、配置编译与针对测试。
- [ ] 阶段 3 全量回归、构建、格式与模块边界检查。
- [ ] 记录最终公共接口、已知限制、后续安装包验收清单。
- [x] JSON 导出／导入库接口；禁止覆盖现有存档。
- [ ] 发布前接入备份文件选择／下载入口，并人工验证恢复流程；目前库接口不等于用户可操作的备份页面。

## 技术依据

- [Tauri SQL 插件：参数绑定、迁移与权限](https://v2.tauri.app/plugin/sql/)
- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri 资源打包](https://v2.tauri.app/develop/resources/)
