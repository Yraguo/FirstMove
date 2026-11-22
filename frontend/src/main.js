import { icons } from "./icons.js";
import {
  bootstrap,
  flushOutbox,
  getMergedTasks,
  setRailSide,
  setState,
  state,
  subscribe,
  syncNow
} from "./store.js";
import { esc, showToast } from "./utils.js";
import { renderAdmin } from "./views/admin.js";
import { renderAgenda } from "./views/agenda.js";
import { renderAuth } from "./views/auth.js";
import { renderMe } from "./views/me.js";
import { renderProjects } from "./views/projects.js";
import { renderRecords } from "./views/records.js";
import { renderSearch } from "./views/search.js";

const appEl = document.getElementById("app");
let searchDebounce = null;

function render() {
  if (!state.ready) return;

  if (!state.user) {
    appEl.className = "";
    renderAuth(appEl);
    return;
  }

  const agendaCount = getMergedTasks("agenda").filter((t) => t.status !== "done").length;
  const navItems = [
    { id: "agenda", label: "日程", icon: icons.calendar, badge: agendaCount || "" },
    { id: "records", label: "记录", icon: icons.record, badge: state.conflicts.length ? `${state.conflicts.length}冲突` : "" },
    { id: "projects", label: "项目", icon: icons.folder, badge: "" },
    { id: "me", label: "我的", icon: icons.user, badge: state.outbox.length ? `${state.outbox.length}待同步` : "" }
  ];
  if (state.user.admin) {
    navItems.push({ id: "admin", label: "管理", icon: icons.shield, badge: "" });
  }

  const recentProjects = state.projects.filter(p => !p.hidden && !p.trashed && !p.archived).slice(0, 5);
  const statusPill = !state.online
    ? `<span class="status-pill status-pill--offline"><span class="status-dot"></span>离线模式</span>`
    : state.outbox.length
      ? `<button type="button" class="status-pill status-pill--pending" id="btn-topbar-sync"><span class="status-dot"></span>${state.outbox.length} 项待同步</button>`
      : `<button type="button" class="status-pill" id="btn-topbar-sync" title="点击立即同步"><span class="status-dot"></span>${state.syncing ? "同步中…" : "已同步"}</button>`;

  appEl.className = `shell ${state.railSide === "right" ? "shell--rail-right" : ""}`;
  appEl.innerHTML = `
    <aside class="rail" id="desktop-rail" aria-label="主导航">
      <div class="rail-brand">
        <span class="rail-brand-title">
          <img class="rail-logo" src="/src/brand/xianxing-180.png" width="36" height="36" alt="" />
          <span>先行</span>
        </span>
      </div>
      <nav class="rail-nav">
        ${navItems
          .map(
            (item) => `
          <button type="button" class="rail-item" data-nav="${item.id}" aria-current="${!state.searchQuery && state.tab === item.id ? "page" : "false"}">
            ${item.icon}
            <span>${item.label}</span>
            ${item.badge ? `<span class="rail-item-badge tabular">${esc(item.badge)}</span>` : ""}
          </button>`
          )
          .join("")}
      </nav>
      ${recentProjects.length ? `<section class="rail-projects"><h2>进行中的项目</h2>${recentProjects.map(p => `<button type="button" data-sidebar-project="${esc(p.id)}"><i style="background:${esc(p.color)}"></i><span>${esc(p.name)}</span></button>`).join("")}</section>` : ""}
      <div class="rail-footer">
        <button class="account-link" type="button" data-nav="me"><b aria-hidden="true">${esc(state.user.name.slice(0,1).toUpperCase())}</b><span>${esc(state.user.name)}</span></button>
        <div class="rail-drag-hint" id="rail-drag-handle" title="长按并横向拖动可将导航栏切至${state.railSide === "left" ? "右侧" : "左侧"}">
          <span>${icons.move} 移动侧栏</span>
        </div>
      </div>
    </aside>

    <header class="topbar">
      <img class="mobile-logo" src="/src/brand/xianxing-180.png" width="30" height="30" alt="先行" />
      <div class="search-box">
        <span class="search-box-icon">${icons.search}</span>
        <input class="search-input" id="global-search-input" value="${esc(state.searchQuery)}"
          placeholder="搜索工作台" aria-label="全局搜索" />
        ${
          state.searchQuery
            ? `<button type="button" class="search-clear" id="global-search-clear" aria-label="清除搜索">${icons.x}</button>`
            : ""
        }
      </div>
      <div class="topbar-meta">
        ${statusPill}
      </div>
    </header>

    <main class="main" id="main-content"></main>

    <nav class="mobile-nav" aria-label="底部导航" style="grid-template-columns:repeat(${navItems.length},minmax(0,1fr))">
      ${navItems
        .map(
          (item) => `
        <button type="button" class="mobile-nav-btn" data-nav="${item.id}" aria-current="${!state.searchQuery && state.tab === item.id ? "page" : "false"}">
          ${item.icon}
          <span>${item.label}</span>
        </button>`
        )
        .join("")}
    </nav>
  `;

  bindShellEvents();
  const mainEl = document.getElementById("main-content");
  if (state.searchQuery.trim()) {
    renderSearch(mainEl, state.searchQuery.trim());
  } else if (state.tab === "agenda") {
    renderAgenda(mainEl);
  } else if (state.tab === "records") {
    renderRecords(mainEl);
  } else if (state.tab === "projects") {
    renderProjects(mainEl);
  } else if (state.tab === "me") {
    renderMe(mainEl);
  } else if (state.tab === "admin") {
    renderAdmin(mainEl);
  }
}

