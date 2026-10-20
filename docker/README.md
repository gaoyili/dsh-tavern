# DSH Tavern Docker 镜像 —— 构建与部署指南

> 方案 B：**精简基础镜像 + 首次启动时安装 / 镜像更新后自动升级**。
> 镜像内不含 Tavern 本体，程序与依赖安装在数据卷；镜像只负责安装器与运行入口。
>
> **当前版本：Tavern 3.0.0 / 独立 DSH 0.2.1-rc.2**
> 镜像推送到阿里云 ACR（也支持 GHCR 等 OCI 仓库），见第五节。
> （支持 DSH 0.1.5 的 2.7.0 版本在上游 `stable` 分支，本目录不涉及）

---

## 一、镜像特性

| 项目 | 说明 |
|------|------|
| 基础镜像 | `node:22-alpine` |
| 镜像大小 | **约 296 MB**（离线导出约 72 MB），远低于 1 GB 目标 |
| 运行用户 | 入口以 root 对齐数据目录属主后**降权**到非 root `tavern`（默认 `PUID:PGID=1000:1000`，可覆盖） |
| 运行模式 | CLI（`DSH_TAVERN_HOST=cli`） |
| 数据持久化 | 程序、运行时与用户数据全部位于 `/home/tavern/.dsh-tavern`（挂卷） |
| 访问端口 | 容器对外 `3080`（内部核心 `3081`，由内置反向代理转发） |
| 认证 | 使用外部反代（如 lucky）的 Basic Auth；镜像默认**不装** `dsh-webui-auth` |
| 自动升级 | 镜像修订号与数据卷记录不一致时，启动时自动升级（暂存切换、失败回滚） |

### 目录结构

```
dsh-tavern/                      # 本仓库（gaoyili/dsh-tavern fork）
├── docker/
│   ├── Dockerfile               # 镜像定义
│   ├── entrypoint.sh            # 容器入口：降权 / 安装升级 / 修复 / 启动
│   ├── apply-launcher-patch.mjs # 启动器补丁（信任主机、就绪检查）
│   ├── detect-ips.mjs           # 本机网络地址探测
│   ├── reverse-proxy.mjs        # 反向代理（0.0.0.0:3080 → 127.0.0.1:3081）
│   ├── resolve-source.mjs       # GitHub 加速源探测
│   ├── push.sh                  # 构建 + 推送到镜像仓库
│   ├── docker-compose.yml       # NAS 部署示例
│   └── README.md                # 本文
├── install.sh                   # 上游安装脚本（构建时 COPY 进镜像）
└── .dockerignore                # 构建上下文排除项
```

---

## 二、关键设计说明

### 1. 为什么运行时安装而不是构建时复制

早期做法是在宿主机安装后 `COPY` 进镜像，会带来符号链接指向宿主路径、pnpm 硬链接
虚拟存储失效等问题，镜像体积也膨胀到 2 GB 以上。改为**容器内安装**后，所有依赖都
在目标文件系统中生成，无跨边界链接问题。

### 2. 为什么入口以 root 启动、再降权（PUID/PGID）

NAS 上挂载目录（如飞牛的 `/path/to/docker/...`）的属主是**宿主用户 uid（通常 1000）**。
若容器固定用 uid 100 运行，就会因属主不匹配而 `EACCES`，而把 NAS 目录 chown 成 100
又不符合 NAS 的权限模型。

因此采用与 linuxserver.io 一致的方案：**入口以 root 启动 → 按 `PUID`/`PGID`
（默认 `1000:1000`）把数据目录属主对齐 → 立即降权到非 root `tavern` 运行**。
服务进程始终是非 root。

### 3. 为什么需要 `--expose-internals` wrapper

DSH 的插件加载器通过 `node-addon-require-builtin` 原生模块获取 Node 内部加载器
（`loader.internal`），从而按 profile 目录解析插件名。该原生模块**没有 musl 构建**，
在 Alpine 上不可用，导致启动时 `ERR_MODULE_NOT_FOUND`。
`entrypoint.sh` 把 `runtime/bin/dsh` 替换为带 `--expose-internals` 的 wrapper，
走 Node 内置解析路径，问题消失。DSH 0.2.1 仍依赖该机制。

### 4. 为什么需要反向代理

