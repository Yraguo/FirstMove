const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function esc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function uuid() {
  if (crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(isoDay, delta) {
  const [y, m, d] = isoDay.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function weekdayIndex(isoDay) {
  const [y, m, d] = isoDay.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 ? 7 : dow; // 1=Mon .. 7=Sun (matches backend)
}

export function formatDueReadable(due) {
  if (!due) return "";
  const today = todayISO();
  const day = due.slice(0, 10);
  const hasTime = due.length > 10;
  const timePart = hasTime ? ` ${due.slice(11, 16)}` : "";
  const [y, m, d] = day.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const diff = Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000);
  const wk = `周${WEEKDAYS[new Date(y, m - 1, d).getDay()]}`;

  if (diff === 0) return hasTime ? `今天${timePart}` : "今天截止";
  if (diff === 1) return hasTime ? `明天${timePart}` : "明天截止";
  if (diff === -1) return hasTime ? `昨天${timePart}` : "昨天截止";
  if (diff > 1 && diff <= 6) return hasTime ? `${wk}${timePart}` : `${wk}截止`;
  const md = `${m}月${d}日`;
  return hasTime ? `${md}${timePart}` : `${md}截止`;
}

export function formatTimestamp(sec) {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function priorityLabel(p) {
  return p === 3 ? "高优先" : p === 1 ? "低优先" : "中优先";
}

export function projectKindLabel(k) {
  return k === "course" ? "课程" : k === "personal" ? "个人" : "比赛";
}

export function formatHabitDays(daysStr) {
  const set = new Set(String(daysStr || "").split(",").filter(Boolean));
  if (set.size === 7) return "每天";
  const map = { "1": "周一", "2": "周二", "3": "周三", "4": "周四", "5": "周五", "6": "周六", "7": "周日" };
  return [...set].sort().map((d) => map[d] || d).join("、");
}

export function showToast(message, type = "info") {
  const root = document.getElementById("toast-root");
  if (!root) return;
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "toast--error" : ""}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 180ms ease";
    setTimeout(() => el.remove(), 200);
  }, 3200);
}

export function openEntryDialog(trigger, title, fields, submitLabel, formId) {
  const dialog = document.createElement("dialog");
  dialog.className = "entry-dialog";
  dialog.setAttribute("aria-labelledby", "entry-title");
  dialog.innerHTML = `
    <form id="${formId}">
      <header><h2 id="entry-title">${title}</h2><button type="button" class="entry-close" aria-label="关闭">×</button></header>
      <div class="entry-body">${fields}<p class="entry-error" role="alert"></p></div>
      <footer><button type="button" class="btn" data-cancel>取消</button><button type="submit" class="btn btn--primary">${submitLabel}</button></footer>
    </form>`;
  document.getElementById("drawer-root").append(dialog);
  const cancel = () => { if (!dialog.querySelector("[type=submit]").disabled) dialog.close(); };
  dialog.querySelector(".entry-close").onclick = cancel;
  dialog.querySelector("[data-cancel]").onclick = cancel;
  dialog.oncancel = e => { if (dialog.querySelector("[type=submit]").disabled) e.preventDefault(); };
  dialog.onclose = () => {
    dialog.remove();
    document.getElementById(trigger.id)?.focus();
  };
  dialog.showModal();
  return dialog;
}

export function openConfirmDialog({ title, message, confirmLabel = "确认", danger = false }) {
  return new Promise((resolve) => {
    const parent = document.querySelector("dialog.entry-dialog[open]");
    const root = parent ? document.createElement("dialog") : document.getElementById("dialog-root");
    if (parent) {
      root.className = "confirm-layer";
      parent.append(root);
      root.showModal();
      root.oncancel = e => { e.preventDefault(); cleanup(false); };
    }
    root.innerHTML = `
      <div class="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div class="dialog-box">
          <h3 id="dlg-title" class="drawer-title">${esc(title)}</h3>
          <div style="font-size: var(--text-sm); color: var(--ink-secondary); line-height: 1.6;">${message}</div>
          <div class="dialog-actions">
            <button type="button" class="btn" data-dlg-cancel>取消</button>
            <button type="button" class="btn ${danger ? "btn--danger" : "btn--primary"}" data-dlg-ok>${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>
    `;
    const cleanup = (val) => {
      if (parent) root.remove();
      else root.innerHTML = "";
      resolve(val);
    };
    root.querySelector("[data-dlg-cancel]").addEventListener("click", () => cleanup(false));
    root.querySelector("[data-dlg-ok]").addEventListener("click", () => cleanup(true));
    root.querySelector(".dialog-backdrop").addEventListener("click", (e) => {
      if (e.target.classList.contains("dialog-backdrop")) cleanup(false);
    });
  });
}