function bindShellEvents() {
  appEl.querySelectorAll("[data-sidebar-project]").forEach(btn => {
    btn.onclick = () => setState({tab:"projects", activeProjectId:btn.dataset.sidebarProject, searchQuery:""});
  });
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setState({ tab: btn.dataset.nav, searchQuery: "", activeProjectId: null });
    });
  });

  const searchInput = document.getElementById("global-search-input");
  searchInput.addEventListener("input", (e) => {
    const val = e.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.searchQuery = val;
      const mainEl = document.getElementById("main-content");
      if (val.trim()) renderSearch(mainEl, val.trim());
      else render();
    }, 220);
  });

  const clearBtn = document.getElementById("global-search-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => setState({ searchQuery: "" }));
  }

  const syncBtn = document.getElementById("btn-topbar-sync");
  if (syncBtn) {
    syncBtn.addEventListener("click", async () => {
      await flushOutbox();
      await syncNow(true);
    });
  }

  // Desktop rail long-press & drag left/right (PRD §2)
  const rail = document.getElementById("desktop-rail");
  const dragHandle = document.getElementById("rail-drag-handle");
  if (rail && dragHandle) {
    let pressTimer = null;
    let dragging = false;

    const startDrag = () => {
      dragging = true;
      rail.classList.add("rail--dragging");
    };

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      pressTimer = setTimeout(startDrag, 320);
      const onMove = (ev) => {
        if (!dragging) return;
        const mid = window.innerWidth / 2;
        const targetSide = ev.clientX > mid ? "right" : "left";
        if (targetSide !== state.railSide) {
          setRailSide(targetSide);
          showToast(`导航栏已移至${targetSide === "right" ? "右侧" : "左侧"}`);
        }
      };
      const onUp = () => {
        clearTimeout(pressTimer);
        dragging = false;
        rail.classList.remove("rail--dragging");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

    dragHandle.addEventListener("pointerdown", onPointerDown);
    dragHandle.addEventListener("dblclick", () => {
      const next = state.railSide === "left" ? "right" : "left";
      setRailSide(next);
      showToast(`导航栏已切换至${next === "right" ? "右侧" : "左侧"}`);
    });
  }
}

// Register Service Worker for offline shell persistence
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// Global online / offline recovery
window.addEventListener("online", async () => {
  setState({ online: true });
  await flushOutbox();
  await syncNow(true);
});

window.addEventListener("offline", () => {
  setState({ online: false });
  showToast("当前处于离线状态，新记录与附件将暂存本机");
});

// Keyboard shortcut: Cmd/Ctrl + K focuses global search
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    const input = document.getElementById("global-search-input");
    if (input) input.focus();
  }
});

// Periodic lightweight ETag sync & reminder refresh every 45s
setInterval(() => {
  if (state.user && navigator.onLine && document.visibilityState === "visible") {
    syncNow(false);
  }
}, 45000);

subscribe(render);
bootstrap();
