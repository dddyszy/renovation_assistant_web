# 装修备忘文件交换 · 0.9.6

Web 与微信小程序 0.9.6 使用同一套 JSON v1 协议。该功能只交换装修备忘，不迁移账号、家庭成员、账本或微信身份，也不建立实时同步。

## 使用方式

Web：打开项目的“装修备忘 → 导入 / 导出”。选择整个项目或当前专栏，点击“导出 JSON 文件”。导入时选择文件，核对来源项目、专栏及条数，再点击“确认追加导入”。只读成员、归档项目可以导出；导入需要项目可编辑且用户有写权限。

小程序：打开“备忘 → 导入 / 导出”，生成文件后点击“发送导出文件”，将文件发到微信聊天。导入时“从微信聊天选择 JSON 文件”，预览后确认。Web 文件可先发送到微信聊天再导入；小程序文件可从微信下载到电脑或手机后在 Web 选择。文件选择与分享能力需支持相应 API 的微信客户端。

两端导出均包含范围内**全部有效备忘**，不受当前页、重点/确认筛选影响，不包含最近删除内容。保留空专栏、专栏顺序、标题、描述数组、重点与确认状态。

文件交换只覆盖文字内容，**不包含备忘图片**。图片目前仅保存在 Web 数据库中，导出 JSON 或导入小程序时不会携带；需要迁移图片时应使用数据库备份或存储迁移。

## 导入规则

- 导入目标始终是界面当前项目，文件中的项目名称仅用于提示。
- 同名专栏合并；文件中的新专栏按顺序追加，已有专栏不重排。
- 同一专栏内，标题、描述数组、重点和状态全部相同的记录视为重复并跳过。标题相同但描述或状态不同的记录仍会新增。
- 不覆盖、删除或恢复已有备忘。导出文件没有数据库 ID、OpenID、用户 ID、创建人、会话或版本锁字段；导入重新创建本端标识与时间，不继承原作者。
- 字段超限或格式不合法时明确报错，文件导入不静默截断。粘贴文本导入仍保留原有行为。

Web 导入在单个数据库事务中完成；失败不留下半份内容。小程序先做容量预检，再每批最多 50 条运行云端事务，显示进度；失败时已完成的批次保留，当前批次回滚。可以重新选择同一文件导入，已完成内容会自动跳过。若超时后结果未知，重新导入也不会重复写入相同内容。

## 文件结构

文件使用 UTF-8 JSON，可接受 UTF-8 BOM。最多 2 MiB、20 个专栏、1000 条备忘；专栏名最多 30 字、标题 60 字、每条最多 20 条描述、每条描述 1000 字。名称和内容会去除首尾空白，空描述忽略。文件结构版本独立于应用版本，未知 schemaVersion 明确拒绝。

```json
{
  "format": "zhujia.notes",
  "schemaVersion": 1,
  "appVersion": "0.9.6",
  "source": "web",
  "exportedAt": "2026-11-01T00:00:00.000Z",
  "projectName": "我们的新家",
  "columns": [
    {
      "name": "事前确认",
      "items": [
        {
          "title": "厨房插座位置",
          "details": ["洗碗机独立插座", "与橱柜方案一起核对"],
          "starred": true,
          "status": "pending"
        }
      ]
    }
  ]
}
```

source 为 `web` 或 `miniprogram`，status 为 `pending` 或 `confirmed`。未知额外字段不导入。导出过大时明确失败，可缩小为当前专栏导出；不会生成不完整的文件。

## 接口与实现

Web：

- `GET /api/v1/families/:fid/projects/:pid/notes/export`，可选 `columnId`，返回 `{data: NotesArchive}`。
- `POST /api/v1/families/:fid/projects/:pid/notes/import-file`，JSON 请求体直接为 NotesArchive，返回 `{data:{added, skipped, createdColumns}}`。导入权限、来源检查与其他写接口相同。
- 旧 `notes/import` 粘贴批量接口保留，文件接口独立，不改变既有客户端。

小程序 notes 云函数：`exportFile` 接收 projectId 与可选 columnId；`importFile` 接收 projectId 和一批 archive，单批最多 50 条。每批重新检查所有权、容量与重复内容。源文件没有权限效力，不能通过填入其他项目的 ID 绕过检查。

协议的唯一源文件是 Web 的 `shared/notes-transfer.ts`。小程序客户端与 notes 云函数使用生成的 CommonJS 实现；小程序仓库保留 `protocol/notes-transfer.ts` 作为可独立测试的源镜像，避免手工维护两套解析规则：

```bash
node scripts/sync-notes-transfer.mjs --target /path/to/renovation_assistant
node scripts/sync-notes-transfer.mjs --target /path/to/renovation_assistant --check
```

小程序的生成文件不要手工修改。协议修改后重新生成，提交两个仓库，并运行双方 `npm run check`。测试覆盖跨运行时往返、125 条跨页文件、1000 条分批、重复导入、非法文件、权限和失败回滚。

云端分批依据 [CloudBase 事务限制](https://docs.cloudbase.net/database/transaction)：单事务最多 100 个操作，事务中使用单文档操作。每批为专栏、所有权与版本检查预留操作空间。

## 0.9.6 升级与发布

Web 无数据库结构变更，保留原数据卷和 PostgreSQL 18 / 17 配置，重新构建或使用已发布的 0.9.6 镜像。不要改写已有 0.9.5 标签。

小程序先上传并部署整个 `cloudfunctions/notes`（含 `index.js`、`transfer.js`、生成的 `notes-transfer.js` 与 package.json），建议将 notes 云函数执行超时设为 60 秒（单批数据库事务仍需在 30 秒内完成），再编译、上传 0.9.6 小程序。新云函数继续兼容旧粘贴导入；只更新客户端而未部署新云函数会提示不支持操作。云开发环境、文件选择/发送及手机端真机行为需要在目标环境验收，单元测试不代表已经发布。
