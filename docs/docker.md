# Docker 部署

版本：**0.9.9**。需要 Docker Engine 与 Docker Compose 2.24.4 及以上。

## 快速开始

默认使用内置 PGlite 数据库，数据存在 `zhu-jia-web_app_data` 卷，不需要数据库账号或密码。

```bash
cp .env.example .env
# 修改 APP_ORIGIN 为浏览器实际访问地址；本机验证保留 http://localhost:8080
docker compose up -d --build --wait
curl --fail http://127.0.0.1:8080/api/v1/health
```

健康接口应返回 `data.status=ok`、`data.version=0.9.9`。Compose 自动读取 `.env`，常用命令不需要 `--env-file`。

## 选择数据库

三种方式选一种，默认已选内置数据库。

| 方式                  | 需要设置            | 启动命令                                                                       |
| --------------------- | ------------------- | ------------------------------------------------------------------------------ |
| 内置 PGlite（默认）   | 无                  | `docker compose up -d --build --wait`                                          |
| Compose PostgreSQL 18 | `POSTGRES_PASSWORD` | `docker compose -f compose.yaml -f compose.postgres.yaml up -d --build --wait` |
| 已有 PostgreSQL       | `DATABASE_URL`      | `docker compose -f compose.yaml -f compose.external.yaml up -d --build --wait` |

Compose PostgreSQL 只需一个密码，库名和账号默认 `zhu_jia`。需要 PostgreSQL 17 时把 `compose.postgres.yaml` 换成 `compose.postgres17.yaml`。

连接已有数据库只填一条连接串：

```dotenv
DATABASE_URL=postgresql://zhu_jia:password@db.example.internal:5432/zhu_jia?sslmode=verify-full
```

密码含 `@`、`/`、`%` 等字符时先做 URL 编码。数据库在宿主机时用 `host.docker.internal`，并让数据库接受容器网络访问。数据库账号需要能建表、建索引和读写业务数据。

## 端口与反向代理

应用只监听宿主机回环地址 `127.0.0.1:8080`，容器端口 `3001`。需要换端口时直接修改 `compose.yaml` 的 `ports`，并同步修改 `APP_ORIGIN`。

服务器已有 Nginx 时整体转发即可：

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`APP_ORIGIN` 必须与浏览器地址栏完全一致（协议、域名、非默认端口），不要填代理上游地址。代理也在容器里时转发到 `app:3001`。

## 使用预构建镜像

```bash
docker compose -f compose.yaml -f compose.image.yaml pull
docker compose -f compose.yaml -f compose.image.yaml up -d --no-build --wait
```

默认镜像为 `ghcr.io/dddyszy/renovation_assistant_web:0.9.9`；换仓库或标签时才需要在 `.env` 设置 `APP_IMAGE`、`APP_IMAGE_TAG`。私有镜像需先 `docker login ghcr.io`。

## 数据目录挂载

内置数据库可改用宿主机目录：

```bash
mkdir -p /srv/zhu-jia/data && sudo chown 1000:1000 /srv/zhu-jia/data
# .env 中设置 DATA_DIR=/srv/zhu-jia/data
docker compose -f compose.yaml -f compose.bind.yaml up -d --build --wait
```

切换已有数据卷前先备份，空目录会呈现全新数据库。

## 升级与排错

```bash
docker compose pull            # 使用预构建镜像时
docker compose up -d --build --wait
docker compose ps
docker compose logs --tail 100 app
```

升级不要执行 `docker compose down -v`，它会删除数据卷。备份、恢复和故障处理见 [运维手册](operations.md)，数据库版本差异见 [PostgreSQL 说明](postgresql.md)，镜像发布见 [容器镜像仓库](container-registry.md)。

## 说明

- 镜像已内置 `NODE_ENV`、监听地址、端口和 `DATABASE_URL=/app/data/postgres`，无需重复配置。
- 当前版本不包含邮件服务，生产环境不提供自助找回密码；注册和登录不受影响。
- 真实域名、证书、数据库备份仍需在目标环境单独验收。
