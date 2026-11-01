# 配置参考

版本：**0.9.7**。Docker 和本地开发均可从 `.env.example` 复制 `.env`；真实凭据不提交。

## 应用运行变量

| 变量                             | 默认值                | 用途                                             |
| -------------------------------- | --------------------- | ------------------------------------------------ |
| NODE_ENV                         | 未设置                | 生产使用 production；Docker 镜像已设置           |
| HOST / PORT                      | 127.0.0.1 / 3001      | 监听地址和端口；Docker 镜像设置为 0.0.0.0 / 3001 |
| APP_ORIGIN                       | http://localhost:5173 | 浏览器真实入口；生产必须显式设置                 |
| DATABASE_URL                     | 见下节                | PostgreSQL 连接 URL 或 PGlite 数据目录           |
| PGHOST / PGPORT                  | 无 / 5432             | DATABASE_URL 为空时连接独立 PostgreSQL           |
| PGDATABASE / PGUSER / PGPASSWORD | pg 环境默认           | 独立传递数据库、账号和密码                       |
| PGSSLMODE                        | pg 环境默认           | verify-full 验证可信 TLS；disable 明确关闭 TLS   |
| SMTP_HOST / SMTP_PORT            | 无 / 587              | 邮件服务器；465 使用直接 TLS                     |
| SMTP_USER / SMTP_PASSWORD        | 无                    | 可选邮件认证                                     |
| SMTP_FROM                        | 无                    | 配置 SMTP_HOST 后必填                            |

APP_ORIGIN 只接受 HTTP(S) 来源，不允许账号、子路径、查询参数或片段。Cookie Secure 属性按入口协议设置，HttpOnly 和 SameSite=Lax 始终保留。

## 数据库选择优先级

1. 非空 DATABASE_URL：以 postgres 开头连接 PostgreSQL，否则作为 PGlite 目录。
2. DATABASE_URL 为空且设置 PGHOST：使用 PG* 环境变量。
3. 都未设置：使用 `.data/postgres`。

Docker 默认固定 `/app/data/postgres`；PostgreSQL 覆盖配置会清空 DATABASE_URL，再设置 PG*。`.env` 由 Compose 读取，只有 Compose `environment` 明确列出的变量才进入容器。

## Docker 编排变量

默认只需要 APP_ORIGIN。源码构建镜像固定为 `zhu-jia-web:0.9.7`，端口固定映射 `127.0.0.1:8080:3001`，修改时直接编辑 Compose。

| 变量                          | 默认值或条件                        | 用途                                 |
| ----------------------------- | ----------------------------------- | ------------------------------------ |
| APP_ORIGIN                    | 必填                                | 用户浏览器真实入口                   |
| APP_IMAGE / APP_IMAGE_TAG     | GHCR 仓库 / 0.9.7                   | 仅 compose.image.yaml 使用           |
| DATA_DIR                      | 仅 compose.bind.yaml 必填           | 宿主机数据目录绝对路径               |
| POSTGRES_HOST / POSTGRES_PORT | 外部模式必填 / 5432                 | 已有数据库服务器                     |
| POSTGRES_DB / POSTGRES_USER   | zhu_jia                             | 外部或 Compose PostgreSQL 数据库账号 |
| POSTGRES_PASSWORD             | 外部或 Compose PostgreSQL 必填      | 不提供通用默认密码                   |
| POSTGRES_SSLMODE              | 外部默认 prefer，建议按实际显式设置 | 传给 PGSSLMODE                       |
| SMTP_*                        | 仅 compose.smtp.yaml 使用           | 可选密码找回邮件                     |

## 运行工具变量

| 变量                              | 使用工具                     | 用途                                            |
| --------------------------------- | ---------------------------- | ----------------------------------------------- |
| SOURCE_DATABASE / TARGET_DATABASE | `npm run migrate:storage`    | 显式指定源和全新目标，默认只预检                |
| TEST_DATABASE_URL                 | `npm test`                   | 专用可丢弃 PostgreSQL 测试库；不设用内存 PGlite |
| TEST_MIGRATION_TARGET_DATABASE    | 存储迁移测试                 | 独立空测试库，不能与 TEST_DATABASE_URL 相同     |
| BACKUP_DIR                        | `scripts/backup-postgres.sh` | 备份目录，默认 backups                          |
| SMOKE_ALLOW_WRITE                 | Docker HTTP 验收             | 必须为 yes；会创建并清理虚构账号和家庭          |
| SMOKE_URL / SMOKE_ORIGIN          | Docker HTTP 验收             | 本机端口和应用允许的来源                        |

应用版本从 package.json 读取，健康接口、前端和 Service Worker 缓存名一致；发布时同步镜像标签和更新记录。
