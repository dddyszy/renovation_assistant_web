# 开发与协作规范

推荐 Node.js 24 LTS，最低版本为 22.13；仓库的 `.nvmrc`、CI 和 Docker 均以 24 为开发基线。使用 npm 和已提交的 `package-lock.json`，首次安装或 CI 执行 `npm ci`。

## 日常开发

```bash
nvm use                 # 安装 nvm 的开发者可选
npm ci
npm run dev
```

前端运行在 5173，API 运行在 3001。本地默认数据库位于 `.data/postgres`；测试使用隔离数据库。不得删除或提交开发数据库来解决代码问题，也不要把正式账号、Cookie、令牌或真实家庭数据加入测试。

| 命令                   | 用途                                             |
| ---------------------- | ------------------------------------------------ |
| `npm run lint`         | 检查 TypeScript、Vue、JavaScript；不允许警告     |
| `npm run lint:fix`     | 修复可以自动处理的代码问题                       |
| `npm run format`       | 按 Prettier 配置格式化源码、样式和文档           |
| `npm run format:check` | 只检查格式，不修改文件                           |
| `npm run typecheck`    | 独立检查前端、服务端、共享代码、脚本和测试的类型 |
| `npm test`             | HTTP 客户端、领域、数据库、API 和迁移测试        |
| `npm run build`        | 类型检查、Vite 生产构建和静态资源压缩            |
| `npm run check`        | 提交前的统一检查：lint、格式、构建和测试         |

CI 与 Docker 构建执行 `npm run check`。CI 另外在 PostgreSQL 18、17 上运行集成测试，并验收三种容器存储模式。格式和 lint 不在普通开发启动时自动改文件。

## 代码放在哪里

```text
src/
  router/             路由定义与页面懒加载
  services/           浏览器 HTTP 请求与错误处理
  stores/             Pinia 会话、家庭和项目上下文
  composables/        Vue Query 等可复用组合式逻辑
  components/         共用界面组件
  views/              路由页面
  styles/             基础、布局、业务和响应式样式
server/
  app.ts              装配 Fastify 插件、上下文和路由，不承载业务处理
  context.ts          会话、家庭/项目权限和写事务守卫
  routes/             按业务分组的接口与请求校验
  services/           邮件、项目数据清理等服务端操作
  lib/                错误、响应、资源关联和 SQL 写入辅助函数
  plugins/            通用请求安全检查、响应头和错误映射
  schemas.ts          Zod 字段约束与业务输入结构
  db.ts               PGlite / PostgreSQL 驱动适配与结果规范化
  schema.sql          初始建表脚本
shared/               纯业务函数、API JSON 类型和版本号
tests/                隔离测试，不访问开发或正式数据库
```

前端不能导入服务端或运维脚本；服务端不能导入 Vue 界面；`shared` 不依赖其中任何一层。这些边界由 ESLint 检查。路由注册函数通过 `RequestContext` 获取数据库和守卫，保持显式依赖；注册时使用同一个 Fastify 实例，避免插件封装改变已有权限和错误处理范围。

## 风格和类型

- 使用 UTF-8、LF、两个空格、双引号和分号；具体格式交给 `.editorconfig` 与 Prettier，避免手工对齐。
- Vue 组件使用 PascalCase 文件名与 `<script setup lang="ts">`；组合函数使用 `use` 前缀；变量和函数使用 camelCase，类型使用 PascalCase。
- 前端相对导入省略扩展名；Node 中运行的 TypeScript 相对导入显式写 `.ts`。类型依赖使用 `import type` 或内联 `type`。
- HTTP 读取明确指定响应类型，项目公共查询通过 `ProjectResources` 映射推导。接口字段统一 camelCase，SQL 字段使用 snake_case，在数据库适配层转换。
- 外部输入先经 Zod 校验；`catch` 使用 unknown，通过 `errorMessage` 或明确的类型收窄处理。不得通过 `@ts-ignore` 或全局关闭 lint 来绕过检查。
- 当前仅原始 SQL 的 `Row` 和跨业务弹窗的动态草稿保留有说明的局部 `any`。新增普通页面、接口与领域对象使用明确类型。`Db.query<T>` 是对 SQL 结果的类型声明，不能代替运行时校验。
- 注释说明事务、权限或数据约束的原因；不逐行重复代码含义。不为简单函数增加无用的类、接口或通用框架。

`src/styles/index.css` 的导入顺序是样式层叠的一部分；响应式规则最后加载。移动规则时需要确认电脑和手机页面，不能只依据文件名重排选择器。

## 新增接口的检查点

1. 在对应的 `server/routes` 模块添加路由，复用 `schemas.ts` 约束；相关响应类型放在 `shared/api.ts`。
2. 根据资源范围使用 `auth`、`family` 或 `project` 守卫；写入调用 `allow`，多步业务和受权限保护的写入使用 `writeTransaction`，保留事务内的权限复查。
3. 金额使用整数分；更新使用版本号；支出创建保留请求 ID 与内容指纹。SQL 值通过参数传递，表名只来自服务端固定常量。
4. 可预期的失败使用 `fail(status, code, message)`；不向客户端返回数据库错误、密码或会话令牌。
5. 修改 API、金额、权限或迁移行为时补充能发现回归的测试；纯排版调整按影响范围检查页面，不堆叠重复实现的测试。

## 数据库与配置

完整 PostgreSQL 部署默认 18，继续兼容 17。测试只允许专用可丢弃的 `TEST_DATABASE_URL`；迁移集成测试另用 `TEST_MIGRATION_TARGET_DATABASE`，不能指向用户数据。迁移工具默认预检并拒绝覆盖非空目标。

新增环境变量时同步 `.env.example` 或 `.env.docker.example`、[配置参考](docs/configuration.md) 和相关部署说明。数据库结构升级必须提供版本化迁移、旧数据验证和恢复方案，修改初始建表语句不会升级已有表。

## 提交和评审

按一个可说明的问题或目标组织提交，建议使用 `feat:`、`fix:`、`refactor:`、`docs:`、`test:`、`chore:` 前缀。结构重构与全量格式化尽量分开提交，便于审阅行为变化。

提交前运行 `npm run check`；PR 说明改动原因、最终行为、验证结果和未覆盖的环境。接口或配置改动同步文档；依赖变动同步锁文件。不要把 `.env`、`.data`、`dist`、截图或备份纳入提交。

0.9.5 已发布的 tag 和镜像保持原样，源代码重构不自动改写它们。新的正式发布按 [发布流程](docs/releasing.md) 更新版本和重新验收。

## 跨端备忘协议

修改 `shared/notes-transfer.ts` 后，用 `scripts/sync-notes-transfer.mjs --target <小程序仓库>` 同步生成实现，并运行 `--check` 验证一致。小程序的客户端、云函数与协议源镜像必须一起提交，不能手工修补生成文件；操作与发布规则见 [备忘文件交换](docs/notes-transfer.md)。
