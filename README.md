# 筑家手记 Web

当前版本：**0.9.6** · [文档导航](docs/README.md) · [更新记录](CHANGELOG.md) · [版本路线图](docs/roadmap.md)

面向家庭协作的装修管理应用，使用 Vue 3 + TypeScript + Vite，支持电脑和手机浏览器。沿用原微信小程序的暖色家居风格，以独立账号、家庭与共享项目替代微信个人身份。

## 本地运行

推荐 Node.js 24 LTS，最低 22.13；可使用 `nvm use` 读取仓库版本。开发约定见 [开发与协作规范](CONTRIBUTING.md)。

```bash
npm ci
npm run dev
```

浏览器打开 [http://localhost:5173](http://localhost:5173)。前端端口 5173，API 端口 3001。手机与电脑在同一网络时，可以访问启动日志中的 Network 地址；手机浏览器的剪贴板、PWA 安装能力取决于浏览器环境，不影响普通网页使用。

默认使用 PGlite 嵌入式 PostgreSQL，真实数据持久化在 `.data/postgres`，重启后保留。无需先安装数据库服务。开发版只允许一个 API 进程访问该目录，不要同时启动多个开发服务。测试使用独立内存数据库，不操作开发或小程序数据。

### 注册和邮件

注册只需填写邮箱、昵称和密码，不需要邮箱验证码或邮件服务。密码最少 10 位，注册成功后自动登录；相同邮箱不能重复注册。

邮件服务仅用于忘记密码时的找回流程，可按 `.env.example` 和 [部署说明](docs/development.md) 配置。生产模式需要显式设置浏览器入口 `APP_ORIGIN`；未配置邮件时仍可注册登录，但邮件找回暂不可用。开发环境保留本地重置链接以便测试。

### 演示账号

开发服务器启动后，可显式生成虚构演示数据：

```bash
npm run demo
```

- 邮箱：`demo@example.test`
- 密码：`ZhuJiaDemo!2026`
- 包含装修项目、九个阶段、材料、定金/尾款和备忘。
- 演示脚本不在启动时自动运行；重复执行保留已有家庭，不覆盖编辑结果。
- 示例账号仅用于本地体验，不应带到生产数据库。

## Docker 部署与存储

0.9.6 开发版请先从源码构建；新镜像以发布工作流成功为准。GHCR 发布与拉取说明见 [容器镜像仓库](docs/container-registry.md)。

支持内置数据库和外置 PostgreSQL，也提供同 Compose 启动 PostgreSQL 的配置。Docker Compose 需要 2.24.4 及以上。

完整 PostgreSQL 部署以 **18 为默认，兼容 17**，推荐配合默认数据库配置使用；详见 [PostgreSQL 部署与升级](docs/postgresql.md)。

```bash
cp .env.docker.example .env.docker
# 编辑 APP_ORIGIN，填写浏览器实际访问的来源，例如 http://home.example.com。

# 内置数据库，数据保存在 Docker 卷中。
docker compose --env-file .env.docker -f compose.yaml up -d --build --wait

# 或连接已有 PostgreSQL，先填写 POSTGRES_*。
docker compose --env-file .env.docker -f compose.yaml -f compose.external.yaml up -d --build --wait

# 或由 Compose 一起运行独立 PostgreSQL 18 容器（默认版本）。
docker compose --env-file .env.docker -f compose.yaml -f compose.postgres.yaml up -d --build --wait

# 兼容已有 PostgreSQL 17；继续使用原 17 数据卷。
docker compose --env-file .env.docker -f compose.yaml -f compose.postgres17.yaml up -d --build --wait
```

三种存储模式选择其一。Docker 应用只提供 HTTP，服务器现有反代转发到 `127.0.0.1:8080` 即可，完整 Nginx 示例见 [Docker 部署](docs/docker.md#启动应用与服务器反代)。

内置模式可以叠加 `compose.bind.yaml` 将数据放到宿主机指定目录；容器重建不删除持久化数据。切换数据库不会自动搬迁记录，使用带预检和核对的存储迁移工具。

- [Docker 部署详解](docs/docker.md)
- [Docker 部署参数怎么填](docs/docker-parameters.md)
- [直接拉取 GitHub 容器镜像](docs/container-registry.md)
- [配置参考](docs/configuration.md)
- [存储迁移](docs/storage-migration.md)
- [备份、升级与故障处理](docs/operations.md)

## 0.9.6 备忘导入导出

Web 和小程序均可在备忘页使用“导入 / 导出”。支持整个项目或当前专栏 JSON 导出，文件导入先预览，再按专栏合并、追加并跳过重复内容；标题、描述、重点、状态和空专栏跨端保留。操作步骤与共用格式见 [备忘文件交换](docs/notes-transfer.md)。

## 已实现

- 邮箱密码直接注册、密码登录、退出、昵称修改、邮件重置密码、服务端可撤销会话。
- 多家庭创建与切换，四级角色，单次邀请、撤销、失效、成员管理、退出、所有权转让、受密码保护的家庭解散。
- 多装修项目，半包/全包及四种模板，预算与工期、归档/恢复、受确认保护的永久删除。
- 阶段设置、预算、状态、排序；允许多个阶段同时进行。
- 材料计划、数量、型号、供应商、采购状态；关联支出的定金与尾款分开记录。
- 记账、分类、支付状态、日期、商家和支付方式；本地草稿、复制上一笔与连续记录。
- 账本关键词/阶段/状态/分类/日期组合筛选、分页与全集汇总。
- 备忘专栏与需求项、重点、确认状态、移动专栏、多行描述、粘贴导入及预览。
- 项目、阶段、材料及费用分类统计；明确区分已付、待付与已记总成本。
- 软删除、撤销与材料/支出/备忘最近删除恢复，版本冲突保护、支出幂等、家庭操作记录。
- 个人当前家庭和项目保存到服务器，支持包含家庭和项目上下文的链接。
- 响应式布局、手机底部导航、PWA manifest 和仅缓存静态外壳的 Service Worker。
- Docker 多阶段镜像、内置/外置存储配置、服务器反代示例、数据库就绪检查、逻辑迁移和备份脚本。

图表目前用轻量 CSS/SVG 和可读金额明细实现，未引入 ECharts。页面按路由拆分，业务数据通过 Vue Query 管理缓存；数据库统计覆盖全部匹配记录，不依赖列表首屏。

## 检查与构建

```bash
npm run check      # lint、格式、类型、构建和测试的统一入口
npm run lint:fix   # 自动修复可处理的代码问题
npm run format     # 统一格式
npm run typecheck  # 仅检查类型
npm test           # HTTP 客户端、领域规则、API、数据库和迁移
npm run build      # 生产构建，生成 dist
```

集成测试覆盖家庭隔离、只读权限、邀请、成员移除、所有权转让、密码重置、跨项目关联拒绝、金额聚合、分页、并发重复提交、版本冲突、软删除恢复、项目归档与永久清理。

## 目录

```text
src/                  Vue 前端，分为 router/services/stores/composables/views/components/styles
server/               Fastify 装配入口、业务路由、权限上下文、公共辅助函数与数据库适配
shared/               API 类型、金额、流程模板、角色和备忘导入规则
public/               PWA 图标、manifest、Service Worker
scripts/demo.ts       显式生成本地演示数据
scripts/              存储迁移、备份、压缩与容器 HTTP 验收
tests/                领域规则和 API 集成测试
docs/                 设计与运行部署说明
deploy/               宿主机 Nginx 反代示例
compose*.yaml         内置/外置数据库、目录挂载组合
```

## 当前边界

- 旧小程序云端数据尚未导入，迁移方案见设计文档；没有修改原项目或连接其数据库进行写入。
- 手机端为响应式网页/PWA，尚未进行 iOS/Android 真机全机型验收。
- 已完成 PostgreSQL 18 / 17 CI 和 Docker 验证；真实 SMTP、域名证书和目标服务器仍需环境验收，详见开发与验收说明。
- 头像当前使用昵称首字，文件上传、账号注销和外部施工方权限尚未实现。
- 断网保留本地记账草稿；不支持离线写入同步。操作动态保留动作、对象与操作者，尚未提供逐字段修改前后对比。
- 初始 schema 可重复初始化；后续数据结构升级应增加有版本号的迁移脚本，不能直接依赖修改 `CREATE TABLE IF NOT EXISTS`。

原小程序位于 `/Users/zhouyi.shi/WeChatProjects/renovation_assistant`；本项目位于 `/Users/zhouyi.shi/projects/renovation_assistant_web`。

- [产品与技术设计](docs/design.md)
- [运行部署与验收说明](docs/development.md)
- [完整文档目录](docs/README.md)
- [0.9.6 至 1.0 版本规划](docs/roadmap.md)
