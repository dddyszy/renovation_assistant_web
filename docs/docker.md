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

## 配置样例

下面每份 `.env` 都是完整可用的最小配置，改完直接执行对应命令。

### 样例 1：本机试用，内置数据库

```dotenv
APP_ORIGIN=http://localhost:8080
```

```bash
docker compose up -d --build --wait
curl --fail http://127.0.0.1:8080/api/v1/health
```

### 样例 2：服务器 + 域名，内置数据库

Nginx 转发到 `127.0.0.1:8080`，配置见下一节。

```dotenv
APP_ORIGIN=https://home.example.com
```

```bash
docker compose up -d --build --wait
```

### 样例 3：Compose 自带 PostgreSQL 18

库名和账号默认 `zhu_jia`，只设密码。密码可以用 `openssl rand -hex 32` 生成。

```dotenv
APP_ORIGIN=https://home.example.com
POSTGRES_PASSWORD='替换为随机密码'
```

```bash
docker compose -f compose.yaml -f compose.postgres.yaml up -d --build --wait
```

需要 PostgreSQL 17 时把文件换成 `compose.postgres17.yaml`。

### 样例 4：连接本机 PostgreSQL 的 5433 端口

宿主机数据库需要监听外部地址并允许 Docker 网段访问，详见 [常见问题](#常见问题)。

```dotenv
APP_ORIGIN=http://localhost:8080
DATABASE_URL=postgresql://zhu_jia:my-pass@host.docker.internal:5433/zhu_jia?sslmode=disable
```

```bash
docker compose -f compose.yaml -f compose.external.yaml up -d --build --wait
```

### 样例 5：连接云数据库或远程 PostgreSQL

密码里的 `@` 要写成 `%40`，其余特殊字符同理。

```dotenv
APP_ORIGIN=https://home.example.com
DATABASE_URL=postgresql://app_user:P%40ssw0rd@db.example.com:5432/zhu_jia?sslmode=verify-full
```

```bash
docker compose -f compose.yaml -f compose.external.yaml up -d --build --wait
```

数据库提供可信证书时用 `sslmode=verify-full`；受控内网明确没有 TLS 才用 `disable`。

### 样例 6：使用预构建镜像

```dotenv
APP_ORIGIN=https://home.example.com
APP_IMAGE_TAG=0.9.9
```

```bash
docker compose -f compose.yaml -f compose.image.yaml pull
docker compose -f compose.yaml -f compose.image.yaml up -d --no-build --wait
```

### 样例 7：内置数据库挂到宿主机目录

```dotenv
APP_ORIGIN=http://localhost:8080
DATA_DIR=/srv/zhu-jia/data
```

```bash
sudo mkdir -p /srv/zhu-jia/data && sudo chown 1000:1000 /srv/zhu-jia/data
docker compose -f compose.yaml -f compose.bind.yaml up -d --build --wait
```

### 组合速查

| 目标            | `.env` 中设置                      | Compose 文件                 |
| --------------- | ---------------------------------- | ---------------------------- |
| 内置数据库      | `APP_ORIGIN`                       | `compose.yaml`               |
| 自带 PostgreSQL | `APP_ORIGIN`、`POSTGRES_PASSWORD`  | 再加 `compose.postgres.yaml` |
| 已有 PostgreSQL | `APP_ORIGIN`、`DATABASE_URL`       | 再加 `compose.external.yaml` |
| 预构建镜像      | `APP_ORIGIN`，可选 `APP_IMAGE_TAG` | 再加 `compose.image.yaml`    |
| 宿主机目录      | `APP_ORIGIN`、`DATA_DIR`           | 再加 `compose.bind.yaml`     |

外部数据库和自带 PostgreSQL 只能选一种，不要同时叠加。

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

## 常见问题

| 现象                                           | 原因与处理                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL is required`                     | 用了 `compose.external.yaml` 但 `.env` 没写连接串                                        |
| `POSTGRES_PASSWORD is required`                | 用了 `compose.postgres.yaml` 但没设密码                                                  |
| `ECONNREFUSED host.docker.internal:5433`       | 数据库只监听 `127.0.0.1`，改为 `listen_addresses='*'` 并重启                             |
| `no pg_hba.conf entry`                         | 缺少 Docker 网段规则，例如 `host all all 172.16.0.0/12 scram-sha-256`                    |
| `password authentication failed`               | 连接串里的密码没有 URL 编码，或数据库密码已改                                            |
| `The server does not support SSL connections`  | 连接要求 SSL 但数据库未启用：本机改用 `sslmode=disable`，并确认没有 `PGSSLMODE` 环境变量 |
| `self-signed certificate in certificate chain` | 自签证书：改用 `sslmode=require`，或挂载 CA 后用 `verify-full`                           |
| 启动后看到空库                                 | 换了存储方式或数据卷，旧数据不会自动迁移                                                 |
| 页面能开但写操作报来源无效                     | `APP_ORIGIN` 与浏览器地址的协议、域名、端口不一致                                        |

### SSL 连接说明

`pg` 驱动会把 `sslmode=prefer` 按 `verify-full` 处理，不会自动回退到非加密连接。因此：

| 数据库情况           | 建议写法               |
| -------------------- | ---------------------- |
| 本机或内网未启用 SSL | `?sslmode=disable`     |
| 云数据库，证书受信任 | `?sslmode=verify-full` |
| 自签证书，只要加密   | `?sslmode=require`     |

如果容器里残留 `PGSSLMODE=prefer`，即使连接串没写 `sslmode` 也会尝试 SSL。排查命令：

```bash
docker compose -f compose.yaml -f compose.external.yaml exec app printenv PGSSLMODE
docker compose -f compose.yaml -f compose.external.yaml config | grep -i ssl
```

从容器内测试宿主机数据库：

```bash
docker run --rm --add-host host.docker.internal:host-gateway \
  postgres:18-alpine \
  psql "postgresql://zhu_jia:my-pass@host.docker.internal:5433/zhu_jia?sslmode=disable" \
  -c "select 1"
```

## 说明

- 镜像已内置 `NODE_ENV`、监听地址、端口和 `DATABASE_URL=/app/data/postgres`，无需重复配置。
- 当前版本不包含邮件服务，生产环境不提供自助找回密码；注册和登录不受影响。
- 真实域名、证书、数据库备份仍需在目标环境单独验收。
