# Android 单进程 APK：构建与待验收记录

日期：2026-10-20
范围：`main` 的独立 APK（DSHA v0.2.0-rc2 + DSH 0.2.0-rc.2）

## 结论

独立 APK 把原生层固定为 `tavern` Profile（端口 3080），不再启动 DSHA 的 `web` / `user`
Profile，因此手机上只有一个 DSH 常驻进程。构建、签名和静态检查已完成；**真机/模拟器上的
内存对比与首次安装验收尚未执行**，本文不声称已通过运行验收。

## 构建身份

| 项 | 值 |
| --- | --- |
| DSHA 源码 | `8362bba747fcf84c19e436c3dbb594a0fc388a67`（v0.2.0-rc2） |
| 官方 APK SHA-256 | `1fedf883d431af658d89c28b86d85974cc1d11b74e0c5d46ef3d3cf8650b1961`（与 release 校验文件一致） |
| 酒馆版本 | 3.0.0（`versionCode` 30000） |
| 包名 | `io.github.flizzywine.dshtavern.standalone` |
| 构建产物 | `output/android-apk-020/dsh-tavern-android-release.apk` |
| 产物 SHA-256 | `cf7a04b53a691767d96805cb89ce142f8f7e65003c3585eaa89f40a1e6cba014` |
| 签名证书 SHA-256 | `D6:B8:B0:C7:25:BE:51:41:58:AF:97:4B:04:27:92:26:2E:CD:6E:97:47:06:89:95:24:2F:EE:30:55:59:E4:8D` |

产物由 `TAVERN_APK_MODE=Release TAVERN_APK_SKIP_TESTS=1 bash android/apk/build.sh` 生成。
`TAVERN_APK_SKIP_TESTS=1` 只用于本次沙箱：上游两个单测依赖可写符号链接和自由端口，在本机
必然失败（`AdbWheelPathsTest`、`WebPortPolicyTest`），与本方案改动无关；Debug 构建的其余
1330 个单测通过。

## 已做的验证

- APK 清单：包名、`versionCode 30000`、`versionName 3.0.0`、minSdk 30、`application-label` 为
  「DSH Tavern」，且没有 `application-debuggable`。
- `apksigner verify`：v1/v2/v3 签名有效，证书为酒馆长期密钥（非 DSHA 的 E7E3）。
- `zipalign -c -p 4` 通过，native 仅 `arm64-v8a`。
- 资产：`assets/tavern-apk-setup.sh`、`offline-rootfs.bin`、`dsh-runtime.bin`、
  `runtime-descriptor.json`、`recovery-*`、`es-compat.js` 均在包内；setup 脚本与构建时的
  `android/setup.sh` 逐字节一致（仅追加“停掉安装器临时 3088 服务”三行）。
- `es-compat.js` 的 SHA-256 与包内 `es-compat.inputs.json` 一致，且包含 `structuredClone`
  兼容层；`Constants.DSH_VERSION` 与内置 DSH 0.2.0-rc.2 一致，浏览器补丁会实际生效。
- DEX 中可检索到 `DSH_TAVERN_ANDROID_STANDALONE`、`tavern-apk-installed`、新包名和
  `exec dsh --profile`，确认补丁进入 Release 包。
- 单进程路径：生产代码只有 `WebLifecycleController.startWeb` → `StartupPipeline` 这一条启动链，
  返回 `tavern`；`HarnessController.runCoreCommand()` 只被 debug / deviceAudit 源集引用。
  `android/configure-profiles.mjs` 清空 tavern Profile 的 web 插件，`dsh-tavern-entry` 只加入
  web Profile，APK 不会拉起 3088 入口插件。
- pnpm **11.25.0**（安装器实际版本）验证：`pnpm_config_fetch_timeout=123` 会被
  `pnpm config get fetchTimeout` 读为 123，`--config.fetchTimeout=600000` 可覆盖它。
- 单测：`StartupPipelineTest`、`TavernWebProcessTest` 通过；新增的启动 shell 识别断言覆盖
  `exec dsh --profile 'tavern'` 与 `node /usr/local/bin/dsh --profile tavern`；安装测试
  21/21 通过（夹具校验新的 `--config.fetchTimeout=600000` 参数）。
- 文档测试与新客户端提示测试通过。

## 首次安装实测反馈（2026-10-20，MuMu）

真机日志显示 APK 引导链路正常：环境解压后自动进入「首次安装」，成功 clone `main`、安装
Tavern 专用 pnpm 11.25.0，随后核心依赖从 `registry.npmmirror.com` 批量超时
（`UND_ERR_CONNECT_TIMEOUT` / `error (23)`，单请求 20–70 秒），安装停在依赖阶段。

根因不只是镜像：pnpm 的单请求 `fetchTimeout` 默认 60000ms，慢速网络下载大包时 undici 以
code 23 中止（日志里的 `error (23)`）。pnpm 11 支持用 `pnpm_config_fetch_timeout` 覆盖，因此
APK 的安装命令固定导出 `pnpm_config_fetch_timeout=600000`；`android/install.sh` 的 pnpm 包装
也显式传 `--config.fetchTimeout=600000`，让 DSHA 路线在推送后同样受益。

另保留一次自动重试：首次失败后用 `https://registry.npmjs.org` 重跑 setup，日志以 `tee -a`
追加；两次都失败才报错并提示检查网络。本次重建后的产物 SHA-256 为上表的值；版本号未变
（30000 / 3.0.0）。

## 待验收（需要设备）

1. MuMu Android 12 与至少一台中端 ARM64 真机：全新安装 → 引导解压 → 自动安装酒馆 → 导入
   人物卡 → 游玩一轮（含 MVU 结算）。
2. `ps -ef | grep -E "dsh|node"`：仅一个 `dsh --profile tavern`，无 3088 常驻；模板/卡脚本
   fork 只在使用时出现。
3. 记录主进程与子进程 RSS，与“DSHA v0.2.0-rc2 + 安装脚本”跑同样操作对比。
4. 应用内更新一次后仍可启动、仍是单进程。
5. 旧数据迁移：从 v2.1 APK（DSH 0.1.5）导出存档/人物卡，在新包导入；两包签名不同，不能
   覆盖升级。
6. 签名密钥离线备份确认后再发布。
