# 运维手册

版本：0.9.16。运行命令应始终使用同一份 `.env` 和同一组 Compose 配置，避免误启用另一种存储模式。

## 查看运行状态

以下例子为内置模式；外置 PostgreSQL 时追加 `-f compose.external.yaml`：

```bash
docker compose ps
docker compose logs --tail 100 app
curl --fail http://127.0.0.1:8080/api/v1/health
```

健康检查确认 API 与数据库查询均可用，并显示版本 0.9.16。它不代表服务器反代或全部浏览器交互已经验证。

日志默认每个文件 10 MB、最多 3 个，不记录普通请求 URL 或 Cookie。向别人提供日志前检查数据库地址等环境信息，不复制 `.env`。

## 内置模式备份

先停止应用，确保 PGlite 正常关闭，再备份完整数据卷：

```bash
docker compose stop app
mkdir -p backups
chmod 700 backups
docker run --rm \
  -v zhu-jia-web_app_data:/source:ro \
  -v "$(pwd)/backups:/backup" \
  alpine:3.22 tar -C /source -czf /backup/embedded-0.9.16.tar.gz .
docker compose start app
```

每次备份使用新的文件名，避免覆盖唯一副本。目录挂载模式备份对应宿主机 DATA_DIR，仍先停止应用。不能将运行中的部分数据库文件复制为可靠备份。

恢复时先解压到一个新的空卷或空目录，保持 UID/GID 1000 可写，使用隔离应用实例核对账号、项目、金额和备忘，再切换正式挂载。不要把归档直接解压覆盖运行中的目录。

## 外置 PostgreSQL 备份

脚本从 `.env` 读取 `DATABASE_URL`，用容器内的 `pg_dump` 导出：

```bash
sh scripts/backup-postgres.sh .env
```

默认客户端镜像为 `postgres:18-alpine`，可以备份 18 和 17 服务；需要匹配 17 客户端时设置 `PG_CLIENT_IMAGE=postgres:17-alpine`。输出为自定义格式，权限仅限当前用户，失败时移除不完整文件。

外部数据库也可以直接使用云平台快照。备份应包含用户、家庭、账目与密码哈希；只备份应用镜像不能代替数据库备份。

恢复演练应使用新数据库：

```bash
# 使用已配置的 DATABASE_URL 或 PG* 环境。
createdb zhu_jia_restore_check
pg_restore --no-owner --no-privileges --dbname=zhu_jia_restore_check backups/替换为备份文件.dump
```

确认记录和统计后，再制定正式恢复窗口。覆盖现有数据库会替换写入后的数据，先保全当前数据，并停止相关应用写入。

## 升级与回滚

1. 保存当前镜像标签、配置和数据库备份。
2. 获取新版本源码或镜像，阅读 CHANGELOG 和 schema 变更说明。
3. 使用原存储配置执行 `up -d --build --wait`；不要加 `-v` 删除卷。
4. 检查健康接口版本，登录后检查家庭、项目、已付/待付、材料和备忘。
5. 只有完成真实业务检查后，才结束升级窗口。

仅应用代码变更且 schema 兼容时，可以切回旧镜像。涉及结构或数据迁移时，回滚必须匹配数据库版本，并处理新版本产生的增量，不能直接用旧备份覆盖。

切换存储模式不是普通升级：新的数据库可能为空，按 [存储迁移](storage-migration.md) 操作。

## 常见问题

| 现象                       | 检查方向                                                                   |
| -------------------------- | -------------------------------------------------------------------------- |
| 注册成功但浏览器一直未登录 | APP_ORIGIN 是否与浏览器的协议、主机及端口一致；是否已经重建应用容器        |
| API 返回来源无效           | 协议、域名、端口或结尾斜线是否与 APP_ORIGIN 不一致                         |
| 内置模式重建后看到空库     | 是否换了 Compose 项目名、卷名或 DATA_DIR；不要马上创建同名数据覆盖判断依据 |
| 内置数据库无法启动         | 是否有另一个进程同时打开同一目录；文件权限是否允许 UID 1000 写入           |
| 外置数据库连接失败         | DATABASE_URL 是否误填容器内 localhost、账号授权、网络或 TLS 是否匹配       |
| 生成邀请正常但朋友打不开   | 分享地址是否为朋友可访问的域名；localhost 只对当前设备有效                 |
| 忘记密码                   | 当前版本不提供邮件找回，由部署管理员处理；开发环境可直接使用重置链接       |
| 家人修改后暂时没变化       | 活动页面约 30 秒刷新，也可重新聚焦窗口或手动刷新                           |

建议备份至少保留一份服务器之外的副本，定期恢复演练；具体频率与保留期由实际使用者确定。当前版本没有自动备份调度和监控告警服务。
