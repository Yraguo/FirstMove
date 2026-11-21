import { api } from "./api.js";
import { isNativeApp, nativeNotify } from "./native.js";
import { offlineDB } from "./offline.js";
import { showToast, todayISO, uuid } from "./utils.js";

const listeners = new Set();
let reminderTimers = [];

export const state = {
  ready: false,
  online: navigator.onLine,
  syncing: false,
  user: null,
  etag: null,
  tab: "agenda", // agenda | records | projects | me
  agendaSub: "agenda", // agenda | waiting | history | week | month
  projectsFilter: "active", // active | archived | hidden | trash
  activeProjectId: null,
  searchQuery: "",
  searchResults: null,
  railSide: localStorage.getItem("workbench_rail_side") || "left",
  // Synced server snapshot
  projects: [],
  tasks: [],
  records: [],
  files: [],
  habits: [],
  checks: [],
  conflicts: [],
  reminders: [],
  storage: { used: 0, quota: 134217728, available: 134217728, file_limit: 16777216, large_file_hint: 5242880 },
  // Local IndexedDB state
  localFileIds: new Set(),
  localFiles: [],
  outbox: []
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  for (const fn of listeners) fn(state);
}

export function setState(patch) {
  Object.assign(state, patch);
  emit();
}

export function setRailSide(side) {
  const next = side === "right" ? "right" : "left";
  state.railSide = next;
  localStorage.setItem("workbench_rail_side", next);
  emit();
}

function applySnapshot(data, etag) {
  state.user = data.user;
  state.etag = etag || state.etag;
  state.projects = data.projects || [];
  state.tasks = data.tasks || [];
  state.records = data.records || [];
  state.files = data.files || [];
  state.habits = data.habits || [];
  state.checks = data.checks || [];
  state.conflicts = data.conflicts || [];
  state.reminders = data.reminders || [];
  state.storage = data.storage || state.storage;
}

export async function refreshLocalIndexes() {
  if (!state.user) return;
  const uid = state.user.id;
  const [localFiles, outbox] = await Promise.all([
    offlineDB.listLocalFiles(uid),
    offlineDB.listOutbox(uid)
  ]);
  state.localFiles = localFiles;
  state.localFileIds = new Set(localFiles.map((f) => f.aid));
  state.outbox = outbox;
}

export function clearSession() {
  localStorage.removeItem("workbench_last_uid");
  for (const timer of reminderTimers) clearTimeout(timer);
  reminderTimers = [];
  Object.assign(state, {
    user: null, etag: null, tasks: [], projects: [], records: [], files: [],
    habits: [], checks: [], conflicts: [], reminders: [], localFiles: [],
    localFileIds: new Set(), outbox: [], searchQuery: "", activeProjectId: null,
    tab: "agenda", projectsFilter: "active", agendaSub: "agenda"
  });
  document.getElementById("drawer-root").replaceChildren();
  document.getElementById("dialog-root").replaceChildren();
  emit();
}

export async function bootstrap() {
  try {
    const me = await api.me();
    state.user = me;
    const cached = await offlineDB.loadSnapshot(me.id);
    if (cached && cached.data) {
      applySnapshot(cached.data, cached.etag);
    }
    await refreshLocalIndexes();
    await flushOutbox();
    await syncNow(true);
    state.ready = true;
    emit();
  } catch (err) {
    if (!navigator.onLine || err.name === "TypeError") {
      const cached = await offlineDB.loadSnapshot();
      if (cached && cached.data) {
        applySnapshot(cached.data, cached.etag);
        await refreshLocalIndexes();
        state.online = false;
        state.ready = true;
        emit();
        return;
      }
    }
    if (err.status === 401) clearSession();
    state.user = null;
    state.ready = true;
    emit();
  }
}

