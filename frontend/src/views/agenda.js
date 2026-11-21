import { api } from "../api.js";
import { icons } from "../icons.js";
import { offlineDB } from "../offline.js";
import { saveBlobToDevice } from "../native.js";
import {
  createTaskOfflineAware,
  getMergedTasks,
  refreshLocalIndexes,
  setState,
  state,
  syncNow
} from "../store.js";
import {
  addDays,
  esc,
  formatBytes,
  formatDueReadable,
  formatHabitDays,
  priorityLabel,
  openEntryDialog,
  showToast,
  todayISO,
  uuid,
  weekdayIndex
} from "../utils.js";

let calendarAnchor = todayISO();
let selectedCalDay = todayISO();


export function renderAgenda(container) {
  const sub = state.agendaSub;
  const activeProjects = state.projects.filter((p) => !p.trashed && !p.archived);
  const today = todayISO();

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">日程</h1>
        <p class="page-subtitle">${new Intl.DateTimeFormat("zh-CN",{month:"long",day:"numeric",weekday:"long"}).format(new Date(today+"T12:00:00"))}</p>
      </div>
      <button id="new-task" type="button" class="btn btn--primary entry-launch">${icons.plus}新建待办</button>
    </div>
    <div class="agenda-tabs"><div class="segmented" role="tablist" aria-label="日程视图切换">
        <button type="button" class="segmented-btn" data-sub="agenda" aria-selected="${sub === "agenda"}">待办</button>
        <button type="button" class="segmented-btn" data-sub="waiting" aria-selected="${sub === "waiting"}">等待确认</button>
        <button type="button" class="segmented-btn" data-sub="week" aria-selected="${sub === "week"}">周历</button>
        <button type="button" class="segmented-btn" data-sub="month" aria-selected="${sub === "month"}">月历</button>
        <button type="button" class="segmented-btn" data-sub="history" aria-selected="${sub === "history"}">历史</button>
      </div>
    </div>

    <div id="agenda-body"></div>
  `;

  container.querySelectorAll("[data-sub]").forEach((btn) => {
    btn.addEventListener("click", () => setState({ agendaSub: btn.dataset.sub }));
  });

  const trigger = container.querySelector("#new-task");
  trigger.onclick = () => {
    const dialog = openEntryDialog(trigger, "新建待办", renderQuickAdd(activeProjects, sub === "waiting"), "保存待办", "quick-add-form");
    bindQuickAdd(dialog);
  };

  const body = container.querySelector("#agenda-body");
  if (sub === "agenda") {
    renderAgendaSplit(body);
  } else if (sub === "waiting") {
    renderTaskListSurface(body, "waiting", "等待确认", "课堂口头通知或待向老师/队友核实的事项。问清后点开补截止日即可转为正式待办。");
  } else if (sub === "history") {
    renderTaskListSurface(body, "history", "完成与取消记录", "到期收起的已完成任务及已取消任务均保留在此，便于复盘查询。");
  } else if (sub === "week" || sub === "month") {
    renderCalendarView(body, sub);
  }
}

function renderQuickAdd(projects, defaultWaiting) {
  return `
    <label class="entry-field">待办名称<input class="input entry-name" name="title" placeholder="要完成什么？" maxlength="240" required autofocus /></label>
    <div class="entry-grid">
      <label class="entry-field">截止日期<input class="input" type="date" name="due_date" /></label>
      <label class="entry-field">截止时刻<input class="input" type="time" name="due_time" /></label>
      <label class="entry-field">开始准备<input class="input" type="date" name="prepare" /></label>
      <label class="entry-field">所属项目<select class="select" name="pid"><option value="">无项目</option>${projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
    </div>
    <fieldset class="entry-priority"><legend>优先级</legend>${[["","默认"],["3","高"],["2","中"],["1","低"]].map(([v,label]) => `<label class="priority-level-${v || "default"}"><input type="radio" name="priority" value="${v}" ${v ? "" : "checked"}><span>${label}</span></label>`).join("")}</fieldset>
    <label class="entry-check"><input type="checkbox" id="qa-waiting" ${defaultWaiting ? "checked" : ""}>等待确认</label>
  `;
}

function bindQuickAdd(container) {
  const form = container.querySelector("#quick-add-form");
  const waitingBtn = container.querySelector("#qa-waiting");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const title = String(fd.get("title") || "").trim();
    if (!title) return;
    const dueDate = String(fd.get("due_date") || "").trim();
    const dueTime = String(fd.get("due_time") || "").trim();
    const prepare = String(fd.get("prepare") || "").trim();
    const pid = String(fd.get("pid") || "").trim();
    const prio = String(fd.get("priority") || "").trim();
    const waiting = waitingBtn.checked;

    let due = null;
    if (dueDate) {
      due = dueTime ? `${dueDate}T${dueTime}` : dueDate;
    }

    const payload = {
      id: uuid(),
      title,
      status: waiting ? "waiting" : "open"
    };
    if (due) payload.due = due;
    if (prepare) payload.prepare = prepare;
    if (pid) payload.pid = pid;
    if (prio) payload.priority = Number(prio);

    const submit = form.querySelector("[type=submit]");
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      await createTaskOfflineAware(payload);
      container.close();
      showToast(waiting ? "已加入等待确认" : "已添加到日程");
    } catch (err) {
      form.querySelector(".entry-error").textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });
}

function renderAgendaSplit(container) {
  const tasks = getMergedTasks("agenda");
  const today = todayISO();
  const todayDow = String(weekdayIndex(today));
  const checkSet = new Set(state.checks.filter((c) => c.day === today).map((c) => c.hid));
  const todayHabits = state.habits.filter(
    (h) => h.start <= today && (!h.end || h.end >= today) && String(h.days).includes(todayDow)
  );

  const monday = addDays(today, 1 - weekdayIndex(today));
  const dueDays = new Set(tasks.filter(t => t.status !== "done" && t.due).map(t => t.due.slice(0,10)));
  container.innerHTML = `
    <div class="week-strip" aria-label="本周日程">${["一","二","三","四","五","六","日"].map((label,i) => {
      const day = addDays(monday, i);
      return `<button type="button" data-week-date="${day}" aria-label="查看 ${day} 日程" ${day === today ? 'aria-current="date"' : ""}>
        <small>周${label}</small><strong>${Number(day.slice(8))}</strong><i class="${dueDays.has(day) ? "has-deadline" : ""}"></i></button>`;
    }).join("")}</div>
    <div class="agenda-grid">
      <section class="surface" aria-label="今日待办清单">
        <div class="surface-header">
          <h2 class="surface-title">待办清单 <span class="tabular" style="color:var(--ink-muted);font-weight:500;">(${tasks.length})</span></h2>
          <span style="font-size:var(--text-xs);color:var(--ink-muted);">按截止时间</span>
        </div>
        ${
          tasks.length
            ? `<ul class="task-list">${tasks.map((t) => renderTaskRow(t, today)).join("")}</ul>`
            : `<div class="empty-state">
                <p class="empty-state-title">待办已清空</p>
                <p class="empty-state-desc">新任务会显示在这里。</p>
              </div>`
        }
      </section>

      <aside class="surface agenda-habits-col" aria-label="日常打卡">
        <div class="surface-header">
          <h2 class="surface-title">日常打卡</h2>
          <button type="button" class="btn btn--sm" id="btn-new-habit">${icons.plus}<span>新增</span></button>
        </div>
        <div id="habit-creator"></div>
        ${
          todayHabits.length
            ? `<div>${todayHabits
                .map((h) => {
                  const done = checkSet.has(h.id);
                  return `
                    <div class="habit-item">
                      <div style="min-width:0;">
                        <div class="habit-title" style="${done ? "text-decoration:line-through;color:var(--ink-muted);" : ""}">${esc(h.title)}</div>
                        <div class="habit-days">${esc(formatHabitDays(h.days))}${h.end ? ` · 至 ${esc(h.end)}` : ""}</div>
                      </div>
                      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
                        <button type="button" class="btn btn--sm ${done ? "btn--ghost" : "btn--primary"}" data-check-habit="${esc(h.id)}" ${done ? "disabled" : ""}>
                          ${done ? "已完成" : "已完成"}
                        </button>
                        <button type="button" class="btn btn--sm btn--ghost" title="结束重复" data-stop-habit="${esc(h.id)}">${icons.x}</button>
                      </div>
                    </div>
                  `;
                })
                .join("")}</div>`
            : `<div class="empty-state" style="padding:24px 16px;">
                <p class="empty-state-title">今天没有安排打卡</p>
                <p class="empty-state-desc"></p>
              </div>`
        }
      </aside>
    </div>
  `;

  container.querySelectorAll("[data-week-date]").forEach(btn => {
    btn.onclick = () => {
      calendarAnchor = selectedCalDay = btn.dataset.weekDate;
      setState({agendaSub:"week"});
    };
  });
  bindTaskRowEvents(container);
  bindHabitEvents(container, today);
}

function renderTaskListSurface(container, view, title, emptyDesc) {
  const tasks = getMergedTasks(view);
  const today = todayISO();
  container.innerHTML = `
    <section class="surface">
      <div class="surface-header">
        <h2 class="surface-title">${esc(title)} <span class="tabular" style="color:var(--ink-muted);font-weight:500;">(${tasks.length})</span></h2>
      </div>
      ${
        tasks.length
          ? `<ul class="task-list">${tasks.map((t) => renderTaskRow(t, today)).join("")}</ul>`
          : `<div class="empty-state">
              <p class="empty-state-title">暂无条目</p>
              <p class="empty-state-desc">${esc(emptyDesc)}</p>
            </div>`
      }
    </section>
  `;
  bindTaskRowEvents(container);
}

function renderTaskRow(t, today) {
  const isDone = t.status === "done";
  const isCancelled = t.status === "cancelled";
  const isPinned = t.pin === today;
  const dueText = formatDueReadable(t.due);

  const line2Parts = [];
  if (t.project_name) {
    line2Parts.push(
      `<span style="display:inline-flex;align-items:center;gap:5px;"><span class="proj-dot" style="background:${esc(t.color || "#4776BE")}"></span>${esc(t.project_name)}</span>`
    );
  }
  if (dueText) {
    line2Parts.push(`<span class="tabular">${esc(dueText)}</span>`);
  } else if (t.status === "waiting") {
    line2Parts.push(`<span>待补截止日</span>`);
  } else {
    line2Parts.push(`<span>无日期</span>`);
  }

  if (t.overdue && !isDone && !isCancelled) {
    line2Parts.push(`<span class="tag tag--danger">已逾期</span>`);
  } else if (t.prepare_today && !isDone) {
    line2Parts.push(`<span class="tag tag--warn">今天开始准备</span>`);
  }
  if (t.review_prepare && !isDone) {
    line2Parts.push(`<span class="tag tag--danger">准备日冲突</span>`);
  }
  if (t.previous_due && t.assigned) {
    line2Parts.push(`<span class="tag tag--warn">交付日已变更</span>`);
  }
  if (t.handle && !isDone) {
    line2Parts.push(`<span class="tabular">处理日 ${esc(t.handle)}</span>`);
  }
  if (isCancelled) {
    line2Parts.push(`<span class="tag">已取消</span>`);
  } else if (isDone) {
    line2Parts.push(`<span class="tag tag--success">已完成</span>`);
  }
  if (t._pending) {
    line2Parts.push(`<span class="tag tag--warn">待同步</span>`);
  }

  return `
    <li class="task-row priority-level-${t.priority || 2} ${isDone || isCancelled ? "task-row--done" : ""}" data-open-task="${esc(t.id)}">
      <button type="button" class="task-check" role="checkbox" aria-checked="${isDone ? "true" : "false"}"
        aria-label="标记完成：${esc(t.title)}" data-toggle-task="${esc(t.id)}" ${isCancelled || t._pending ? "disabled" : ""}>
        ${isDone ? icons.check : ""}
      </button>
      <div class="task-content">
        <div class="task-line1">
          <span class="task-title">${esc(t.title)}</span>
          ${isPinned ? `<span class="tag tag--accent">今日置顶</span>` : ""}
          ${t.assigned ? `<span class="tag">团队</span>` : ""}
        </div>
        <div class="task-line2">${line2Parts.join("<span>·</span>")}</div>
      </div>
      <span class="priority-pip" title="${priorityLabel(t.priority)}">
        ${t.priority === 3 ? "高" : t.priority === 1 ? "低" : "中"}
      </span>
    </li>
  `;
}

