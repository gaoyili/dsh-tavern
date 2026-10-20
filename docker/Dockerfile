# DSH Tavern 精简镜像（方案 B：启动时安装到数据卷）
#
# 构建（在仓库根目录执行，构建上下文为整个仓库）：
#   docker build --provenance=false --sbom=false -t dsh-tavern:3.0.0 -f docker/Dockerfile .
# 或直接使用 docker/push.sh 构建并推送。
#
# 设计要点：
#   * 基础镜像仅含 Node.js 运行时与安装器依赖，Tavern 本体在首次启动时
#     安装到数据卷（/home/tavern/.dsh-tavern），因此镜像保持精简。
#   * 镜像内记录安装器版本（/opt/dsh-tavern/image-revision）；数据卷记录
#     已完成安装的版本。镜像更新后（两者不一致）入口自动执行升级
#     （install.sh 暂存切换：失败回滚，用户数据不动）。
#   * 入口以 root 启动，按 PUID/PGID（默认 1000:1000）修正数据目录属主后
#     降权到非 root 用户 tavern 运行（服务进程始终是非 root）。
#   * CLI 模式；核心回环监听，内置反向代理对外，通过 DSH_TAVERN_TRUSTED_HOSTS
#     配置局域网访问白名单。
#   * 不预装 dsh-webui-auth（认证由外部反代如 lucky 的 basic auth 负责）。
FROM node:22-alpine

# 使用国内镜像源（官方 dl-cdn 源在部分网络下极慢）
# su-exec 用于降权运行（root 入口 -> 非 root 服务）
RUN sed -i 's#dl-cdn.alpinelinux.org#mirrors.aliyun.com#g' /etc/apk/repositories \
 && apk add --no-cache \
      git \
      curl \
      bash \
      tar \
      coreutils \
      procps \
      lsof \
      su-exec \
      xdg-user-dirs \
 && npm config set registry https://registry.npmmirror.com \
 && npm install -g pnpm@11.25.0 \
 && npm cache clean --force

# 非 root 用户（默认 uid/gid 与常见 NAS 一致，可用 PUID/PGID 覆盖）
# node 基础镜像自带的 node 用户占用 1000，先移除
RUN deluser node 2>/dev/null || true \
 && addgroup -g 1000 tavern \
 && adduser -u 1000 -G tavern -h /home/tavern -s /bin/bash -D tavern \
 && mkdir -p /home/tavern/.dsh-tavern \
 && chown -R tavern:tavern /home/tavern

# 安装器与入口脚本
COPY install.sh /opt/dsh-tavern/install.sh
COPY docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY docker/apply-launcher-patch.mjs /opt/dsh-tavern/apply-launcher-patch.mjs
COPY docker/import-user-data.mjs /opt/dsh-tavern/import-user-data.mjs
COPY docker/detect-ips.mjs /opt/dsh-tavern/detect-ips.mjs
COPY docker/reverse-proxy.mjs /opt/dsh-tavern/reverse-proxy.mjs
COPY docker/resolve-source.mjs /opt/dsh-tavern/resolve-source.mjs
RUN chmod +x /opt/dsh-tavern/install.sh /usr/local/bin/docker-entrypoint.sh

# 镜像修订号：安装器版本（install.sh 中的 INSTALLER_VERSION）+ 构建日期 + install.sh 哈希。
# 入口脚本用它对比数据卷上的安装记录，决定是否需要自动升级。
# 可用 --build-arg IMAGE_REVISION=xxx 覆盖（例如只改了入口脚本、想强制触发升级时）。
ARG IMAGE_REVISION=""
RUN set -e; \
    if [ -n "${IMAGE_REVISION}" ]; then \
      printf '%s\n' "${IMAGE_REVISION}" > /opt/dsh-tavern/image-revision; \
    else \
      ver="$({ grep -m1 '^INSTALLER_VERSION=' /opt/dsh-tavern/install.sh 2>/dev/null || echo "INSTALLER_VERSION='unknown'"; } \
        | sed -e "s/^INSTALLER_VERSION=//" -e "s/^['\"]//" -e "s/['\"]$//" | tr -d '\n')"; \
      hash="$(sha256sum /opt/dsh-tavern/install.sh | cut -c1-8)"; \
      printf '%s-%s-%s\n' "${ver}" "$(date -u +%Y%m%d)" "${hash}" > /opt/dsh-tavern/image-revision; \
    fi; \
    cat /opt/dsh-tavern/image-revision

ENV HOME=/home/tavern \
    PUID=1000 \
    PGID=1000 \
    DSH_TAVERN_HOST=cli \
    DSH_TAVERN_CLI_HOME=/home/tavern/.dsh-tavern \
    DSH_HOME=/home/tavern/.dsh-tavern \
    DSH_TAVERN_NPM_REGISTRY=https://registry.npmmirror.com \
    DSH_TAVERN_PORT=3081 \
    DSH_TAVERN_PUBLIC_PORT=3080 \
    DSH_TAVERN_WEBUI_LOGIN=0 \
    PATH=/home/tavern/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 源码加速源默认由入口脚本自动探测（ghfast.top / ghproxy.net / gh-proxy.com / 直连）。
# 如需固定，可用 -e DSH_TAVERN_GIT_URL=... -e DSH_TAVERN_ARCHIVE_URL=... 覆盖。

# 入口以 root 启动以便修正属主；随后降权到 tavern 运行服务
USER root
WORKDIR /home/tavern

EXPOSE 3080

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sleep", "infinity"]
