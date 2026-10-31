# 发布流程

当前版本：0.9.5。发布版本只在当前交付和验证范围内作承诺，未来工作放入 roadmap。

## 版本来源

package.json 是应用版本来源，package-lock.json 根版本须同步。`shared/version.ts` 供前后端读取，构建阶段把版本写入 Service Worker 缓存名。

发布时还需更新 compose.yaml 默认 APP_IMAGE_TAG、Dockerfile 默认 APP_VERSION、`.env.docker.example` 和 CHANGELOG 中的版本。镜像标签是部署元数据，不能仅改镜像名就把旧源码称为新版本。

## 发布前

```bash
npm ci
npm run check
```

分别使用专用 PostgreSQL 18、17 测试库运行集成测试，环境变量 `TEST_DATABASE_URL` 指向该测试库。不可指向生产数据库。

Docker 环境运行内置、外置配置验证，并构建对应架构镜像。源仓库已上传到 GitHub，普通 CI 负责校验；`publish-image.yml` 负责将通过验证的 AMD64/ARM64 镜像发布到 GHCR，见 [容器镜像仓库](container-registry.md)。

新增 schema 变更必须包括旧数据升级和回滚方案。0.9.5 仍使用初始 schema，后续版本优先引入正式迁移框架。

## 发布验收

核对健康接口与“我的账号”中的版本相同；验证注册、家庭加入、权限、创建项目、记账、备忘、统计、软删除恢复。Docker 部署另外验证容器重建后数据保留、数据库故障的健康状态与备份恢复。

对内置和外置分别记录通过/失败/未验证，SMTP、服务器反代和真机单独记录。线上发布不带演示数据库，不使用默认测试账号。

## 发布后

保留旧镜像与数据库备份。应用启动成功后继续核对金额和家庭权限，不因健康接口为 200 就立即删除备份。出现回滚需求时按 operations 文档处理代码、schema 与新增数据的一致性。
