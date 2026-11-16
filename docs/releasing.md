# 发布流程

当前版本：0.9.17。所有代码、配置和文档变更统一使用：**从 main 建 release → 从 release 建功能分支 → 合入 release → 打 tag 发布 → 合入 main**。

## 分支规则

| 分支                                                           | 用途               | 允许合入                          |
| -------------------------------------------------------------- | ------------------ | --------------------------------- |
| `main`                                                         | 已发布的稳定基线   | 仅接受 `release/X.Y.Z`            |
| `release/X.Y.Z`                                                | 一次版本的集成分支 | 接受本次版本的功能分支            |
| `feat/*`、`fix/*`、`docs/*`、`test/*`、`chore/*`、`refactor/*` | 单项开发任务       | 合入对应 release，不直接合入 main |

功能分支只承担一个可说明的目标。版本号在 release 准备阶段更新，不在每个功能分支中单独修改。

## 1. 从 main 创建 release

以下以 `0.9.17` 为例，替换为实际新版本：

```bash
git switch main
git pull --ff-only origin main
git switch -c release/0.9.17
git push -u origin release/0.9.17
```

release 创建后，所有新功能都从它切出，不从 main 或旧 release 切出。

## 2. 创建功能分支并合入 release

```bash
git switch release/0.9.17
git pull --ff-only origin release/0.9.17
git switch -c feat/short-task-name
```

完成开发后：

```bash
npm run check
git add -A
git commit -m "feat: 说明本次任务"
git push -u origin feat/short-task-name
gh pr create --base release/0.9.17 --head feat/short-task-name
```

CI 通过后合入 release，并删除功能分支。多个功能重复上述步骤，始终基于最新 release 创建分支。

```bash
gh pr merge <功能PR编号> --merge --delete-branch
```

不要把功能分支直接提到 main。`.github/workflows/branch-policy.yml` 会拒绝不符合源/目标关系的 PR。

## 3. 在 release 准备版本

功能全部合入后，同步 release 并更新版本元数据：

```bash
git switch release/0.9.17
git pull --ff-only origin release/0.9.17
npm version 0.9.17 --no-git-tag-version
```

还需同步：

- `compose.yaml` 与 `compose.image.yaml` 的镜像版本。
- `Dockerfile` 的 `APP_VERSION` 默认值。
- `.env.example` 的可选镜像标签。
- CI 工作流名称和镜像版本断言。
- README、CHANGELOG、相关文档和版本规划。

```bash
npm ci
npm run check
git add -A
git commit -m "release: 0.9.17"
git push origin release/0.9.17
```

新增 schema 变更必须包括旧数据升级、回滚和恢复验证，见 [数据库结构演进](schema-evolution.md)。不能把启动成功当作旧库已经正确升级。

## 4. 从 release 打 tag 并发布镜像

确认标签不存在且 release 已推送：

```bash
git status --short
git rev-parse HEAD
git ls-remote --tags origin refs/tags/v0.9.17
```

创建并推送标签：

```bash
git tag -a v0.9.17 -m "Release v0.9.17"
git push origin refs/tags/v0.9.17
```

标签触发 `publish-image.yml`，流程依次执行：版本与 release 分支校验 → AMD64/ARM64 构建 → 候选镜像容器验收 → 正式发布 GHCR 标签。

```bash
gh run list --workflow publish-image.yml --limit 1
gh run watch <运行ID> --exit-status
```

发布源必须是 `release/0.9.17` 的最新远程提交，标签名必须与 package.json 版本相同。发布失败时先修复 release，**不要继续合入 main，也不要移动或复用已有标签**；需要变更时递增版本号。

手动重新发布也必须明确选择匹配的 release 分支：

```bash
gh workflow run publish-image.yml -f source_ref=release/0.9.17
```

## 5. 发布成功后合入 main

只有镜像发布和候选验收全部成功后才创建最终 PR：

```bash
gh pr create --base main --head release/0.9.17
gh pr merge <发布PR编号> --merge
git switch main
git pull --ff-only origin main
```

main 的合并提交与 tag 提交可以不同；release 提交会作为合并父提交保留完整来源。最后再删除 release 分支，确认 tag、镜像和 main 内容一致。

## 发布后

保留旧镜像与数据库备份。应用启动后继续核对金额、家庭权限、公开分享和关键页面，不因健康接口为 200 就立即删除备份。回滚时按 [运维手册](operations.md) 处理代码、schema 与新增数据的一致性。

## 仓库保护

`main` 和 `release/*` 应启用仓库规则：禁止直接推送、删除和强制推送，要求 PR 与 CI 状态检查通过。工作流只能检查 PR，仓库规则负责阻止绕过 PR；两者需要同时存在。