DSH 核心出于安全考虑**硬拒绝通配绑定地址**（`--host 0.0.0.0`），只接受具体接口地址；
而绑定具体地址又会让 dsh-tavern 的就绪检查（固定探测 `127.0.0.1`）失败。
因此：核心保持回环监听 `127.0.0.1:3081`，由内置反向代理在 `0.0.0.0:3080` 对外，
并**保留原始 Host 头**（核心的 `/api` 信任栅栏与登录 cookie 的 authority 都依赖 Host）。

> **外部反代（lucky）必须保留原始 Host**，否则核心会因信任栅栏或 cookie authority
> 不匹配而拒绝 WebSocket（表现为页面一直“自动重连中”）。
> 已验证可用的 lucky 配置要点：
> - 保留原始 Host（等价于 nginx 的 `proxy_set_header Host $host;`）
> - 移除 Origin 请求头（nginx 写法 `proxy_set_header Origin "";`，空值即删除）
> - 开启 Basic Auth；WebSocket 为 lucky 默认支持

### 5. 为什么需要就绪检查补丁

DSH 核心自带浏览器认证：未携带 cookie 的根路径请求在 0.1.5 返回 302 跳转
`/?token=...`、在 0.2.1 返回 401；而 Node 的 `fetch` 没有 cookie 存储，会陷入跳转循环，
导致就绪检查永远失败、启动超时。补丁改为不跟随跳转，并把 `302/303/401`
视为「服务已就绪」。两个版本均适用。

> 注意区分：核心的 **launch-token 浏览器认证** ≠ **账号密码登录**。
> 后者由外部反代 Basic Auth 提供（或可选插件 `dsh-webui-auth`）。

### 6. 为什么需要源码加速源探测

安装/升级要从 GitHub 拉源码。单一加速源（如 `gh-proxy.com`）会限流/临时封禁，
导致安装失败。`resolve-source.mjs` 会依次探测 `ghfast.top`、`ghproxy.net`、
`gh-proxy.com` 与直连 GitHub，选第一个可用的；用户也可用
`DSH_TAVERN_GIT_URL` 直接指定。

### 7. 自动升级机制

- 镜像构建时把安装器版本写入 `/opt/dsh-tavern/image-revision`
  （格式：`安装器版本-构建日期-install.sh 哈希`，例如 `3.0.0-20261019-aa4160c0`）。
- 数据卷根目录记录已完成安装的版本：`.dsh-tavern-image-revision`。
- 容器启动时两者不一致（含首次部署）→ 自动执行 `install.sh`：
  - **暂存切换（staged）**：新版先下载/安装到旁边的 `.staging` 目录，成功后才原子切换；
    失败自动回滚到旧版本，旧版本继续可用。
  - 用户数据（`profile-data/tavern/data`、会话、凭证）全程不动。
  - 升级成功后写入新的修订号；下次重启直接跳过安装。
- 覆盖开关：
  - `DSH_TAVERN_FORCE_INSTALL=1` 强制重跑安装/升级
  - `DSH_TAVERN_SKIP_INSTALL=1` 跳过安装/升级（离线启动现有版本）
- 升级失败不会写入修订号，下次重启会自动重试；容器仍以现有版本启动。

> 重新构建镜像时构建日期会变化，因此即使 `install.sh` 没变，新镜像也会触发一次
> 安装/升级（用于顺带拉取上游最新运行时）。不想升级时可用
> `DSH_TAVERN_SKIP_INSTALL=1` 临时跳过。

---

## 三、构建

在仓库根目录执行：

```bash
git clone https://github.com/gaoyili/dsh-tavern.git
cd dsh-tavern

docker build --provenance=false --sbom=false \
  -f docker/Dockerfile \
  -t dsh-tavern:3.0.0 .
```

构建仅需约 1 分钟（安装器依赖使用阿里云 apk 源与 npmmirror）。
构建日志末尾会打印镜像修订号（如 `3.0.0-20261020-aa4160c0`）。

> 说明：`--provenance=false --sbom=false` 生成传统单 manifest 镜像，
> 兼容性最好（部分老版本 docker / NAS 不认 buildx 的 attestation manifest）。
> 镜像修订号默认是 `安装器版本-构建日期-install.sh 哈希`；也可用
> `--build-arg IMAGE_REVISION=自定义值` 强制刷新。

推送（见第五节）：

```bash
./docker/push.sh 3.0.0
```

离线导出（可选）：

```bash
docker save dsh-tavern:3.0.0 | gzip > dsh-tavern-3.0.0.tar.gz
```

---

## 四、本地首次运行

