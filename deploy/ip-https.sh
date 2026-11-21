#!/usr/bin/env bash
# 给公网 IPv4 申请 Let's Encrypt IP 证书，并用 Caddy 反代到本机的先行服务。
# 适用：阿里云 ECS / Ubuntu 24.04，后端是 systemd 服务 firstmove，监听 127.0.0.1:8000。
# 用法（root）：bash ip-https.sh 47.100.x.x
#
# 说明：
# - IP 证书必须使用 shortlived 配置档，有效期 160 小时，Caddy 在剩余 1/3 时自动续期。
# - 续期依赖 80 或 443 一直可从公网访问，别为了安全把这两个端口长期关掉。
# - 脚本只改 /etc/caddy 与 Caddy 服务，不碰数据库、不动 firstmove 的 unit。

set -euo pipefail

TARGET_IP="${1:-}"
if [ -z "$TARGET_IP" ]; then
  echo "没有传参，自动探测公网 IPv4…"
  TARGET_IP=$(curl -4 -s --max-time 8 ifconfig.me || true)
fi
if [ -z "$TARGET_IP" ]; then
  echo "无法自动探测公网 IPv4。请手动传入：bash $0 47.100.x.x" >&2
  echo "地址可在 ECS 控制台实例详情里查看" >&2
  exit 1
fi
if ! printf '%s' "$TARGET_IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
  echo "不是合法的 IPv4：$TARGET_IP" >&2
  echo "用法：bash $0 <公网IPv4>" >&2
  exit 1
fi
echo "目标 IP：$TARGET_IP"

say() { printf '\n== %s ==\n' "$1"; }

say "1/6 检查后端服务"
systemctl is-active --quiet firstmove || {
  echo "firstmove 服务没有运行，先把它修好再跑这个脚本。" >&2
  exit 1
}
curl -fsS --max-time 5 http://127.0.0.1:8000/api/health && echo
if systemctl cat firstmove | grep -q 'WORKSPACE_HTTPS=1'; then
  echo "WORKSPACE_HTTPS=1 已配置。"
else
  echo "注意：firstmove 没有 WORKSPACE_HTTPS=1。HTTPS 下会话 Cookie 是 Secure 的，"
  echo "      少了这个变量会导致登录状态存不住。改 unit 后执行："
  echo "      systemctl daemon-reload && systemctl restart firstmove"
fi

say "2/6 准备 Caddy 2.10.1 以上"
need_install=1
if command -v caddy >/dev/null 2>&1; then
  current=$(caddy version | awk '{print $1}' | sed 's/^v//')
  echo "已安装 caddy $current"
  # IP 证书与 ACME profile 从 2.10.1 起才支持，发行版自带的一般是 2.7
  if [ "$(printf '%s\n2.10.1\n' "$current" | sort -V | head -1)" = "2.10.1" ]; then
    need_install=0
  fi
fi
if [ "$need_install" = 1 ]; then
  echo "从官方仓库安装 Caddy。"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gpg >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
  caddy version
fi

say "3/6 写入 Caddyfile"
mkdir -p /etc/caddy
if [ -f /etc/caddy/Caddyfile ]; then
  backup="/etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S)"
  cp /etc/caddy/Caddyfile "$backup"
  echo "原配置已备份到 $backup"
  if grep -q 'Hello, world' "$backup" 2>/dev/null || [ ! -s "$backup" ]; then
    echo "原配置是 Caddy 默认欢迎页，直接覆盖。"
  else
    echo "警告：原配置不是默认欢迎页，可能还有别的站点。已备份，覆盖前请确认（Ctrl+C 可中止）。"
    sleep 5
  fi
fi
cat > /etc/caddy/Caddyfile <<EOF
{
	# 客户端连 IP 时不发 SNI，需要这个回退值才能匹配到站点
	default_sni $TARGET_IP
}

https://$TARGET_IP {
	tls {
		issuer acme {
			# IP 证书强制使用短期配置档
			profile shortlived
		}
	}
	encode zstd gzip
	reverse_proxy 127.0.0.1:8000
}
EOF
cat /etc/caddy/Caddyfile

say "4/6 校验并启动 Caddy"
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable --now caddy
systemctl reload caddy
sleep 2
systemctl is-active caddy

say "5/6 等待 Let's Encrypt 签发（最多 60 秒）"
cert=""
for _ in $(seq 1 30); do
  cert=$(find /var/lib/caddy/.local/share/caddy/certificates /root/.local/share/caddy/certificates \
    -name "${TARGET_IP}.crt" 2>/dev/null | head -1 || true)
  [ -n "$cert" ] && break
  sleep 2
done
if [ -z "$cert" ]; then
  echo "没有在 60 秒内看到证书文件。查看日志定位原因：" >&2
  echo "  journalctl -u caddy -n 50 --no-pager" >&2
  echo "常见原因：安全组没放行 80/443；这台 ECS 不是独占公网 IPv4；IP 填错。" >&2
  exit 1
fi
echo "证书已签发：$cert"
if command -v openssl >/dev/null 2>&1; then
  openssl x509 -in "$cert" -noout -subject -dates || true
fi

say "6/6 收尾"
cat <<TIPS
还需要你手动确认两件事：

1. 阿里云安全组入方向放行 TCP 80 和 443（来源 0.0.0.0/0）。这一步脚本改不了。
2. 在 ECS 之外的电脑上验证：
     curl -fsS https://$TARGET_IP/api/health
   返回 {"ok":true} 就说明公网 HTTPS 通了。

续期：Caddy 自动完成，不需要 cron。证书 6 天一轮，剩余约 1/3 时续期。
      前提是 80 或 443 一直可从公网访问；连续失败超过两天，HTTPS 会失效。
      检查方式：journalctl -u caddy --no-pager | grep -i 'certificate obtained'

备案下来后：在同一个 Caddyfile 里再加一个站点块，域名与 IP 可以并存，
            客户端里把地址改成域名即可。
TIPS
