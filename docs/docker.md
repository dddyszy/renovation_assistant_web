# Docker 部署

版本：**0.9.12**。需要 Docker Engine 与 Docker Compose 2.24.4 及以上。

支持两种存储方式：**内置 PGlite**（默认，单容器）和**外置 PostgreSQL**（推荐 18，兼容 17）。

## 快速开始

```bash
cp .env.example .env
# 修改 APP_ORIGIN 为浏览器实际访问地址；本机验证保留 http://localhost:8080
docker compose up -d --build --wait
curl --fail http://127.0.0.1:8080/api/v1/health
```

健康接口应返回 `data.status=ok`、`data.version=0.9.12`。Compose 自动读取 `.env`。

## 选择存储

| 方式                    | 需要设置       | 启动命令                                                                       |
| ----------------------- | -------------- | ------------------------------------------------------------------------------ |
| 内置 PGlite（默认）     | 无             | `docker compose up -d --build --wait`                                          |
| 外置 PostgreSQL 18 / 17 | `DATABASE_URL` | `docker compose -f compose.yaml -f compose.external.yaml up -d --build --wait` |

内置模式的数据保存在 `zhu-jia-web_app_data` 卷，不需要数据库账号或密码。外置模式只运行 app 容器，数据库由你自行安装或使用云服务，详见 [外置 PostgreSQL](postgresql.md)。

## 配置样例

每份 `.env` 都是完整可用的最小配置。

### 样例 1：本机试用，内置数据库

```dotenv
APP_ORIGIN=http://localhost:8080
```

```bash
docker compose up -d --build --wait
```

### 样例 2：服务器 + 域名，内置数据库

```dotenv
APP_ORIGIN=https://home.example.com
```

```bash
docker compose up -d --build --wait
```

Nginx 转发配置见下一节。

### 样例 3：连接本机 PostgreSQL 5433

```dotenv
APP_ORIGIN=http://localhost:8080
DATABASE_URL=postgresql://zhu_jia:my-pass@host.docker.internal:5433/zhu_jia?sslmode=disable
```

```bash
docker compose -f compose.yaml -f compose.external.yaml up -d --build --wait
```

宿主机 PostgreSQL 需要监听外部地址并允许 Docker 网段，见 [常见问题](#常见问题)。

### 样例 4：连接云数据库或远程 PostgreSQL

```dotenv
APP_ORIGIN=https://home.example.com
DATABASE_URL=postgresql://app_user:P%40ssw0rd@db.example.com:5432/zhu_jia?sslmode=verify-full
```

```bash
docker compose -f compose.yaml -f compose.external.yaml up -d --build --wait
```

密码里的 `@` 写成 `%40`，其他特殊字符同理。

### 样例 5：使用预构建镜像

```dotenv
APP_ORIGIN=https://home.example.com
APP_IMAGE_TAG=0.9.12
```

```bash
docker compose -f compose.yaml -f compose.image.yaml pull
docker compose -f compose.yaml -f compose.image.yaml up -d --no-build --wait
```

### 样例 6：内置数据库挂到宿主机目录

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
| 外置 PostgreSQL | `APP_ORIGIN`、`DATABASE_URL`       | 再加 `compose.external.yaml` |
| 预构建镜像      | `APP_ORIGIN`，可选 `APP_IMAGE_TAG` | 再加 `compose.image.yaml`    |
| 宿主机目录      | `APP_ORIGIN`、`DATA_DIR`           | 再加 `compose.bind.yaml`     |

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

升级不要执行 `docker compose down -v`，它会删除数据卷。备份、恢复和故障处理见 [运维手册](operations.md)，数据库说明见 [外置 PostgreSQL](postgresql.md)，镜像发布见 [容器镜像仓库](container-registry.md)。

## 常见问题

| 现象                                           | 原因与处理                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL is required`                     | 用了 `compose.external.yaml` 但 `.env` 没写连接串                                    |
| `ECONNREFUSED host.docker.internal:5433`       | 数据库只监听 `127.0.0.1`，改为 `listen_addresses='*'` 并重启                         |
| `no pg_hba.conf entry`                         | 缺少 Docker 网段规则，例如 `host all all 172.16.0.0/12 scram-sha-256`                |
| `password authentication failed`               | 连接串里的密码没有 URL 编码，或数据库密码已改                                        |
| `The server does not support SSL connections`  | 连接要求 SSL 但数据库未启用：改用 `sslmode=disable`，并确认没有 `PGSSLMODE` 环境变量 |
| `self-signed certificate in certificate chain` | 自签证书：改用 `sslmode=require`，或挂载 CA 后用 `verify-full`                       |
| 启动后看到空库                                 | 换了存储方式或数据卷，旧数据不会自动迁移                                             |
| 页面能开但写操作报来源无效                     | `APP_ORIGIN` 与浏览器地址的协议、域名、端口不一致                                    |

### SSL 连接说明

| 数据库情况           | 建议写法               |
| -------------------- | ---------------------- |
| 本机或内网未启用 SSL | `?sslmode=disable`     |
| 云数据库，证书受信任 | `?sslmode=verify-full` |
| 自签证书，只要加密   | `?sslmode=require`     |

`pg` 驱动会把 `sslmode=prefer` 按 `verify-full` 处理，不会自动回退。容器里残留 `PGSSLMODE=prefer` 时也会尝试 SSL，可用下面命令检查：

```bash
docker compose -f compose.yaml -f compose.external.yaml exec app printenv PGSSLMODE
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
