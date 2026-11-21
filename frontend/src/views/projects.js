import { api } from "../api.js";
import { icons } from "../icons.js";
import { offlineDB } from "../offline.js";
import {
  getMergedRecords,
  refreshLocalIndexes,
  setState,
  state,
  syncNow
} from "../store.js";
import {
  esc,
  formatBytes,
  formatDueReadable,
  formatTimestamp,
  openConfirmDialog,
  priorityLabel,
  projectKindLabel,
  showToast,
  uuid
} from "../utils.js";
import { openRecordDrawer, openRecordComposer } from "./records.js";

const PRESET_COLORS = ["#4776BE", "#3F8575", "#895EA8", "#AB6940", "#68793E", "#B65454", "#3E7C99"];
let projectSearchTerm = "";

export function renderProjects(container) {
  if (state.activeProjectId) {
    const target = state.projects.find((p) => p.id === state.activeProjectId);
    if (target) {
      renderProjectDetail(container, target);
      return;
    }
    state.activeProjectId = null;
  }

  const filter = state.projectsFilter;
  const term = projectSearchTerm.trim().toLowerCase();

  const filtered = state.projects.filter((p) => {
    if (term && !p.name.toLowerCase().includes(term)) return false;
    if (filter === "trash") return Boolean(p.trashed);
    if (p.trashed) return false;
    if (filter === "archived") return Boolean(p.archived);
    if (filter === "hidden") return Boolean(p.hidden) && !p.archived;
    return !p.archived && !p.hidden;
  });

  const trashCount = state.projects.filter((p) => p.trashed).length;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">项目</h1>
        <p class="page-subtitle">${state.projects.filter(p => !p.trashed && !p.archived && !p.hidden).length} 个进行中的项目</p>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <div class="segmented" role="tablist">
          <button type="button" class="segmented-btn" data-pfilter="active" aria-selected="${filter === "active"}">进行中</button>
          <button type="button" class="segmented-btn" data-pfilter="archived" aria-selected="${filter === "archived"}">已结束</button>
          <button type="button" class="segmented-btn" data-pfilter="hidden" aria-selected="${filter === "hidden"}">已收起</button>
          <button type="button" class="segmented-btn" data-pfilter="trash" aria-selected="${filter === "trash"}">回收站${trashCount ? ` (${trashCount})` : ""}</button>
        </div>
        <button type="button" class="btn btn--primary" id="btn-new-project">${icons.plus}<span>新建项目</span></button>
      </div>
    </div>

    <div style="margin-bottom:14px;max-width:360px;position:relative;">
      <span class="search-box-icon">${icons.search}</span>
      <input class="search-input" id="project-local-search" value="${esc(projectSearchTerm)}" placeholder="按项目名称筛选课程或比赛…" />
    </div>

    ${
      filtered.length
        ? `<div class="project-grid">${filtered.map((p) => renderProjectCard(p, filter === "trash")).join("")}</div>`
        : `<div class="surface empty-state">
            <p class="empty-state-title">${filter === "trash" ? "回收站为空" : "没有匹配的项目"}</p>
            <p class="empty-state-desc">${
              filter === "trash"
                ? "移入回收站的项目将保留 7 天，期间随时可以恢复。"
                : "点击右上角「新建项目」创建一门课程或一场比赛。"
            }</p>
          </div>`
    }
  `;

  container.querySelectorAll("[data-pfilter]").forEach((btn) => {
    btn.addEventListener("click", () => setState({ projectsFilter: btn.dataset.pfilter }));
  });

  const searchInput = container.querySelector("#project-local-search");
  searchInput.addEventListener("input", (e) => {
    projectSearchTerm = e.target.value;
    renderProjects(container);
  });

  container.querySelector("#btn-new-project").addEventListener("click", () => openCreateProjectDrawer());

  if (filter === "trash") {
    bindTrashCardActions(container);
  } else {
    container.querySelectorAll("[data-open-project]").forEach((card) => {
      card.addEventListener("click", () => setState({ activeProjectId: card.dataset.openProject }));
    });
  }
}

function renderProjectCard(p, isTrash) {
  const nextNode = p.next_personal
    ? `${formatDueReadable(p.next_personal.due || p.next_personal.prepare)} · ${p.next_personal.title}`
    : p.next_due
      ? `最近节点：${formatDueReadable(p.next_due)}`
      : "暂无待交付节点";

  const expiryText =
    isTrash && p.trashed ? `清除日期：${formatTimestamp(p.trashed + 7 * 86400).slice(0, 10)}` : "";

  return `
    <article class="project-card" ${isTrash ? "" : `data-open-project="${esc(p.id)}"`}>
      <div class="project-card-head">
        <span class="proj-dot" style="width:10px;height:10px;background:${esc(p.color)}"></span>
        <h3 class="project-card-name">${esc(p.name)}</h3>
        ${p.pinned ? `<span class="tag tag--accent" style="margin-left:auto;">置顶</span>` : ""}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:var(--text-xs);color:var(--ink-secondary);">
        <span class="tag">${projectKindLabel(p.kind)}</span>
        <span class="tag">${priorityLabel(p.priority)}</span>
        ${p.start || p.end ? `<span class="tabular">${esc(p.start || "?")} ~ ${esc(p.end || "?")}</span>` : ""}
      </div>
      <div style="font-size:var(--text-sm);color:var(--ink-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${esc(isTrash ? expiryText : nextNode)}
      </div>
      ${
        isTrash && p.lead === state.user.id
          ? `<div style="display:flex;gap:8px;margin-top:4px;">
              <button type="button" class="btn btn--sm btn--primary" data-restore-proj="${esc(p.id)}">恢复项目</button>
              <button type="button" class="btn btn--sm btn--danger-soft" data-purge-proj="${esc(p.id)}" data-proj-name="${esc(p.name)}">永久删除</button>
            </div>`
          : ""
      }
    </article>
  `;
}

function bindTrashCardActions(container) {
  container.querySelectorAll("[data-restore-proj]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api.restoreProject(btn.dataset.restoreProj);
        await syncNow(true);
        showToast("项目已从回收站恢复");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  container.querySelectorAll("[data-purge-proj]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pid = btn.dataset.purgeProj;
      const name = btn.dataset.projName;
      let infoText = `确定永久删除项目「${esc(name)}」吗？`;
      try {
        const preview = await api.deletionPreview(pid);
        infoText = `即将永久删除项目「<strong>${esc(preview.name)}</strong>」，清除 <strong>${preview.shared_records}</strong> 条共享记录与 <strong>${preview.attachments}</strong> 份附件引用，预计释放 <strong>${formatBytes(preview.reclaimable_bytes)}</strong> 空间。成员的私人复盘笔记将保留在「我的记录」中。`;
      } catch {
        // fallback message
      }
      const ok = await openConfirmDialog({
        title: "永久删除项目",
        message: infoText,
        confirmLabel: "确认永久删除",
        danger: true
      });
      if (!ok) return;
      try {
        await api.purgeProject(pid);
        await syncNow(true);
        showToast("项目已永久删除");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });
}

function openCreateProjectDrawer() {
  const root = document.getElementById("drawer-root");
  root.innerHTML = `
    <div class="drawer-backdrop" id="proj-create-bg">
      <div class="drawer" role="dialog" aria-modal="true" aria-label="新建项目">
        <div class="drawer-header">
          <h2 class="drawer-title">新建项目</h2>
          <button type="button" class="btn btn--ghost btn--icon" id="pc-close">${icons.x}</button>
        </div>
        <form class="drawer-body" id="pc-form">
          <label class="field">
            <span class="field-label">项目名称</span>
            <input class="input" name="name" required placeholder="例如：萌芽杯创新赛 / 数学建模 / 概率论" />
          </label>
          <div class="field-row">
            <label class="field">
              <span class="field-label">类型</span>
              <select class="select" name="kind">
                <option value="contest">比赛（支持准备建议与团队分工）</option>
                <option value="course">课程</option>
                <option value="personal">个人专题</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">默认优先级</span>
              <select class="select" name="priority">
                <option value="3">高优先级</option>
                <option value="2" selected>中优先级</option>
                <option value="1">低优先级</option>
              </select>
            </label>
          </div>
          <div class="field-row">
            <label class="field">
              <span class="field-label">开始日期（可选）</span>
              <input class="input" type="date" name="start" />
            </label>
            <label class="field">
              <span class="field-label">总截止日（可选，比赛填写后可生成阶段建议）</span>
              <input class="input" type="date" name="end" />
            </label>
          </div>
        </form>
        <div class="drawer-footer">
          <span></span>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn" id="pc-cancel">取消</button>
            <button type="submit" form="pc-form" class="btn btn--primary">创建项目</button>
          </div>
        </div>
      </div>
    </div>
  `;
  const close = () => (root.innerHTML = "");
  root.querySelector("#pc-close").addEventListener("click", close);
  root.querySelector("#pc-cancel").addEventListener("click", close);
  root.querySelector("#proj-create-bg").addEventListener("click", (e) => {
    if (e.target.id === "proj-create-bg") close();
  });
  root.querySelector("#pc-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      id: uuid(),
      name: String(fd.get("name") || "").trim(),
      kind: String(fd.get("kind") || "contest"),
      priority: Number(fd.get("priority") || 2),
      start: String(fd.get("start") || "").trim() || null,
      end: String(fd.get("end") || "").trim() || null
    };
    try {
      const created = await api.createProject(payload);
      await syncNow(true);
      close();
      setState({ activeProjectId: created.id });
      showToast("项目已创建");
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

// Project Workspace Detail
async function renderProjectDetail(container, p) {
  const isLead = p.lead === state.user.id;
  const projectRecords = getMergedRecords(p.id);
  const projectRecordIds = new Set(projectRecords.map((r) => r.id));
  const projectFiles = state.files.filter((f) => projectRecordIds.has(f.rid));

  container.innerHTML = `
    <div style="margin-bottom:12px;">
      <button type="button" class="btn btn--sm btn--ghost" id="btn-back-projects">${icons.chevronLeft}<span>返回项目列表</span></button>
    </div>

    <div class="page-header">
      <div style="display:flex;align-items:center;gap:10px;min-width:0;">
        <span class="proj-dot" style="width:14px;height:14px;background:${esc(p.color)}"></span>
        <div>
          <h1 class="page-title">${esc(p.name)}</h1>
          <p class="page-subtitle">
            ${projectKindLabel(p.kind)} · ${priorityLabel(p.priority)}
            ${p.start || p.end ? ` · ${esc(p.start || "?")} 至 ${esc(p.end || "?")}` : ""}
            ${p.archived ? " · 已归档" : ""}
          </p>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        <button type="button" class="btn btn--sm" id="btn-toggle-pin">${icons.pin}<span>${p.pinned ? "取消置顶" : "置顶项目"}</span></button>
        <button type="button" class="btn btn--sm" id="btn-toggle-hide">${p.hidden ? "恢复显示" : "从首页收起"}</button>
        ${isLead ? `<button type="button" class="btn btn--sm" id="btn-edit-proj">项目设置</button>` : ""}
        ${
          isLead
            ? `<button type="button" class="btn btn--sm" id="btn-archive-proj">${p.archived ? "取消归档" : "归档项目"}</button>
               <button type="button" class="btn btn--sm btn--danger-soft" id="btn-trash-proj">${icons.trash}<span>移入回收站</span></button>`
            : `<button type="button" class="btn btn--sm btn--danger-soft" id="btn-leave-proj">退出项目</button>`
        }
      </div>
    </div>

    <div style="display:grid;gap:18px;">
      <div id="proj-suggestions-slot"></div>
      <div id="proj-team-slot"></div>
      <div id="proj-materials-slot"></div>
    </div>
  `;

  container.querySelector("#btn-back-projects").addEventListener("click", () => setState({ activeProjectId: null }));

  container.querySelector("#btn-toggle-pin").addEventListener("click", async () => {
    try {
      await api.projectFlags(p.id, !p.pinned, Boolean(p.hidden));
      await syncNow(true);
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  container.querySelector("#btn-toggle-hide").addEventListener("click", async () => {
    try {
      await api.projectFlags(p.id, Boolean(p.pinned), !p.hidden);
      await syncNow(true);
      showToast(p.hidden ? "已恢复到进行中列表" : "已从项目首页收起");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  if (isLead) {
    container.querySelector("#btn-edit-proj").addEventListener("click", () => openEditProjectDrawer(p));
    container.querySelector("#btn-archive-proj").addEventListener("click", async () => {
      try {
        await api.editProject(p.id, { archived: !p.archived });
        await syncNow(true);
        showToast(p.archived ? "已取消归档" : "已归档至「已结束」，资料仍可搜索");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
    container.querySelector("#btn-trash-proj").addEventListener("click", async () => {
      let msg = `确认将项目「${esc(p.name)}」移入回收站吗？`;
      try {
        const preview = await api.deletionPreview(p.id);
        msg = `项目「<strong>${esc(preview.name)}</strong>」包含 <strong>${preview.shared_records}</strong> 条共享记录与 <strong>${preview.attachments}</strong> 份附件引用（预计永久删除可释放 <strong>${formatBytes(preview.reclaimable_bytes)}</strong>）。移入回收站后保留 7 天可恢复，成员私人笔记将继续保留。`;
      } catch {
        // ignore preview error
      }
      const ok = await openConfirmDialog({
        title: "移入回收站",
        message: msg,
        confirmLabel: "确认移入回收站",
        danger: true
      });
      if (!ok) return;
      try {
        await api.trashProject(p.id);
        await syncNow(true);
        setState({ activeProjectId: null, projectsFilter: "trash" });
        showToast("已移入回收站，7 天内可恢复");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  } else {
    container.querySelector("#btn-leave-proj").addEventListener("click", async () => {
      const ok = await openConfirmDialog({
        title: "退出团队项目",
        message: "退出后将不再看到项目共享资料，你的私人笔记会保留在「我的记录」中并记录原项目名。",
        confirmLabel: "确认退出",
        danger: true
      });
      if (!ok) return;
      try {
        await api.leaveProject(p.id);
        await syncNow(true);
        setState({ activeProjectId: null });
        showToast("已退出项目");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  // Load contest suggestions, team, and materials
  renderProjectSuggestions(container.querySelector("#proj-suggestions-slot"), p);
  renderProjectTeam(container.querySelector("#proj-team-slot"), p, isLead);
  renderProjectMaterials(container.querySelector("#proj-materials-slot"), p, projectRecords, projectFiles);
}

async function renderProjectSuggestions(slot, p) {
  if (p.kind !== "contest" || !p.end || !navigator.onLine) return;
  try {
    const list = await api.projectSuggestions(p.id);
    if (!list.length) return;
    slot.innerHTML = `
      <section class="surface">
        <div class="surface-header">
          <h2 class="surface-title">比赛阶段与提前准备建议</h2>
          <span style="font-size:var(--text-xs);color:var(--ink-muted);">仅在点击「采纳」后加入个人日程</span>
        </div>
        <div class="surface-body" style="display:grid;gap:10px;">
          ${list
            .map(
              (s, i) => `
            <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);background:var(--bg-canvas);">
              <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
                <input class="input" style="width:150px;" value="${esc(s.title)}" data-sug-title="${i}" />
                <label class="chip-control"><span>准备日</span><input type="date" value="${esc(s.prepare)}" data-sug-prep="${i}" /></label>
                <label class="chip-control"><span>截止日</span><input type="date" value="${esc(s.due)}" data-sug-due="${i}" /></label>
              </div>
              <button type="button" class="btn btn--sm btn--primary" data-adopt-sug="${i}">采纳</button>
            </div>`
            )
            .join("")}
        </div>
      </section>
    `;
    slot.querySelectorAll("[data-adopt-sug]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const i = btn.dataset.adoptSug;
        const title = slot.querySelector(`[data-sug-title="${i}"]`).value.trim();
        const prepare = slot.querySelector(`[data-sug-prep="${i}"]`).value || null;
        const due = slot.querySelector(`[data-sug-due="${i}"]`).value || null;
        try {
          await api.createTask({ id: uuid(), pid: p.id, title, prepare, due });
          await syncNow(true);
          btn.disabled = true;
          btn.textContent = "已采纳";
          showToast(`已采纳阶段「${title}」到日程`);
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  } catch {
    // ignore offline/suggestion failure
  }
}

async function renderProjectTeam(slot, p, isLead) {
  if (!navigator.onLine) return;
  try {
    const team = await api.projectTeam(p.id);
    const memberMap = new Map(team.members.map((m) => [m.id, m.name]));

    slot.innerHTML = `
      <section class="surface">
        <div class="surface-header">
          <h2 class="surface-title">团队成员与分工 <span class="tabular" style="color:var(--ink-muted);font-weight:500;">(${team.members.length} 人)</span></h2>
          ${
            isLead
              ? `<div style="display:flex;gap:6px;">
                  <button type="button" class="btn btn--sm" id="btn-gen-proj-invite">${icons.share}<span>生成 7 天邀请链接</span></button>
                </div>`
              : ""
          }
        </div>
        <div class="surface-body" style="display:grid;gap:12px;">
          <div id="proj-invite-box"></div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
            ${team.members
              .map(
                (m) => `
              <span class="tag ${m.id === team.lead ? "tag--accent" : ""}">
                ${esc(m.name)}${m.id === team.lead ? "（队长）" : ""}
              </span>`
              )
              .join("")}
            ${
              isLead && team.members.length > 1
                ? `<button type="button" class="btn btn--sm btn--ghost" id="btn-transfer-lead">移交队长</button>`
                : ""
            }
          </div>

          ${
            isLead
              ? `
            <form id="assign-form" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);background:var(--bg-canvas);">
              <input class="input" name="title" required placeholder="分配给成员的任务标题…" style="flex:1;min-width:180px;" />
              <select class="select" name="assignee" style="width:130px;">
                ${team.members.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}
              </select>
              <input class="input" type="date" name="due_date" style="width:140px;" />
              <input class="input" type="time" name="due_time" style="width:105px;" />
              <button type="submit" class="btn btn--sm btn--primary">分配任务</button>
            </form>
          `
              : ""
          }

          ${
            team.assignments.length
              ? `<div style="display:grid;gap:6px;">
                  ${team.assignments
                    .map(
                      (a) => `
                    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);">
                      <div>
                        <strong style="font-size:var(--text-sm);">${esc(a.title)}</strong>
                        <span style="font-size:var(--text-xs);color:var(--ink-secondary);margin-left:8px;">
                          负责人：${esc(memberMap.get(a.uid) || "成员")} · 交付：${esc(a.due ? formatDueReadable(a.due) : "未定")}
                        </span>
                      </div>
                      ${
                        isLead
                          ? `<button type="button" class="btn btn--sm" data-edit-assign="${esc(a.id)}" data-assign-title="${esc(a.title)}" data-assign-due="${esc(a.due || "")}">调整交付时间</button>`
                          : ""
                      }
                    </div>`
                    )
                    .join("")}
                </div>`
              : `<div style="font-size:var(--text-xs);color:var(--ink-muted);">暂无团队分工。队长分配任务后会自动进入负责人的个人日程，个人优先级与完成进度仅本人可见。</div>`
          }
        </div>
      </section>
    `;

    if (isLead) {
      slot.querySelector("#btn-gen-proj-invite").addEventListener("click", async () => {
        try {
          const inv = await api.createInvite(p.id);
          const url = `${window.location.origin}/?invite=${encodeURIComponent(inv.token)}`;
          slot.querySelector("#proj-invite-box").innerHTML = `
            <div class="banner banner--accent" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;">
              <span class="mono" style="font-size:var(--text-xs);word-break:break-all;">${esc(url)}</span>
              <button type="button" class="btn btn--sm" id="copy-proj-inv">复制链接</button>
            </div>
          `;
          slot.querySelector("#copy-proj-inv").addEventListener("click", () => {
            navigator.clipboard?.writeText(url);
            showToast("邀请链接已复制（7 天内有效）");
          });
        } catch (err) {
          showToast(err.message, "error");
        }
      });

      const transferBtn = slot.querySelector("#btn-transfer-lead");
      if (transferBtn) {
        transferBtn.addEventListener("click", async () => {
          const others = team.members.filter((m) => m.id !== state.user.id);
          const target = others[0];
          const ok = await openConfirmDialog({
            title: "移交队长身份",
            message: `将项目队长身份移交给 <strong>${esc(target.name)}</strong>？移交后你可自行退出该项目。`,
            confirmLabel: "确认移交"
          });
          if (!ok) return;
          try {
            await api.transferLeader(p.id, target.id);
            await syncNow(true);
            showToast(`已将队长移交给 ${target.name}`);
          } catch (err) {
            showToast(err.message, "error");
          }
        });
      }

      slot.querySelector("#assign-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const title = String(fd.get("title") || "").trim();
        const assignee = String(fd.get("assignee"));
        const d = String(fd.get("due_date") || "").trim();
        const t = String(fd.get("due_time") || "").trim();
        const due = d ? (t ? `${d}T${t}` : d) : null;
        try {
          await api.assignTask(p.id, assignee, { id: uuid(), title, due });
          await syncNow(true);
          showToast("已分配给成员");
          renderProjectTeam(slot, p, isLead);
        } catch (err) {
          showToast(err.message, "error");
        }
      });

      slot.querySelectorAll("[data-edit-assign]").forEach((btn) => {
        btn.addEventListener("click", () => {
          openEditAssignmentDrawer(p.id, btn.dataset.editAssign, btn.dataset.assignTitle, btn.dataset.assignDue, () =>
            renderProjectTeam(slot, p, isLead)
          );
        });
      });
    }
  } catch {
    // ignore
  }
}

function openEditAssignmentDrawer(pid, tid, currentTitle, currentDue, onDone) {
  const root = document.getElementById("drawer-root");
  const d = currentDue ? currentDue.slice(0, 10) : "";
  const t = currentDue && currentDue.length > 10 ? currentDue.slice(11, 16) : "";
  root.innerHTML = `
    <div class="dialog-backdrop" id="ea-bg">
      <form class="dialog-box" id="ea-form">
        <h3 class="drawer-title">更新团队交付时间</h3>
        <label class="field">
          <span class="field-label">任务标题</span>
          <input class="input" name="title" value="${esc(currentTitle)}" required />
        </label>
        <div class="field-row">
          <label class="field">
            <span class="field-label">新截止日期</span>
            <input class="input" type="date" name="due_date" value="${esc(d)}" />
          </label>
          <label class="field">
            <span class="field-label">时刻（可选）</span>
            <input class="input" type="time" name="due_time" value="${esc(t)}" />
          </label>
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn" id="ea-cancel">取消</button>
          <button type="submit" class="btn btn--primary">同步变更给队员</button>
        </div>
      </form>
    </div>
  `;
  const close = () => (root.innerHTML = "");
  root.querySelector("#ea-cancel").addEventListener("click", close);
  root.querySelector("#ea-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const dd = String(fd.get("due_date") || "").trim();
    const dt = String(fd.get("due_time") || "").trim();
    const due = dd ? (dt ? `${dd}T${dt}` : dd) : null;
    try {
      await api.editAssignment(pid, tid, { title: String(fd.get("title")).trim(), due });
      await syncNow(true);
      showToast("已更新交付时间并同步给负责人");
      close();
      onDone();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

function renderProjectMaterials(slot, p, projectRecords, projectFiles) {
  const selectedIds = new Set();

  function paint() {
    const selectedFiles = projectFiles.filter((f) => selectedIds.has(f.id));
    const selectedBytes = selectedFiles.reduce((acc, f) => acc + (f.size || 0), 0);

    slot.innerHTML = `
      <section class="surface">
        <div class="surface-header">
          <h2 class="surface-title">项目资料与离线文件 <span class="tabular" style="color:var(--ink-muted);font-weight:500;">(${projectFiles.length} 份文件 · ${projectRecords.length} 条记录)</span></h2>
          ${
            selectedFiles.length
              ? `<button type="button" class="btn btn--sm btn--primary" id="btn-batch-offline">
                  ${icons.download}<span>保存选中 ${selectedFiles.length} 份到本机（${formatBytes(selectedBytes)}）</span>
                </button>`
              : `<span style="font-size:var(--text-xs);color:var(--ink-muted);">勾选资料可批量保存到本机，断网可打开</span>`
          }
        </div>

        <div class="surface-body" style="display:grid;gap:14px;">
          <button type="button" id="project-new-record" class="btn btn--sm" style="justify-self:start">${icons.plus}新建项目记录</button>

          ${
            projectFiles.length
              ? `
            <div style="display:grid;gap:6px;">
              <div style="font-size:var(--text-xs);font-weight:600;color:var(--ink-secondary);">资料文件目录</div>
              ${projectFiles
                .map((f) => {
                  const isLocal = state.localFileIds.has(f.id);
                  const checked = selectedIds.has(f.id);
                  return `
                    <div class="file-chip" style="justify-content:space-between;width:100%;padding:8px 10px;">
                      <label style="display:flex;align-items:center;gap:8px;min-width:0;cursor:pointer;">
                        <input type="checkbox" data-sel-file="${esc(f.id)}" ${checked ? "checked" : ""} />
                        ${icons.paperclip}
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.name)}</span>
                        <span class="mono" style="color:var(--ink-muted);">${formatBytes(f.size)}</span>
                        ${isLocal ? `<span class="tag tag--success">本机可用</span>` : `<span class="tag">仅云端目录</span>`}
                      </label>
                      <button type="button" class="btn btn--sm" data-open-proj-file="${esc(f.id)}" data-fname="${esc(f.name)}" data-fsize="${f.size}">
                        ${isLocal ? "离线打开" : "下载"}
                      </button>
                    </div>
                  `;
                })
                .join("")}
            </div>
          `
              : ""
          }

          ${
            projectRecords.length
              ? `
            <div style="display:grid;border-top:1px solid var(--border-subtle);">
              ${projectRecords
                .map(
                  (r) => `
                <div class="record-item" style="padding:12px 4px;">
                  <div class="record-meta">
                    <span class="tabular">${formatTimestamp(r.created)}</span>
                    ${r.pinned ? `<span class="tag tag--accent">置顶</span>` : ""}
                    ${r.shared ? `<span class="tag tag--success">项目共享</span>` : `<span class="tag">仅本人可见</span>`}
                  </div>
                  ${r.title ? `<strong>${esc(r.title)}</strong>` : ""}
                  ${r.body ? `<p class="record-body">${esc(r.body)}</p>` : ""}
                  <div class="record-actions">
                    <button type="button" class="btn btn--sm" data-open-prec="${esc(r.id)}">查看 / 分享设置</button>
                  </div>
                </div>`
                )
                .join("")}
            </div>
          `
              : `<div class="empty-state" style="padding:20px;"><p class="empty-state-desc">此项目暂无记录与资料，可直接在上方添加。</p></div>`
          }
        </div>
      </section>
    `;

    slot.querySelectorAll("[data-sel-file]").forEach((cb) => {
      cb.addEventListener("change", () => {
        if (cb.checked) selectedIds.add(cb.dataset.selFile);
        else selectedIds.delete(cb.dataset.selFile);
        paint();
      });
    });

    const batchBtn = slot.querySelector("#btn-batch-offline");
    if (batchBtn) {
      batchBtn.addEventListener("click", async () => {
        batchBtn.disabled = true;
        let okCount = 0;
        for (const f of selectedFiles) {
          try {
            const blob = await api.downloadFile(f.id);
            await offlineDB.saveLocalFile(state.user.id, f.id, f.name, f.size || blob.size, blob);
            okCount += 1;
          } catch (err) {
            showToast(`下载 ${f.name} 失败：${err.message}`, "error");
          }
        }
        await refreshLocalIndexes();
        selectedIds.clear();
        showToast(`已保存 ${okCount} 份资料到本机，断网可用`);
        paint();
      });
    }

    slot.querySelectorAll("[data-open-proj-file]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const aid = btn.dataset.openProjFile;
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
          paint();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });

    slot.querySelectorAll("[data-open-prec]").forEach((btn) => {
      btn.addEventListener("click", () => openRecordDrawer(btn.dataset.openPrec));
    });

    const trigger = slot.querySelector("#project-new-record");
    trigger.onclick = () => openRecordComposer(trigger, p.id);
  }

  paint();
}

function openEditProjectDrawer(p) {
  const root = document.getElementById("drawer-root");
  root.innerHTML = `
    <div class="drawer-backdrop" id="pe-bg">
      <div class="drawer" role="dialog" aria-modal="true" aria-label="项目设置">
        <div class="drawer-header">
          <h2 class="drawer-title">项目设置</h2>
          <button type="button" class="btn btn--ghost btn--icon" id="pe-close">${icons.x}</button>
        </div>
        <form class="drawer-body" id="pe-form">
          <label class="field">
            <span class="field-label">项目名称</span>
            <input class="input" name="name" value="${esc(p.name)}" required />
          </label>
          <label class="field">
            <span class="field-label">项目色线颜色（调整优先级时保留颜色）</span>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              ${PRESET_COLORS.map(
                (c) => `
                <label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
                  <input type="radio" name="color_preset" value="${c}" ${p.color.toUpperCase() === c ? "checked" : ""} />
                  <span class="proj-dot" style="width:16px;height:16px;background:${c}"></span>
                </label>`
              ).join("")}
              <input type="color" name="color_custom" value="${esc(p.color)}" style="width:32px;height:28px;border:none;background:none;cursor:pointer;" />
            </div>
          </label>
          <label class="field">
            <span class="field-label">项目优先级</span>
            <select class="select" name="priority">
              <option value="3" ${p.priority === 3 ? "selected" : ""}>高优先级</option>
              <option value="2" ${p.priority === 2 ? "selected" : ""}>中优先级</option>
              <option value="1" ${p.priority === 1 ? "selected" : ""}>低优先级</option>
            </select>
          </label>
          <div class="field-row">
            <label class="field">
              <span class="field-label">开始日期</span>
              <input class="input" type="date" name="start" value="${esc(p.start || "")}" />
            </label>
            <label class="field">
              <span class="field-label">结束 / 总截止日</span>
              <input class="input" type="date" name="end" value="${esc(p.end || "")}" />
            </label>
          </div>
        </form>
        <div class="drawer-footer">
          <span></span>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn" id="pe-cancel">取消</button>
            <button type="submit" form="pe-form" class="btn btn--primary">保存设置</button>
          </div>
        </div>
      </div>
    </div>
  `;
  const close = () => (root.innerHTML = "");
  root.querySelector("#pe-close").addEventListener("click", close);
  root.querySelector("#pe-cancel").addEventListener("click", close);
  root.querySelectorAll('input[name="color_preset"]').forEach((r) => {
    r.addEventListener("change", () => {
      root.querySelector('input[name="color_custom"]').value = r.value;
    });
  });
  root.querySelector("#pe-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.editProject(p.id, {
        name: String(fd.get("name")).trim(),
        color: String(fd.get("color_custom")),
        priority: Number(fd.get("priority")),
        start: String(fd.get("start") || "").trim() || null,
        end: String(fd.get("end") || "").trim() || null
      });
      await syncNow(true);
      showToast("项目设置已更新");
      close();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}
