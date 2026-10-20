#!/bin/sh
# DSH Tavern 容器入口脚本
#   0. 以 root 启动时：按 PUID/PGID 修正数据目录属主，再降权到 tavern 运行
#   1. 首次安装 / 镜像更新后自动升级到数据卷（暂存切换，失败自动回滚）
#   2. 应用 musl 兼容修复（--expose-internals）
#   3. 应用信任主机补丁（LAN 访问白名单）
#   4. 移除 dsh-webui-auth 插件（认证由外部反代如 lucky 负责）
#   5. 启动核心服务（回环）与反向代理（对外）
#
# 版本升级机制：
#   镜像内 /opt/dsh-tavern/image-revision 记录本镜像内置安装器的版本；
#   数据卷内 .dsh-tavern-image-revision 记录已完成安装/升级的版本。
#   两者不一致（含首次部署）时自动执行安装器（install.sh 自带暂存切换升级，
#   升级中用户数据不动、失败回滚旧版本）。可用环境变量覆盖：
#     DSH_TAVERN_FORCE_INSTALL=1  强制重跑安装/升级
#     DSH_TAVERN_SKIP_INSTALL=1   跳过安装/升级（离线启动旧版本时使用）
set -eu

DSH_ROOT="${DSH_TAVERN_CLI_HOME:-/home/tavern/.dsh-tavern}"
APP="${DSH_ROOT}/apps/dsh-tavern"
RUNTIME_BIN="${DSH_ROOT}/runtime/bin/dsh"
DSH_ENTRY="${DSH_ROOT}/runtime/lib/node_modules/@deepseek-ai/dsh/lib/bin.js"

log() { printf '==> %s\n' "$*"; }

# ── 0. 降权：root 入口 -> 非 root 服务 ─────────────────────────────────────
# 容器以 root 启动只是为了把数据目录属主对齐宿主机（NAS 上通常是 uid 1000），
# 修正后立即降权到 tavern 运行，服务进程始终是非 root。
if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"
  CURRENT_UID="$(id -u tavern 2>/dev/null || true)"
  CURRENT_GID="$(id -g tavern 2>/dev/null || true)"
  if [ -n "${CURRENT_UID}" ] && [ "${CURRENT_UID}" != "${PUID}" ]; then
    sed -i "s|^tavern:\([^:]*\):[0-9]*:[0-9]*:|tavern:\1:${PUID}:${PGID}:|" /etc/passwd
  fi
  if [ -n "${CURRENT_GID}" ] && [ "${CURRENT_GID}" != "${PGID}" ]; then
    sed -i "s|^tavern:\([^:]*\):[0-9]*:|tavern:\1:${PGID}:|" /etc/group
  fi
  mkdir -p "${DSH_ROOT}"
  log "对齐数据目录属主为 ${PUID}:${PGID} ……"
  chown -R "${PUID}:${PGID}" "${DSH_ROOT}" 2>/dev/null || true
  chown "${PUID}:${PGID}" /home/tavern 2>/dev/null || true
  if [ -e /home/tavern/.local ]; then chown -R "${PUID}:${PGID}" /home/tavern/.local 2>/dev/null || true; fi
  exec su-exec "${PUID}:${PGID}" "$0" "$@"
fi

NODE_BIN="$(command -v node)"
export DSH_ROOT NODE_BIN

# ── 1. 安装 / 升级 ─────────────────────────────────────────────────────────
IMAGE_REVISION="$(cat /opt/dsh-tavern/image-revision 2>/dev/null || echo unknown)"
VOLUME_REVISION="$(cat "${DSH_ROOT}/.dsh-tavern-image-revision" 2>/dev/null || echo '')"

NEED_INSTALL=0
if [ ! -f "${APP}/bin/dsh-tavern.mjs" ] || [ ! -f "${DSH_ROOT}/.dsh-tavern-install-root" ]; then
  NEED_INSTALL=1
  log "未检测到已安装的 DSH Tavern，执行首次安装（镜像修订 ${IMAGE_REVISION}）……"
elif [ "${DSH_TAVERN_SKIP_INSTALL:-0}" = "1" ]; then
  log "DSH_TAVERN_SKIP_INSTALL=1，跳过安装/升级，直接启动现有版本。"
elif [ "${DSH_TAVERN_FORCE_INSTALL:-0}" = "1" ]; then
  NEED_INSTALL=1
  log "DSH_TAVERN_FORCE_INSTALL=1，重新执行安装/升级……"
elif [ "${VOLUME_REVISION}" != "${IMAGE_REVISION}" ]; then
  NEED_INSTALL=1
  log "检测到镜像更新（数据卷 ${VOLUME_REVISION:-无记录} -> 镜像 ${IMAGE_REVISION}），执行升级……"
  log "升级为暂存切换：准备期间旧版本继续可用，失败自动回滚；用户数据（卡片/存档/会话）不受影响。"
else
  log "已安装且镜像修订一致（${IMAGE_REVISION}），跳过安装步骤。"
fi

