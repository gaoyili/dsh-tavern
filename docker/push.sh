#!/usr/bin/env bash
# 构建并推送 DSH Tavern 镜像到容器仓库（阿里云 ACR / GHCR 等 OCI 仓库）
#
# 正常用法（配置来自 docker/.env，与 compose 共用）：
#   ./docker/push.sh                 # 构建并推送 .env 中配置的标签
#   SKIP_BUILD=1 ./docker/push.sh    # 跳过构建，推送本地已有镜像
#   ./docker/push.sh 3.0.1           # 临时指定其它标签
#
# docker/.env 至少需要一行：
#   DSH_TAVERN_IMAGE=<仓库域名>/<命名空间>/<仓库名>:<标签>
# 例如：
#   DSH_TAVERN_IMAGE=registry.example.com/my-ns/dsh-tavern:3.0.0
#
# 没有 .env 时也可以显式指定：
#   REGISTRY=<仓库域名> NAMESPACE=<命名空间> REMOTE_IMAGE=<仓库名> \
#     ./docker/push.sh 3.0.0
#
# 其它可选环境变量：
#   IMAGE=dsh-tavern        本地镜像名（默认 dsh-tavern）
#   PUSH_LATEST=0           不额外推送 latest 标签（默认推送）
#   IMAGE_REVISION=...      传给 docker build 的修订号
#   ENV_FILE=...            指定配置文件（默认 docker/.env）
#   DRY_RUN=1               只打印解析结果，不执行 Docker
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT}/docker/.env}"

IMAGE="${IMAGE:-dsh-tavern}"
PUSH_LATEST="${PUSH_LATEST:-1}"
SKIP_BUILD="${SKIP_BUILD:-0}"
TAG="${TAG:-}"

# 从 docker/.env 读取 DSH_TAVERN_IMAGE（只解析这一行，不 source 整个文件）
ENV_IMAGE=""
if [ -f "${ENV_FILE}" ]; then
  ENV_IMAGE="$(
    sed -nE 's/^[[:space:]]*(export[[:space:]]+)?DSH_TAVERN_IMAGE[[:space:]]*=[[:space:]]*//p' "${ENV_FILE}" \
      | tail -n 1 \
      | tr -d '\r' \
      | sed -E 's/[[:space:]]+$//'
  )"
  ENV_IMAGE="${ENV_IMAGE%\"}"; ENV_IMAGE="${ENV_IMAGE#\"}"
  ENV_IMAGE="${ENV_IMAGE%\'}"; ENV_IMAGE="${ENV_IMAGE#\'}"
fi

ENV_TAG=""
ENV_REGISTRY=""
ENV_NAMESPACE=""
ENV_REMOTE_IMAGE=""

if [ -n "${ENV_IMAGE}" ]; then
  ref="${ENV_IMAGE%%@*}"          # 去掉 digest
  last="${ref##*/}"               # registry 可能带端口，只有最后一段的冒号是标签
  if [ "${last#*:}" != "${last}" ]; then
    ENV_TAG="${last##*:}"
    ref="${ref%:*}"
  fi

  IFS='/' read -r -a parts <<< "${ref}"
  count="${#parts[@]}"

  if [ "${count}" -lt 3 ]; then
    echo "错误：无法从 DSH_TAVERN_IMAGE=${ENV_IMAGE} 解析仓库地址。" >&2
    echo "  格式应为：仓库域名/命名空间/仓库名:标签" >&2
    exit 1
  fi

  ENV_REGISTRY="${parts[0]}"
  ENV_REMOTE_IMAGE="${parts[count - 1]}"
  ENV_NAMESPACE="$(IFS=/; printf '%s' "${parts[*]:1:$((count - 2))}")"
fi

TAG="${1:-${TAG:-${ENV_TAG}}}"
REGISTRY="${REGISTRY:-${ENV_REGISTRY}}"
NAMESPACE="${NAMESPACE:-${ENV_NAMESPACE}}"
REMOTE_IMAGE="${REMOTE_IMAGE:-${ENV_REMOTE_IMAGE:-dsh-tavern}}"

if [ -z "${TAG}" ]; then
  echo "错误：没有指定标签。" >&2
  echo "  请在 ${ENV_FILE} 的 DSH_TAVERN_IMAGE 中带标签，或执行：$0 <tag>" >&2
  exit 1
fi

if [ -z "${REGISTRY}" ] || [ -z "${NAMESPACE}" ] || [ -z "${REMOTE_IMAGE}" ]; then
  echo "错误：缺少仓库配置。" >&2
  echo "  请在 ${ENV_FILE} 中设置 DSH_TAVERN_IMAGE，或显式传入：" >&2
  echo "  REGISTRY=<仓库域名> NAMESPACE=<命名空间> REMOTE_IMAGE=<仓库名> $0 ${TAG}" >&2
  exit 1
fi

REMOTE="${REGISTRY}/${NAMESPACE}/${REMOTE_IMAGE}"

if [ "${DRY_RUN:-0}" = "1" ]; then
  if [ -f "${ENV_FILE}" ]; then
    echo "配置文件: ${ENV_FILE}"
  else
    echo "配置文件: 未找到，使用环境变量"
  fi
  echo "本地镜像: ${IMAGE}:${TAG}"
  echo "远端镜像: ${REMOTE}:${TAG}"
  echo "跳过构建: ${SKIP_BUILD}"
  exit 0
fi

# 构建上下文是仓库根目录（Dockerfile 需要根目录的 install.sh）
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

if [ "${PUSH_LATEST}" = "1" ] && [ "${TAG}" != "latest" ]; then
  echo "==> 打标签并推送 ${REMOTE}:latest"
  docker tag "${IMAGE}:${TAG}" "${REMOTE}:latest"
  docker push "${REMOTE}:latest"
fi

echo
echo "完成。NAS 上拉取："
echo "  docker pull ${REMOTE}:${TAG}"
echo "  # 或把 docker/.env 的 DSH_TAVERN_IMAGE 改成该地址，然后："
echo "  # docker compose pull && docker compose up -d"