export async function syncNow(force = false) {
  if (!state.user || state.syncing) return;
  const uid = state.user.id;
  const wasOnline = state.online;
  let changed = false;
  state.syncing = true;
  try {
    const res = await api.sync(force ? null : state.etag);
    if (state.user?.id !== uid) return;
    state.online = true;
    if (!res.notModified && res.data) {
      if (res.data.user.id !== uid) {
        clearSession();
        return;
      }
      changed = true;
      applySnapshot(res.data, res.etag);
      await offlineDB.saveSnapshot(state.user.id, res.etag, res.data);
      const validIds = (res.data.files || []).map((f) => f.id);
      await offlineDB.pruneInaccessibleFiles(state.user.id, validIds);
      await refreshLocalIndexes();
    }
    scheduleReminders();
  } catch (err) {
    if (err.status === 401 && state.user?.id === uid) {
      clearSession();
    } else if (err.name === "TypeError" || !navigator.onLine) {
      state.online = false;
    }
  } finally {
    state.syncing = false;
    if (changed || wasOnline !== state.online) emit();
  }
}

// Offline-aware action helpers
export async function createTaskOfflineAware(payload) {
  const tid = payload.id || uuid();
  const body = { ...payload, id: tid };
  if (navigator.onLine) {
    try {
      const created = await api.createTask(body);
      await syncNow(true);
      return created;
    } catch (err) {
      if (err.name !== "TypeError") throw err;
    }
  }
  await offlineDB.enqueue({
    id: `task:${tid}`,
    uid: state.user.id,
    kind: "create_task",
    payload: body
  });
  await refreshLocalIndexes();
  emit();
  showToast("已离线保存，联网后自动同步");
  return body;
}

export async function createRecordOfflineAware(payload, pendingFiles = []) {
  const rid = payload.id || uuid();
  const body = { ...payload, id: rid };
  if (navigator.onLine) {
    try {
      const created = await api.createRecord(body);
      for (const f of pendingFiles) {
        await api.uploadFile(rid, f.aid || uuid(), f.name, f.blob);
      }
      await syncNow(true);
      return created;
    } catch (err) {
      if (err.name !== "TypeError") throw err;
    }
  }
  await offlineDB.enqueue({
    id: `record:${rid}`,
    uid: state.user.id,
    kind: "create_record",
    payload: body
  });
  for (const f of pendingFiles) {
    const aid = f.aid || uuid();
    await offlineDB.enqueue({
      id: `upload:${rid}:${aid}`,
      uid: state.user.id,
      kind: "upload_file",
      payload: { rid, aid, name: f.name, size: f.blob.size },
      blob: f.blob
    });
  }
  await refreshLocalIndexes();
  emit();
  showToast("已保存至本机待同步队列");
  return body;
}

export async function flushOutbox() {
  if (!state.user || !navigator.onLine) return;
  const items = await offlineDB.listOutbox(state.user.id);
  if (!items.length) return;
  let syncedCount = 0;
  for (const item of items) {
    try {
      if (item.kind === "create_record") {
        await api.createRecord(item.payload);
      } else if (item.kind === "create_task") {
        await api.createTask(item.payload);
      } else if (item.kind === "upload_file") {
        await api.uploadFile(item.payload.rid, item.payload.aid, item.payload.name, item.blob);
      } else if (item.kind === "convert_record_task") {
        await api.convertRecordToTask(item.payload.rid, item.payload.task);
      }
      await offlineDB.removeOutbox(item.id);
      syncedCount += 1;
    } catch (err) {
      if (err.name === "TypeError" || !navigator.onLine) {
        state.online = false;
        break;
      }
      showToast(`待同步项已保留：${err.message}`, "error");
      break;
    }
  }
  await refreshLocalIndexes();
  if (syncedCount > 0) {
    showToast(`已自动同步 ${syncedCount} 项离线内容`);
    await syncNow(true);
  } else {
    emit();
  }
}

