# API 参考

版本：0.9.5，前缀 `/api/v1`。以下为当前实现摘要，字段约束以 `server/schemas.ts`、`server/routes/` 和 `server/schema.sql` 为准。

## 通用约定

成功为 `{ "data": ... }`，分页响应另有 `meta`。错误为 `{ "error": { "code": "...", "message": "..." } }`，不返回内部堆栈。

浏览器使用同源 Cookie 会话。所有写请求发送 `Origin: <APP_ORIGIN>` 和 `X-Requested-With: zhu-jia-web`；有 JSON 请求体时再发送 `Content-Type: application/json`，无请求体的退出请求不添加空 JSON 内容类型。

| 状态 | 含义                                                   |
| ---- | ------------------------------------------------------ |
| 401  | 未登录、会话失效或登录凭据错误                         |
| 403  | 角色不足、请求来源无效或权限已变化                     |
| 404  | 资源不可访问、不存在或邀请无效                         |
| 409  | 版本冲突、幂等冲突、重复邮箱、项目已归档或资源不可删除 |
| 422  | 字段格式、金额、关联或确认信息不正确                   |
| 429  | 请求过于频繁                                           |
| 503  | 生产环境未配置邮件找回服务                             |

## 账号

| 方法与路径                  | 请求或返回                                                       |
| --------------------------- | ---------------------------------------------------------------- |
| GET `/health`               | 查询数据库，返回 status、version、localMail                      |
| POST `/auth/register`       | `{email,password,nickname}`；不需要验证码，返回 registered       |
| POST `/auth/login`          | `{email,password}`；设置 session Cookie，返回用户基础资料        |
| POST `/auth/logout`         | 无请求体；撤销当前会话并清 Cookie                                |
| POST `/auth/reset/request`  | `{email}`；邮件找回。开发未配置邮件时可返回 devToken，生产不返回 |
| POST `/auth/reset/complete` | `{token,password}`；一次性使用，撤销该账号全部会话               |
| GET / PATCH `/me`           | 查询个人资料或用 `{nickname}` 修改称呼                           |
| POST `/me/preferences`      | `{familyId,projectId}`；项目可为 null，需有访问权                |

注册 API 创建账号，前端随后调用登录 API 实现注册后自动进入。重复邮箱返回 `EMAIL_EXISTS`；邮箱按小写去重，密码 10–128 位。

## 家庭和协作

| 方法与路径                               | 功能                                   |
| ---------------------------------------- | -------------------------------------- |
| GET / POST `/families`                   | 查看我的家庭 / `{name}` 创建家庭       |
| PATCH `/families/:fid`                   | 所有者用 `{name}` 改名                 |
| GET `/families/:fid/members`             | 有效成员列表                           |
| PATCH `/families/:fid/members/:uid`      | `{role}` 调整角色，不能越级管理        |
| DELETE `/families/:fid/members/:uid`     | 移除成员，历史记录保留                 |
| POST `/families/:fid/leave`              | 非所有者主动退出                       |
| POST `/families/:fid/transfer-ownership` | `{userId}` 转让，原所有者转为管理员    |
| GET / POST `/families/:fid/invitations`  | 查看邀请 / `{role}` 生成单次链接       |
| DELETE `/families/:fid/invitations/:iid` | 撤销邀请                               |
| GET `/invitations/:token/preview`        | 已登录账号查看家庭名、角色、有效期     |
| POST `/invitations/:token/accept`        | 确认加入，事务内校验有效性与成员唯一性 |
| GET `/families/:fid/audit-logs`          | 最近最多 60 条动态                     |
| DELETE `/families/:fid`                  | 所有者用 `{confirmName,password}` 解散 |

## 项目与业务资源

下文以 `P=/families/:fid/projects/:pid` 表示项目路径。

| 方法与路径                                            | 功能                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| GET / POST `/families/:fid/projects`                  | 项目列表 / 创建项目与默认阶段、专栏                                         |
| GET / PATCH `P`                                       | 查询 / 修改项目，PATCH 携带完整可编辑字段和 version                         |
| POST `P/archive`                                      | `{version,archived}` 归档或恢复                                             |
| DELETE `P`                                            | 已归档项目，所有者提交 `{version,confirmName,password}` 永久删除            |
| GET / POST `P/stages`                                 | 阶段列表 / `{name,budgetCents}` 新增阶段                                    |
| PATCH `P/stages/:id`                                  | version 加 name、budgetCents、status 中要修改的字段                         |
| POST `P/stages/reorder`                               | `{items:[{id,version}]}`，须包含全部有效阶段                                |
| GET / POST `P/materials`                              | 查询 / 创建材料                                                             |
| GET / POST `P/costs`                                  | 查询 / 创建支出；创建必须携带 requestId                                     |
| GET / POST `P/notes`                                  | 查询 / 创建备忘项                                                           |
| PATCH `P/materials/:id`、`P/costs/:id`、`P/notes/:id` | 完整业务字段加 version，不是任意部分字段补丁                                |
| DELETE `P/<resource>/:id`                             | `{version}` 软删除，resource 支持 stages/materials/costs/notes/note-columns |
| POST `P/<resource>/:id/restore`                       | `{version}` 恢复，仍检查家庭、项目与有效关联                                |
| GET / POST `P/note-columns`                           | 专栏列表 / `{name}` 新增                                                    |
| PATCH `P/note-columns/:id`                            | `{name,version}` 改名                                                       |
| POST `P/note-columns/reorder`                         | `{items:[{id,version}]}` 调整全部有效专栏顺序                               |
| POST `P/notes/import`                                 | `{items:[...]}` 批量创建，1–100 项，项目总数不超过 1000                     |
| GET `P/statistics`                                    | 已付/待付/成本、材料计划、预算分配、阶段/材料/分类和近期支出                |

材料字段：name、category、stageId、quantity、unit、model、supplier、note、totalPriceCents、purchaseStatus。

支出字段：title、category、amountCents、stageId、materialId、paymentStatus、merchant、paymentMethod、note、incurredAt。日期为 `YYYY-MM-DD`，支付状态为 `paid|pending`。

备忘字段：title、columnId、details 字符串数组、starred、status（`pending|confirmed`）。

## 分页与筛选

材料、支出、备忘列表使用 `page`、`pageSize`，默认 1 和 30，上限每页 100。响应 `meta.total` 为总条数，支出额外返回 `meta.totalCents`，统计不受当前页限制。

- 通用：keyword、deleted=true。
- 材料：stageId、category、purchaseStatus。
- 支出：stageId、category、paymentStatus、from、to。
- 备忘：columnId、status、starred=true。

幂等重试必须复用原 requestId 和原请求内容。409 版本冲突时先读取最新记录，不能仅把 version 加一后覆盖家人的修改。
