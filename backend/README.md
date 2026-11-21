# 效率工作台后端

FastAPI + SQLite，单机运行，数据库启用 WAL。账户、项目、任务、记录历史和附件都保存在数据目录中。前端使用同源的 `/api`，可在 `/docs` 试调，在 `/openapi.json` 查看路径、请求模型和字段限制。

## 本地启动

在项目根目录执行以下命令。开发验证使用 Python 3.13，运行需要 Python 3.11 或更高版本（含 SQLite blobopen 支持）。

```sh
cd backend
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python manage.py create-owner --name owner
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

启动后在浏览器打开 [工作台首页](http://127.0.0.1:8000/)。同一进程提供网页和 API，无需另开前端服务。

首次创建所有者时在终端输入密码。数据库已存在时，直接运行最后一条命令。打开 `http://127.0.0.1:8000/docs`，调用 `POST /api/login` 提交 `{"name":"owner","password":"自己设置的密码"}`。浏览器保存 HttpOnly 会话 Cookie，之后的同源请求使用该会话。开发前端可将 `/api` 代理到后端并保留原始 Host。线上通过同域 HTTPS 反向代理，设置 `WORKSPACE_HTTPS=1`。

## 前端接入顺序

1. 登录后取 `GET /api/me`。工作台邀请由所有者创建，一次使用；比赛邀请由队长创建，多个成员可在七天内使用。用 `POST /api/invites` 返回的 token 生成前端邀请链接。新用户调用 `/api/register`，已有用户调用 `/api/join`。
2. 通过 `POST /api/tasks` 传入 `{"title":"交实验报告","due":"2030-11-22"}`。返回的 `id` 是任务 ID，`rid` 是它的备忘记录 ID，文字修改、上传附件都用 `rid`。调用 `PATCH /api/tasks/{id}`，传 `{"status":"done"}` 即可完成。
3. 日程用 `GET /api/tasks?view=agenda` 的服务端顺序；另外支持 `waiting`、`history` 和 `all`。项目列表返回 `pinned/hidden/archived/trashed` 供前端切换列表与回收站。周历、月历共用 `GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD`。
4. 先发 `POST /api/records` 保存文字，再按需转笔记、关联项目、共享或转待办。调用 `GET /api/projects/{pid}/suggestions` 只预览阶段建议；用户采纳时才把选定条目提交给 `POST /api/tasks`。
5. 所有者用 `PUT /api/users/{uid}/quota` 设置个人额度。`GET /api/me/storage` 返回已用、个人上限、实际可用字节、单文件上限和大文件提示阈值。回收项仍占空间，`GET /api/projects/{pid}/deletion` 返回预计永久删除能释放的附件字节数。
6. 提醒使用 `GET /api/reminders`。每条含稳定的 `id`、`at` 和 `task_id`。页面打开时定期获取，每台设备按 ID 去重；每次同步以最新列表替换本机计划。无需为过去的所有提醒补发通知。浏览器通知权限、定时展示和本机已提醒记录由前端负责。关闭页面或锁屏推送属于安装包阶段。

### 跨端与离线协议

- 新建记录、任务时可传客户端生成的 UUID 作为 `id`。断网时先把条目、附件原件和待发送动作持久化在设备（网页可用 IndexedDB）。恢复联网后，按依赖顺序重试同一 UUID。
- 附件上传用 `PUT /api/records/{rid}/files/{aid}/content?name=文件名`，请求体是原始字节，文件名进行 URL 编码。`aid` 为该文件生成一次的 UUID。成功后再标记为已同步。同一 UUID 重传同一文件只计一次空间；从另一条自己的记录关联已传附件，用不带 `/content` 的 PUT 路径。
- `GET /api/sync` 返回当前会话可见的完整快照和 ETag，包含个人任务、项目、记录、附件目录、打卡、冲突索引、提醒和空间用量。后续携带 `If-None-Match` 可收到 304。按账号存本地数据；更新快照时移除已经无权访问的缓存，保留尚未上传的本机修改。团队分工单独由 `/api/projects/{pid}/team` 读取。
- 目录中的附件含 `rid,id,name,size`。下载选定项时调用 `GET /api/files/{aid}`，写入本机成功后再标“本机可用”。清理本机副本直接操作客户端存储。云端的文件引用另由 `DELETE /api/records/{rid}/files/{aid}` 管理。
- 修改笔记正文用 `PUT /api/records/{rid}/body`，提交上次读取的 `base_version` 和完整新正文。服务端按行三方合并。若返回 `conflict_id`，查看记录详情中的当前正文与冲突版本，确定后调用 `POST /api/records/{rid}/conflicts/{cid}/resolve`，携带当前版本号和选定正文。
- 日期使用 `YYYY-MM-DD`，精确时刻使用工作台时区的 `YYYY-MM-DDTHH:MM`。优先级 1／2／3 对应低／中／高。习惯的星期 1–7 对应周一至周日。操作状态、字段和完整请求示例以接口及集成测试为准。

## 实例配置

通过进程环境变量配置，变量示例见 [.env.example](./.env.example)。数值是本地试用默认值，部署时根据实际套餐调整。附件额度统计原始文件字节，数据库索引、笔记历史、临时上传、SQLite 日志及备份还需要磁盘余量。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| WORKSPACE_DATA | backend/data | 私有持久化目录 |
| WORKSPACE_ZONE | Asia/Shanghai | 所有设备计算日界线的工作台时区 |
| WORKSPACE_USER_BYTES | 134217728 | 默认每人 128 MiB |
| WORKSPACE_TOTAL_BYTES | 1073741824 | 工作台附件总量 1 GiB |
| WORKSPACE_FILE_BYTES | 16777216 | 单个上传上限 16 MiB |
| WORKSPACE_LARGE_BYTES | 5242880 | 5 MiB 起提示大文件 |
| WORKSPACE_HTTPS | 0 | HTTPS 部署设为 1，启用 Secure Cookie |

启动和每分钟检查七天到期的回收站项目。备份应使用 SQLite 在线备份接口或在服务停止后备份整个数据目录。数据库文件包含私有信息，部署时放在静态资源目录之外。

## 验证

```sh
cd backend
.venv/bin/python -m pip install -r requirements-test.txt
.venv/bin/python -m unittest discover -s tests -v
```

测试使用临时数据库和独立会话，覆盖 PRD 的服务端场景。界面布局、真实设备断网持久化、网页通知展示及安装包送达需要前端或客户端联调。
