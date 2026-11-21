import { api } from "../api.js";
import { icons } from "../icons.js";
import { offlineDB } from "../offline.js";
import { saveBlobToDevice } from "../native.js";
import {
  createRecordOfflineAware,
  getMergedRecords,
  refreshLocalIndexes,
  state,
  syncNow
} from "../store.js";
import {
  esc,
  formatBytes,
  formatTimestamp,
  openConfirmDialog,
  openEntryDialog,
  showToast,
  uuid
} from "../utils.js";

export function renderRecords(container) {
  const projectMap = new Map(state.projects.map((p) => [p.id, p]));
  const records = getMergedRecords();
  const conflictByRid = new Map();
  for (const c of state.conflicts) {
    conflictByRid.set(c.rid, (conflictByRid.get(c.rid) || 0) + 1);
  }
  const filesByRid = new Map();
  for (const f of state.files) {
    const arr = filesByRid.get(f.rid) || [];
    arr.push(f);
    filesByRid.set(f.rid, arr);
  }

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">记录</h1>
      </div>
      <button id="new-record" class="btn btn--primary entry-launch" type="button">${icons.plus}新建记录</button>
    </div>

    <section class="surface" aria-label="历史记录时间线">
      <div class="surface-header">
        <h2 class="surface-title">时间线 <span class="tabular" style="color:var(--ink-muted);font-weight:500;">(${records.length})</span></h2>

      </div>
      ${
        records.length
          ? records
              .map((r) => {
                const proj = r.pid ? projectMap.get(r.pid) : null;
                const atts = [...(filesByRid.get(r.id) || []), ...(r._pendingFiles || [])];
                const conflictCount = conflictByRid.get(r.id) || 0;
                return `
                  <article class="record-item" data-rec-id="${esc(r.id)}">
                    <div class="record-meta">
                      <span class="tabular">${formatTimestamp(r.created)}</span>
                      <span class="tag">${r.kind === "note" ? "笔记" : r.kind === "task" ? "任务备忘" : "记录"}</span>
                      ${r.pinned ? `<span class="tag tag--accent">已置顶</span>` : ""}
                      ${
                        proj
                          ? `<span class="tag"><span class="proj-dot" style="background:${esc(proj.color)}"></span>${esc(proj.name)}</span>`
                          : r.former
                            ? `<span class="tag">原项目：${esc(r.former)}</span>`
                            : ""
                      }
                      ${r.shared ? `<span class="tag tag--success">已共享给项目成员</span>` : ""}
                      ${r._pending ? `<span class="tag tag--warn">待同步</span>` : ""}
                      ${conflictCount ? `<span class="tag tag--danger">${conflictCount} 处冲突待解决</span>` : ""}
                    </div>
                    ${r.title ? `<strong style="font-size:var(--text-base);">${esc(r.title)}</strong>` : ""}
                    ${r.body ? `<p class="record-body">${esc(r.body)}</p>` : ""}
                    ${
                      atts.length
                        ? `<div class="file-chip-list">
                            ${atts
                              .map((a) => {
                                const isLocal = state.localFileIds.has(a.id);
                                return `
                                  <span class="file-chip">
                                    ${icons.paperclip}
                                    <span>${esc(a.name)}</span>
                                    <span class="mono" style="color:var(--ink-muted);">${formatBytes(a.size)}</span>
                                    ${a._pending ? `<span class="tag tag--warn">待同步</span>` : isLocal ? `<span class="tag tag--success">本机可用</span>` : ""}
                                  </span>
                                `;
                              })
                              .join("")}
                          </div>`
                        : ""
                    }
                    ${
                      !r._pending
                        ? `<div class="record-actions">
                            <button type="button" class="btn btn--sm" data-open-record="${esc(r.id)}">编辑 / 整理</button>
                            ${
                              r.kind !== "task"
                                ? `<button type="button" class="btn btn--sm" data-to-task="${esc(r.id)}" data-task-status="open">转待办</button>
                                   <button type="button" class="btn btn--sm" data-to-task="${esc(r.id)}" data-task-status="waiting">转等待确认</button>`
                                : ""
                            }
                          </div>`
                        : ""
                    }
                  </article>
                `;
              })
              .join("")
          : `<div class="empty-state">
              <p class="empty-state-title">还没有记录</p>
              <p class="empty-state-desc">点「新建记录」写下第一条笔记。</p>
            </div>`
      }
    </section>
  `;

  const trigger = container.querySelector("#new-record");
  trigger.onclick = () => openRecordComposer(trigger);
  bindRecordActions(container);
}

export function openRecordComposer(trigger, pid = null) {
  const composerFiles = [];
  const fields = `
    <label class="entry-field">正文<textarea class="textarea" name="body" rows="4" placeholder="记下想法、课堂要点或链接…" autofocus></textarea></label>
    <label class="entry-field">标题（可选）<input class="input" name="title" maxlength="240"></label>
    <div class="entry-grid">
      <label class="entry-field">类型<select class="select" name="kind"><option value="memo">随手记</option><option value="note">笔记</option></select></label>
      <label class="entry-field">所属项目<select class="select" name="pid"><option value="">仅我的记录</option>${state.projects.filter(p => !p.trashed).map(p => `<option value="${esc(p.id)}" ${p.id === pid ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
    </div>
    <label class="entry-file">${icons.paperclip}添加图片或文件<input type="file" id="composer-file-input" multiple></label>
    <div id="composer-file-preview" class="file-chip-list"></div>`;
  const container = openEntryDialog(trigger, "新建记录", fields, "保存记录", "record-composer-form");

  const form = container.querySelector("#record-composer-form");
  const fileInput = container.querySelector("#composer-file-input");
  const preview = container.querySelector("#composer-file-preview");

  function renderPreview() {
    preview.innerHTML = composerFiles
      .map(
        (f, idx) => `
        <span class="file-chip">
          ${icons.paperclip}
          <span>${esc(f.name)}</span>
          <span class="mono" style="color:var(--ink-muted);">${formatBytes(f.blob.size)}</span>
          <button type="button" class="btn btn--sm btn--ghost" data-rm-file="${idx}">${icons.x}</button>
        </span>`
      )
      .join("");
    preview.querySelectorAll("[data-rm-file]").forEach((b) => {
      b.addEventListener("click", () => {
        composerFiles.splice(Number(b.dataset.rmFile), 1);
        renderPreview();
      });
    });
  }
  renderPreview();

  fileInput.addEventListener("change", async () => {
    for (const file of Array.from(fileInput.files || [])) {
      if (file.size > state.storage.file_limit) {
        form.querySelector(".entry-error").textContent = `${file.name} 超过单文件上限（${formatBytes(state.storage.file_limit)}），可以改存链接。`;
        continue;
      }
      if (file.size >= state.storage.large_file_hint) {
        const ok = await openConfirmDialog({
          title: "大文件上传提示",
          message: `文件「${esc(file.name)}」大小为 <strong>${formatBytes(file.size)}</strong>，当前剩余可用空间 <strong>${formatBytes(state.storage.available)}</strong>。是否上传原件？取消后可在正文改存外部网盘链接。`,
          confirmLabel: "上传原件"
        });
        if (!ok) continue;
      }
      composerFiles.push({ aid: uuid(), name: file.name, blob: file });
    }
    fileInput.value = "";
    renderPreview();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const title = String(fd.get("title") || "").trim();
    const body = String(fd.get("body") || "").trim();
    const kind = String(fd.get("kind") || "memo");
    const pid = String(fd.get("pid") || "").trim() || null;

    if (!title && !body && !composerFiles.length) {
      form.querySelector(".entry-error").textContent = "请输入内容或添加附件";
      return;
    }

    const submit = form.querySelector("[type=submit]");
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      await createRecordOfflineAware({ id: uuid(), title, body, kind, pid }, [...composerFiles]);
      container.close();
    } catch (err) {
      form.querySelector(".entry-error").textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });
}

function bindRecordActions(container) {
  container.querySelectorAll("[data-open-record]").forEach((btn) => {
    btn.addEventListener("click", () => openRecordDrawer(btn.dataset.openRecord));
  });

  container.querySelectorAll("[data-to-task]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rid = btn.dataset.toTask;
      const status = btn.dataset.taskStatus;
      const rec = state.records.find((r) => r.id === rid);
      const defaultTitle = (rec && (rec.title || rec.body.split("\n")[0].slice(0, 60))) || "来自记录的待办";
      try {
        await api.convertRecordToTask(rid, {
          id: uuid(),
          title: defaultTitle,
          status,
          pid: rec?.pid || null
        });
        await syncNow(true);
        showToast(status === "waiting" ? "已转为等待确认，可在日程中补充截止日" : "已转为日程待办");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });
}

export async function openRecordDrawer(rid) {
  const root = document.getElementById("drawer-root");
  let detail;
  try {
    detail = navigator.onLine
      ? await api.getRecord(rid)
      : {
          ...(state.records.find((r) => r.id === rid) || {}),
          attachments: state.files.filter((f) => f.rid === rid),
          conflicts: []
        };
  } catch (err) {
    showToast(err.message, "error");
    return;
  }

  const isAuthor = detail.uid === state.user.id;
  const activeProjects = state.projects.filter((p) => !p.trashed);

  root.innerHTML = `
    <div class="drawer-backdrop" id="rec-drawer-bg">
      <div class="drawer" role="dialog" aria-modal="true" aria-label="记录详情">
        <div class="drawer-header">
          <h2 class="drawer-title">记录与资料详情</h2>
          <button type="button" class="btn btn--ghost btn--icon" id="rec-close">${icons.x}</button>
        </div>
        <div class="drawer-body">
          ${
            (detail.conflicts || []).length
              ? `
            <div class="banner banner--danger" style="display:grid;gap:10px;">
              <strong>检测到多端同段编辑冲突（共 ${detail.conflicts.length} 个冲突版本）</strong>
              ${detail.conflicts
                .map(
                  (c) => `
                <div style="background:var(--bg-surface);padding:10px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);display:grid;gap:8px;">
                  <div style="font-size:var(--text-xs);color:var(--ink-muted);">另一端提交的版本（基于 v${c.base}）：</div>
                  <pre style="margin:0;white-space:pre-wrap;font-family:inherit;font-size:var(--text-sm);">${esc(c.body)}</pre>
                  <div style="display:flex;gap:6px;">
                    <button type="button" class="btn btn--sm btn--primary" data-resolve-keep="incoming" data-cid="${esc(c.id)}">采用此冲突版本</button>
                    <button type="button" class="btn btn--sm" data-resolve-keep="current" data-cid="${esc(c.id)}">保留当前正文</button>
                  </div>
                </div>`
                )
                .join("")}
            </div>
          `
              : ""
          }

          <form id="rec-edit-form" style="display:grid;gap:12px;">
            <label class="field">
              <span class="field-label">标题</span>
              <input class="input" name="title" value="${esc(detail.title || "")}" ${isAuthor ? "" : "disabled"} />
            </label>
            <label class="field">
              <span class="field-label">正文（版本 v${detail.version || 1}）</span>
              <textarea class="textarea" name="body" rows="6" ${isAuthor ? "" : "disabled"}>${esc(detail.body || "")}</textarea>
            </label>
            <div class="field-row">
              <label class="field">
                <span class="field-label">类型</span>
                <select class="select" name="kind" ${isAuthor && detail.kind !== "task" ? "" : "disabled"}>
                  <option value="memo" ${detail.kind === "memo" ? "selected" : ""}>随手记录</option>
                  <option value="note" ${detail.kind === "note" ? "selected" : ""}>正式笔记</option>
                  ${detail.kind === "task" ? `<option value="task" selected>任务备忘</option>` : ""}
                </select>
              </label>
              <label class="field">
                <span class="field-label">归属项目</span>
                <select class="select" name="pid" ${isAuthor ? "" : "disabled"}>
                  <option value="">不归属项目</option>
                  ${activeProjects.map((p) => `<option value="${esc(p.id)}" ${detail.pid === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
                </select>
              </label>
            </div>
            ${
              isAuthor
                ? `
              <div style="display:flex;flex-wrap:wrap;gap:14px;">
                <label style="display:inline-flex;align-items:center;gap:6px;font-size:var(--text-sm);cursor:pointer;">
                  <input type="checkbox" name="shared" ${detail.shared ? "checked" : ""} />
                  <span>主动分享给项目成员</span>
                </label>
                <label style="display:inline-flex;align-items:center;gap:6px;font-size:var(--text-sm);cursor:pointer;">
                  <input type="checkbox" name="pinned" ${detail.pinned ? "checked" : ""} />
                  <span>在项目中置顶</span>
                </label>
              </div>
            `
                : ""
            }
          </form>

          <div class="field">
            <span class="field-label">附件（${(detail.attachments || []).length}）</span>
            <div style="display:grid;gap:6px;">
              ${(detail.attachments || [])
                .map((a) => {
                  const isLocal = state.localFileIds.has(a.id);
                  return `
                    <div class="file-chip" style="justify-content:space-between;width:100%;padding:7px 10px;">
                      <span style="display:flex;align-items:center;gap:6px;min-width:0;">
                        ${icons.paperclip}
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.name)}</span>
                        <span class="mono" style="color:var(--ink-muted);">${formatBytes(a.size)}</span>
                        ${isLocal ? `<span class="tag tag--success">本机可用</span>` : ""}
                      </span>
                      <span style="display:flex;gap:4px;">
                        <button type="button" class="btn btn--sm" data-open-file="${esc(a.id)}" data-file-name="${esc(a.name)}" data-file-size="${a.size}">
                          ${isLocal ? "打开" : "下载保存"}
                        </button>
                        ${isAuthor ? `<button type="button" class="btn btn--sm btn--ghost" data-unlink-file="${esc(a.id)}">${icons.trash}</button>` : ""}
                      </span>
                    </div>
                  `;
                })
                .join("")}
            </div>
            ${
              isAuthor
                ? `
              <div style="margin-top:8px;">
                <label class="btn btn--sm" style="cursor:pointer;">
                  ${icons.paperclip}<span>补充上传附件</span>
                  <input type="file" id="rec-add-file" style="display:none;" />
                </label>
              </div>
            `
                : ""
            }
          </div>
        </div>

        <div class="drawer-footer">
          ${
            isAuthor && detail.kind !== "task"
              ? `<button type="button" class="btn btn--danger-soft" id="rec-delete">删除记录</button>`
              : `<span></span>`
          }
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn" id="rec-cancel">关闭</button>
            ${isAuthor ? `<button type="submit" form="rec-edit-form" class="btn btn--primary">保存</button>` : ""}
          </div>
        </div>
      </div>
    </div>
  `;

  const close = () => (root.innerHTML = "");
  root.querySelector("#rec-close").addEventListener("click", close);
  root.querySelector("#rec-cancel").addEventListener("click", close);
  root.querySelector("#rec-drawer-bg").addEventListener("click", (e) => {
    if (e.target.id === "rec-drawer-bg") close();
  });

  // Conflict resolution
  root.querySelectorAll("[data-resolve-keep]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cid = btn.dataset.cid;
      const keep = btn.dataset.resolveKeep;
      const conflict = (detail.conflicts || []).find((c) => c.id === cid);
      const chosenBody = keep === "incoming" ? conflict.body : detail.body;
      try {
        await api.resolveConflict(detail.id, cid, detail.version, chosenBody);
        await syncNow(true);
        showToast("冲突已解决");
        openRecordDrawer(detail.id);
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  // File download / open (works offline when cached in IndexedDB!)
  root.querySelectorAll("[data-open-file]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const aid = btn.dataset.openFile;
      const name = btn.dataset.fileName;
      const size = Number(btn.dataset.fileSize || 0);
      try {
        let local = await offlineDB.getLocalFile(state.user.id, aid);
        let blob;
        if (local) {
          blob = local.blob;
        } else {
          blob = await api.downloadFile(aid);
          await offlineDB.saveLocalFile(state.user.id, aid, name, size || blob.size, blob);
          await refreshLocalIndexes();
          showToast(`已保存到本机：${name}`);
        }
        const saved = await saveBlobToDevice(name, blob);
        if (saved !== null) {
          showToast(saved);
          openRecordDrawer(detail.id);
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        openRecordDrawer(detail.id);
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  root.querySelectorAll("[data-unlink-file]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api.unlinkFile(detail.id, btn.dataset.unlinkFile);
        await syncNow(true);
        showToast("已移除附件引用");
        openRecordDrawer(detail.id);
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  const addFileInput = root.querySelector("#rec-add-file");
  if (addFileInput) {
    addFileInput.addEventListener("change", async () => {
      const file = addFileInput.files[0];
      if (!file) return;
      try {
        await api.uploadFile(detail.id, uuid(), file.name, file);
        await syncNow(true);
        showToast(`已上传 ${file.name}`);
        openRecordDrawer(detail.id);
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  const delBtn = root.querySelector("#rec-delete");
  if (delBtn) {
    delBtn.addEventListener("click", async () => {
      const ok = await openConfirmDialog({
        title: "删除记录",
        message: "删除后将无法恢复，且仅被该记录引用的附件也会释放空间。",
        confirmLabel: "确认删除",
        danger: true
      });
      if (!ok) return;
      try {
        await api.deleteRecord(detail.id);
        await syncNow(true);
        showToast("记录已删除");
        close();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  const form = root.querySelector("#rec-edit-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const meta = {
      title: String(fd.get("title") || ""),
      pid: String(fd.get("pid") || "").trim() || null,
      shared: fd.get("shared") === "on",
      pinned: fd.get("pinned") === "on"
    };
    if (detail.kind !== "task") {
      meta.kind = String(fd.get("kind") || "memo");
    }
    const nextBody = String(fd.get("body") || "");
    try {
      await api.editRecordMeta(detail.id, meta);
      if (nextBody !== detail.body) {
        const res = await api.editRecordBody(detail.id, detail.version, nextBody);
        if (res.conflict_id) {
          showToast("检测到同时编辑冲突，请在详情中确认保留版本", "error");
          await syncNow(true);
          openRecordDrawer(detail.id);
          return;
        }
      }
      await syncNow(true);
      showToast("记录已保存");
      close();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}
