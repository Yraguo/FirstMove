export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message || `请求失败 (${status})`);
    this.status = status;
    this.data = data;
  }
}

async function request(path, options = {}) {
  const { json, headers = {}, ...rest } = options;
  const finalHeaders = { ...headers };
  let body = rest.body;
  if (json !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: finalHeaders,
    ...rest,
    body
  });
  if (res.status === 304) {
    return { notModified: true, etag: res.headers.get("ETag") };
  }
  const ct = res.headers.get("Content-Type") || "";
  const isJson = ct.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");
  if (!res.ok) {
    const detail = payload && typeof payload === "object" ? payload.detail : payload;
    const msg = Array.isArray(detail) ? detail.map((d) => d.msg || d).join("；") : detail;
    throw new ApiError(res.status, msg || `请求失败 (${res.status})`, payload);
  }
  return { data: payload, etag: res.headers.get("ETag") };
}

export const api = {
  // Auth & Account
  me: () => request("/me").then((r) => r.data),
  login: (name, password) => request("/login", { method: "POST", json: { name, password } }).then((r) => r.data),
  logout: () => request("/logout", { method: "POST" }).then((r) => r.data),
  register: (name, password, token) =>
    request("/register", { method: "POST", json: { name, password, token } }).then((r) => r.data),
  join: (token) => request("/join", { method: "POST", json: { token } }).then((r) => r.data),
  createInvite: (projectId = null) =>
    request("/invites", { method: "POST", json: { project_id: projectId } }).then((r) => r.data),
  updatePreferences: (evening, deviceEnabled) =>
    request("/me/preferences", { method: "PUT", json: { evening, device_enabled: deviceEnabled } }).then((r) => r.data),
  setUserQuota: (uid, bytes) =>
    request(`/users/${encodeURIComponent(uid)}/quota`, { method: "PUT", json: { bytes } }).then((r) => r.data),
  storage: () => request("/me/storage").then((r) => r.data),

  // Sync, Search & Calendar
  sync: (etag) => request("/sync", { headers: etag ? { "If-None-Match": etag } : {} }),
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`).then((r) => r.data),
  calendar: (start, end) =>
    request(`/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`).then((r) => r.data),

  // Tasks & Habits & Reminders
  listTasks: (view = "agenda") => request(`/tasks?view=${encodeURIComponent(view)}`).then((r) => r.data),
  createTask: (payload) => request("/tasks", { method: "POST", json: payload }).then((r) => r.data),
  getTask: (tid) => request(`/tasks/${encodeURIComponent(tid)}`).then((r) => r.data),
  editTask: (tid, changes) => request(`/tasks/${encodeURIComponent(tid)}`, { method: "PATCH", json: changes }).then((r) => r.data),

  listHabits: (day) => request(`/habits${day ? `?day=${encodeURIComponent(day)}` : ""}`).then((r) => r.data),
  createHabit: (payload) => request("/habits", { method: "POST", json: payload }).then((r) => r.data),
  checkHabit: (hid, day) =>
    request(`/habits/${encodeURIComponent(hid)}/checks/${encodeURIComponent(day)}`, { method: "PUT" }).then((r) => r.data),
  stopHabit: (hid) => request(`/habits/${encodeURIComponent(hid)}/stop`, { method: "POST" }).then((r) => r.data),
  reminders: () => request("/reminders").then((r) => r.data),

  // Projects & Team
  listProjects: () => request("/projects").then((r) => r.data),
  createProject: (payload) => request("/projects", { method: "POST", json: payload }).then((r) => r.data),
  editProject: (pid, changes) => request(`/projects/${encodeURIComponent(pid)}`, { method: "PATCH", json: changes }).then((r) => r.data),
  projectFlags: (pid, pinned, hidden) =>
    request(`/projects/${encodeURIComponent(pid)}/preferences`, { method: "PUT", json: { pinned, hidden } }).then((r) => r.data),
  projectTeam: (pid) => request(`/projects/${encodeURIComponent(pid)}/team`).then((r) => r.data),
  assignTask: (pid, assignee, task) =>
    request(`/projects/${encodeURIComponent(pid)}/assignments`, { method: "POST", json: { assignee, task } }).then((r) => r.data),
  editAssignment: (pid, tid, changes) =>
    request(`/projects/${encodeURIComponent(pid)}/assignments/${encodeURIComponent(tid)}`, { method: "PATCH", json: changes }).then((r) => r.data),
  projectSuggestions: (pid) => request(`/projects/${encodeURIComponent(pid)}/suggestions`).then((r) => r.data),
  transferLeader: (pid, member) =>
    request(`/projects/${encodeURIComponent(pid)}/transfer`, { method: "POST", json: { member } }).then((r) => r.data),
  leaveProject: (pid) => request(`/projects/${encodeURIComponent(pid)}/leave`, { method: "POST" }).then((r) => r.data),
  deletionPreview: (pid) => request(`/projects/${encodeURIComponent(pid)}/deletion`).then((r) => r.data),
  trashProject: (pid) => request(`/projects/${encodeURIComponent(pid)}/trash`, { method: "POST" }).then((r) => r.data),
  restoreProject: (pid) => request(`/projects/${encodeURIComponent(pid)}/restore`, { method: "POST" }).then((r) => r.data),
  purgeProject: (pid) =>
    request(`/projects/${encodeURIComponent(pid)}/purge`, { method: "POST", json: { confirmed: true } }).then((r) => r.data),

  // Records & Conflicts
  listRecords: (pid) => request(`/records${pid ? `?pid=${encodeURIComponent(pid)}` : ""}`).then((r) => r.data),
  createRecord: (payload) => request("/records", { method: "POST", json: payload }).then((r) => r.data),
  getRecord: (rid) => request(`/records/${encodeURIComponent(rid)}`).then((r) => r.data),
  editRecordMeta: (rid, changes) => request(`/records/${encodeURIComponent(rid)}`, { method: "PATCH", json: changes }).then((r) => r.data),
  editRecordBody: (rid, baseVersion, body) =>
    request(`/records/${encodeURIComponent(rid)}/body`, { method: "PUT", json: { base_version: baseVersion, body } }).then((r) => r.data),
  resolveConflict: (rid, cid, baseVersion, body) =>
    request(`/records/${encodeURIComponent(rid)}/conflicts/${encodeURIComponent(cid)}/resolve`, {
      method: "POST",
      json: { base_version: baseVersion, body }
    }).then((r) => r.data),
  convertRecordToTask: (rid, payload) =>
    request(`/records/${encodeURIComponent(rid)}/task`, { method: "POST", json: payload }).then((r) => r.data),
  deleteRecord: (rid) => request(`/records/${encodeURIComponent(rid)}`, { method: "DELETE" }).then((r) => r.data),

  // Files
  async uploadFile(rid, aid, name, blob) {
    const res = await fetch(
      `/api/records/${encodeURIComponent(rid)}/files/${encodeURIComponent(aid)}/content?name=${encodeURIComponent(name)}`,
      {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob
      }
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(res.status, (data && data.detail) || `上传失败 (${res.status})`, data);
    }
    return data;
  },
  linkFile: (rid, aid) =>
    request(`/records/${encodeURIComponent(rid)}/files/${encodeURIComponent(aid)}`, { method: "PUT" }).then((r) => r.data),
  unlinkFile: (rid, aid) =>
    request(`/records/${encodeURIComponent(rid)}/files/${encodeURIComponent(aid)}`, { method: "DELETE" }).then((r) => r.data),
  async downloadFile(aid) {
    const res = await fetch(`/api/files/${encodeURIComponent(aid)}`, { credentials: "same-origin" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(res.status, (data && data.detail) || `下载失败 (${res.status})`);
    }
    return res.blob();
  }
};
