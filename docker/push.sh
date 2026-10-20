#!/usr/bin/env bash
# 构建并推送 DSH Tavern 镜像到容器仓库（阿里云 ACR / GHCR 等 OCI 仓库）
#
# 用法（在仓库任意位置执行均可）：
#   REGISTRY=<仓库域名> NAMESPACE=<命名空间> ./docker/push.sh 3.0.0
#   REGISTRY=ghcr.io NAMESPACE=myuser ./docker/push.sh 3.0.0
#
# 阿里云 ACR 示例（域名与命名空间以控制台为准）：
#   REGISTRY=crpi-xxxx.<region>.personal.cr.aliyuncs.com \
#   NAMESPACE=my-ns \
#   REMOTE_IMAGE=my-repo \
#   ./docker/push.sh 3.0.0
#
# 使用前先登录：
#   docker login --username=<阿里云账号> <仓库域名>
#
# 可选环境变量：
#   IMAGE=dsh-tavern        本地镜像名（默认 dsh-tavern）
#   REMOTE_IMAGE=dsh-tavern 远端仓库名（默认 dsh-tavern，可按仓库实际名称覆盖）
#   SKIP_BUILD=1            跳过 docker build，直接推送本地已有镜像
#   PUSH_LATEST=0           不额外推送 latest 标签（默认推送）
#   IMAGE_REVISION=...      传给 docker build 的修订号（默认 安装器版本-构建日期-哈希）
set -euo pipefail

TAG="${1:-}"
if [ -z "${TAG}" ]; then
  echo "用法: $0 <tag>   （例如 $0 3.0.0）" >&2
  exit 1
fi

REGISTRY="${REGISTRY:-}"
NAMESPACE="${NAMESPACE:-}"
IMAGE="${IMAGE:-dsh-tavern}"
REMOTE_IMAGE="${REMOTE_IMAGE:-dsh-tavern}"
PUSH_LATEST="${PUSH_LATEST:-1}"
SKIP_BUILD="${SKIP_BUILD:-0}"

if [ -z "${REGISTRY}" ] || [ -z "${NAMESPACE}" ]; then
  echo "错误：请设置 REGISTRY 与 NAMESPACE（仓库域名 / 命名空间）。" >&2
  echo "  例：REGISTRY=<仓库域名> NAMESPACE=my-ns $0 ${TAG}" >&2
  exit 1
fi

# 远端完整地址（Docker Hub / ACR / GHCR 等都按“域名/命名空间/仓库”拼接）
REMOTE="${REGISTRY}/${NAMESPACE}/${REMOTE_IMAGE}"

# 构建上下文是仓库根目录（Dockerfile 需要根目录的 install.sh）
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

if [ "${SKIP_BUILD}" != "1" ]; then
  echo "==> 构建 ${IMAGE}:${TAG}"
  BUILD_ARGS=(--provenance=false --sbom=false -f docker/Dockerfile -t "${IMAGE}:${TAG}")
  if [ -n "${IMAGE_REVISION:-}" ]; then
    BUILD_ARGS+=(--build-arg "IMAGE_REVISION=${IMAGE_REVISION}")
  fi
  docker build "${BUILD_ARGS[@]}" .
elif ! docker image inspect "${IMAGE}:${TAG}" >/dev/null 2>&1; then
  echo "错误：SKIP_BUILD=1，但本地不存在镜像 ${IMAGE}:${TAG}。" >&2
  exit 1
fi

echo "==> 打标签 ${REMOTE}:${TAG}"
docker tag "${IMAGE}:${TAG}" "${REMOTE}:${TAG}"

echo "==> 推送 ${REMOTE}:${TAG}"
docker push "${REMOTE}:${TAG}"

if [ "${PUSH_LATEST}" = "1" ]; then
  echo "==> 打标签并推送 ${REMOTE}:latest"
  docker tag "${IMAGE}:${TAG}" "${REMOTE}:latest"
  docker push "${REMOTE}:latest"
fi

echo
echo "完成。NAS 上拉取："
echo "  docker pull ${REMOTE}:${TAG}"
echo "  # 或直接改 docker run / compose 里的 image 为 ${REMOTE}:${TAG}"