// Compute merged tasks (server + pending offline tasks) matching exact PRD §3.2 sorting
export function getMergedTasks(view = "agenda") {
  const today = todayISO();
  const nowMs = Date.now();
  const projectMap = new Map(state.projects.map((p) => [p.id, p]));
  const existingIds = new Set(state.tasks.map((t) => t.id));
  const pendingTasks = state.outbox
    .filter((o) => o.kind === "create_task" && !existingIds.has(o.payload.id))
    .map((o) => {
      const p = o.payload.pid ? projectMap.get(o.payload.pid) : null;
      return {
        ...o.payload,
        priority: o.payload.priority || (p ? p.priority : 2),
        status: o.payload.status || "open",
        project_name: p ? p.name : null,
        color: p ? p.color : null,
        pin: null,
        done: null,
        overdue: false,
        prepare_today: Boolean(o.payload.prepare && o.payload.prepare <= today),
        review_prepare: false,
        _pending: true
      };
    });

  const all = [...state.tasks, ...pendingTasks];
  const filtered = all.filter((t) => {
    if (view === "waiting") return t.status === "waiting";
    if (view === "history") return t.status === "done" || t.status === "cancelled";
    if (view === "agenda") {
      if (t.status === "waiting" || t.status === "cancelled") return false;
      if (t.status === "done") {
        if (t.due) {
          const endMs = t.due.length === 10
            ? new Date(`${t.due}T23:59:59`).getTime()
            : new Date(t.due).getTime();
          if (endMs <= nowMs) return false;
        } else if (t.done && t.done.slice(0, 10) !== today) {
          return false;
        }
      }
      return true;
    }
    return true;
  });

  return filtered.sort((a, b) => {
    const doneDiff = Number(a.status === "done") - Number(b.status === "done");
    if (doneDiff) return doneDiff;
    const pinDiff = Number(a.pin !== today) - Number(b.pin !== today);
    if (pinDiff) return pinDiff;
    const dueA = a.due || "9999-12-31Z";
    const dueB = b.due || "9999-12-31Z";
    if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    return (b.priority || 2) - (a.priority || 2);
  });
}

export function getMergedRecords(pid = null) {
  const existingIds = new Set(state.records.map((r) => r.id));
  const pendingUploadsByRid = new Map();
  for (const o of state.outbox) {
    if (o.kind === "upload_file") {
      const arr = pendingUploadsByRid.get(o.payload.rid) || [];
      arr.push({ id: o.payload.aid, name: o.payload.name, size: o.payload.size, _pending: true });
      pendingUploadsByRid.set(o.payload.rid, arr);
    }
  }
  const pendingRecs = state.outbox
    .filter((o) => o.kind === "create_record" && !existingIds.has(o.payload.id))
    .map((o) => ({
      id: o.payload.id,
      uid: state.user?.id,
      pid: o.payload.pid || null,
      title: o.payload.title || "",
      body: o.payload.body || "",
      kind: o.payload.kind || "memo",
      shared: 0,
      pinned: 0,
      position: 0,
      version: 1,
      created: Math.floor(o.createdAt / 1000),
      updated: Math.floor(o.createdAt / 1000),
      _pending: true,
      _pendingFiles: pendingUploadsByRid.get(o.payload.id) || []
    }));

  const combined = [...pendingRecs, ...state.records];
  return pid ? combined.filter((r) => r.pid === pid) : combined;
}

// Browser Notification Scheduler (deduplicated per device by reminder.id)
export function scheduleReminders() {
  for (const t of reminderTimers) clearTimeout(t);
  reminderTimers = [];
  if (!state.user || !state.user.enabled) return;
  if (isNativeApp ? false : (typeof Notification === "undefined" || Notification.permission !== "granted")) return;

  const firedKey = `workbench_fired_reminders_${state.user.id}`;
  const fired = new Set(JSON.parse(localStorage.getItem(firedKey) || "[]"));
  const nowMs = Date.now();

  for (const rem of state.reminders) {
    if (fired.has(rem.id)) continue;
    const atMs = new Date(rem.at).getTime();
    if (Number.isNaN(atMs)) continue;
    const delay = atMs - nowMs;
    // Skip stale past reminders (> 2 minutes old) to avoid spamming on login
    if (delay < -120000) continue;
    // Only schedule reminders within next 24h in memory
    if (delay > 86400000) continue;
    const timer = setTimeout(() => {
      const body = `${rem.title}${rem.kind === "independent" ? "（自定义提醒）" : "（即将截止）"}`;
      try {
        if (isNativeApp) {
          nativeNotify("先行提醒", body);
        } else {
          new Notification("先行提醒", {
            icon: "/src/brand/xianxing-192.png",
            body
          });
        }
        fired.add(rem.id);
        localStorage.setItem(firedKey, JSON.stringify([...fired].slice(-200)));
      } catch {
        // Ignore notification errors
      }
    }, Math.max(0, delay));
    reminderTimers.push(timer);
  }
}
