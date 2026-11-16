# 测试与质量保障

适用版本：0.9.16。本文说明现有自动化验证能证明什么，以及哪些风险仍需环境验收。

## 检查入口

```bash
npm run check
```

它依次执行 ESLint、Prettier、TypeScript 类型检查、Vite 生产构建和测试。任何一步失败都不应提交或发布。

```bash
npm test                 # 全部自动测试
npm run typecheck        # 仅类型检查
npm run lint             # 仅静态检查
npm run format:check     # 仅格式检查
```

## 覆盖率

使用 Node 内置覆盖率能力，不引入额外依赖：

```bash
node --import tsx --test --experimental-test-coverage tests/*.test.ts
```

本次 0.9.16 审查实测 50 项测试全部通过，Node 可统计代码的行覆盖率约 **96.96%**、分支约 **88.73%**、函数约 **97.15%**。该统计覆盖被测试进程加载的 TypeScript，不包含未加载的 Vue SFC 界面行为。

覆盖率用于发现未执行的分支，不代表这些分支的行为都正确。重点阅读失败路径、权限边界和事务回滚，而不是只追求总行数。

## 测试分层

| 层次        | 代表文件                                                          | 主要覆盖                                       |
| ----------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| 纯函数      | `domain.test.ts`、`notes-transfer.test.ts`、`linkify.test.ts`     | 金额、模板、导入导出协议、网址识别             |
| 路由与配置  | `origin.test.ts`、`public-paths.test.ts`、`app-config.test.ts`    | 浏览器来源、公开路径、生产/开发配置            |
| API 集成    | `api.test.ts`、`notes-columns.test.ts`、`stages-projects.test.ts` | 会话、家庭权限、版本冲突、删除恢复、金额与分页 |
| 分享        | `shared-note.test.ts`                                             | 免登录只读、撤销、过期、删除和成员权限         |
| 存储        | `db.test.ts`、`migration.test.ts`                                 | PGlite 重开持久化、预检、事务迁移与金额核对    |
| HTTP 客户端 | `http-client.test.ts`                                             | Cookie、请求头、错误和业务上下文恢复           |

API 测试通过 Fastify `inject` 调用真实路由和数据库，但不监听网络端口，也不经过真实浏览器。

## 测试数据隔离

- 未设置 `TEST_DATABASE_URL` 时使用内存 PGlite，不读取 `.data/postgres`。
- `TEST_DATABASE_URL` 只能指向专用、可丢弃的测试库。
- 迁移测试另外使用 `TEST_MIGRATION_TARGET_DATABASE`，不能是正式库或源库。
- Docker HTTP 验收必须显式设置 `SMOKE_ALLOW_WRITE=yes`，并只允许访问本机地址；脚本创建临时账号、家庭和项目，完成后清理。
- 测试账号、令牌和虚构数据不得进入生产数据库或提交截图。

## CI 矩阵

`.github/workflows/ci.yml` 包含：

| 任务                            | 验证                                                     |
| ------------------------------- | -------------------------------------------------------- |
| `quality (18)` / `quality (17)` | 检查、构建、测试，以及 PostgreSQL 18/17 的集成与迁移测试 |
| `docker (embedded, 18)`         | 内置 PGlite 容器、镜像默认值、Nginx 反代和 HTTP 验收     |
| `docker (external, 18)`         | 连接真实 PostgreSQL 18，确认主版本并完成 HTTP 验收       |
| `docker (external, 17)`         | 连接真实 PostgreSQL 17，确认主版本并完成 HTTP 验收       |

发布流程另行构建 AMD64/ARM64 镜像，拉取候选镜像重复容器验收，全部通过后才发布版本标签。

## 当前未覆盖

1. **真实浏览器 E2E**：Vue 渲染、弹窗交互、回车行为、复制链接、登录态切换没有自动化浏览器测试。
2. **分享页完整链路**：现有测试覆盖公开 API 和路径分类；完整浏览器启动时序曾用无头浏览器人工验证，尚未纳入 CI。
3. **视觉回归**：手机端对齐、下拉框、长文本和系统键盘依赖目标浏览器/真机验收。
4. **PWA 更新与离线行为**：Service Worker 激活、缓存替换和断网导航未做自动浏览器测试。
5. **故障注入**：数据库断连、磁盘不足、备份恢复、超时与容器终止需要专项测试。
6. **真实外部服务**：TLS 证书、域名、云平台网络和线上恢复演练以实际部署环境为准。

新增公开路由时，至少覆盖未登录访问、已登录访问、失效条件和返回字段；新增数据库行为时，至少覆盖事务失败、旧数据兼容和目标为空库。
