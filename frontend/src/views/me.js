import { api } from "../api.js";
import { icons } from "../icons.js";
import { offlineDB } from "../offline.js";
import {
  flushOutbox,
  refreshLocalIndexes,
  scheduleReminders,
  setRailSide,
  clearSession,
  state,
  syncNow
} from "../store.js";
import { esc, formatBytes, openConfirmDialog, showToast } from "../utils.js";

export function renderMe(container) {
  const u = state.user;
  const st = state.storage;
  const pct = st.quota > 0 ? Math.min(100, Math.round((st.used / st.quota) * 100)) : 0;
  const meterClass = pct >= 90 ? "meter-fill--danger" : pct >= 75 ? "meter-fill--warn" : "";
  const localBytes = state.localFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  const notifState =
    typeof Notification === "undefined"
      ? "当前浏览器不支持桌面通知"
      : Notification.permission === "granted"
        ? "已允许浏览器通知"
        : Notification.permission === "denied"
          ? "浏览器通知已被拒绝，请在站点设置中开启"
          : "尚未授权浏览器通知";

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">我的</h1>
        <p class="page-subtitle">${esc(u.name)}</p>
      </div>
      <button type="button" class="btn btn--danger-soft" id="btn-logout">退出登录</button>
    </div>

    <div style="display:grid;gap:16px;max-width:760px;">
      <section class="surface">
        <div class="surface-header">
          <h2 class="surface-title">当前账号与界面偏好</h2>
          <span class="tag ${u.admin ? "tag--accent" : ""}">${u.admin ? "工作台所有者" : "工作台成员"}</span>
        </div>
        <div class="surface-body" style="display:grid;gap:12px;">
          <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;align-items:center;">
            <div>
              <strong style="font-size:var(--text-md);">${esc(u.name)}</strong>
              <div class="mono" style="font-size:var(--text-xs);color:var(--ink-muted);">ID: ${esc(u.id)}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <span style="font-size:var(--text-xs);color:var(--ink-secondary);">电脑端导航栏位置：</span>
              <div class="segmented">
                <button type="button" class="segmented-btn" data-rail="left" aria-selected="${state.railSide === "left"}">左侧</button>
                <button type="button" class="segmented-btn" data-rail="right" aria-selected="${state.railSide === "right"}">右侧</button>
              </div>
            </div>
          </div>

          ${
            u.admin
              ? `
            <div style="padding-top:10px;border-top:1px solid var(--border-subtle);display:grid;gap:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-size:var(--text-sm);font-weight:600;">邀请朋友开设私人工作台（一次性链接）</span>
                <button type="button" class="btn btn--sm btn--primary" id="btn-gen-ws-invite">${icons.share}<span>生成工作台邀请</span></button>
              </div>
              <div id="ws-invite-result"></div>
            </div>
          `
              : ""
          }
        </div>
      </section>

      <section class="surface">
        <div class="surface-header">
          <h2 class="surface-title">提醒设置</h2>
          <span style="font-size:var(--text-xs);color:var(--ink-muted);">${esc(notifState)}</span>
        </div>
        <form class="surface-body" id="pref-form" style="display:grid;gap:12px;">
          <div class="field-row">
            <label class="field">
              <span class="field-label">仅日期任务的默认前一晚提醒时间</span>
              <input class="input" type="time" name="evening" value="${esc(u.evening || "20:00")}" required />
            </label>
            <div class="field" style="align-content:end;">
              <label style="display:inline-flex;align-items:center;gap:8px;font-size:var(--text-sm);cursor:pointer;height:36px;">
                <input type="checkbox" name="device_enabled" ${u.enabled ? "checked" : ""} />
                <span>在本设备接收提醒</span>
              </label>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="submit" class="btn btn--primary">保存提醒设置</button>
            ${
              typeof Notification !== "undefined" && Notification.permission !== "granted"
                ? `<button type="button" class="btn" id="btn-req-notif">${icons.bell}<span>开启浏览器通知权限</span></button>`
                : ""
            }
          </div>
          <div style="font-size:var(--text-xs);color:var(--ink-muted);">
            当前待触发提醒数：<span class="tabular">${state.reminders.length}</span> 条。在任一设备完成任务后会自动取消其余设备的后续提醒。
          </div>
        </form>
      </section>

      <section class="surface">
        <div class="surface-header">
          <h2 class="surface-title">个人存储空间</h2>
          <span class="mono" style="font-size:var(--text-xs);color:var(--ink-secondary);">${formatBytes(st.used)} / ${formatBytes(st.quota)} (${pct}%)</span>
        </div>
        <div class="surface-body" style="display:grid;gap:10px;">
          <div class="meter"><div class="meter-fill ${meterClass}" style="width:${pct}%"></div></div>
          <div style="display:flex;flex-wrap:wrap;gap:14px;font-size:var(--text-xs);color:var(--ink-secondary);">
            <span>当前可用：<strong class="mono">${formatBytes(st.available)}</strong></span>
            <span>单文件上限：<strong class="mono">${formatBytes(st.file_limit)}</strong></span>
            <span>大文件提示：<strong class="mono">${formatBytes(st.large_file_hint)}</strong></span>
          </div>
          ${
            u.admin
              ? `
            <form id="quota-form" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-top:8px;border-top:1px solid var(--border-subtle);">
              <input class="input mono" name="uid" value="${esc(u.id)}" placeholder="用户 ID" style="flex:1;min-width:180px;" required />
              <input class="input" type="number" name="mb" min="0" value="${Math.round(st.quota / 1048576)}" style="width:110px;" required />
              <span style="font-size:var(--text-xs);color:var(--ink-secondary);">MiB</span>
              <button type="submit" class="btn btn--sm">调整配额</button>
            </form>
          `
              : ""
          }
        </div>
      </section>

      <section class="surface">
        <div class="surface-header">
          <h2 class="surface-title">本机离线文件 <span class="mono" style="color:var(--ink-muted);font-weight:500;">(${state.localFiles.length} 份 · ${formatBytes(localBytes)})</span></h2>
          ${
            state.outbox.length
              ? `<button type="button" class="btn btn--sm btn--primary" id="btn-flush-outbox">${icons.refresh}<span>同步 ${state.outbox.length} 项待上传</span></button>`
              : ""
          }
        </div>
        <div class="surface-body" style="display:grid;gap:10px;">
          ${
            state.outbox.length
              ? `<div class="banner banner--warn">当前有 <strong>${state.outbox.length}</strong> 项尚未上传成功的离线内容（待同步队列），为防止数据丢失，它们不会出现在下方可清理列表中。</div>`
              : ""
          }
          ${
            state.localFiles.length
              ? state.localFiles
                  .map(
                    (f) => `
                  <div class="file-chip" style="justify-content:space-between;width:100%;padding:8px 10px;">
                    <span style="display:flex;align-items:center;gap:6px;min-width:0;">
                      ${icons.paperclip}
                      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.name)}</span>
                      <span class="mono" style="color:var(--ink-muted);">${formatBytes(f.size)}</span>
                    </span>
                    <button type="button" class="btn btn--sm btn--danger-soft" data-clear-local="${esc(f.aid)}">清理本机副本</button>
                  </div>`
                  )
                  .join("")
              : `<div style="font-size:var(--text-sm);color:var(--ink-muted);">暂无已下载的离线文件副本。在项目资料中点击「保存到本机」后可断网查看。</div>`
          }
        </div>
      </section>
    </div>
  `;

  container.querySelector("#btn-logout").addEventListener("click", async () => {
    try {
      await api.logout();
    } catch (err) {
      if (err.status !== 401) {
        showToast("退出失败，请联网后重试", "error");
        return;
      }
    }
    clearSession();
  });

  container.querySelectorAll("[data-rail]").forEach((btn) => {
    btn.addEventListener("click", () => setRailSide(btn.dataset.rail));
  });

  const wsInvBtn = container.querySelector("#btn-gen-ws-invite");
  if (wsInvBtn) {
    wsInvBtn.addEventListener("click", async () => {
      try {
        const inv = await api.createInvite(null);
        const url = `${window.location.origin}/?invite=${encodeURIComponent(inv.token)}`;
        container.querySelector("#ws-invite-result").innerHTML = `
          <div class="banner banner--accent" style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:center;">
            <span class="mono" style="font-size:var(--text-xs);word-break:break-all;">${esc(url)}</span>
            <button type="button" class="btn btn--sm" id="copy-ws-inv">复制</button>
          </div>
        `;
        container.querySelector("#copy-ws-inv").addEventListener("click", () => {
          navigator.clipboard?.writeText(url);
          showToast("工作台邀请链接已复制");
        });
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  container.querySelector("#pref-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.updatePreferences(String(fd.get("evening")), fd.get("device_enabled") === "on");
      await syncNow(true);
      showToast("提醒偏好已保存");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  const notifBtn = container.querySelector("#btn-req-notif");
  if (notifBtn) {
    notifBtn.addEventListener("click", async () => {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        scheduleReminders();
        showToast("已开启浏览器通知");
      }
      renderMe(container);
    });
  }

  const quotaForm = container.querySelector("#quota-form");
  if (quotaForm) {
    quotaForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(quotaForm);
      const uid = String(fd.get("uid")).trim();
      const bytes = Math.round(Number(fd.get("mb")) * 1048576);
      try {
        await api.setUserQuota(uid, bytes);
        await syncNow(true);
        showToast("已更新用户配额");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  const flushBtn = container.querySelector("#btn-flush-outbox");
  if (flushBtn) {
    flushBtn.addEventListener("click", () => flushOutbox());
  }

  container.querySelectorAll("[data-clear-local]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ok = await openConfirmDialog({
        title: "清理本机副本",
        message: "仅释放当前设备的离线缓存空间，云端原件不受影响，后续仍可随时重新下载。",
        confirmLabel: "确认清理"
      });
      if (!ok) return;
      await offlineDB.deleteLocalFile(state.user.id, btn.dataset.clearLocal);
      await refreshLocalIndexes();
      showToast("已清理本机副本");
      renderMe(container);
    });
  });
}
