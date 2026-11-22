# 先行 FirstMove 部署现状与交接

写于 2026-11-22。这份替换掉 11-21 那版——那份写的是"等备案域名下来再上 HTTPS"，后来实际走的是 IP 证书，Tailscale 也退掉了，里面列的步骤和状态都对不上。

## 一句话

一台阿里云 ECS 上跑 FastAPI + SQLite，Caddy 用公网 IP 的 Let's Encrypt 证书对外提供 HTTPS；浏览器、macOS、Windows、Android 四个入口都能用，带一个只有所有者能进的管理后台。

## 服务器

阿里云北京 ECS，Ubuntu 24.04 x86_64。源码在 `/opt/FirstMove`，systemd 服务名 `firstmove`，`uvicorn` 监听 `127.0.0.1:8000`。数据目录 `/var/lib/firstmove`，SQLite 库和附件都在里面。服务里设了 `WORKSPACE_HTTPS=1`，否则 HTTPS 下会话 Cookie 存不住。

没有用 Docker：ECS 拉 Docker Hub 的 Python 镜像会超时，所以直接用系统 Python 虚拟环境 + systemd。仓库里的 compose 文件留给别的环境用。

## 为什么没有域名，怎么做的 HTTPS

备案还在走，而域名解析到境内未备案的 IP 会被拦，IPv4 直连不受影响，所以先按 IP 上线。

Let's Encrypt 从 2026 年 1 月起签发 IP 地址证书，规则和域名证书不一样：

- 必须在 ACME 请求里带 `profile shortlived`，有效期 160 小时（约 6 天）
- 只能用 http-01 或 tls-alpn-01 验证，所以 **80 或 443 必须一直能从公网访问**
- Caddy 要 2.10.1 以上才支持，Ubuntu 源里的是 2.7，得从 Caddy 官方源装
- Caddyfile 里必须有 `default_sni`，因为客户端连 IP 时不发 SNI，没有这个值匹配不到站点

现在 Caddy 自动续期，不用 cron。但连续几天续不上证书就会过期，然后所有客户端一起连不上——报错还看不出是这个原因。为了"安全"把 80/443 关掉是个很自然的想法，别这么干。

域名叫下来之后，在同一个 Caddyfile 里加一个站点块就行，IP 和域名可以并存；客户端地址要跟着换（见"换域名时要改什么"）。

## 客户端

四端共用同一份前端，页面都从服务器加载。所以改界面只需要更新服务器，不用重新发版。

**Android**：自己写的应用外壳，内嵌 WebView，不再跳系统浏览器。同源页面留在应用内，外站链接交给浏览器；返回键先回退页面，到底再退到后台；地址填一次就记住，连不上时才出现"重试 / 更换地址"。外壳通过 `window.FirstMove` 给页面三样能力：把附件存到系统「下载」、发系统通知、读写剪贴板。上传附件走系统文件选择器。

**Windows**：Electron 打包，NSIS 安装程序。安装向导有欢迎页、目录选择页（可以装到其他盘）、组件页（桌面快捷方式可选）；开始菜单里有「先行」和「卸载 先行」。安装以当前用户身份运行，不弹 UAC，默认目录 `%LOCALAPPDATA%\Programs\Yraguo\FirstMove`。

**macOS**：Electron 打包，DMG 里放了「先行」和「卸载 先行.command」。卸载脚本会先列出要删的东西和占用大小，确认后退出应用、删掉 `/Applications/先行.app` 与 `~/Library/Application Support/先行` 等本机数据。下载来的 `.command` 带隔离标记，首次双击可能被拦，右键「打开」即可。安装包是 ad-hoc 签名，没有 Apple 公证。

**图标**：原来那版是 RGB 不透明图，圆角外面填的白色，所以在深色桌面、APK 安装界面、任务栏、程序坞上都会露白角。现在从一张满版酒红的源图重新生成，圆角外是透明的，按各平台规范留白（macOS 内容占 80.5%，Windows 少一点，Android 圆角 22%）。脚本在 `clients/icons/build_icons.py`，换图标只改 `source.png` 再跑一次。