```bash
mkdir -p /data/dsh-tavern

docker run -d --name dsh-tavern \
  -p 3080:3080 \
  -v /data/dsh-tavern:/home/tavern/.dsh-tavern \
  dsh-tavern:3.0.0
```

首次启动会安装 DSH Tavern（含独立 DSH 运行时），约 **2~10 分钟**（取决于网络）。
查看进度：

```bash
docker logs -f dsh-tavern
```

日志出现 `容器已就绪` 后访问 <http://127.0.0.1:3080/>。

---

## 五、推送到阿里云 ACR

镜像已按「精简基础镜像 + 运行时安装」设计，只有 296 MB，推到 ACR 后
NAS 上 `docker pull` 即可，不再需要 `docker save` / `scp` / `docker load`。

### 1. 登录

先在 ACR 控制台创建命名空间和镜像仓库。如果还没有本地配置：

```bash
cp docker/.env.example docker/.env
# 编辑 docker/.env，至少填写：
# DSH_TAVERN_IMAGE=<仓库域名>/<命名空间>/<仓库名>:<标签>
```

然后登录（只需一次，Docker 会记住凭据）：

```bash
ACR=<你的 ACR 实例域名>     # 例如 crpi-xxxx.<region>.personal.cr.aliyuncs.com
docker login --username=<阿里云账号> "$ACR"
```

> 密码是 ACR 控制台「访问凭证」里设置的 **Registry 登录密码**，
> 不是阿里云账号登录密码。

### 2. 推送

`docker/push.sh` 会自动读取 `docker/.env` 里的 `DSH_TAVERN_IMAGE`，
解析出仓库域名、命名空间、仓库名和标签。正常推送只需：

```bash
cd dsh-tavern
./docker/push.sh
```

推送 `.env` 中配置的标签（同时更新 `latest`）。如果本地已经有验证过的同标签镜像，
可以跳过构建：

```bash
SKIP_BUILD=1 ./docker/push.sh
```

临时推送其它标签（不会修改 `.env`）：

```bash
./docker/push.sh 3.0.1
```

没有 `.env`，或想临时覆盖仓库地址时，也可以显式传入：

```bash
REGISTRY=<仓库域名> \
NAMESPACE=<命名空间> \
REMOTE_IMAGE=<仓库名> \
./docker/push.sh 3.0.0
```

> 推荐直接维护 `docker/.env`：compose 也用这份配置，改标签只需改一处。
> 只想确认解析结果、不执行 Docker：

```bash
DRY_RUN=1 ./docker/push.sh
```

### 3. NAS 拉取

在 NAS 的 compose 目录（与 `.env` 同级）：

```bash
# 私有仓库先登录（只需一次）
docker login --username=<阿里云账号> <ACR>

docker compose pull
docker compose up -d
```

也可以直接拉取 `.env` 中配置的镜像：

```bash
IMAGE="$(grep -E '^DSH_TAVERN_IMAGE=' .env | tail -n1 | cut -d= -f2-)"
docker pull "$IMAGE"
```

> 如果 ACR 仓库设为**公开**，NAS 上无需登录即可拉取
> （但仍建议保留 lucky 的 Basic Auth，不要直接把 3080 暴露到公网）。
>
> 也支持其它 OCI 仓库（如 GHCR）：把 `DSH_TAVERN_IMAGE` 换成对应地址即可。

---

## 六、部署到 FnOS NAS

### 1. 数据卷与权限（已自动处理）

镜像会**自动把数据目录属主对齐到 `PUID:PGID`（默认 `1000:1000`）**，
因此飞牛 `/path/to/docker/...` 这类属主为 1000 的目录**无需手动 chown**。

如果目录属主不是 1000，用 `PUID`/`PGID` 指定即可：

```bash
# 先看属主
ls -ln /path/to/dsh-tavern
# 再按需指定（示例：属主是 1002:1002）
docker run -d ... -e PUID=1002 -e PGID=1002 ...
```

### 2. 桥接模式 + 外部反代（lucky）

`docker/docker-compose.yml` 是部署示例。在 NAS 上新建目录
`/path/to/dsh-tavern-compose`，把文件保存为其中的 `docker-compose.yml`
（**不要放进数据卷目录**），按实际情况修改：

