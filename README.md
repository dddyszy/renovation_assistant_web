# 筑家手记 Web

当前版本：**0.9.9** · [文档导航](docs/README.md) · [更新记录](CHANGELOG.md) · [版本路线图](docs/roadmap.md)

面向家庭协作的装修管理应用，使用 Vue 3 + TypeScript + Vite，支持电脑和手机浏览器。沿用原微信小程序的暖色家居风格，以独立账号、家庭与共享项目替代微信个人身份。

## 本地运行

推荐 Node.js 24 LTS，最低 22.13；可使用 `nvm use` 读取仓库版本。开发约定见 [开发与协作规范](CONTRIBUTING.md)。

```bash
npm ci
npm run dev
```

浏览器打开 [http://localhost:5173](http://localhost:5173)。前端端口 5173，API 端口 3001。默认使用 PGlite 嵌入式 PostgreSQL，数据持久化在 `.data/postgres`，无需安装数据库服务。

### 注册和邮件

注册只需邮箱、昵称和至少 10 位密码，不需要邮箱验证码。生产模式必须设置浏览器入口 `APP_ORIGIN`；当前版本不提供邮件找回密码。

### 演示账号

开发服务器启动后可生成虚构演示数据：`npm run demo`。账号为 `demo@example.test`，密码为 `ZhuJiaDemo!2026`。演示数据不自动写入生产数据库。

## Docker 部署

默认使用内置数据库，数据保存在 Docker 命名卷：

```bash
cp .env.example .env
# 编辑 .env 中的 APP_ORIGIN；本机直接访问可保留 http://localhost:8080。
docker compose up -d --build --wait
curl --fail http://127.0.0.1:8080/api/v1/health
```

健康接口应返回 `status=ok` 和 `version=0.9.9`。应用同时提供页面和 API，服务器现有 Nginx 可转发到 `127.0.0.1:8080`。本机验证只监听回环地址，不应把它当作局域网或公网入口。

其他场景按需增加一个配置文件：

```bash
# 外置 PostgreSQL（18 推荐，兼容 17）：先在 .env 设置 DATABASE_URL。
docker compose -f compose.yaml -f compose.external.yaml up -d --build --wait

# 使用已发布的 GHCR 镜像，不在服务器构建。
docker compose -f compose.yaml -f compose.image.yaml up -d --no-build --wait
```

外置 PostgreSQL、宿主机目录挂载和参数细节见部署文档。不要使用 `down -v` 做正常升级，它会删除数据卷。

- [Docker 部署](docs/docker.md) · [PostgreSQL](docs/postgresql.md)
- [容器镜像仓库](docs/container-registry.md) · [配置参考](docs/configuration.md) · [运维手册](docs/operations.md)

## 功能概览

- 邮箱注册登录、多家庭与角色权限、邀请和所有权转让。
- 多装修项目、流程模板、预算工期、材料计划和九阶段管理。
- 记账、材料付款、组合筛选、分页和项目/阶段/分类统计。
- 备忘专栏、描述、重点、确认状态，以及 Web 与小程序 JSON 导入导出。
- 软删除恢复、版本冲突保护、支出幂等、家庭操作记录。
- 响应式布局、PWA、预压缩静态资源和 Docker 多存储部署。

## 检查与构建

```bash
npm run check      # lint、格式、类型、构建和测试
npm run lint:fix   # 自动修复 lint 问题
npm run typecheck  # TypeScript 检查
npm test           # 单元与 API 集成测试
npm run build      # 生成生产前端
```

目录：`src/` 为 Vue 前端，`server/` 为 Fastify 服务，`shared/` 为共享类型和规则，`scripts/` 为构建、迁移和容器验收脚本，`docs/` 为文档，`compose*.yaml` 为可选部署组合。

## 当前边界

- 旧微信云数据尚未导入，规划见 [版本路线图](docs/roadmap.md)。
- 文件附件、账号注销、WebSocket 实时同步和逐字段变更历史尚未实现。
- 真实域名、证书、数据库备份仍需各自环境验收；自动测试不能替代上线验收。
- 初始 schema 可重复初始化，后续结构变更需要正式版本化迁移。

- [产品与技术设计](docs/design.md) · [开发与验收](docs/development.md) · [完整文档目录](docs/README.md)
