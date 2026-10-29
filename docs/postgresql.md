# PostgreSQL 18 默认部署与 17 兼容

适用应用版本：0.9.5。PostgreSQL 部署默认使用 **18**，保留 **17** 兼容配置；外部数据库可以连接 18 或 17，使用相同的账号、项目和记账功能。

内置 PGlite 仍作为轻量存储选项保留。推荐使用完整 PostgreSQL 时，选择下文默认 18 命令；PGlite 不会因为填写数据库密码就自动变成 PostgreSQL 18。

## 推荐：直接使用 PostgreSQL 18

复制最新部署配置，填写 `.env.docker` 中的 APP_ORIGIN、数据库密码。需要 Caddy 时再填 DOMAIN。镜像私有，先完成 GHCR 登录。

```bash
docker compose --env-file .env.docker \
  -f compose.yaml -f compose.image.yaml -f compose.postgres.yaml \
  up -d --no-build --wait
```

应用使用 `ghcr.io/dddyszy/renovation_assistant_web:0.9.5`，数据库使用 `postgres:18-alpine`。无需重建应用镜像。完整填写规则见 [Docker 参数指南](docker-parameters.md)。

## 兼容 PostgreSQL 17

已有 17 数据或需要继续运行 17 时，把默认数据库配置换成兼容配置，其他参数不变：

```bash
docker compose --env-file .env.docker \
  -f compose.yaml -f compose.image.yaml -f compose.postgres17.yaml \
  up -d --no-build --wait
```

数据库使用 `postgres:17-alpine`，兼容配置继续使用旧的 `zhu-jia-web_postgres_data` 卷。更新项目部署文件后，原 17 部署应选择这个配置，不能继续假定 compose.postgres.yaml 仍代表 17。

这两个数据库配置选一个，不同时叠加。

## 外部数据库

如果 PostgreSQL 18 或 17 已由云平台、宿主机或其他 Compose 项目管理，仍然使用外置配置：

```bash
docker compose --env-file .env.docker \
  -f compose.yaml -f compose.image.yaml -f compose.external.yaml \
  up -d --no-build --wait
```

填写实际的 POSTGRES_HOST、POSTGRES_PORT、POSTGRES_DB、POSTGRES_USER、POSTGRES_PASSWORD 和 POSTGRES_SSLMODE。不需要额外设置数据库版本变量，版本由外部服务器决定；应用不会替外部服务器升级数据库。

## 18 与 17 的目录和卷不同

| 配置 | 数据库镜像 | 数据目录 PGDATA | 挂载目标 | 命名卷 |
| --- | --- | --- | --- | --- |
| compose.postgres.yaml 默认 | postgres:18-alpine | `/var/lib/postgresql/18/docker` | `/var/lib/postgresql` | `zhu-jia-web_postgres18_data` |
| compose.postgres17.yaml 兼容 | postgres:17-alpine | `/var/lib/postgresql/data` | `/var/lib/postgresql/data` | `zhu-jia-web_postgres_data` |

PostgreSQL 官方镜像从 18 起使用按主版本分目录的数据布局，详见 [官方 PGDATA 说明](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata)。本项目用独立卷保存新 18 数据，不让新引擎直接打开原 17 文件。

首次启动 18 卷会创建空数据库。看到空库不表示旧 17 卷已经删除，不要删除旧卷或继续在两个库中分别录入数据。

## 从已有 17 升级到 18

更改镜像标签、改文件夹名字或移动数据目录，都不能替代数据库大版本升级。推荐采用逻辑备份和恢复：

1. 使用 17 兼容配置继续运行旧库，记录项目、已付、待付和备忘数量。
2. 停止应用写入，在旧库执行 pg_dump，保存完整备份；备份脚本命令为 `sh scripts/backup-postgres.sh .env.docker 17`。
3. 停止旧数据库容器，保留旧卷。启动默认 18 数据库服务，使用新的 18 卷。
4. 在应用首次连接 18 之前，把备份恢复进新 18 数据库；使用 18 的 pg_restore 客户端。
5. 启动应用，重新登录，核对金额、关联、成员和软删除，再开放正常使用。

可用以下命令只启动 18 数据库，暂不启动应用：

```bash
docker compose --env-file .env.docker \
  -f compose.yaml -f compose.image.yaml -f compose.postgres.yaml \
  up -d --wait db
```

若 18 已经有应用初始化的表，不直接向其中恢复整库备份。应新建空数据库恢复，或者使用 [存储迁移工具](storage-migration.md) 迁移到全新目标。该工具支持 PostgreSQL URL 与 PG 环境变量，但不合并非空数据库；账号和业务数据保留，现有登录会话需重新建立。

回退时停止新环境并切回 17 配置和旧卷。新环境已有新增记录后，先保全并处理增量，不能直接丢弃。具体备份、恢复步骤见 [运维手册](operations.md)。

## 备份与验证

默认 18 备份：

```bash
sh scripts/backup-postgres.sh .env.docker
```

17 兼容部署备份：

```bash
sh scripts/backup-postgres.sh .env.docker 17
```

脚本在实际数据库容器中调用对应版本的 pg_dump。自行使用宿主机工具时，18 服务应配套使用 18 客户端，不能用 17 的 pg_dump 备份 18 服务。

CI 分别连接 18 和 17 执行 API、金额、权限与迁移测试，并检查服务真实主版本。另有手动工作流 `verify-image.yml`，用已发布的 0.9.5 镜像测试对应 PostgreSQL 版本，验证数据库容器重建后的持久化、记账接口与备份恢复。