```yaml
services:
  dsh-tavern:
    image: ${DSH_TAVERN_IMAGE:-your-registry.example.com/your-namespace/dsh-tavern:3.0.0}
    container_name: dsh-tavern
    restart: unless-stopped
    ports:
      - "${DSH_TAVERN_HTTP_PORT:-3080}:3080"
    environment:
      PUID: "1000"
      PGID: "1000"
      DSH_TAVERN_TRUSTED_HOSTS: ${DSH_TAVERN_TRUSTED_HOSTS:-tavern.example.com}
    volumes:
      - ${DSH_TAVERN_DATA:-/path/to/dsh-tavern}:/home/tavern/.dsh-tavern
```

也可以直接复制仓库里的示例配置到同目录：

```bash
cp docker/.env.example .env
# 再按实际情况修改 .env
```

`.env` 已被 `.gitignore` 忽略，不会提交；`docker/push.sh` 也会读取其中的
`DSH_TAVERN_IMAGE`。

启动：

```bash
cd /path/to/dsh-tavern-compose
docker compose up -d
docker logs -f dsh-tavern
```

也可以直接用 `docker run`：

```bash
docker run -d --name dsh-tavern --restart unless-stopped \
  -p 3080:3080 \
  -e PUID=1000 -e PGID=1000 \
  -e DSH_TAVERN_TRUSTED_HOSTS=tavern.example.com \
  -v /path/to/dsh-tavern:/home/tavern/.dsh-tavern \
  your-registry.example.com/your-namespace/dsh-tavern:3.0.0
```

> 卷路径、端口、环境变量按实际部署调整，只把镜像名换成新版本。

### 3. 信任主机与外部反代

桥接模式下容器探测到的是容器内网 IP，**必须**用 `DSH_TAVERN_TRUSTED_HOSTS`
显式列出你实际访问用的域名 / IP（多个用逗号分隔），否则核心会以 `403` 拒绝 `/api`
与 WebSocket。例如：

```bash
-e DSH_TAVERN_TRUSTED_HOSTS=tavern.example.com
```

lucky 侧保持你已验证的规则：

| 规则 | 作用 |
|------|------|
| 保留原始 Host | 让核心信任栅栏与登录 cookie 的 authority 与实际访问域名一致 |
| 移除 Origin | 绕过插件 Origin 白名单与核心的同源校验 |
| 开启 Basic Auth | 对外认证 |
| WebSocket 支持 | lucky 默认开启 |

### 4. 访问

浏览器打开 `https://tavern.example.com/`，通过 lucky 的 Basic Auth 后即可游玩。

---

## 七、升级（旧数据卷 → 新镜像）

### 1. 升级前备份（建议）

```bash
# 在 NAS 上，容器停止后备份数据卷（保留权限与符号链接）
docker stop dsh-tavern
tar -C /path/to/docker -czf /path/to/dsh-tavern-backup-$(date +%Y%m%d).tar.gz dsh-tavern
```

至少要保留：`profile-data/tavern/data/`（卡片/存档/素材）、`profiles/tavern/`、
`settings.yaml*`、`.credentials.yaml`。

### 2. 删除旧容器（**不要删除数据卷/目录**）

```bash
docker rm -f dsh-tavern
# 旧镜像可保留用于回滚：
# docker tag <旧镜像ID> dsh-tavern:2.7.0
```

### 3. 用新镜像启动（同一数据卷）

```bash
# 方式 A：从镜像仓库拉取（推荐）
docker pull your-registry.example.com/your-namespace/dsh-tavern:3.0.0

# 方式 B：离线 tar 包
# gunzip -c dsh-tavern-3.0.0.tar.gz | docker load

docker run -d --name dsh-tavern --restart unless-stopped \
  -p 3080:3080 \
  -e PUID=1000 -e PGID=1000 \
  -e DSH_TAVERN_TRUSTED_HOSTS=tavern.example.com \
  -v /path/to/dsh-tavern:/home/tavern/.dsh-tavern \
  your-registry.example.com/your-namespace/dsh-tavern:3.0.0
```

首次启动日志会显示：

```
==> 检测到镜像更新（数据卷 无记录 -> 镜像 3.0.0-20261020-aa4160c0），执行升级……
==> 正在安装/升级 DSH Tavern（需保持联网，通常 3~15 分钟）……
...
==> 安装/升级完成（修订 3.0.0-20261020-aa4160c0）。
==> 应用 musl 兼容 wrapper（--expose-internals）。
==> 容器已就绪。
```

### 4. 升级会自动完成的事情

