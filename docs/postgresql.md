# 外置 PostgreSQL

应用只负责连接，不安装、不升级数据库。**推荐 PostgreSQL 18，兼容 17**，云数据库和自建实例都可以。

## 准备数据库

创建专用账号和库：

```sql
CREATE ROLE zhu_jia LOGIN PASSWORD '替换为强密码';
CREATE DATABASE zhu_jia OWNER zhu_jia;
```

账号需要能建表、建索引和读写业务数据。应用启动时会自动执行幂等的建表语句。

数据库在宿主机时，需要允许容器访问：

```conf
# postgresql.conf
listen_addresses = '*'
port = 5432

# pg_hba.conf，Docker 默认网段
host all all 172.16.0.0/12 scram-sha-256
```

改完重启 PostgreSQL，并确认防火墙放行。

## 配置并启动

`.env` 只需要一条连接串：

```dotenv
APP_ORIGIN=https://home.example.com
DATABASE_URL=postgresql://zhu_jia:密码@db.example.internal:5432/zhu_jia?sslmode=verify-full
```

```bash
docker compose -f compose.yaml -f compose.external.yaml up -d --build --wait
curl --fail http://127.0.0.1:8080/api/v1/health
```

本机数据库示例：

```dotenv
DATABASE_URL=postgresql://zhu_jia:密码@host.docker.internal:5433/zhu_jia?sslmode=disable
```

密码含 `@`、`:`、`/`、`%`、`#` 时必须 URL 编码，例如 `@` 写成 `%40`。容器里的 `127.0.0.1` 指容器自身，访问宿主机要用 `host.docker.internal`。

## SSL 模式

`pg` 驱动把 `sslmode=prefer` 当作 `verify-full` 处理，不会自动回退。

| 数据库情况           | 写法                  |
| -------------------- | --------------------- |
| 本机或内网未启用 SSL | `sslmode=disable`     |
| 云数据库，证书受信任 | `sslmode=verify-full` |
| 自签证书，只需要加密 | `sslmode=require`     |

容器里若残留 `PGSSLMODE=prefer`，即使连接串没写 `sslmode` 也会尝试 SSL。用下面命令排查：

```bash
docker compose -f compose.yaml -f compose.external.yaml exec app printenv PGSSLMODE
```

## 版本与升级

- 应用不区分 18 或 17，连接串相同；CI 分别用 PostgreSQL 18 和 17 验证接口。
- 大版本升级由数据库侧完成，推荐逻辑备份 + 恢复，不要直接替换数据目录。
- 应用没有内置 schema 迁移框架，升级前先备份；结构变更以 `server/schema.sql` 为准。

## 备份与恢复

`scripts/backup-postgres.sh` 从 `.env` 读取 `DATABASE_URL`，用容器内的 `pg_dump` 导出：

```bash
sh scripts/backup-postgres.sh .env
```

默认客户端镜像 `postgres:18-alpine`，18 的 `pg_dump` 可以备份 17 服务。需要匹配 17 客户端时：

```bash
PG_CLIENT_IMAGE=postgres:17-alpine sh scripts/backup-postgres.sh .env
```

恢复：

```bash
createdb zhu_jia_restore
pg_restore --no-owner --no-privileges --dbname=zhu_jia_restore backups/替换为备份文件.dump
```

先在独立库演练，核对家庭、项目、金额和备忘，再切换正式库。外部数据库也可以直接使用云平台的快照能力。

## 切换存储

内置 PGlite 与外置 PostgreSQL 之间可以用迁移工具复制数据，见 [存储迁移](storage-migration.md)。切换不会自动搬迁，需要显式执行。
