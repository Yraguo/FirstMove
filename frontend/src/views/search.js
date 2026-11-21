import { api } from "../api.js";
import { icons } from "../icons.js";
import { offlineDB } from "../offline.js";
import { refreshLocalIndexes, setState, state } from "../store.js";
import { esc, formatBytes, projectKindLabel, showToast } from "../utils.js";
import { openRecordDrawer } from "./records.js";

export async function renderSearch(container, query) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">搜索结果</h1>
        <p class="page-subtitle">关键词：「${esc(query)}」 · 覆盖当前账号有权限访问的项目、记录与附件</p>
      </div>
      <button type="button" class="btn btn--sm" id="btn-exit-search">返回工作区</button>
    </div>
    <div id="search-results-body" class="surface surface-body">
      <div class="skeleton-bar"></div>
    </div>
  `;

  container.querySelector("#btn-exit-search").addEventListener("click", () => {
    setState({ searchQuery: "" });
  });

  let data;
  if (navigator.onLine) {
    try {
      data = await api.search(query);
    } catch {
      data = offlineSearch(query);
    }
  } else {
    data = offlineSearch(query);
  }

  const body = container.querySelector("#search-results-body");
  const total = (data.projects?.length || 0) + (data.records?.length || 0) + (data.files?.length || 0);

  if (!total) {
    body.innerHTML = `
      <div class="empty-state">
        <p class="empty-state-title">没有找到与「${esc(query)}」相关的内容</p>
        <p class="empty-state-desc">试试更短的关键词，支持按项目名（含已删除项目的原名称）、记录正文与附件文件名搜索。</p>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div style="display:grid;gap:20px;">
      ${
        data.projects.length
          ? `
        <div>
          <h2 class="surface-title" style="margin-bottom:8px;">项目（${data.projects.length}）</h2>
          <div style="display:grid;gap:6px;">
            ${data.projects
              .map(
                (p) => `
              <button type="button" class="btn" style="justify-content:flex-start;height:auto;padding:10px 12px;" data-jump-proj="${esc(p.id)}">
                <span class="proj-dot" style="background:${esc(p.color)}"></span>
                <strong>${esc(p.name)}</strong>
                <span class="tag">${projectKindLabel(p.kind)}</span>
                ${p.archived ? `<span class="tag">已归档</span>` : ""}
              </button>`
              )
              .join("")}
          </div>
        </div>
      `
          : ""
      }

      ${
        data.records.length
          ? `
        <div>
          <h2 class="surface-title" style="margin-bottom:8px;">记录与笔记（${data.records.length}）</h2>
          <div style="display:grid;gap:6px;">
            ${data.records
              .map(
                (r) => `
              <div class="file-chip" style="justify-content:space-between;width:100%;padding:10px 12px;cursor:pointer;" data-jump-rec="${esc(r.id)}">
                <div style="min-width:0;">
                  <div style="font-weight:600;font-size:var(--text-sm);">${esc(r.title || r.body.slice(0, 60) || "无标题记录")}</div>
                  <div style="font-size:var(--text-xs);color:var(--ink-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${r.former ? `原项目：${esc(r.former)} · ` : ""}${esc(r.body.slice(0, 120))}
                  </div>
                </div>
                <span class="btn btn--sm">查看</span>
              </div>`
              )
              .join("")}
          </div>
        </div>
      `
          : ""
      }

      ${
        data.files.length
          ? `
        <div>
          <h2 class="surface-title" style="margin-bottom:8px;">附件资料（${data.files.length}）</h2>
          <div style="display:grid;gap:6px;">
            ${data.files
              .map((f) => {
                const isLocal = state.localFileIds.has(f.id);
                return `
                  <div class="file-chip" style="justify-content:space-between;width:100%;padding:8px 12px;">
                    <span style="display:flex;align-items:center;gap:6px;min-width:0;">
                      ${icons.paperclip}
                      <span>${esc(f.name)}</span>
                      <span class="mono" style="color:var(--ink-muted);">${formatBytes(f.size)}</span>
                      ${isLocal ? `<span class="tag tag--success">本机可用</span>` : ""}
                    </span>
                    <button type="button" class="btn btn--sm" data-dl-search-file="${esc(f.id)}" data-fname="${esc(f.name)}" data-fsize="${f.size}">
                      ${isLocal ? "离线打开" : "下载"}
                    </button>
                  </div>`;
              })
              .join("")}
          </div>
        </div>
      `
          : ""
      }
    </div>
  `;

  body.querySelectorAll("[data-jump-proj]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setState({ searchQuery: "", tab: "projects", activeProjectId: btn.dataset.jumpProj });
    });
  });

  body.querySelectorAll("[data-jump-rec]").forEach((el) => {
    el.addEventListener("click", () => openRecordDrawer(el.dataset.jumpRec));
  });

  body.querySelectorAll("[data-dl-search-file]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const aid = btn.dataset.dlSearchFile;
      const name = btn.dataset.fname;
      const size = Number(btn.dataset.fsize || 0);
      try {
        let local = await offlineDB.getLocalFile(state.user.id, aid);
        let blob = local ? local.blob : await api.downloadFile(aid);
        if (!local) {
          await offlineDB.saveLocalFile(state.user.id, aid, name, size || blob.size, blob);
          await refreshLocalIndexes();
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });
}

function offlineSearch(q) {
  const term = q.toLowerCase().trim();
  return {
    projects: state.projects.filter((p) => !p.trashed && p.name.toLowerCase().includes(term)),
    records: state.records.filter((r) =>
      [r.title, r.body, r.former].some((v) => (v || "").toLowerCase().includes(term))
    ),
    files: state.files.filter((f) => (f.name || "").toLowerCase().includes(term))
  };
}