| 项目 | 行为 |
|------|------|
| Tavern 程序 | `apps/dsh-tavern` 从 2.7.0 暂存切换到 3.0.0（旧目录只用于回滚，成功后删除） |
| DSH 运行时 | `runtime/` 从 0.1.5-rc.2 整体替换为 0.2.1-rc.2（版本校验不通过才重装） |
| Profile 配置 | `profiles/tavern/package.json` 按 3.0.0 重新生成，旧文件备份为 `package.json.backup.<时间戳>` |
| 依赖 | 侧边栏等插件升级（如 `dsh-better-sidebar` 0.19.1 → 0.28.0） |
| `settings.yaml` | DSH 0.2.1 移除 home 级配置：旧文件重命名为 `settings.yaml.imported`，各段自动导入 profile 配置（**不是数据丢失**） |
| 会话存档 | DSH 0.2.1 内置存档升级（v3→v4）；tavern 侧启动时也会做前缀迁移并保留备份 |
| 用户数据 | `profile-data/tavern/data/`（卡片/聊天/素材）、`sessions/`、`.credentials.yaml` **原样保留** |

> 已在本地用「2.7.0 + DSH 0.1.5-rc.2 数据卷 → 3.0.0 + DSH 0.2.1-rc.2」做过端到端验证：
> 升级后用户数据校验和不变，WebSocket 握手在带 cookie 时返回 `101 Switching Protocols`。

### 5. 回滚

- 升级**进行中**失败：安装器自动回滚到旧程序目录，容器以旧版本继续启动。
- 升级**完成后**想回退：恢复升级前的数据卷备份，并用旧镜像启动。
  （新版 DSH 会把会话/设置迁移到新格式，旧版本不保证能读回，因此以整卷备份为准。）

---

## 八、环境变量参考

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PUID` / `PGID` | `1000` / `1000` | 数据目录属主（与宿主目录属主一致即可，NAS 上通常 1000） |
| `DSH_TAVERN_PUBLIC_PORT` | `3080` | 反向代理对外端口 |
| `DSH_TAVERN_PORT` | `3081` | 核心回环端口（一般无需改） |
| `DSH_TAVERN_TRUSTED_HOSTS` | 自动探测的本机 IPv4 | 额外信任的访问权威（IP/域名，逗号分隔） |
| `DSH_TAVERN_DISABLE_PROXY` | `0` | 设为 `1` 关闭反向代理 |
| `DSH_TAVERN_FORCE_INSTALL` | `0` | 设为 `1` 强制重跑安装/升级 |
| `DSH_TAVERN_SKIP_INSTALL` | `0` | 设为 `1` 跳过安装/升级（离线启动现有版本） |
| `DSH_TAVERN_NPM_REGISTRY` | `https://registry.npmmirror.com` | npm 镜像源 |
| `DSH_TAVERN_GIT_URL` | 自动探测 | 源码 Git 地址（不设则自动选加速源） |
| `DSH_TAVERN_ARCHIVE_URL` | 自动探测 | 备用源码压缩包 |
| `DSH_TAVERN_REPOSITORY` | `flizzywine/dsh-tavern` | 仓库名（配合自动探测） |
| `DSH_TAVERN_WEBUI_LOGIN` | `0` | 设为 `1` 可保留/使用 `dsh-webui-auth` 插件 |

> 若 NAS 可直连 GitHub，可设 `DSH_TAVERN_GIT_URL=https://github.com/flizzywine/dsh-tavern.git`
> 与对应的 `DSH_TAVERN_ARCHIVE_URL` 跳过探测。

---

## 九、数据持久化

`/home/tavern/.dsh-tavern` 卷内包含：

| 路径 | 内容 |
|------|------|
| `apps/dsh-tavern/` | Tavern 程序与依赖 |
| `runtime/` | 独立 DSH 运行时（当前 0.2.1-rc.2） |
| `profiles/tavern/` | Tavern Profile 与插件 |
| `profile-data/tavern/data/` | 人物卡、聊天、素材等用户数据 |
| `profile-data/tavern/sessions/` | DSH 会话存档 |
| `.pnpm-store/` | pnpm 缓存（加速后续更新） |
| `source-cache/` | 源码增量缓存 |
| `.dsh-tavern-image-revision` | 已完成的镜像修订号（自动升级判断用） |
| `settings.yaml.imported` | 旧版 home 配置（0.2.1 升级后保留，可删） |

**升级镜像不会丢失数据**；同一镜像重启会跳过安装、直接启动。
需要强制重装时：`docker run ... -e DSH_TAVERN_FORCE_INSTALL=1`。

---

## 十、常见问题

