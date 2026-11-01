# Docker 部署

版本：**0.9.9**。使用 Docker Engine 和 Docker Compose 2.24.4 及以上；可选覆盖配置使用 `!reset`。

## 默认部署

默认模式只运行一个应用容器，使用内置 PGlite 数据库，数据保存在 `zhu-jia-web_app_data` 命名卷。

```bash
cp .env.example .env
# 修改 APP_ORIGIN 为浏览器实际访问地址；本机验证保留 http://localhost:8080。
docker compose up -d --build --wait
curl --fail http://127.0.0.1:8080/api/v1/health
```

健康接口应返回 `data.status=ok`、`data.version=0.9.9`。Compose 默认自动读取 `.env`，常用命令不需要 `--env-file` 或 `-f compose.yaml`。旧部署可继续显式传入原环境文件，新部署使用 `.env`。

Docker 自动提供 `NODE_ENV=production`、容器监听地址和端口、健康检查；默认 Compose 不再重复设置。默认也不需要数据库密码、SMTP、镜像名或版本变量。

## 保留的运行参数

- `APP_ORIGIN` 必须填写：用于写请求来源校验和邮件找回链接，值是浏览器入口而不是容器地址。
- `DATABASE_URL=/app/data/postgres`：选择内置数据库并固定持久化目录。
- `127.0.0.1:8080:3001`：仅向宿主机回环地址开放应用端口。
- `app_data:/app/data`：容器重建后保留数据。
- `restart`、`init`、`stop_grace_period`：自动重启、信号转发和优雅退出。
- `read_only`、`tmpfs`、`cap_drop`、`no-new-privileges`：保留基础容器安全限制。
- 日志轮转：单个日志 10 MB、最多 3 个文件。

`NODE_ENV/HOST/PORT/TSX_DISABLE_CACHE` 已在 Dockerfile 设置，无需写入 `.env`。镜像还内置 `DATABASE_URL=/app/data/postgres`，因此直接用 `docker run` 并挂载 `/app/data` 也能启动；PostgreSQL 覆盖配置会用空值清除它并改用 `PG*`。不要删除数据卷或健康检查来换取更少配置行。

## 服务器反向代理

默认只监听宿主机 `127.0.0.1:8080`。将服务器已有 Nginx、宝塔或其他代理转发到该地址，整个站点一起代理，包括页面和 `/api/`：

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

对应 `APP_ORIGIN=http://home.example.com`。入口有非默认端口时也要写入；暂不支持子路径部署。代理也运行在容器内时，转发到同一 Docker 网络中的 `app:3001`，不要使用代理容器自身的 `127.0.0.1`。

需要修改宿主机端口时，直接修改 `compose.yaml` 的 `ports`，例如将 `127.0.0.1:8080:3001` 改为 `127.0.0.1:8081:3001`，并同步修改 `APP_ORIGIN`。无需再增加一个端口变量。

## 可选存储

### Compose PostgreSQL 18

在 `.env` 设置 `POSTGRES_PASSWORD`，库名和账号可保留默认：

```bash
docker compose -f compose.yaml -f compose.postgres.yaml up -d --build --wait
```

数据库不向宿主机公开 5432 端口，应用等待数据库健康后启动。数据保存在 `zhu-jia-web_postgres18_data`。

### PostgreSQL 17 兼容

已有 17 数据时使用原数据卷，不能直接让 18 打开旧目录：

```bash
docker compose -f compose.yaml -f compose.postgres17.yaml up -d --build --wait
```

18 与 17 配置二选一。数据库升级和迁移见 [PostgreSQL 说明](postgresql.md)。

### 已有外部 PostgreSQL

在 `.env` 填写真实 `POSTGRES_HOST/PORT/DB/USER/PASSWORD/SSLMODE`：

```bash
docker compose -f compose.yaml -f compose.external.yaml up -d --build --wait
```

数据库账号需能创建表、索引并读写业务数据。`127.0.0.1` 指应用容器自身；宿主机数据库可使用 `host.docker.internal`，并配置数据库监听和访问权限。

### 内置数据挂到宿主机目录

设置专用绝对路径 `DATA_DIR=/srv/zhu-jia/data`：

```bash
sudo mkdir -p /srv/zhu-jia/data
sudo chown 1000:1000 /srv/zhu-jia/data
docker compose -f compose.yaml -f compose.bind.yaml up -d --build --wait
```

切换已有卷前先备份和迁移，不能把空目录当作原数据。目录挂载不与 PostgreSQL 配置叠加。

## 可选 SMTP

普通注册登录不需要邮件。只有密码找回需要 SMTP，在 `.env` 填写 `SMTP_HOST`、`SMTP_FROM` 及服务商要求的账号参数，然后叠加：

```bash
docker compose -f compose.yaml -f compose.smtp.yaml up -d --build --wait
```

这样未使用邮件的部署不会携带空 SMTP 参数。

## 使用预构建镜像

对应 GHCR 镜像发布成功后：

```bash
docker compose -f compose.yaml -f compose.image.yaml pull
docker compose -f compose.yaml -f compose.image.yaml up -d --no-build --wait
```

默认地址为 `ghcr.io/dddyszy/renovation_assistant_web:0.9.9`。需要其他仓库或候选镜像时，才在 `.env` 设置 `APP_IMAGE` 和 `APP_IMAGE_TAG`。私有镜像登录见 [容器镜像仓库](container-registry.md)。

## 构建、升级与验收

单独构建：

```bash
docker build -t zhu-jia-web:0.9.9 .
```

Dockerfile 内执行 lint、格式检查、类型检查、前端构建和测试；运行层只保留生产依赖，使用非 root 用户。升级使用原存储配置重新 `up -d --build --wait`，不要使用 `down -v`。

```bash
docker compose ps
docker compose logs --tail 100 app
curl --fail http://127.0.0.1:8080/api/v1/health
```

实际容器运行和 HTTP 验收才算部署验证通过；`docker compose config` 只能检查配置展开。真实域名、SMTP、备份恢复仍需在目标环境单独验收。
