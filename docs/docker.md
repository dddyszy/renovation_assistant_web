# Docker 部署

版本：0.9.5。应用镜像默认名称为 `zhu-jia-web:0.9.5`。使用 Docker Engine 或 Docker Desktop，Docker Compose **2.24.4 及以上**；配置中使用 `!reset`、`!override` 合并存储模式。

## 选择存储方式

| 模式 | 数据存在哪里 | 配置文件 | 适用情况 |
| --- | --- | --- | --- |
| 内置数据库 | 应用使用 PGlite，目录持久化到 Docker 卷 | `compose.yaml` | 个人或单个家庭，最少组件 |
| 外部 PostgreSQL | 独立服务器、云数据库或已有 PostgreSQL | 再加 `compose.external.yaml` | 数据库已有专人维护，应用与存储分离 |
| Compose 自带 PostgreSQL | 单独数据库容器及独立数据卷 | 再加 `compose.postgres.yaml` | 想使用完整 PostgreSQL，但不单独安装数据库 |

这三种模式共用同一套业务表和权限规则。内置模式只运行一个应用实例；外部 PostgreSQL 可以让应用容器独立重建。当前限流在应用进程内，尚不建议直接扩成多个应用副本。

内置默认使用命名卷 `zhu-jia-web_app_data`，数据不在容器可写层。替换镜像、重建容器或执行 `docker compose down` 后数据仍保留；`down -v` 会删除数据卷，不用于正常升级。

当前没有文件附件功能，这里的存储切换指账号、家庭、账本等数据库记录；S3/OSS 文件存储在后续版本规划中。

## 准备配置

```bash
cp .env.docker.example .env.docker
```

修改 `.env.docker`：

```dotenv
APP_IMAGE_TAG=0.9.5
APP_ORIGIN=https://home.example.com
DOMAIN=home.example.com
APP_PORT=8080
```

`APP_ORIGIN` 是浏览器真实访问的 HTTPS 来源，不带结尾 `/`，`DOMAIN` 只写域名。SMTP 可不填写，注册没有邮箱验证码；邮件找回密码需要 SMTP。

## 内置模式

已有 HTTPS 反向代理时：

```bash
docker compose --env-file .env.docker -f compose.yaml config --quiet
docker compose --env-file .env.docker -f compose.yaml up -d --build --wait
```

将现有代理转发到 `127.0.0.1:8080`。应用绑定的宿主机端口默认只监听本机。`http://127.0.0.1:8080/api/v1/health` 可用于服务检查，浏览器登录应从配置的 HTTPS 域名访问，生产会话 Cookie 使用 Secure。

没有代理时，可以叠加随附的 Caddy：

```bash
docker compose --env-file .env.docker -f compose.yaml -f compose.https.yaml up -d --build --wait
```

域名 A/AAAA 记录需指向服务器，80/443 端口可达，Caddy 会申请并续期证书。已有服务占用这些端口时使用已有代理方案。证书状态依赖真实 DNS 和网络，配置语法检查不能验证证书签发。

## 外置数据库模式

在外部 PostgreSQL 中创建专用数据库和账号，账号需要在该数据库中创建表、索引并读写数据。填写：

```dotenv
POSTGRES_HOST=your-db.example.internal
POSTGRES_PORT=5432
POSTGRES_DB=zhu_jia
POSTGRES_USER=zhu_jia
POSTGRES_PASSWORD=填写真实数据库密码
POSTGRES_SSLMODE=verify-full
```

使用可信证书的服务器选 `verify-full`；明确不提供 TLS 的受控内网数据库才使用 `disable`。云数据库需允许应用服务器的来源地址。密码通过 `PGPASSWORD` 单独传递，包含 `@`、`/`、`%` 等字符时无需拼接和转义连接 URL。

```bash
docker compose --env-file .env.docker -f compose.yaml -f compose.external.yaml config --quiet
docker compose --env-file .env.docker -f compose.yaml -f compose.external.yaml up -d --build --wait
```

需要 Caddy 时在上述命令中继续加 `-f compose.https.yaml`。外置配置移除应用数据卷，数据库记录由外部服务持久化。`POSTGRES_HOST=127.0.0.1` 会指向容器自身；访问宿主机数据库应使用 `host.docker.internal`，并让宿主机 PostgreSQL 接受来自容器网络的连接。

## Compose 自带 PostgreSQL

无需填写 `POSTGRES_HOST`，数据库服务名固定为 `db`。设置专用密码，例如用 `openssl rand -hex 32` 生成后填入 `.env.docker`。

```bash
docker compose --env-file .env.docker -f compose.yaml -f compose.postgres.yaml up -d --build --wait
```

应用等待数据库健康后启动，数据库不向宿主机公开 5432 端口，数据卷为 `zhu-jia-web_postgres_data`。该配置在容器私有网络中关闭数据库 TLS；浏览器到应用仍使用 HTTPS。

首次初始化后修改 `POSTGRES_PASSWORD` 环境变量不会自动更改已有数据库账号的密码。应先在 PostgreSQL 中修改密码，再更新应用配置，不能通过删除数据卷解决密码不匹配。

## 将内置存储挂到宿主机磁盘

内置数据库也可以使用宿主机目录，而不是命名卷：

```dotenv
DATA_DIR=/srv/zhu-jia/data
```

```bash
mkdir -p /srv/zhu-jia/data
# Linux 上目录需要允许容器内 UID/GID 1000 写入；仅针对新建的专用目录设置。
sudo chown 1000:1000 /srv/zhu-jia/data
docker compose --env-file .env.docker -f compose.yaml -f compose.bind.yaml up -d --build --wait
```

切换已有命名卷到目录挂载前，先停应用并备份、复制完整数据目录；挂载一个空目录会呈现全新数据库。目录挂载与外部 PostgreSQL 是两回事，不叠加 `compose.bind.yaml` 和两个 PostgreSQL 配置。

## 单独构建镜像

```bash
docker build --build-arg APP_VERSION=0.9.5 -t zhu-jia-web:0.9.5 .
```

多阶段构建先做类型检查、前端构建和自动测试，再生成运行镜像。运行层使用 Node.js 24、生产依赖和非 root 用户，应用以前台 Node 进程运行，接收终止信号后关闭 API 和数据库。

本地的 `.env*`、数据库、截图、node_modules 不进入构建上下文。镜像中不包含演示账号数据。ARM64/AMD64 需分别构建对应平台镜像，不能复制宿主机 node_modules 进去。

## 健康检查和验收

```bash
docker compose --env-file .env.docker -f compose.yaml ps
curl --fail http://127.0.0.1:8080/api/v1/health
```

健康接口同时查询数据库并返回版本，期望 `data.status=ok`、`data.version=0.9.5`。启动失败时用相同配置组合查看 `logs --tail 100 app`，外置模式优先检查数据库地址、账号、TLS 和网络。

CI 配置在 `.github/workflows/ci.yml`，包含内置与 PostgreSQL 容器的构建和 HTTP 验收。本机如果没有 Docker 引擎，只能完成配置检查和非容器测试；容器是否真正启动必须以 Docker 运行结果为准。
