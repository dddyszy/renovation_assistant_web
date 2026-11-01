# 内置与外置存储迁移

适用版本：0.9.9。`scripts/migrate-storage.ts` 用于本 Web 应用的 PGlite 与 PostgreSQL 之间复制账号和业务数据，可以双向迁移。它不处理原微信云开发集合，微信身份映射另见设计与路线图。

## 工具边界

- 源与目标使用同一版本 schema，目标必须为全新数据库。
- 默认只预检和展示表数量；加 `--apply` 才复制业务记录。预检会初始化目标空表结构。
- 执行前停止源、目标应用写入；PGlite 目录必须关闭其他使用进程。
- 所有目标写入在一个事务内完成，失败回滚；源使用一致性只读快照。
- 保留原 ID、账号密码哈希、家庭成员、邀请、偏好、审计、时间、软删除及金额；核对表数量与项目/阶段预算、材料计划、支出金额合计。
- 不复制现有登录会话和密码重置令牌，迁移后需重新登录。
- 不合并两个已使用数据库，不覆盖目标现有记录，也不删除源数据。

同名的两个项目可能属于不同家庭，不能按名称合并。迁移工具只按原记录 ID 和外键复制关系。

## 本机执行示例

先备份源数据库，停止开发 API。准备空的目标数据库和权限，然后在环境中设置：

```dotenv
SOURCE_DATABASE=/绝对路径/renovation_assistant_web/.data/postgres
TARGET_DATABASE=postgres:env
PGHOST=your-db.example.internal
PGPORT=5432
PGDATABASE=zhu_jia_new
PGUSER=zhu_jia
PGPASSWORD=目标数据库密码
PGSSLMODE=verify-full
```

变量可以放到本机 `.env` 中，或由进程环境注入。`SOURCE_DATABASE` 和 `TARGET_DATABASE` 也接受完整 PostgreSQL URL；URL 中的账号密码必须按 URL 规则编码，使用 PG 环境变量可以避免特殊字符拼接问题。

```bash
npm run migrate:storage
npm run migrate:storage -- --apply
```

从外部 PostgreSQL 迁回内置时，源使用 PostgreSQL URL，目标使用一个新的 PGlite 目录。不能把 PostgreSQL 的物理数据文件复制到 PGlite 目录。

## Docker 内执行示例

对于内置命名卷，先停应用：

```bash
docker compose stop app
```

新建只留在本机的 `.env.migrate`：

```dotenv
SOURCE_DATABASE=/app/data/postgres
TARGET_DATABASE=postgres:env
PGHOST=your-db.example.internal
PGPORT=5432
PGDATABASE=zhu_jia_new
PGUSER=zhu_jia
PGPASSWORD=目标数据库密码
PGSSLMODE=verify-full
```

执行预检与迁移：

```bash
docker run --rm --env-file .env.migrate \
  -v zhu-jia-web_app_data:/app/data \
  zhu-jia-web:0.9.9 node --import tsx scripts/migrate-storage.ts

docker run --rm --env-file .env.migrate \
  -v zhu-jia-web_app_data:/app/data \
  zhu-jia-web:0.9.9 node --import tsx scripts/migrate-storage.ts --apply
```

目标在宿主机时，给临时迁移容器加 `--add-host host.docker.internal:host-gateway`，PGHOST 填 `host.docker.internal`，不要填容器自身的 localhost。目标是远程数据库时直接填其域名。

迁移容器需要源数据卷的写入权限，供数据库引擎打开与正常关闭文件；业务查询仍在只读事务中。不要在迁移运行时重启原应用。

## 验证与切换

1. 保存预检和迁移结果，确认没有非空目标或金额不一致错误。
2. 使用外置配置启动应用，访问 `/api/v1/health` 并重新登录。
3. 对比家庭、项目、成员数量以及已付/待付、材料计划、阶段预算。
4. 检查软删除恢复和备忘多条描述，再开放正常写入。
5. 保留原存储备份直到确认迁移稳定；之后按既定保留期处理。

目标尚未新增数据时可以停止目标应用并恢复源。目标已经产生新记录后，回退必须保全并处理这些增量，不能直接指回源数据库让用户继续在两个库中分别写入。
