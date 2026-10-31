# Docker 部署参数填写指南

适用版本：0.9.6。先选择存储方式，再按对应部分填写 `.env.docker`。不需要把所有参数都填满。

```bash
cp .env.docker.example .env.docker
```

下面的 `home.example.com`、数据库和邮件地址都是示例，请替换成自己的信息。真实密码、邮件凭据填写在服务器的 `.env.docker` 中，不修改并提交示例文件。

## 先判断哪些参数必须填写

| 部署方式                 | 必须按实际情况填写                                                                         | 通常保留默认                                                                  | 可以留空或忽略                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 内置数据库 + 服务器反代  | APP_ORIGIN                                                                                 | APP_IMAGE、APP_IMAGE_TAG、APP_PORT                                            | DATA_DIR、全部 POSTGRES__、全部 SMTP__                                |
| 已有外部 PostgreSQL      | APP_ORIGIN、POSTGRES_HOST、POSTGRES_DB、POSTGRES_USER、POSTGRES_PASSWORD、POSTGRES_SSLMODE | APP_IMAGE、APP_IMAGE_TAG、APP_PORT；POSTGRES_PORT 取数据库实际端口，通常 5432 | DATA_DIR、全部 SMTP_*                                                 |
| Compose 自带 PostgreSQL  | APP_ORIGIN、POSTGRES_PASSWORD                                                              | APP_IMAGE、APP_IMAGE_TAG、APP_PORT、POSTGRES_DB、POSTGRES_USER                | DATA_DIR、POSTGRES_HOST、POSTGRES_PORT、POSTGRES_SSLMODE、全部 SMTP_* |
| 内置数据库改用宿主机目录 | 在所选内置方式基础上，再填 DATA_DIR                                                        | 其他同内置模式                                                                | 全部 POSTGRES_*                                                       |

只有启用邮件找回密码时才填写 SMTP 参数。注册不验证邮箱，未配置 SMTP 不影响注册和登录。

选择方式由 `-f compose.*.yaml` 决定，不是靠把某个密码或地址填入 `.env.docker` 自动切换。内置、外部 PostgreSQL、Compose 自带 PostgreSQL 三种方式选一种。

## 入口和镜像参数

| 参数          | 是否必填                      | 填什么                                                                           | 示例或默认                                 |
| ------------- | ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| APP_ORIGIN    | 必填                          | 用户浏览器实际访问的来源，只含协议、域名和可选端口；不含路径、查询参数、结尾斜线 | `http://home.example.com`                  |
| APP_IMAGE     | 使用 GHCR 时保留默认即可      | 镜像名称，不包含 `:版本号`；仅 compose.image.yaml 使用                           | `ghcr.io/dddyszy/renovation_assistant_web` |
| APP_IMAGE_TAG | 可不改                        | 已发布的镜像版本，不带 v；当前没有 latest 标签                                   | `0.9.6`                                    |
| APP_PORT      | 可不改                        | 宿主机回环端口，需未被占用，范围 1–65535                                         | `8080`                                     |
| DATA_DIR      | 使用 compose.bind.yaml 时必填 | 宿主机专用数据目录的绝对路径                                                     | `/srv/zhu-jia/data`                        |

`APP_PORT=8080` 表示应用映射到 `127.0.0.1:8080`，不表示用户应访问 `http://服务器IP:8080`。用户访问的是 APP_ORIGIN 指定的入口地址，代理再转发给应用。

