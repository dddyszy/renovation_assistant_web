# 配置参考

版本：0.9.5。本地开发参考 `.env.example`，Docker 参考 `.env.docker.example`。示例文件可提交，真实凭据文件不提交。

## 应用运行变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| NODE_ENV | 未设置 | 生产使用 `production`，启用 HTTPS 来源检查与 Secure Cookie |
| HOST | `127.0.0.1` | API 监听地址，Docker 设置为 `0.0.0.0` |
| PORT | `3001` | API 及生产静态服务端口 |
| APP_ORIGIN | `http://localhost:5173` | 浏览器来源；生产必须显式填写 HTTPS 来源 |
| DATABASE_URL | 见下节 | 连接 URL 或 PGlite 数据目录 |
| PGHOST / PGPORT | 无 / 5432 | 不填 DATABASE_URL 时选择外部 PostgreSQL 的地址和端口 |
| PGDATABASE / PGUSER / PGPASSWORD | pg 的环境默认 | 独立传递数据库、账号和密码 |
| PGSSLMODE | pg 的环境默认 | `verify-full` 用于可信 TLS，`disable` 用于明确不启用 TLS 的数据库 |
| SMTP_HOST / SMTP_PORT | 无 / 587 | 邮件服务器；465 使用直接 TLS |
| SMTP_USER / SMTP_PASSWORD | 无 | 邮件认证，按服务商要求填写 |
| SMTP_FROM | 无 | 发件人；配置 SMTP_HOST 后必填 |

数据库连接池每个应用进程最多 10 个连接，建立连接超时 5 秒，空闲连接 30 秒回收。

## 数据库选择优先级

1. 非空 `DATABASE_URL` 优先：以 `postgres` 开头时连接 PostgreSQL，否则作为 PGlite 目录。
2. `DATABASE_URL` 为空且设置 `PGHOST` 时，使用 `PG*` 环境变量连接 PostgreSQL。
3. 均未设置时，使用 `.data/postgres` 内置持久化数据库。

迁移工具中的 `postgres:env` 表示使用 `PG*` 环境变量，不是可复制到其他软件中的标准连接 URL。`memory://` 只用于测试，不持久化。

Compose 默认固定内置目录 `/app/data/postgres`；两个 PostgreSQL 配置将其清空，再设置 PG 环境变量。修改宿主机 `.env.docker` 中未被 Compose 映射的变量，不会自动出现在容器里。

## Docker 编排变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| APP_IMAGE_TAG | `0.9.5` | 本地构建镜像标签和 OCI 版本标记 |
| APP_PORT | `8080` | 宿主机回环端口，容器端口仍为 3001 |
| DOMAIN | 无 | Caddy 使用的域名，不含协议和路径 |
| DATA_DIR | 无 | 可选目录挂载的绝对路径 |
| POSTGRES_HOST / POSTGRES_PORT | 无 / 5432 | 外置数据库服务器 |
| POSTGRES_DB / POSTGRES_USER | `zhu_jia` | 外置和自带 PostgreSQL 的数据库及账号 |
| POSTGRES_PASSWORD | 无，相关模式必填 | 不设通用数据库密码 |
| POSTGRES_SSLMODE | 示例为 `verify-full` | 外置配置传给 PGSSLMODE；自带配置固定为 disable |

`.env.docker` 由 Compose 显式读取，启动命令始终带 `--env-file .env.docker`。应用镜像内没有这个文件，实际配置通过容器 environment 注入。

## 运行工具变量

| 变量 | 使用工具 | 用途 |
| --- | --- | --- |
| SOURCE_DATABASE / TARGET_DATABASE | `npm run migrate:storage` | 显式指定源和全新目标，默认只预检 |
| TEST_DATABASE_URL | `npm test` | 指向专用、可丢弃的 PostgreSQL 测试库；不设时使用内存 PGlite |
| TEST_MIGRATION_TARGET_DATABASE | 存储迁移测试 | 单独的全新测试库，不能与 TEST_DATABASE_URL 相同；不设时使用临时 PGlite 目录 |
| BACKUP_DIR | `scripts/backup-postgres.sh` | 备份输出目录，默认 backups |
| SMOKE_ALLOW_WRITE | Docker HTTP 验收 | 必须为 yes；验收会创建虚构账号和家庭 |
| SMOKE_URL / SMOKE_ORIGIN | Docker HTTP 验收 | 本机端口和应用允许的来源，不用于正常浏览器访问 |

应用版本从 package.json 读取，健康接口和前端显示相同版本；生产构建将版本写入 Service Worker 缓存名。升级版本时还需同步默认镜像标签和更新记录，见发布流程。
