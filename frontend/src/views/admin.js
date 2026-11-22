import { api } from "../api.js";
import { icons } from "../icons.js";
import { copyText } from "../native.js";
import { state } from "../store.js";
import { esc, formatBytes, openConfirmDialog, showToast } from "../utils.js";

let revealed = null;

export function renderAdmin(container) {
  if (!state.user || !state.user.admin) {
    container.innerHTML = `<div class="empty-state"><p class="empty-state-title">需要所有者权限</p>
      <p class="empty-state-desc">这个页面只对工作台所有者开放。</p></div>`;
    return;
  }
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">管理</h1>
        <p class="page-subtitle">账号、配额与存储</p>
      </div>
      <button type="button" class="btn" id="admin-refresh">${icons.refresh}<span>刷新</span></button>
    </div>
    <div id="admin-body"><div class="empty-state"><p class="empty-state-desc">正在读取…</p></div></div>`;
  container.querySelector("#admin-refresh").addEventListener("click", () => load(container));
  load(container);
}

async function load(container) {
  const body = container.querySelector("#admin-body");
  try {
    const [overview, users] = await Promise.all([api.adminOverview(), api.adminUsers()]);
    paint(container, body, overview, users);
  } catch (error) {
    body.innerHTML = `<div class="empty-state"><p class="empty-state-title">读取失败</p>
      <p class="empty-state-desc">${esc(error.message)}</p></div>`;
  }
}

function stamp(value) {
  if (!value) return "未登录";
  const days = Math.round((value * 1000 - Date.now()) / 86400000);
  if (days <= 0) return "已过期";
  return days <= 1 ? "今天内到期" : `${days} 天后过期`;
}

function paint(container, body, overview, users) {
  const banner = revealed
    ? `<div class="banner banner--accent" style="margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
         <span>「${esc(revealed.name)}」的临时密码：<b class="mono">${esc(revealed.password)}</b>
         　对方登录后请自行修改；关闭本页后不再显示。</span>
         <button type="button" class="btn btn--sm" id="admin-copy-pw">复制</button>
       </div>`
    : "";

  body.innerHTML = `
    ${banner}
    <div class="admin-stats">
      <div class="admin-stat"><b>${overview.users}</b><span>账号（停用 ${overview.disabled_users}）</span></div>
      <div class="admin-stat"><b>${overview.projects}</b><span>进行中的项目</span></div>
      <div class="admin-stat"><b>${overview.open_tasks}</b><span>未完成待办</span></div>
      <div class="admin-stat"><b>${formatBytes(overview.bytes)}</b><span>附件占用 / 上限 ${formatBytes(overview.total_bytes)}</span></div>
    </div>
    <section class="surface">
      <div class="surface-header"><h2 class="surface-title">账号</h2>
        <span class="tag">每人默认 ${formatBytes(overview.personal_bytes)}</span></div>
      <div id="admin-users">
        ${users.map((u) => row(u, overview.personal_bytes)).join("")}
      </div>
    </section>`;

  const copy = body.querySelector("#admin-copy-pw");
  if (copy) {
    copy.addEventListener("click", () => {
      const done = copyText(revealed.password);
      showToast(done ? "临时密码已复制" : "复制失败，请手动抄录", done ? undefined : "error");
    });
  }

  body.querySelectorAll(".admin-row").forEach((node) => bindRow(container, node));
}

function row(u, personal) {
  const quota = u.quota == null ? personal : u.quota;
  const role = u.admin ? `<span class="tag tag--accent">所有者</span>` : "";
  const stateTag = u.disabled ? `<span class="tag tag--danger">已停用</span>` : "";
  const self = u.id === state.user.id;
  return `
    <div class="admin-row" data-uid="${esc(u.id)}" data-name="${esc(u.name)}"
         data-admin="${u.admin}" data-disabled="${u.disabled}" data-quota="${quota}">
      <b class="admin-avatar" aria-hidden="true">${esc(u.name.slice(0, 1).toUpperCase())}</b>
      <div class="admin-id">
        <div class="admin-name">${esc(u.name)}${self ? `<span class="tag">我</span>` : ""}${role}${stateTag}</div>
        <div class="admin-meta">
          用量 ${formatBytes(u.used)} / ${formatBytes(quota)} · 附件 ${u.files} 个 · 未完成 ${u.open_tasks}
          · 会话 ${stamp(u.session_until)}
        </div>
      </div>
      <div class="admin-actions">
        <button type="button" class="btn btn--sm" data-act="quota">改额度</button>
        <button type="button" class="btn btn--sm" data-act="admin" ${self ? "disabled" : ""}>${u.admin ? "取消所有者" : "设为所有者"}</button>
        <button type="button" class="btn btn--sm" data-act="disable" ${self ? "disabled" : ""}>${u.disabled ? "恢复账号" : "停用账号"}</button>
        <button type="button" class="btn btn--sm" data-act="reset" ${self ? "disabled" : ""}>重置密码</button>
        <button type="button" class="btn btn--sm" data-act="kick" ${self ? "disabled" : ""}>强制下线</button>
      </div>
      <div class="admin-quota" hidden>
        <input class="input" type="number" min="0" step="1" value="${Math.round(quota / 1048576)}" data-quota-input aria-label="额度（MB）" />
        <span class="admin-meta">MB</span>
        <button type="button" class="btn btn--sm btn--primary" data-act="quota-save">保存</button>
        <button type="button" class="btn btn--sm" data-act="quota-cancel">取消</button>
      </div>
    </div>`;
}

function bindRow(container, node) {
  const uid = node.dataset.uid;
  const name = node.dataset.name;
  const box = node.querySelector(".admin-quota");

  node.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-act]")?.dataset.act;
    if (!action) return;
    if (action === "quota") {
      box.hidden = false;
      box.querySelector("input").focus();
      return;
    }
    if (action === "quota-cancel") {
      box.hidden = true;
      return;
    }
    if (action === "quota-save") {
      const mb = Number(box.querySelector("input").value);
      if (!Number.isFinite(mb) || mb < 0) return showToast("请输入有效的额度", "error");
      await run(() => api.adminChangeUser(uid, { quota: Math.round(mb * 1048576) }), `已将「${name}」的额度改为 ${mb} MB`);
      return;
    }
    if (action === "disable") {
      const disable = node.dataset.disabled === "0";
      const ok = await openConfirmDialog({
        title: disable ? `停用「${name}」？` : `恢复「${name}」？`,
        message: disable
          ? "该账号会立即退出所有设备，之后无法登录。数据保留，可随时恢复。"
          : "恢复后该账号可以重新登录，原有数据不受影响。",
        confirmLabel: disable ? "停用" : "恢复",
        danger: disable
      });
      if (!ok) return;
      await run(() => api.adminChangeUser(uid, { disabled: disable }), disable ? "账号已停用" : "账号已恢复");
      return;
    }
    if (action === "admin") {
      const promote = node.dataset.admin === "0";
      const ok = await openConfirmDialog({
        title: promote ? `把「${name}」设为所有者？` : `取消「${name}」的所有者权限？`,
        message: promote ? "所有者可以管理所有账号、配额与邀请。" : "该账号会立即退出所有设备，之后按普通成员使用。",
        confirmLabel: promote ? "设为所有者" : "取消权限",
        danger: !promote
      });
      if (!ok) return;
      await run(() => api.adminChangeUser(uid, { admin: promote }), promote ? "已设为所有者" : "已取消所有者权限");
      return;
    }
    if (action === "reset") {
      const ok = await openConfirmDialog({
        title: `重置「${name}」的密码？`,
        message: "会生成一个临时密码并让该账号退出所有设备。密码只显示一次。",
        confirmLabel: "重置密码",
        danger: true
      });
      if (!ok) return;
      try {
        const result = await api.adminResetPassword(uid);
        revealed = result;
        await load(container);
        showToast("临时密码已生成，请当面告知对方");
      } catch (error) {
        showToast(error.message, "error");
      }
      return;
    }
    if (action === "kick") {
      const ok = await openConfirmDialog({
        title: `让「${name}」退出所有设备？`,
        message: "只清除登录状态，数据不动，对方重新登录即可。",
        confirmLabel: "下线"
      });
      if (!ok) return;
      await run(() => api.adminKickUser(uid), "已强制下线");
    }
  });
}

async function run(action, message) {
  try {
    await action();
    showToast(message);
    const container = document.getElementById("main-content");
    if (container) await load(container);
  } catch (error) {
    showToast(error.message, "error");
  }
}