服务器现有代理若运行在宿主机，转发到 `127.0.0.1:8080`；若也是容器，将代理和应用加入同一个 Docker 网络，转发到 `app:3001`。不要把代理容器的 localhost 当成宿主机。完整示例见 [服务器反代](docker.md#启动应用与服务器反代)。

APP_ORIGIN 必须匹配浏览器地址栏的协议、主机和端口，不能填写代理的上游地址。根路径末尾的 `/` 会被规范化，子路径、查询参数和账号信息会被拒绝。

## 数据库参数

| 参数              | 外部 PostgreSQL                                  | Compose 自带 PostgreSQL            | 内置 PGlite |
| ----------------- | ------------------------------------------------ | ---------------------------------- | ----------- |
| POSTGRES_HOST     | 填数据库真实域名/IP，必填                        | 忽略，应用自动使用服务名 db        | 忽略        |
| POSTGRES_PORT     | 填真实端口，通常 5432                            | 忽略，容器之间固定使用 5432        | 忽略        |
| POSTGRES_DB       | 填已经创建的数据库名称                           | 首次初始化创建该库，默认 zhu_jia   | 忽略        |
| POSTGRES_USER     | 填数据库已有账号，需能创建表、索引及读写业务数据 | 首次初始化创建该账号，默认 zhu_jia | 忽略        |
| POSTGRES_PASSWORD | 填该账号的真实密码，不能为空                     | 自行设置随机密码，不能为空         | 忽略        |
| POSTGRES_SSLMODE  | 按服务器 TLS 要求填写，建议显式设置              | 忽略，配置固定使用 disable         | 忽略        |

外部 PostgreSQL 的主机、库名、账号和密码必须与实际数据库一致，不能直接沿用示例中的 `db.example.internal`。`127.0.0.1` 指应用容器自身；数据库在宿主机上时可使用 `host.docker.internal`，同时配置宿主机数据库监听和访问权限。

POSTGRES_SSLMODE 主要选择：

- `verify-full`：外部数据库提供可信 TLS 证书，并验证证书与主机名；示例文件采用此值。
- `disable`：数据库明确不提供 TLS，且应用到数据库是受控内网连接。

外置配置在不设置该变量时回退为 `prefer`，实际部署建议按数据库要求显式填写，而不是依赖回退行为。这里的 TLS 只控制应用到数据库的连接。

可以用 `openssl rand -hex 32` 为新建的 Compose PostgreSQL 生成密码。已有数据库应使用其已有密码；修改环境变量不会重置已经初始化的数据库密码。

Compose 将密码单独传给 PGPASSWORD，不必把特殊字符编码成 URL。`.env.docker` 中密码含 `$`、`#` 等字符时，用单引号包住完整值，避免变量替换或注释解析；不要把引号本身计入密码。

## 可选邮件参数

| 参数          | 何时填写                                             | 示例                               |
| ------------- | ---------------------------------------------------- | ---------------------------------- |
| SMTP_HOST     | 启用邮件找回时填邮件服务商地址                       | `smtp.example.com`                 |
| SMTP_PORT     | 跟随服务商要求；通常 587 为 STARTTLS，465 为直接 TLS | `587`                              |
| SMTP_USER     | 服务商要求账号认证时填写，常为完整邮箱               | `noreply@example.com`              |
| SMTP_PASSWORD | 填 SMTP 授权码或服务商密码，不是网站用户密码         | 由邮件服务商提供                   |
| SMTP_FROM     | 只要配置 SMTP_HOST 就必填；通常需通过服务商发信认证  | `'筑家手记 <noreply@example.com>'` |

不需要邮件功能时保持 SMTP_HOST、SMTP_USER、SMTP_PASSWORD、SMTP_FROM 为空，SMTP_PORT 保留 587 即可。生产环境会明确提示邮件找回暂不可用，不会影响普通登录。

0.9.6 镜像发布前，移除下列命令的 `-f compose.image.yaml`，把 `--no-build` 换为 `--build`，从当前源码构建。

## 示例一：内置存储，服务器已有反代

`.env.docker` 最少保留以下内容，替换 APP_ORIGIN：

```dotenv
APP_IMAGE=ghcr.io/dddyszy/renovation_assistant_web
APP_IMAGE_TAG=0.9.6
APP_ORIGIN=http://home.example.com
APP_PORT=8080
```

```bash
docker compose --env-file .env.docker -f compose.yaml -f compose.image.yaml up -d --no-build --wait
```

已有代理转发到 `127.0.0.1:8080`，内置数据默认保存在 Docker 命名卷，无需填写数据库密码或 DATA_DIR。

## 示例二：使用已有外部 PostgreSQL

在示例一配置中增加并填写真实值：

```dotenv
POSTGRES_HOST=your-db.example.internal
POSTGRES_PORT=5432
POSTGRES_DB=your_existing_database
POSTGRES_USER=your_existing_user
POSTGRES_PASSWORD='这里填该数据库账号的真实密码'
POSTGRES_SSLMODE=verify-full
```

```bash
docker compose --env-file .env.docker -f compose.yaml -f compose.image.yaml -f compose.external.yaml up -d --no-build --wait
```

示例的数据库密码和地址是占位值，需要替换。无 TLS 的内网数据库按实际要求改为 disable。

## 示例三：Compose 创建 PostgreSQL 18，兼容 17

在示例一配置中增加：

```dotenv
POSTGRES_DB=zhu_jia
POSTGRES_USER=zhu_jia
POSTGRES_PASSWORD='这里填你生成的随机密码'
```

```bash
docker compose --env-file .env.docker -f compose.yaml -f compose.image.yaml -f compose.postgres.yaml up -d --no-build --wait
```

替换密码占位值。默认启动 PostgreSQL 18；需要兼容 17 时，把数据库配置换成 `-f compose.postgres17.yaml`。无需填写 POSTGRES_HOST、POSTGRES_PORT、POSTGRES_SSLMODE，配置会让应用连接 db:5432。

18 与 17 使用不同命名卷和目录布局，已有 17 数据不要只改镜像版本，见 [PostgreSQL 部署和升级](postgresql.md)。

## 可选：内置存储放到指定宿主机目录

仅在内置模式下增加：

```dotenv
DATA_DIR=/srv/zhu-jia/data
```

创建专用目录并允许容器用户 UID/GID 1000 写入，然后在原命令中追加 `-f compose.bind.yaml`。该目录包含真实数据库，不应是系统目录或另一个应用的数据目录。已有数据换挂载位置前先备份和迁移，不能直接把空目录当成原数据。

## 哪些值不用手工写进 .env.docker

NODE_ENV、HOST、PORT、DATABASE_URL 和 PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD/PGSSLMODE 已由选中的 Compose 配置设置，通常不改。宿主机端口使用 APP_PORT，数据库连接使用 POSTGRES_*。

GitHub 用户名和 GHCR Token 不属于应用环境参数，不填进 `.env.docker`。镜像当前私有，部署前单独 `docker login ghcr.io`，使用有 read:packages 权限的令牌，见 [镜像使用说明](container-registry.md#私有镜像登录)。

每次运行都带 `--env-file .env.docker`。在别的目录运行时用文件的真实路径；只创建文件但不让 Compose 读取，不会生效。

## 启动前核对

将部署命令的 `up -d --no-build --wait` 换成 `config --quiet`，先校验必填值和配置合并。它能发现缺少的必填变量，不能检测域名是否属于你、密码是否正确或数据库是否可达。

避免将完整的 `docker compose config` 输出发到公开位置，其中可能包含展开后的密码；日常校验使用 `--quiet`。

启动后执行 `curl --fail http://127.0.0.1:8080/api/v1/health`（若改 APP_PORT，同步改这里的端口），再用 APP_ORIGIN 指定的地址打开网页。