if [ "${NEED_INSTALL}" = "1" ]; then
  # 探测可用的 GitHub 加速源（单一源会限流/封禁）；用户可用 DSH_TAVERN_GIT_URL 覆盖
  if [ -z "${DSH_TAVERN_GIT_URL:-}" ] && [ -f /opt/dsh-tavern/resolve-source.mjs ]; then
    log "探测可用的 GitHub 加速源……"
    SOURCE_PREFIX="$(node /opt/dsh-tavern/resolve-source.mjs 2>/dev/null || true)"
    REPO="${DSH_TAVERN_REPOSITORY:-flizzywine/dsh-tavern}"
    DSH_TAVERN_GIT_URL="${SOURCE_PREFIX}https://github.com/${REPO}.git"
    DSH_TAVERN_ARCHIVE_URL="${SOURCE_PREFIX}https://github.com/${REPO}/archive/refs/heads/main.tar.gz"
    export DSH_TAVERN_GIT_URL DSH_TAVERN_ARCHIVE_URL
    log "源码源：${DSH_TAVERN_GIT_URL}"
  fi

  log "正在安装/升级 DSH Tavern（需保持联网，通常 3~15 分钟）……"
  # DEFER_SERVICE_START：由本脚本在应用 musl 兼容 wrapper 之后再启动服务
  if DSH_TAVERN_HOST=cli \
     DSH_TAVERN_CLI_HOME="${DSH_ROOT}" \
     DSH_TAVERN_DEFER_SERVICE_START=1 \
     sh /opt/dsh-tavern/install.sh; then
    printf '%s\n' "${IMAGE_REVISION}" > "${DSH_ROOT}/.dsh-tavern-image-revision"
    log "安装/升级完成（修订 ${IMAGE_REVISION}）。"
  else
    log "安装脚本返回非零：升级未完成，继续以数据卷中的现有版本启动（下次重启会重试）。"
    log "请检查上方日志中的失败原因（常见：网络不通、磁盘空间不足）。"
  fi
fi

# ── 2. musl 兼容：dsh 需要 --expose-internals 才能解析 profile 插件 ────────
# Alpine(musl) 缺少 node-addon-require-builtin 的原生绑定，导致加载器
# loader.internal 不可用；改用 --expose-internals 走 Node 内置解析路径。
if [ -f "${DSH_ENTRY}" ]; then
  printf '#!/bin/sh\nexec "%s" --expose-internals "%s" "$@"\n' "${NODE_BIN}" "${DSH_ENTRY}" \
    > "${DSH_ROOT}/runtime/bin/dsh.wrapper"
  chmod +x "${DSH_ROOT}/runtime/bin/dsh.wrapper"
  if [ ! -L "${RUNTIME_BIN}" ] || [ "$(readlink "${RUNTIME_BIN}")" != "dsh.wrapper" ]; then
    log "应用 musl 兼容 wrapper（--expose-internals）。"
    rm -f "${RUNTIME_BIN}"
    ln -s dsh.wrapper "${RUNTIME_BIN}"
  fi
fi

# ── 3. 信任主机补丁（LAN 访问白名单） ──────────────────────────────────────
if [ -f "${APP}/bin/service-lifecycle.mjs" ]; then
  node /opt/dsh-tavern/apply-launcher-patch.mjs "${APP}/bin/service-lifecycle.mjs" || true
fi

# 本机所有非回环 IPv4 都加入信任主机；用户可通过 DSH_TAVERN_TRUSTED_HOSTS
# 追加域名/其它地址（例如桥接网络下 NAS 的局域网 IP 或域名）。
IPS_LINES="$(node /opt/dsh-tavern/detect-ips.mjs 2>/dev/null || true)"
LOCAL_IPS="$(printf '%s\n' "${IPS_LINES}" | sed -n 's/^all=//p')"
if [ -n "${DSH_TAVERN_TRUSTED_HOSTS:-}" ] && [ -n "${LOCAL_IPS}" ]; then
  DSH_TAVERN_TRUSTED_HOSTS="${DSH_TAVERN_TRUSTED_HOSTS},${LOCAL_IPS}"
elif [ -z "${DSH_TAVERN_TRUSTED_HOSTS:-}" ]; then
  DSH_TAVERN_TRUSTED_HOSTS="${LOCAL_IPS}"
fi
export DSH_TAVERN_TRUSTED_HOSTS
log "信任主机：${DSH_TAVERN_TRUSTED_HOSTS:-（无）}"

# ── 4. dsh-webui-auth 插件（默认移除，认证由外部反代如 lucky 负责） ────────
# 如果之前安装过 dsh-webui-auth，先卸载它（避免其认证闸门拦截 WS 请求导致 403）。
if [ "${DSH_TAVERN_WEBUI_LOGIN:-0}" != "1" ] && [ -f "${RUNTIME_BIN}" ]; then
  if grep -q '"dsh-webui-auth"' "${DSH_ROOT}/profiles/tavern/package.json" 2>/dev/null; then
    log "检测到 dsh-webui-auth，正在卸载……"
    "${RUNTIME_BIN}" plugin --profile tavern remove dsh-webui-auth || true
  fi
fi

# ── 5. 启动核心服务（回环监听） ────────────────────────────────────────────
CORE_PORT="${DSH_TAVERN_PORT:-3081}"
PUBLIC_PORT="${DSH_TAVERN_PUBLIC_PORT:-3080}"
export DSH_TAVERN_PORT="${CORE_PORT}"

if [ -f "${APP}/bin/dsh-tavern.mjs" ]; then
  log "启动 DSH Tavern 核心（127.0.0.1:${CORE_PORT}）……"
  if ! DSH_HOME="${DSH_ROOT}" node "${APP}/bin/dsh-tavern.mjs" start; then
    log "核心启动失败，请查看 ${DSH_ROOT}/logs/tavern.log"
  fi
else
  log "未找到 DSH Tavern 程序，跳过启动。"
fi

# ── 6. 反向代理（对外访问） ────────────────────────────────────────────────
if [ "${DSH_TAVERN_DISABLE_PROXY:-0}" != "1" ]; then
  log "启动反向代理 0.0.0.0:${PUBLIC_PORT} -> 127.0.0.1:${CORE_PORT}"
  # 简单守护：进程退出后 2 秒重试
  (
    while true; do
      node /opt/dsh-tavern/reverse-proxy.mjs || true
      sleep 2
    done
  ) &
fi

log "容器已就绪。数据目录：${DSH_ROOT}；访问端口：${PUBLIC_PORT}"
exec "$@"