## 服务端功能

除了原有的待办、记录、项目、日历、附件，这次加了管理后台。

接口在 `/api/admin/*`，只有 `admin=1` 的账号能调，其他人返回 403：账号列表（用量、附件数、未完成待办、会话状态）、改额度、设为或取消所有者、停用/恢复、重置密码（生成一次性临时密码并踢掉所有设备）、强制下线。

三条保护：不能停用自己，不能取消自己的所有者权限，不能把最后一个所有者去掉。停用的账号登录返回 403，已登录的会话也一并失效。

数据库给 `users` 加了 `disabled` 列，服务启动时幂等补列，老库直接升级，不用手工迁移。

**提醒只在客户端运行时送达。** 锁屏推送、后台推送都没做。

## 版本

| 版本 | 内容 |
| --- | --- |
| 0.2.0 | Android 改成内嵌 WebView 外壳；附件可存到系统下载、提醒走系统通知、邀请链接走剪贴板 |
| 0.2.1 | 修 Android 15 强制全屏导致的状态栏遮挡 |
| 0.3.0 | 图标透明化；Windows 安装器加选盘与快捷方式选项；管理后台 |
| 0.3.1 | macOS 卸载脚本；Windows 开始菜单卸载入口 |
| 0.3.2 | 修 Windows 换盘安装失败（详见下一节） |

0.3.2 具体改了什么：上一版加了选盘但只有默认路径能装。原因有两个，一是目标目录写不进去时 NSIS 要解压到一半才报错，二是目录页前面的回调每次显示都从注册表覆盖 `$INSTDIR`，翻回上一页就把刚选的位置换掉了。现在离开目录页时会先建目录、试写文件，写不进去当场说清原因；路径改用 `InstallDirRegKey` 提供初始值，不再中途覆盖。

这次修复**还没有被真机验证**——安装器在 macOS 上编译，跑不起来。如果换盘仍然失败，需要失败时的弹窗原文。

## 日常操作

改完代码更新服务器：

```sh
cd /opt/FirstMove && git checkout main && git pull && systemctl restart firstmove
```

`/opt/FirstMove` 曾经处于 detached HEAD 状态，`git pull` 会报 "You are not currently on a branch"，所以先 `git checkout main`。

**改了 Python 必须重启服务。** 只改 `frontend/` 下的 js 和 css 不用重启，FastAPI 直接读磁盘，刷新页面就生效。表结构变更在启动时自动补列。

出问题先看这几条：

```sh
systemctl is-active firstmove
journalctl -u firstmove -n 40 --no-pager
journalctl -u caddy -n 50 --no-pager
```

接口通不通（返回 401 是正常的，说明路由在，只是没带登录态）：

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://服务器IP/api/admin/overview
```

## 还没做的

- **公安联网备案**。ICP 初审过了，公安那头一般要求网站开通后 30 天内办完。
- **域名**。买下来、实名、备案通过后启用，见下一节。
- 锁屏和后台推送；邀请链接的深链接跳转（现在点邀请链接是在系统浏览器里打开，不进应用）。

## 换域名时要改什么

1. Caddyfile 加一个域名站点块，证书自动申请；IP 那块可以留着
2. 客户端里的地址要重新填——Android 内嵌版没有修改入口，只能卸载重装，或者以后补一个设置页
3. 前端生成邀请链接用的是 `window.location.origin`，换域名后自动跟着变，不用改代码
4. 首页要展示备案号，这是备案的要求

## 这份文档里没有的东西

服务器 IP、实例 ID、密码、Android 签名密钥都不在这里。IP 和实例信息在阿里云控制台；签名材料在用户本地的 `.release-private/`，那个目录在 `.gitignore` 里。

## 相关文件

`README.md` 给使用者看，`clients/README.md` 写构建与打包，`backend/README.md` 写接口，`prd.md` 是产品需求。
