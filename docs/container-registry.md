# 发布和使用 GitHub 容器镜像

当前镜像地址：`ghcr.io/dddyszy/renovation_assistant_web:0.9.16`。版本标签只有在发布工作流成功后才可使用，以 GitHub Actions 的 Publish container image 结果为准。

GHCR 是 GitHub 的容器镜像仓库。源代码保存在 Git 仓库，服务器从 GHCR 拉取构建好的镜像，无需安装 Node.js、运行 npm 或编译源码。

## 自动发布

工作流位于 `.github/workflows/publish-image.yml`：

1. 推送 `vX.Y.Z` 标签，或在 Actions 中手动选择源分支/标签。
2. 检查 package.json 版本，固定源码 commit。
3. 使用原生 AMD64、ARM64 runner 分别构建并执行 Dockerfile 内的构建与测试。
4. 上传按 digest 标识的镜像，合并为临时候选标签 `sha-<完整 commit>`。
5. 从 GHCR 拉取候选镜像，分别运行内置数据库和独立 PostgreSQL 的 HTTP 验收。
6. 两种存储均通过后，发布 `:X.Y.Z` 版本标签。

发布使用该仓库的临时 GITHUB_TOKEN，工作流中声明 packages 写权限，不需要把个人 PAT 存到源码或 Actions secrets。镜像带有源仓库、版本和 commit 的 OCI 标签，默认保持私有。

AMD64 与 ARM64 使用同一个地址，Docker 根据服务器架构选择，不需要用户分别找镜像。暂不发布 `latest`，部署固定具体版本，避免升级时误拉未计划的版本。

首次手动发布：

```bash
gh workflow run publish-image.yml \
  --repo dddyszy/renovation_assistant_web \
  --ref main \
  -f source_ref=v0.9.16
```

后续版本将 package.json、部署默认版本和 CHANGELOG 同步后，提交代码并推送相应标签，自动触发发布；标签名必须和源码版本相同。若要重新发布旧版本，也使用该版本标签，避免把别的 commit 当成同一个版本。

## 私有镜像登录

当前仓库和镜像均为私有。部署账号需要有该 package 的读取权限，并创建只读的 Personal access token classic，包含 `read:packages`。

在服务器交互式输入令牌，令牌不写在命令参数或文件中：

```bash
read -rsp 'GHCR token: ' GHCR_TOKEN; printf '\n'
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u dddyszy --password-stdin
unset GHCR_TOKEN
docker pull ghcr.io/dddyszy/renovation_assistant_web:0.9.16
```

以上为 Bash。使用其他 GitHub 账号部署时，将 `-u` 改成该账号，且确保已被授予 package 读取权限。`docker login` 会在该服务器保存登录配置，应使用专用部署账号或凭据存储。

如果日后明确要允许匿名拉取，可由所有者在 GitHub Package Settings 中将 package 可见性改为 public；源代码仓库和镜像可见性是分别管理的，当前发布不会自动公开。

## 用 Compose 直接拉取运行

0.9.16 镜像尚未发布时请按 [Docker 部署](docker.md) 从源码构建；以下拉取命令以对应镜像发布成功为前提。

部署前需要设置哪些变量，见 [Docker 部署](docker.md)。

服务器只需复制选用的 Compose 配置和 `.env.example`，无需上传源代码和 node_modules。

```bash
cp .env.example .env
# 编辑 APP_ORIGIN；连接已有 PostgreSQL 时填写 DATABASE_URL。
```

内置数据库：

```bash
docker compose -f compose.yaml -f compose.image.yaml pull
docker compose -f compose.yaml -f compose.image.yaml up -d --no-build --wait
```

已有外部 PostgreSQL：

```bash
docker compose -f compose.yaml -f compose.image.yaml -f compose.external.yaml up -d --no-build --wait
```

服务器现有代理转发到 `127.0.0.1:8080`，内置数据目录挂载可叠加 `compose.bind.yaml`，规则见 [Docker 部署](docker.md)。`compose.image.yaml` 删除 build 配置并启用镜像拉取，服务器不会构建。

## 不用 Compose 的内置模式示例

```bash
docker run -d --name zhu-jia --init --restart unless-stopped \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  -p 127.0.0.1:8080:3001 \
  -v zhu_jia_data:/app/data \
  -e DATABASE_URL=/app/data/postgres \
  -e APP_ORIGIN=http://home.example.com \
  ghcr.io/dddyszy/renovation_assistant_web:0.9.16
```

将服务器现有站点代理到该端口，APP_ORIGIN 填浏览器实际访问的入口。数据保存在命名卷，替换容器不删除数据库。镜像已内置 `DATABASE_URL=/app/data/postgres`，上面这条内置模式命令可以省略该变量；连接外部 PostgreSQL 时直接传 `postgresql://` 连接串即可。

## 升级与定位问题

在 `.env` 中修改 APP_IMAGE_TAG，使用原存储配置执行 pull 和 `up -d --no-build --wait`。先备份数据，保留旧版本标签；查看健康接口确认运行版本。

- `unauthorized/denied`：检查登录账号、read:packages 和 package 访问权；不要把 GitHub 登录成功等同于已有镜像读取权限。
- `manifest unknown`：确认完整地址和版本，以及发布流程是否成功。
- `no matching manifest`：当前仅提供 Linux AMD64/ARM64，不支持 Windows 容器或 ARMv7。
- 登录后仍失败：如果是组织账号，确认组织 SSO 和包策略允许该凭据；个人仓库不需要组织授权流程。

构建失败或验收失败时，不提升该候选到版本标签；应先查看 Actions 中对应阶段的日志。
