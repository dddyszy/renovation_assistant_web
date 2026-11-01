# Docker 部署参数

适用版本：**0.9.9**。先复制配置：

```bash
cp .env.example .env
```

Compose 自动读取 `.env`，不用在每次命令中添加 `--env-file`。示例域名和密码都要替换，真实凭据不提交到 Git。

## 默认模式：只填一个参数

| 参数       | 是否必填 | 说明                                                               | 本机示例                |
| ---------- | -------- | ------------------------------------------------------------------ | ----------------------- |
| APP_ORIGIN | 是       | 浏览器真实来源，含协议、主机和非默认端口，不含子路径、查询或尾斜线 | `http://localhost:8080` |

本机启动保留示例值即可。服务器使用域名时，例如 `https://home.example.com`，必须与浏览器地址一致。代理转发地址不是 APP_ORIGIN。

默认端口固定为宿主机 `127.0.0.1:8080`、容器 `3001`。需要更换宿主机端口时直接修改 `compose.yaml` 的 `ports`，同时更新 APP_ORIGIN；不再增加 APP_PORT 变量。

## 默认不需要配置的参数

- **镜像参数**：源码构建已固定为 `zhu-jia-web:0.9.9`，不需要 APP_IMAGE 或 APP_IMAGE_TAG。
- **运行参数**：NODE_ENV、HOST、PORT、DATABASE_URL 均由镜像提供默认值，Compose 再显式声明数据库目录。
- **数据库参数**：内置 PGlite 不需要账号或密码。
- **SMTP 参数**：不使用密码找回邮件时保持为空，且不要叠加 `compose.smtp.yaml`。
- **DATA_DIR**：使用默认命名卷时不需要。

## 按场景增加的参数

| 场景                           | 需要填写                                                | 额外 Compose 文件          |
| ------------------------------ | ------------------------------------------------------- | -------------------------- |
| Compose PostgreSQL 18 / 17     | POSTGRES_PASSWORD；DB/USER 可保留默认                   | `compose.postgres.yaml` 等 |
| 已有外部 PostgreSQL            | POSTGRES_HOST、PORT、DB、USER、PASSWORD、SSLMODE        | `compose.external.yaml`    |
| 内置数据库改用宿主机目录       | DATA_DIR，必须是专用绝对路径                            | `compose.bind.yaml`        |
| SMTP 密码找回                  | SMTP_HOST、SMTP_FROM；PORT、USER、PASSWORD 按服务商要求 | `compose.smtp.yaml`        |
| 默认以外的预构建镜像或候选标签 | APP_IMAGE（不含标签）、APP_IMAGE_TAG                    | `compose.image.yaml`       |

存储方式由 Compose 文件选择，不是因为填写了密码就自动切换。内置、外部 PostgreSQL、Compose PostgreSQL 三选一。

## PostgreSQL 参数

| 参数              | 外部 PostgreSQL                                   | Compose PostgreSQL             |
| ----------------- | ------------------------------------------------- | ------------------------------ |
| POSTGRES_HOST     | 必填，数据库真实域名/IP                           | 忽略，应用固定连接服务名 db    |
| POSTGRES_PORT     | 默认 5432，按实际端口                             | 忽略，容器间固定 5432          |
| POSTGRES_DB       | 已创建的数据库名                                  | 首次初始化创建，默认 zhu_jia   |
| POSTGRES_USER     | 已有账号，需能建表、索引和读写                    | 首次初始化创建，默认 zhu_jia   |
| POSTGRES_PASSWORD | 必填，该账号真实密码                              | 必填，自行生成随机密码         |
| POSTGRES_SSLMODE  | 按数据库 TLS 要求设置，默认可信证书用 verify-full | 忽略，容器私有网络固定 disable |

可以用 `openssl rand -hex 32` 生成新密码。已有数据库密码不会因修改环境变量而自动重置。密码含 `$`、`#` 等字符时，在 `.env` 中用单引号包住完整值。

## SMTP 参数

- SMTP_HOST：服务商地址；SMTP_FROM：已通过发信认证的发件人，两者都要设置。
- SMTP_PORT：通常 587 使用 STARTTLS，465 使用直接 TLS。
- SMTP_USER / SMTP_PASSWORD：服务商要求认证时填写授权码或密码。

启用示例：

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASSWORD='替换为真实授权码'
SMTP_FROM='筑家手记 <noreply@example.com>'
```

```bash
docker compose -f compose.yaml -f compose.smtp.yaml up -d --build --wait
```

## 校验与启动

```bash
docker compose config --quiet
docker compose up -d --build --wait
curl --fail http://127.0.0.1:8080/api/v1/health
```

可选模式在 `config` 和 `up` 中使用完全相同的 `-f` 组合。`config --quiet` 只验证配置和必填变量，不能验证密码、网络或数据库可用性；完整 `config` 输出可能含密码，不要公开发送。
