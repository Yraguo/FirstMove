from datetime import date, timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter
from pydantic import Field

from .core import (Creation, DB, Day, Due, Model, Priority, Title, User, fail, key,
                   now, one, project, rows, stamp, update, deadline_instant)

router = APIRouter(tags=["日程、打卡与提醒"])
Status = Literal["open","waiting","done","cancelled"]


class NewTask(Creation):
    title: Title
    pid: UUID | None = None
    due: Due | None = None
    priority: Priority | None = None
    prepare: Day | None = None
    status: Literal["open","waiting"] = "open"


class TaskEdit(Model):
    title: Title | None = None
    due: Due | None = None
    prepare: Day | None = None
    handle: Day | None = None
    priority: Priority | None = None
    status: Status | None = None
    today_pin: bool | None = None
    reminder: bool | None = None
    remind_minutes: int | None = Field(default=None,ge=0,le=525600)
    independent: Due | None = None


def own_task(db, tid, uid):
    return one(db,"""SELECT t.* FROM tasks t LEFT JOIN projects p ON p.id=t.pid
                     WHERE t.id=? AND t.uid=? AND p.trashed IS NULL""",(tid,uid))


def insert_task(db, data, uid, *, assigned=False, rid=None):
    tid = str(data.id)
    pid = str(data.pid) if data.pid else None
    priority = data.priority
    if pid:
        p = project(db,pid,uid)
        priority = priority or p["priority"]
    existing = db.execute("SELECT uid,rid FROM tasks WHERE id=?",(tid,)).fetchone()
    if existing:
        if existing["uid"] != uid or assigned or (rid and existing["rid"]!=rid):
            fail(409,"任务编号已使用")
        return own_task(db,tid,uid)
    if not rid:
        rid = key()
        db.execute("""INSERT INTO records(id,uid,pid,title,kind,created,updated)
                      VALUES(?,?,?,?,'task',?,?)""",(rid,uid,pid,data.title,stamp(),stamp()))
        db.execute("INSERT INTO revisions VALUES(?,1,'')",(rid,))
    db.execute("""INSERT INTO tasks(id,uid,pid,rid,assigned,title,due,priority,prepare,status,created)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
               (tid,uid,pid,rid,assigned,data.title,data.due,priority or 2,data.prepare,data.status,stamp()))
    return own_task(db,tid,uid)


@router.post("/tasks",status_code=201)
def create_task(data: NewTask, db: DB, u: User):
    return insert_task(db,data,u["id"])


@router.patch("/tasks/{tid}")
def edit_task(tid: str, data: TaskEdit, db: DB, u: User):
    t = own_task(db,tid,u["id"])
    changes = data.model_dump(exclude_unset=True)
    if any(k in changes and changes[k] is None for k in ("status","priority","title","reminder","today_pin")):
        fail(422,"字段不能为空")
    if t["assigned"] and ("due" in changes or "title" in changes):
        fail(422,"团队标题和截止时间由队长更新")
    if "status" in changes:
        changes["done"] = (t["done"] or now().isoformat()) if changes["status"]=="done" else None
    if "today_pin" in changes:
        changes["pin"] = now().date().isoformat() if changes.pop("today_pin") else None
    update(db,"tasks",tid,changes)
    return own_task(db,tid,u["id"])


def task_list(db, uid, view="agenda"):
    moment = now()
    today = moment.date().isoformat()
    result = rows(db,"""SELECT t.*,p.name project_name,p.color FROM tasks t
                        LEFT JOIN projects p ON p.id=t.pid WHERE t.uid=? AND p.trashed IS NULL
                        ORDER BY t.created,t.rowid""",(uid,))
    filtered = []
    for t in result:
        due = t["due"]
        completed = t["status"]=="done"
        t["overdue"] = bool(due and deadline_instant(due)<=moment and t["status"] in ("open","waiting"))
        t["prepare_today"] = bool(t["prepare"] and t["prepare"]<=today and t["status"]=="open")
        t["review_prepare"] = bool(t["prepare"] and due and t["prepare"]>due[:10])
        if view=="waiting" and t["status"]!="waiting":
            continue
        if view=="history" and t["status"] not in ("done","cancelled"):
            continue
        if view=="agenda":
            if t["status"] in ("waiting","cancelled"):
                continue
            if completed and (deadline_instant(due)<=moment if due else t["done"][:10]!=today):
                continue
        filtered.append(t)
    # A date prefix sorts before all timed deadlines on that date.
    return sorted(filtered,key=lambda t:(t["status"]=="done", t["pin"]!=today,
                                         t["due"] or "9999-12-31Z", -t["priority"]))


@router.get("/tasks")
def tasks(db: DB, u: User, view: Literal["agenda","all","waiting","history"]="agenda"):
    return task_list(db,u["id"],view)


@router.get("/tasks/{tid}")
def detail(tid: str, db: DB, u: User):
    return own_task(db,tid,u["id"])


class Habit(Creation):
    title: Title
    days: set[int] = Field(min_length=1, max_length=7)
    start: Day | None = None
    end: Day | None = None


@router.post("/habits", status_code=201)
def new_habit(data: Habit, db: DB, u: User):
    start = data.start or now().date().isoformat()
    if not data.days <= set(range(1,8)) or (data.end and data.end < start):
        fail(422,"请检查星期和起止日期")
    db.execute("INSERT INTO habits VALUES(?,?,?,?,?,?)",
               (str(data.id),u["id"],data.title,",".join(map(str,sorted(data.days))),start,data.end))
    return {"id":str(data.id)}


@router.get("/habits")
def habits(db: DB, u: User, day: Day | None=None):
    day = day or now().date().isoformat()
    return rows(db,"""SELECT h.*, EXISTS(SELECT 1 FROM checks WHERE hid=h.id AND day=?) completed
                      FROM habits h WHERE uid=? AND start<=? AND (end IS NULL OR end>=?)
                      AND instr(days,?)>0 ORDER BY h.rowid""",
                (day,u["id"],day,day,str(date.fromisoformat(day).isoweekday())))


@router.put("/habits/{hid}/checks/{day}")
def check(hid: str, day: Day, db: DB, u: User):
    h = one(db,"SELECT * FROM habits WHERE id=? AND uid=?",(hid,u["id"]))
    if day<h["start"] or (h["end"] and day>h["end"]) or str(date.fromisoformat(day).isoweekday()) not in h["days"]:
        fail(422,"当天没有这项打卡")
    db.execute("INSERT OR IGNORE INTO checks VALUES(?,?)",(hid,day))
    return {"completed":True}


@router.post("/habits/{hid}/stop")
def stop(hid: str, db: DB, u: User):
    h = one(db,"SELECT * FROM habits WHERE id=? AND uid=?",(hid,u["id"]))
    end = min(h["end"] or "9999-12-31",now().date().isoformat())
    db.execute("UPDATE habits SET end=? WHERE id=?",(end,hid))
    return {"end":end}


@router.get("/reminders")
def reminders(db: DB, u: User):
    if not u["enabled"]:
        return []
    result = []
    for t in task_list(db,u["id"],"all"):
        if t["status"] not in ("open","waiting"):
            continue
        due = t["due"]
        schedule = {}
        if due and t["reminder"]:
            if t["remind_minutes"] is not None:
                schedule["deadline"] = deadline_instant(due) - timedelta(minutes=t["remind_minutes"])
            elif len(due)==10:
                eve = date.fromisoformat(due)-timedelta(days=1)
                schedule["deadline"] = deadline_instant(eve.isoformat()+"T"+u["evening"])
            else:
                schedule["deadline"] = deadline_instant(due)
        if t["independent"]:
            schedule["independent"] = deadline_instant(t["independent"] if len(t["independent"])>10
                                                    else t["independent"]+"T09:00")
        for kind, when in schedule.items():
            result.append({"id":f"{t['id']}:{kind}:{when.isoformat()}","task_id":t["id"],"title":t["title"],
                           "kind":kind,"at":when.isoformat()})
    return sorted(result,key=lambda r:r["at"])