function bindTaskRowEvents(container) {
  container.querySelectorAll("[data-toggle-task]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const tid = btn.dataset.toggleTask;
      const checked = btn.getAttribute("aria-checked") === "true";
      try {
        await api.editTask(tid, { status: checked ? "open" : "done" });
        await syncNow(true);
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  container.querySelectorAll("[data-open-task]").forEach((row) => {
    row.addEventListener("click", () => {
      const tid = row.dataset.openTask;
      const task = getMergedTasks("all").find((t) => t.id === tid);
      if (task && !task._pending) {
        openTaskDrawer(task);
      } else if (task && task._pending) {
        showToast("离线待同步任务，恢复联网同步后可进入详情编辑");
      }
    });
  });
}

function bindHabitEvents(container, today) {
  const newBtn = container.querySelector("#btn-new-habit");
  const creator = container.querySelector("#habit-creator");

  newBtn.addEventListener("click", () => {
    if (creator.innerHTML.trim()) {
      creator.innerHTML = "";
      return;
    }
    const dayLabels = [
      [1, "一"], [2, "二"], [3, "三"], [4, "四"], [5, "五"], [6, "六"], [7, "日"]
    ];
    creator.innerHTML = `
      <form id="habit-form" style="padding:12px 14px;border-bottom:1px solid var(--border-subtle);display:grid;gap:10px;background:var(--bg-canvas);">
        <input class="input" name="title" required placeholder="打卡名称，如：背 30 个单词" />
        <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
          ${dayLabels
            .map(
              ([v, lbl]) => `
            <label class="chip-control" style="cursor:pointer;">
              <input type="checkbox" name="days" value="${v}" checked />
              <span>周${lbl}</span>
            </label>`
            )
            .join("")}
          <button type="button" class="btn btn--sm btn--ghost" id="habit-all-days">全选七天</button>
        </div>
        <label class="field">
          <span class="field-label">结束日期（可选）</span>
          <input class="input" type="date" name="end" />
        </label>
        <div style="display:flex;justify-content:flex-end;gap:6px;">
          <button type="button" class="btn btn--sm" id="habit-cancel">取消</button>
          <button type="submit" class="btn btn--sm btn--primary">创建打卡</button>
        </div>
      </form>
    `;
    creator.querySelector("#habit-cancel").addEventListener("click", () => (creator.innerHTML = ""));
    creator.querySelector("#habit-all-days").addEventListener("click", () => {
      creator.querySelectorAll('input[name="days"]').forEach((c) => (c.checked = true));
    });
    creator.querySelector("#habit-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const title = String(fd.get("title") || "").trim();
      const days = fd.getAll("days").map(Number);
      const end = String(fd.get("end") || "").trim() || null;
      if (!days.length) {
        showToast("请至少选择一天", "error");
        return;
      }
      try {
        await api.createHabit({ id: uuid(), title, days, end });
        await syncNow(true);
        showToast("已新增日常打卡");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  container.querySelectorAll("[data-check-habit]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api.checkHabit(btn.dataset.checkHabit, today);
        await syncNow(true);
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  container.querySelectorAll("[data-stop-habit]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api.stopHabit(btn.dataset.stopHabit);
        await syncNow(true);
        showToast("已结束该打卡重复");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });
}

// Week & Month Calendar with Stacked Project Color Lines
async function renderCalendarView(container, mode) {
  const { start, end, days, titleLabel } = computeCalendarRange(calendarAnchor, mode);


  container.innerHTML = `
    <div class="cal-toolbar">
      <div style="display:flex;align-items:center;gap:6px;">
        <button type="button" class="btn btn--sm btn--icon" id="cal-prev" aria-label="上一周期">${icons.chevronLeft}</button>
        <button type="button" class="btn btn--sm" id="cal-today">回到今天</button>
        <button type="button" class="btn btn--sm btn--icon" id="cal-next" aria-label="下一周期">${icons.chevronRight}</button>
        <strong style="margin-left:6px;font-size:var(--text-md);" class="tabular">${esc(titleLabel)}</strong>
      </div>
      <div style="font-size:var(--text-xs);color:var(--ink-muted);">任务线按优先级着色，点击日期查看详情</div>
    </div>
    <div id="cal-grid-wrap">
      <div class="surface surface-body"><div class="skeleton-bar"></div></div>
    </div>
    <div id="cal-day-detail" style="margin-top:16px;"></div>
  `;

  container.querySelector("#cal-prev").addEventListener("click", () => {
    calendarAnchor = addDays(calendarAnchor, mode === "week" ? -7 : -28);
    renderCalendarView(container, mode);
  });
  container.querySelector("#cal-next").addEventListener("click", () => {
    calendarAnchor = addDays(calendarAnchor, mode === "week" ? 7 : 28);
    renderCalendarView(container, mode);
  });
  container.querySelector("#cal-today").addEventListener("click", () => {
    calendarAnchor = todayISO();
    selectedCalDay = todayISO();
    renderCalendarView(container, mode);
  });

  const calData = buildCalendar(start, end);
  paintCalendarGrid(container, days, calData, mode);
}

function taskSpan(task) {
  const due = task.due?.slice(0, 10);
  const start = task.prepare && (!due || task.prepare <= due) ? task.prepare : due || task.handle;
  return { start, end: due || start };
}

function buildCalendar(start, end) {
  const spans = state.projects
    .filter((p) => !p.hidden && !p.trashed && !p.archived)
    .map((p) => ({
      id: p.id,
      name: p.name,
      start: p.start || p.end,
      end: p.end || p.start,
      color: p.color,
      priority: p.priority
    }))
    .filter((p) => p.start && p.start <= end && p.end >= start)
    .sort((a, b) => b.priority - a.priority);
  const items = getMergedTasks("all").filter(t => {
    const range = taskSpan(t);
    return t.status !== "cancelled" && ((range.start <= end && range.end >= start) ||
      [t.handle,t.prepare].some(day => day >= start && day <= end));
  });
  return { projects: spans, tasks: items };
}

function computeCalendarRange(anchor, mode) {
  const [y, m, d] = anchor.split("-").map(Number);
  if (mode === "week") {
    const dow = weekdayIndex(anchor);
    const start = addDays(anchor, -(dow - 1));
    const days = Array.from({ length: 7 }, (_, i) => ({ iso: addDays(start, i), inMonth: true }));
    const end = days[6].iso;
    return { start, end, days, titleLabel: `${start} 至 ${end}` };
  }
  const firstOfMonth = `${y}-${String(m).padStart(2, "0")}-01`;
  const firstDow = weekdayIndex(firstOfMonth);
  const gridStart = addDays(firstOfMonth, -(firstDow - 1));
  const days = Array.from({ length: 42 }, (_, i) => {
    const iso = addDays(gridStart, i);
    return { iso, inMonth: iso.startsWith(`${y}-${String(m).padStart(2, "0")}`) };
  });
  return {
    start: days[0].iso,
    end: days[41].iso,
    days,
    titleLabel: `${y} 年 ${m} 月`
  };
}

function calendarWeek(days, data, mode, today) {
  const bars = [
    ...data.projects.map(p => ({ ...p, label: p.name, project: true })),
    ...data.tasks.map(t => ({ ...taskSpan(t), label: t.title, priority: t.priority, id: t.id }))
  ].filter(b => b.start <= days[6].iso && b.end >= days[0].iso)
   .sort((a,b) => Number(!!b.project) - Number(!!a.project) || b.priority - a.priority || a.start.localeCompare(b.start));
  const occupied = [];
  const lines = bars.map(b => {
    const first = days.findIndex(d => d.iso >= b.start);
    const last = days.findLastIndex(d => d.iso <= b.end);
    const mask = ((1 << (last - first + 1)) - 1) << first;
    let lane = occupied.findIndex(bits => !(bits & mask));
    if (lane < 0) lane = occupied.length;
    occupied[lane] = (occupied[lane] || 0) | mask;
    const title = b.project ? b.label : `${priorityLabel(b.priority)} · ${b.label}`;
    const style = `grid-column:${first + 1}/${last + 2};grid-row:${lane + 1}`;
    return b.project
      ? `<span class="cal-project-line" title="${esc(title)}" style="${style};background:${esc(b.color)}"></span>`
      : `<span class="cal-task-line priority-level-${b.priority || 2}" data-task-line="${esc(b.id)}" style="${style}" title="${esc(title)}">${esc(b.label)}</span>`;
  });
  return `<div class="cal-week" style="--lanes:${occupied.length}">
    ${days.map(d => `<button type="button" class="cal-cell ${!d.inMonth && mode === "month" ? "cal-cell--other" : ""} ${d.iso === today ? "cal-cell--today" : ""} ${d.iso === selectedCalDay ? "cal-cell--selected" : ""}" data-cal-day="${d.iso}" aria-label="${d.iso}"><span class="cal-day-num tabular">${Number(d.iso.slice(8))}</span></button>`).join("")}
    <div class="cal-tracks">${lines.join("")}</div></div>`;
}

function paintCalendarGrid(container, days, calData, mode) {
  const today = todayISO();
  const dows = ["一", "二", "三", "四", "五", "六", "日"];
  const gridWrap = container.querySelector("#cal-grid-wrap");

  gridWrap.innerHTML = `
    <div class="cal-grid">
      ${dows.map((d) => `<div class="cal-dow">周${d}</div>`).join("")}
      ${days.filter((_, i) => i % 7 === 0).map((_, i) =>
        calendarWeek(days.slice(i * 7, i * 7 + 7), calData, mode, today)).join("")}
    </div>
  `;

  gridWrap.querySelectorAll("[data-cal-day]").forEach((cell) => {
    cell.addEventListener("click", () => {
      selectedCalDay = cell.dataset.calDay;
      paintCalendarGrid(container, days, calData, mode);
    });
  });

  renderSelectedDayDetail(container.querySelector("#cal-day-detail"), selectedCalDay, calData);
}

function renderSelectedDayDetail(el, iso, calData) {
  const dayProjects = (calData.projects || []).filter((p) => p.start <= iso && p.end >= iso);
  const dayTasks = (calData.tasks || []).filter((t) =>
    (taskSpan(t).start <= iso && taskSpan(t).end >= iso) || t.handle === iso || t.prepare === iso
  );
  const today = todayISO();

  el.innerHTML = `
    <div class="surface">
      <div class="surface-header">
        <h3 class="surface-title tabular">${esc(iso)} 当日详情</h3>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${
            dayProjects.length
              ? dayProjects
                  .map(
                    (p) =>
                      `<span class="tag" style="background:${esc(p.color)}18;color:${esc(p.color)};border:1px solid ${esc(p.color)}40;">
                        <span class="proj-dot" style="background:${esc(p.color)}"></span>${esc(p.name)}
                      </span>`
                  )
                  .join("")
              : `<span style="font-size:var(--text-xs);color:var(--ink-muted);">当日无进行中项目区间</span>`
          }
        </div>
      </div>
      ${
        dayTasks.length
          ? `<ul class="task-list">${dayTasks.map((t) => renderTaskRow(t, today)).join("")}</ul>`
          : `<div class="empty-state" style="padding:20px;"><p class="empty-state-desc">这一天没有安排截止、准备或处理的事项。</p></div>`
      }
    </div>
  `;
  bindTaskRowEvents(el);
}

// Slide-over Task Detail Drawer
export async function openTaskDrawer(task) {
  const root = document.getElementById("drawer-root");
  const today = todayISO();
  let recordDetail = null;
  if (task.rid && navigator.onLine) {
    try {
      recordDetail = await api.getRecord(task.rid);
    } catch {
      recordDetail = null;
    }
  }

  const dueDate = task.due ? task.due.slice(0, 10) : "";
  const dueTime = task.due && task.due.length > 10 ? task.due.slice(11, 16) : "";
  const indDate = task.independent ? task.independent.slice(0, 10) : "";
  const indTime = task.independent && task.independent.length > 10 ? task.independent.slice(11, 16) : "";
  const isPinnedToday = task.pin === today;

  root.innerHTML = `
    <div class="drawer-backdrop" id="task-drawer-bg">
      <div class="drawer" role="dialog" aria-modal="true" aria-label="任务详情">
        <div class="drawer-header">
          <h2 class="drawer-title">任务详情</h2>
          <button type="button" class="btn btn--ghost btn--icon" id="drawer-close" aria-label="关闭">${icons.x}</button>
        </div>

        <form class="drawer-body" id="task-detail-form">
          ${
            task.previous_due && task.assigned
              ? `<div class="banner banner--warn">团队交付时间已由队长更新：原 <strong>${esc(task.previous_due)}</strong> → 现 <strong>${esc(task.due || "未定")}</strong></div>`
              : ""
          }
          ${
            task.review_prepare
              ? `<div class="banner banner--danger">你的个人准备日（${esc(task.prepare)}）晚于新的截止时间，请重新选择准备日。</div>`
              : ""
          }

          <label class="field">
            <span class="field-label">标题${task.assigned ? "（由队长维护）" : ""}</span>
            <input class="input" name="title" value="${esc(task.title)}" ${task.assigned ? "disabled" : "required"} />
          </label>

          <div class="field-row">
            <label class="field">
              <span class="field-label">截止日期${task.assigned ? "（由队长维护）" : ""}</span>
              <input class="input" type="date" name="due_date" value="${esc(dueDate)}" ${task.assigned ? "disabled" : ""} />
            </label>
            <label class="field">
              <span class="field-label">精确时刻（留空为全天）</span>
              <input class="input" type="time" name="due_time" value="${esc(dueTime)}" ${task.assigned ? "disabled" : ""} />
            </label>
          </div>

          <div class="field-row">
            <label class="field">
              <span class="field-label">个人优先级</span>
              <select class="select" name="priority">
                <option value="3" ${task.priority === 3 ? "selected" : ""}>高优先级</option>
                <option value="2" ${task.priority === 2 ? "selected" : ""}>中优先级</option>
                <option value="1" ${task.priority === 1 ? "selected" : ""}>低优先级</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">状态</span>
              <select class="select" name="status">
                <option value="open" ${task.status === "open" ? "selected" : ""}>正式待办</option>
                <option value="waiting" ${task.status === "waiting" ? "selected" : ""}>等待确认</option>
                <option value="done" ${task.status === "done" ? "selected" : ""}>已完成</option>
                <option value="cancelled" ${task.status === "cancelled" ? "selected" : ""}>已取消</option>
              </select>
            </label>
          </div>

          <div class="field-row">
            <label class="field">
              <span class="field-label">个人准备日</span>
              <input class="input" type="date" name="prepare" value="${esc(task.prepare || "")}" />
            </label>
            <label class="field">
              <span class="field-label">安排处理日（逾期保留原截止日）</span>
              <div style="display:flex;gap:6px;">
                <input class="input" type="date" name="handle" value="${esc(task.handle || "")}" />
                <button type="button" class="btn btn--sm" id="btn-handle-today">今天</button>
              </div>
            </label>
          </div>

          <div style="display:flex;flex-wrap:wrap;gap:14px;padding:6px 0;">
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:var(--text-sm);cursor:pointer;">
              <input type="checkbox" name="today_pin" ${isPinnedToday ? "checked" : ""} />
              <span>今日置顶（次日自动恢复排序）</span>
            </label>
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:var(--text-sm);cursor:pointer;">
              <input type="checkbox" name="reminder" ${task.reminder ? "checked" : ""} />
              <span>开启截止提醒</span>
            </label>
          </div>

          <div class="field-row">
            <label class="field">
              <span class="field-label">提前提醒分钟数（留空用默认）</span>
              <input class="input" type="number" min="0" max="525600" name="remind_minutes" value="${task.remind_minutes ?? ""}" placeholder="例如 60" />
            </label>
            <label class="field">
              <span class="field-label">独立提醒（不随截止日变动）</span>
              <div style="display:flex;gap:4px;">
                <input class="input" type="date" name="ind_date" value="${esc(indDate)}" />
                <input class="input" type="time" name="ind_time" value="${esc(indTime)}" style="width:105px;" />
              </div>
            </label>
          </div>

          ${
            recordDetail
              ? `
            <label class="field">
              <span class="field-label">任务备忘与链接</span>
              <textarea class="textarea" name="memo_body" placeholder="补充要求、参考链接或复盘笔记…">${esc(recordDetail.body || "")}</textarea>
            </label>
            <div class="field">
              <span class="field-label">附件（${(recordDetail.attachments || []).length}）</span>
              <div class="file-chip-list" id="task-att-list">
                ${(recordDetail.attachments || [])
                  .map(
                    (a) => `
                  <span class="file-chip">
                    ${icons.paperclip}
                    <span>${esc(a.name)}</span>
                    <span class="mono" style="color:var(--ink-muted);">${formatBytes(a.size)}</span>
                    <button type="button" class="btn btn--sm btn--ghost" data-dl-att="${esc(a.id)}" data-dl-name="${esc(a.name)}" data-dl-size="${a.size}">下载</button>
                  </span>`
                  )
                  .join("")}
              </div>
              <div style="margin-top:6px;">
                <label class="btn btn--sm" style="cursor:pointer;">
                  ${icons.paperclip}<span>上传附件</span>
                  <input type="file" id="task-file-input" style="display:none;" />
                </label>
              </div>
            </div>
          `
              : ""
          }
        </form>

        <div class="drawer-footer">
          <button type="button" class="btn btn--danger-soft" id="btn-cancel-task">取消任务</button>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn" id="drawer-cancel">关闭</button>
            <button type="submit" form="task-detail-form" class="btn btn--primary">保存修改</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const close = () => (root.innerHTML = "");
  root.querySelector("#drawer-close").addEventListener("click", close);
  root.querySelector("#drawer-cancel").addEventListener("click", close);
  root.querySelector("#task-drawer-bg").addEventListener("click", (e) => {
    if (e.target.id === "task-drawer-bg") close();
  });

  root.querySelector("#btn-handle-today").addEventListener("click", () => {
    root.querySelector('input[name="handle"]').value = today;
  });

  root.querySelector("#btn-cancel-task").addEventListener("click", async () => {
    try {
      await api.editTask(task.id, { status: "cancelled" });
      await syncNow(true);
      showToast("任务已取消，可在历史记录查看");
      close();
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  const fileInput = root.querySelector("#task-file-input");
  if (fileInput && task.rid) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      if (file.size > state.storage.file_limit) {
        showToast(`文件超过单文件上限（${formatBytes(state.storage.file_limit)}），建议改存外部链接`, "error");
        return;
      }
      try {
        await api.uploadFile(task.rid, uuid(), file.name, file);
        await syncNow(true);
        showToast(`已上传 ${file.name}`);
        openTaskDrawer(task);
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  root.querySelectorAll("[data-dl-att]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const aid = btn.dataset.dlAtt;
      const name = btn.dataset.dlName;
      const size = Number(btn.dataset.dlSize || 0);
      try {
        let local = await offlineDB.getLocalFile(state.user.id, aid);
        let blob = local ? local.blob : await api.downloadFile(aid);
        if (!local) {
          await offlineDB.saveLocalFile(state.user.id, aid, name, size || blob.size, blob);
          await refreshLocalIndexes();
        }
        const saved = await saveBlobToDevice(name, blob);
        if (saved !== null) {
          showToast(saved);
          return;
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

  root.querySelector("#task-detail-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const changes = {
      priority: Number(fd.get("priority")),
      status: String(fd.get("status")),
      prepare: String(fd.get("prepare") || "").trim() || null,
      handle: String(fd.get("handle") || "").trim() || null,
      today_pin: fd.get("today_pin") === "on",
      reminder: fd.get("reminder") === "on"
    };
    const rm = String(fd.get("remind_minutes") || "").trim();
    changes.remind_minutes = rm === "" ? null : Number(rm);

    const iDate = String(fd.get("ind_date") || "").trim();
    const iTime = String(fd.get("ind_time") || "").trim();
    changes.independent = iDate ? (iTime ? `${iDate}T${iTime}` : iDate) : null;

    if (!task.assigned) {
      changes.title = String(fd.get("title") || "").trim();
      const dDate = String(fd.get("due_date") || "").trim();
      const dTime = String(fd.get("due_time") || "").trim();
      changes.due = dDate ? (dTime ? `${dDate}T${dTime}` : dDate) : null;
    }

    try {
      await api.editTask(task.id, changes);
      if (recordDetail && fd.has("memo_body")) {
        const nextBody = String(fd.get("memo_body") || "");
        if (nextBody !== recordDetail.body) {
          await api.editRecordBody(task.rid, recordDetail.version, nextBody);
        }
      }
      await syncNow(true);
      showToast("任务已更新");
      close();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}
