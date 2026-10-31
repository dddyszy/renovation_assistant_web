# Docker 部署

版本：0.9.5。应用镜像默认名称为 `zhu-jia-web:0.9.5`。使用 Docker Engine 或 Docker Desktop，Docker Compose **2.24.4 及以上**；配置中使用 `!reset`、`!override` 合并存储模式。

需要直接使用 GHCR 预构建镜像时，再加 `-f compose.image.yaml` 并使用 `--no-build`；私有镜像登录及完整命令见 [镜像仓库说明](container-registry.md)。以下默认命令用于从源码构建，两种部署方式共用存储配置。

## 选择存储方式

| 模式                               | 数据存在哪里                            | 配置文件                       | 适用情况                           |
| ---------------------------------- | --------------------------------------- | ------------------------------ | ---------------------------------- |
| 内置数据库                         | 应用使用 PGlite，目录持久化到 Docker 卷 | `compose.yaml`                 | 个人或单个家庭，最少组件           |
| 外部 PostgreSQL                    | 独立服务器、云数据库或已有 PostgreSQL   | 再加 `compose.external.yaml`   | 数据库已有专人维护，应用与存储分离 |
| Compose 自带 PostgreSQL 18（默认） | 单独数据库容器及独立数据卷              | 再加 `compose.postgres.yaml`   | 推荐的完整 PostgreSQL 部署         |
| PostgreSQL 17 兼容                 | 单独数据库容器及原有 17 卷              | 改用 `compose.postgres17.yaml` | 已有 17 数据或仍需使用 17          |

这三种模式共用同一套业务表和权限规则。内置模式只运行一个应用实例；外部 PostgreSQL 可以让应用容器独立重建。当前限流在应用进程内，尚不建议直接扩成多个应用副本。

内置默认使用命名卷 `zhu-jia-web_app_data`，数据不在容器可写层。替换镜像、重建容器或执行 `docker compose down` 后数据仍保留；`down -v` 会删除数据卷，不用于正常升级。

当前没有文件附件功能，这里的存储切换指账号、家庭、账本等数据库记录；S3/OSS 文件存储在后续版本规划中。

## 准备配置

各参数的必填条件、填写格式、默认值和完整示例见 [Docker 参数填写指南](docker-parameters.md)。内置模式通常只需修改 APP_ORIGIN；使用 PostgreSQL 时再填写对应数据库信息。应用提供 HTTP 服务，反向代理由服务器现有软件管理。

```bash
cp .env.docker.example .env.docker
```

修改 `.env.docker`：

```dotenv
APP_IMAGE_TAG=0.9.5
APP_ORIGIN=http://home.example.com
APP_PORT=8080
```

`APP_ORIGIN` 是浏览器真实访问的来源，包含协议、域名或 IP，以及实际端口；不要填写容器内部地址或子路径。SMTP 可不填写，注册没有邮箱验证码；邮件找回密码需要 SMTP。

## 启动应用与服务器反代

以下以内置模式为例：

```bash
docker compose --env-file .env.docker -f compose.yaml config --quiet
docker compose --env-file .env.docker -f compose.yaml up -d --build --wait
```

宿主机端口默认只监听 `127.0.0.1:8080`。将服务器已有的 Nginx、宝塔或其他代理转发到该地址，整个站点一起代理，包括页面和 `/api/`，无需单独部署前端。应用不管理证书、站点域名或代理进程。

Nginx 示例见 [deploy/nginx.conf](../deploy/nginx.conf)，可合并到服务器的现有站点配置：

```nginx
server {
    listen 80;
    server_name home.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

对应 `APP_ORIGIN=http://home.example.com`。如果入口带非默认端口，也要把端口写入 APP_ORIGIN。修改配置后重新创建应用容器；入口来源用于写请求校验与邮件找回链接，不依赖代理头自动推断。会话 Cookie 的 Secure 属性按入口协议设置，HttpOnly 和 SameSite 始终保留。

反代也运行在容器内时，将代理和应用加入同一个 Docker 网络，通过服务名 `app:3001` 转发；代理容器中的 `127.0.0.1` 不是宿主机。不需要把数据库端口暴露给代理。

应用部署在站点根路径，例如 `http://home.example.com`；暂不支持 `/renovation/` 之类的子路径部署。服务器上可直接用 `curl --fail http://127.0.0.1:8080/api/v1/health` 检查应用，再从配置的域名测试注册和登录。

本次 HTTP 入口调整需要用当前源码重新构建镜像。已发布的旧 0.9.5 镜像尚未包含该改动；新镜像发布前使用上述 `--build` 命令。

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

外置配置移除应用数据卷，数据库记录由外部服务持久化。`POSTGRES_HOST=127.0.0.1` 会指向容器自身；访问宿主机数据库应使用 `host.docker.internal`，并让宿主机 PostgreSQL 接受来自容器网络的连接。

## Compose 自带 PostgreSQL 18，兼容 17

无需填写 `POSTGRES_HOST`，数据库服务名固定为 `db`。设置专用密码，例如用 `openssl rand -hex 32` 生成后填入 `.env.docker`。

```bash
docker compose --env-file .env.docker -f compose.yaml -f compose.postgres.yaml up -d --build --wait
```

默认镜像为 `postgres:18-alpine`，数据卷为 `zhu-jia-web_postgres18_data`，挂载到 `/var/lib/postgresql`，实际数据目录为 `/var/lib/postgresql/18/docker`。应用等待数据库健康后启动，数据库不向宿主机公开 5432 端口。容器私有网络中的数据库连接关闭 TLS，服务器代理仍转发到同一个应用端口。

需要 17 时将命令中的数据库配置改为 `-f compose.postgres17.yaml`。该配置继续使用原来的 `zhu-jia-web_postgres_data` 卷。**原先运行 17 的部署，更新配置文件后要选择 17 兼容文件，或先按升级流程迁移；不能直接用 18 读取旧卷。**完整命令与说明见 [PostgreSQL 18 与 17](postgresql.md)。

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
