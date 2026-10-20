# Android 安装与更新

## 独立 APK（首选，Android 11+ / ARM64）

[下载 DSH Tavern Android APK](https://github.com/flizzywine/dsh-tavern/releases/latest/download/dsh-tavern-android-release.apk) · [下载 SHA-256 校验文件](https://github.com/flizzywine/dsh-tavern/releases/latest/download/dsh-tavern-android-release.apk.sha256)

独立 APK 内置 DSHA v0.2.0-rc2 与 DSH 0.2.0-rc.2，只启动酒馆自己的 `tavern` Profile（端口 3080）。它不运行 DSHA 的 `web` Profile，所以手机上只有一个 DSH 服务，内存、CPU 和电量开销明显低于下面的 DSHA 路线。

1. 下载 APK，按 Android 提示允许当前浏览器或文件管理器安装应用，然后安装。
2. 打开「DSH Tavern」，按首次引导完成内置环境部署（离线解压，不需联网）；随后应用会自动下载并安装酒馆，保持联网并等待完成，无需另装 DSHA，也无需输入命令。
3. 安装完成后会自动进入酒馆；在酒馆设置中配置文字模型，再导入人物卡。
4. 以后直接打开此应用；酒馆源码更新在应用内完成，更新后返回启动页重启。

这是在线安装包，首次启动需要下载最新版酒馆；请保持应用运行。依赖下载失败时，应用会自动改用官方 npm 源（registry.npmjs.org）重试一次。仍失败时保留错误日志，再点击启动重试；安装日志位于容器内 /root/.dsh/logs/tavern-install.log。

APK 使用独立包名 `io.github.flizzywine.dshtavern.standalone`，可以与旧版 v2.1 APK（DSH 0.1.5）和原版 DSHA 同时安装，数据各自独立。旧版 v2.1 APK 与本包签名不同，不能覆盖升级：先在旧包里导出存档和人物卡，装好本包后按 [数据导入](data-import.md) 导入。两个应用不要同时运行。

Android 安装包不从应用内自更新：新版本从 [Releases](https://github.com/flizzywine/dsh-tavern/releases) 下载，直接覆盖安装同一包名的新 APK。不要为了更新先卸载应用，以免删除应用数据。

本包要求 Android 11 及以上、ARM64。设备不满足要求时使用下面的 DSHA 方案；DSHA 路线会同时运行两个 DSH 服务。

> 不同手机系统、网络和后台限制都可能导致安装或运行失败；当前安装脚本只能修复项目已知问题。

## 备选：通过 DSHA 安装（Android 11+）

> DSHA 路线会同时运行 DSHA 自己的 DSH（`web` / `user` Profile，3080）和酒馆的 DSH（`tavern` Profile，3088），内存、耗电和 CPU 占用都高于独立 APK。Android 11 及以上的 ARM64 手机优先用独立 APK；只有在设备不满足 APK 要求，或已经在 DSHA 中积累了大量配置时才选这条路线。

当前版本适配 DSHA **v0.2.0-rc2**（内置 DSH 0.2.0-rc.2）。请安装 **[DSHA v0.2.0-rc2](https://github.com/DSH-APP/DSHA/releases/tag/v0.2.0-rc2)**。Android 11 及以上用标准包 `dsha-0.2.0-rc2.apk`，更早的系统用兼容包 `dsha-0.2.0-rc2low.apk`。DSHA 0.1.5（内置 DSH 0.1.5）不能安装当前版本；需要旧宿主时改用 stable 分支的安装方法。历史包见 [DSHA 历史版本下载页面](https://github.com/DSH-APP/DSHA/releases)。

dsh-tavern 可以借助 [DSHA](https://github.com/DSH-APP/DSHA) 在 Android 手机上安装和使用。下面从安装到排错的所有步骤都只针对 DSHA 路线；已经用独立 APK 跑通的用户不需要继续阅读。

## DSHA：最简单的安装方法

1. 安装 DSHA，配置模型，并确认 DSHA 自身可以正常打开。
2. 打开 DSHA 底部的 **终端**，把下面整条命令复制进去并回车。安装脚本会自行完成下载、配置、校验、启动和失败回滚：

```bash
node -e "fetch('https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/android/setup.sh').then(async r=>{if(!r.ok)throw Error('HTTP '+r.status);require('fs').writeFileSync('/tmp/dsh-tavern-setup.sh',await r.text())}).then(()=>{const r=require('child_process').spawnSync('bash',['/tmp/dsh-tavern-setup.sh'],{stdio:'inherit'});process.exit(r.status??1)}).catch(e=>{console.error(e);process.exit(1)})"
```

3. 如果不会使用终端，也可以打开“创造模式”，完整复制下面这一整段话发给 Agent：

```text
请帮我安装 DSH Tavern。只需要原样执行下面这一条命令，等待它结束，然后把最后的结果告诉我；不要拆解步骤，也不要修改命令：

node -e "fetch('https://raw.githubusercontent.com/flizzywine/dsh-tavern/main/android/setup.sh').then(async r=>{if(!r.ok)throw Error('HTTP '+r.status);require('fs').writeFileSync('/tmp/dsh-tavern-setup.sh',await r.text())}).then(()=>{const r=require('child_process').spawnSync('bash',['/tmp/dsh-tavern-setup.sh'],{stdio:'inherit'});process.exit(r.status??1)}).catch(e=>{console.error(e);process.exit(1)})"
```

4. 看到“全部完成”后重启 DSHA，在底部 **启动** 页点 **启动**；显示“已就绪，可进入”后点 **进入**，再从侧栏打开 **酒馆工作台**。

如需从手机 Download 目录导入人物卡，还需在 Android 系统设置中允许 DSHA **访问所有文件**。酒馆检测到无法读取下载目录时会明确提示，也可尝试界面中的系统文件选择器。

不需要手工克隆仓库、进入目录、配置 Profile 或输入端口。

点击 **酒馆工作台** 后，酒馆会直接在 DSHA 内全屏打开，无需另外安装窗口插件或手动填写地址。窗口里没有工具栏，整屏都留给酒馆。按系统 **返回键** 关闭窗口、回到 DSHA；页面卡住或需要刷新时，返回后再点一次 **酒馆工作台** 即可重新加载。

## 以后怎样打开酒馆

1. 打开 DSHA，点底部 **启动** 页。
2. 如果显示未运行，点 **启动**，等待“已就绪，可进入”。
3. 点 **进入**，在打开的页面侧栏点 **酒馆工作台**；侧栏收起时先展开。
4. 使用期间保持 DSHA 运行。

这条路径自动处理认证，不需要自己找 token 或输入端口。不要把手输浏览器地址作为日常入口。

## 浏览器提示需要认证怎么办

如果看到：

```text
dsh web authentication required; reopen the URL printed by dsh web.
```

意思是：服务已收到请求，但当前浏览器没有有效的登录凭证（HTTP 401）。这不代表安装失败，不必因此重装。

**最简单的恢复：回到 DSHA → 启动页 → 进入 → 酒馆工作台。**

如果必须使用外部浏览器：

1. 回到 DSHA 的 **启动** 页，确认服务已运行。
2. 在本次启动的日志中找到 **本机打开**，取得该行完整地址，包括 `?token=` 后面的全部字符；不要使用旧截图中的地址。不同版本的日志展示可能不同，找不到时优先使用内置入口。
3. 把完整地址粘贴到**同一台安卓设备**的浏览器地址栏打开。这一步先进入 DSH 主界面。
4. 再点击侧栏 **酒馆工作台**，进入酒馆。

不要只复制 `http://127.0.0.1:3080` 或 `http://127.0.0.1:3088`：未登录的浏览器直接打开它们就可能看到上述提示。DSHA 内置页面和外部浏览器不共享登录状态；换浏览器、清除浏览器数据或重新启动后若再次提示认证，重新走上述流程。完整地址相当于登录凭证，不要发群或公开截图。

MuMu 用户也在**模拟器里面**完成这些步骤。这里的 `127.0.0.1` 指当前设备，复制到电脑浏览器不会自动连到模拟器里的 DSHA。

实测记录（2026-09-11）：现有 MuMu、DSHA 1.2.0-rc1、酒馆 v1.6.0。内置“进入 → 酒馆工作台”成功；模拟器自带浏览器直接打开 3088 复现上述报错，使用本次启动的完整 3080 认证地址后再点“酒馆工作台”，成功显示酒馆页面。本次验证限于认证与页面进入，不代表外部浏览器的模型生成和全部功能验证通过；适配版本仍以上文为准。

内嵌窗口另已完成旧存档读取、真实模型生成、变量结算及重启恢复测试，见 [MuMu 实测记录](research/android-embedded-window-mumu-2026-09-11.md)。

## 更新与修复

正常更新：打开酒馆，点击左侧栏底部的 **更新到最新版**。

酒馆打不开时：回到 DSHA 主界面，在 **酒馆工作台**入口点击 **更新/修复**。它不依赖 3088 已经启动。

**更新完成后，还需在 DSHA 底部「启动」页点「重启」**，等待就绪后点「进入 → 酒馆工作台」，让 DSHA 加载新版入口。老用户不用卸载重装，也不用另外安装窗口插件。

这两个入口都会安全更新原安装、保留用户配置并重新启动酒馆。检测到项目目录有本地修改或分叉时会停止，不会强行覆盖。

脚本通常优先通过 Git 下载；如果当前网络无法完成 GitHub 的 Git 下载，会自动改用 `codeload.github.com` 的普通 HTTPS 压缩包。压缩包会先在临时目录解压并校验，确认完整后才整体替换源码；安装失败时恢复旧源码。

## 一键脚本做了什么

`android/setup.sh` 同时负责首次安装、更新和修复：

- 首次运行时下载到 DSHA 的应用目录，Git 失败时自动改用压缩包；
- 再次运行时优先安全快进更新，网络不支持 Git 时继续使用压缩包更新；
- 自动创建和配置 Tavern Profile；
- 自动安装新版移动端界面插件与酒馆入口，并清理旧版适配插件；
- 校验配置并启动酒馆。

这些是内部步骤，普通用户不需要逐项执行。

## 排错

- 更新在“停止旧版酒馆服务”处出现 `kill EPERM`：新版会核对安卓进程身份，并清理端口未监听的陈旧或无法确认的 PID 记录；不会向身份不明的进程发送终止信号。若提示真实服务权限不足或端口被未识别进程占用，请先在 DSHA 中停止服务，再重试。
- 恢复备份后安装 pnpm 提示 `EEXIST`：新版会在临时目录安装并校验专用 pnpm，再替换损坏目录；安装或校验失败时保留原目录，可重新运行安装。无需删除聊天、人物卡或整个 `.dsh` 目录。

- 酒馆窗口白屏或连接中断：按返回键关闭窗口，再点一次 **酒馆工作台** 重新加载；仍打不开时确认服务运行，再点击 **更新/修复**。
- 更新后窗口顶部仍有工具栏：在 DSHA 底部 **启动** 页点 **重启**，再从侧栏打开酒馆；只刷新酒馆页面不会重新加载入口插件。

- 一键命令下载失败：确认 DSHA 已完成基础安装并且手机能访问 GitHub，然后重试同一句话。
- 更新提示“存在未提交修改”或“已经分叉”：脚本为避免覆盖文件会主动停止，请先备份或移走 `/root/.dsh/apps/dsh-tavern` 中的手工修改。
- 酒馆仍未启动：点击一次 **更新/修复**；仍失败时查看 `/root/.dsh/logs/tavern.log`。
- 导入窗口显示无法读取下载目录：在系统设置中打开 DSHA 的 **访问所有文件** 权限，返回酒馆后点“刷新”。
- 如果 DSHA 使用的 Web Profile 既不是 `web` 也不是 `user`，安装前设置 `DSH_ANDROID_WEB_PROFILE`。
- 必须允许 DSHA 在后台运行；Android 杀死 DSHA 后，DSHA 和酒馆服务都会停止，重新打开 DSHA 后会自动拉起。
- 手机适配依赖 DSH 前端结构；DSH 更新后如有布局异常，先点击 **更新/修复** 获取最新版适配。

仅在需要人工排错时，才直接运行本地入口：

```bash
bash /root/.dsh/apps/dsh-tavern/android/setup.sh
```