**Q：首次启动卡在下载 / `Access to this resource is forbidden`？**
A：加速源被限流。入口脚本会自动换源；若都不可用，可手动指定
`-e DSH_TAVERN_GIT_URL=...`（见第八节）。同时确认容器能访问 npm（`registry.npmmirror.com`）。

**Q：重启后没有自动升级？**
A：确认新镜像的 `/opt/dsh-tavern/image-revision` 与卷内
`.dsh-tavern-image-revision` 不同；必要时加 `-e DSH_TAVERN_FORCE_INSTALL=1`。
日志会明确打印“检测到镜像更新”或“已安装且镜像修订一致”。

**Q：升级失败了怎么办？**
A：安装器采用暂存切换，失败会自动回滚，容器仍以旧版本启动；日志会给出失败原因
（常见：网络不通、磁盘空间不足）。修复后重启容器会自动重试。

**Q：升级后 `settings.yaml` 不见了？**
A：DSH 0.2.1 起移除了 home 级 `settings.yaml`：旧文件被重命名为
`settings.yaml.imported`，其中的配置段会自动导入 profile。属正常迁移，不是数据丢失。

**Q：启动时报 `EACCES: permission denied ... .tavern-install.lock`？**
A：数据目录属主与 `PUID:PGID` 不一致。用 `ls -ln <宿主目录>` 看属主，再用
`-e PUID=<uid> -e PGID=<gid>` 指定即可（飞牛通常是 `1000:1000`，默认已覆盖）。

**Q：局域网/外网访问 403，或页面一直“自动重连中”？**
A：
1. 访问用的域名 / IP 不在信任白名单内 → 设置 `DSH_TAVERN_TRUSTED_HOSTS`；
2. 外部反代改写了 Host 或保留了跨域 Origin → 反代需**保留原始 Host、移除 Origin**。

**Q：页面能打开，但没有人物卡/聊天，并提示“无法创建默认工作区”？**
A：这是 `/api` 被信任栅栏拒绝（HTTP 403）的典型表现：页面静态资源能加载，但所有
RPC 与 WebSocket 都失败，客户端因此读不到数据、也无法创建工作区。排查：
1. 在容器内自测（域名/端口换成你实际访问的）：
   `docker exec dsh-tavern curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: tavern.example.com:58001' http://127.0.0.1:3080/api/`
   返回 `401` 正常（未登录）；返回 `403` 即栅栏拒绝。
2. 确认 `DSH_TAVERN_TRUSTED_HOSTS` 含实际访问域名（端口可省略，port-less 条目匹配任意端口），
   且反代保留原始 Host、移除 Origin。
3. 启动日志不应出现 `[patch] 未找到锚点`；首次安装显示 `已应用 3 处补丁`，
   已装过补丁的卷显示 `已应用 1 处补丁` 或 `补丁已是最新`。

**Q：为什么必须用反向代理，不能直接映射 3081？**
A：核心只监听回环，且拒绝通配绑定；反向代理负责对外并保留 Host。对外请始终用 3080。

**Q：更新 Tavern 后功能异常？**
A：应用更新会覆盖启动器补丁与 `dsh` wrapper。**重启容器**即可由入口脚本自动重新应用
（本镜像每次启动都会重新应用补丁与 wrapper）。

**Q：日志在哪里？**
A：`docker logs dsh-tavern` 为入口脚本与安装日志；核心日志在
`/home/tavern/.dsh-tavern/logs/tavern.log`。

**Q：`docker exec` 进去是 root，服务却是非 root？**
A：`docker exec` 默认用镜像的 `USER`（root），不影响服务；服务进程由入口降权后
以 `tavern`（`PUID`）运行，可用 `docker top dsh-tavern` 确认。

**Q：推送到 ACR 失败 / `unauthorized`？**
A：
1. `docker login --username=<阿里云账号> <ACR>`
   的密码是 ACR 的 **Registry 登录密码**（控制台「访问凭证」设置），不是阿里云登录密码；
2. 确认 ACR 上已创建对应的命名空间与仓库；
3. 确认本地标签存在（`docker images dsh-tavern`），私有仓库必须先登录。

**Q：NAS 拉取时提示 `manifest unknown` 或 `denied`？**
A：先确认推送成功（`docker push` 输出 digest）；私有仓库在 NAS 上也要先 `docker login`；
镜像名必须是 `your-registry.example.com/your-namespace/dsh-tavern:3.0.0`
（三段：域名/命名空间/仓库）。
