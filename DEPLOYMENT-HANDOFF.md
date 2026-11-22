# 先行 FirstMove 部署现状

写于 2026-11-22，替换掉 11-21 那份交接——那份里写的是"等备案域名下来再上 HTTPS"，现在走的已经是另一条路，步骤都对不上了。

## 现在跑在哪里

一台阿里云北京 ECS（Ubuntu 24.04 x86_64）。源码在 `/opt/FirstMove`，systemd 服务 `firstmove` 监听 `127.0.0.1:8000`，数据放在 `/var/lib/firstmove`，SQLite 和附件都在这个目录里。服务里设了 `WORKSPACE_HTTPS=1`。

对外是 **直接用公网 IP 访问**，没有域名。Caddy 在前面做反向代理，证书用的是 Let's Encrypt 的 IP 证书（`shortlived` 档，160 小时有效，由 Caddy 自动续期）。

走 IP 证书不是偷懒：域名解析到境内未备案的 IP 会被拦，而 IPv4 直连不受影响。备案还在走，等域名下来，在同一个 Caddyfile 里加一个站点块就行，IP 和域名可以并存。

Tailscale 那套方案已经放弃了，ECS 上的 serve 配置清掉了。

## 已经做完的

三端都能用：浏览器、macOS 和 Windows 的桌面客户端、Android 应用（内嵌 WebView，不再跳系统浏览器）。客户端第一次打开时填 `https://服务器IP`，之后记住，连不上时才有"重试 / 更换地址"。

管理后台在 `/api/admin/*`，`admin=1` 的账号登录后左侧导航会多一项「管理」，可以改额度、停用账号、重置密码、强制下线。非所有者调用返回 403。

Windows 安装包会写入卸载信息，开始菜单也有「卸载 先行」；macOS 的卸载脚本放在 DMG 里，名字是「卸载 先行.command」。

## 还没做的

- **公安联网备案**。ICP 初审已经过了，公安那头一般要求网站在开通后 30 天内办完，别拖过这个窗口。
- **域名**。买下来、实名、备案通过之后，再把 Caddyfile 和客户端地址换成域名。现在所有配置都写死在 IP 上，换的时候要一起改。
- 提醒只在客户端运行时送达。锁屏推送、后台推送都还没有。

## 升级代码时容易踩的两个坑

`/opt/FirstMove` 曾经处于 detached HEAD 状态，`git pull` 会报 "You are not currently on a branch"。先 `git checkout main` 再拉：

```sh
cd /opt/FirstMove && git checkout main && git pull && systemctl restart firstmove
```

第二点：**改了 Python 代码必须 `systemctl restart firstmove`**。只改前端（`frontend/` 下的 js、css）不用重启，FastAPI 是直接读磁盘的静态文件，刷新页面就生效。表结构变更会在启动时幂等补列，老库不用手工迁移。

## 出问题先看这三条

```sh
systemctl is-active firstmove
journalctl -u firstmove -n 40 --no-pager
journalctl -u caddy -n 50 --no-pager
```

接口通不通可以用（返回 401 是正常的，说明路由在，只是没带登录态）：

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://服务器IP/api/admin/overview
```

证书 6 天一轮，依赖 80 或 443 从公网可达。为了"安全"把这两个端口关掉，几天后证书过期，所有客户端会一起连不上，而且报错信息很难看出是这个原因。

## 这份文档里没有的东西

服务器 IP、实例 ID、密码、Android 签名密钥都不在这里。IP 证书和实例信息在阿里云控制台，签名材料和口令在用户本地的 `.release-private/`，那个目录在 `.gitignore` 里。
