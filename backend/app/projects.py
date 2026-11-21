import secrets
from datetime import date, timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter
from pydantic import Field

from .core import (Creation, DAY, DB, Day, Due, Model, Priority, Title, User, fail, now,
                   one, project, rows, stamp, update)
from .schedule import NewTask, insert_task

router = APIRouter(tags=["项目与阶段"])
COLORS = ["#4776BE","#3F8575","#895EA8","#AB6940","#68793E"]


class NewProject(Creation):
    name: Title
    kind: Literal["course","contest","personal"]="contest"
    priority: Priority=2
    start: Day | None=None
    end: Day | None=None


class EditProject(Model):
    name: Title | None=None
    color: str | None=Field(default=None,pattern=r"^#[0-9a-fA-F]{6}$")
    priority: Priority | None=None
    start: Day | None=None
    end: Day | None=None
    archived: bool | None=None


class Flags(Model):
    pinned: bool
    hidden: bool


class AssignedTask(Creation):
    title: Title
    due: Due | None = None


class Assignment(Model):
    task: AssignedTask
    assignee: UUID


class Delivery(Model):
    due: Due | None
    title: Title | None=None


class Transfer(Model):
    member: UUID


def project_list(db, uid):
    result = rows(db,"""SELECT p.*,m.hidden,m.pinned FROM projects p JOIN members m ON m.pid=p.id
                        WHERE m.uid=? ORDER BY p.rowid""",(uid,))
    for p in result:
        mine = db.execute("""SELECT title,due,prepare FROM tasks WHERE pid=? AND uid=?
                             AND status IN ('open','waiting') ORDER BY coalesce(prepare,due,'9999'),rowid LIMIT 1""",
                          (p["id"],uid)).fetchone()
        p["next_personal"] = dict(mine) if mine else None
        deadline = db.execute("""SELECT min(due) FROM tasks WHERE pid=? AND due IS NOT NULL
                                 AND ((uid=? AND status IN ('open','waiting')) OR
                                      (assigned=1 AND uid<>? AND substr(due,1,10)>=?))""",
                              (p["id"],uid,uid,now().date().isoformat())).fetchone()[0]
        p["next_due"] = min((d for d in (p["end"],deadline) if d),default=None)
    return sorted(result,key=lambda p:(not p["pinned"],p["next_due"] or "9999-12-31Z",-p["priority"]))


@router.get("/projects")
def projects(db: DB,u: User):
    return project_list(db,u["id"])


@router.post("/projects",status_code=201)
def new_project(data: NewProject,db: DB,u: User):
    if data.start and data.end and data.start>data.end:
        fail(422,"起始日不能晚于结束日")
    pid = str(data.id)
    db.execute("""INSERT INTO projects(id,name,lead,kind,priority,color,start,end)
                  VALUES(?,?,?,?,?,?,?,?)""",(pid,data.name,u["id"],data.kind,data.priority,
                                               secrets.choice(COLORS),data.start,data.end))
    db.execute("INSERT INTO members(pid,uid) VALUES(?,?)",(pid,u["id"]))
    return project(db,pid,u["id"])


@router.patch("/projects/{pid}")
def edit(pid: str,data: EditProject,db: DB,u: User):
    p = project(db,pid,u["id"],leader=True)
    changes = data.model_dump(exclude_unset=True)
    if any(v is None for k,v in changes.items() if k not in ("start","end")):
        fail(422,"项目字段不能为空")
    merged = p | changes
    if merged["start"] and merged["end"] and merged["start"]>merged["end"]:
        fail(422,"起始日不能晚于结束日")
    update(db,"projects",pid,changes)
    return project(db,pid,u["id"])


@router.put("/projects/{pid}/preferences")
def flags(pid: str,data: Flags,db: DB,u: User):
    project(db,pid,u["id"])
    db.execute("UPDATE members SET pinned=?,hidden=? WHERE pid=? AND uid=?",
               (data.pinned,data.hidden,pid,u["id"]))
    return data


@router.get("/projects/{pid}/team")
def team(pid: str,db: DB,u: User):
    p = project(db,pid,u["id"])
    return {"lead":p["lead"],"members":rows(db,"""SELECT u.id,u.name FROM members m JOIN users u ON u.id=m.uid
                                                  WHERE m.pid=?""",(pid,)),
            "assignments":rows(db,"SELECT id,uid,title,due FROM tasks WHERE pid=? AND assigned=1",(pid,))}


@router.post("/projects/{pid}/assignments",status_code=201)
def assign(pid: str,data: Assignment,db: DB,u: User):
    project(db,pid,u["id"],leader=True)
    # Team assignment creates a private task with the project default priority.
    task = NewTask(id=data.task.id,title=data.task.title,pid=pid,due=data.task.due)
    result = insert_task(db,task,str(data.assignee),assigned=True)
    return {k:result[k] for k in ("id","uid","pid","title","due")}


@router.patch("/projects/{pid}/assignments/{tid}")
def delivery(pid: str,tid: str,data: Delivery,db: DB,u: User):
    project(db,pid,u["id"],leader=True)
    task = one(db,"SELECT due FROM tasks WHERE id=? AND pid=? AND assigned=1",(tid,pid))
    changes = {"due":data.due}
    if task["due"]!=data.due:
        changes["previous_due"]=task["due"]
    if data.title:
        changes["title"]=data.title
    update(db,"tasks",tid,changes)
    return one(db,"SELECT id,title,due,uid FROM tasks WHERE id=?",(tid,))


@router.get("/projects/{pid}/suggestions")
def suggestions(pid: str,db: DB,u: User):
    p = project(db,pid,u["id"])
    if not p["end"] or p["kind"]!="contest":
        return []
    end = date.fromisoformat(p["end"])
    return [{"title":title,"pid":pid,"due":(end-timedelta(days=offset)).isoformat(),
             "prepare":(end-timedelta(days=offset+lead)).isoformat()}
            for title,offset,lead in (("收集资料",5,2),("准备初稿",2,2),("检查并提交",0,1))]


@router.post("/projects/{pid}/transfer")
def transfer(pid: str,data: Transfer,db: DB,u: User):
    project(db,pid,u["id"],leader=True)
    project(db,pid,str(data.member))
    update(db,"projects",pid,{"lead":str(data.member)})
    return {"lead":str(data.member)}


@router.post("/projects/{pid}/leave")
def leave(pid: str,db: DB,u: User):
    p = project(db,pid,u["id"])
    if p["lead"]==u["id"]:
        fail(409,"请先移交队长")
    db.execute("UPDATE records SET former=?,pid=NULL WHERE pid=? AND uid=? AND shared=0",(p["name"],pid,u["id"]))
    db.execute("UPDATE tasks SET pid=NULL,assigned=0 WHERE pid=? AND uid=?",(pid,u["id"]))
    db.execute("DELETE FROM members WHERE pid=? AND uid=?",(pid,u["id"]))
    return {"ok":True}


def impact(db,pid):
    counts = one(db,"""SELECT count(DISTINCT r.id) shared_records,count(DISTINCT l.aid) attachments
                     FROM records r LEFT JOIN links l ON r.id=l.rid WHERE r.pid=? AND r.shared=1""",(pid,))
    counts["reclaimable_bytes"] = db.execute("""SELECT coalesce(sum(a.size),0) FROM assets a WHERE
        EXISTS (SELECT 1 FROM links l JOIN records r ON l.rid=r.id WHERE l.aid=a.id AND r.pid=? AND r.shared=1)
        AND NOT EXISTS (SELECT 1 FROM links l JOIN records r ON l.rid=r.id WHERE l.aid=a.id
                        AND (r.pid IS NOT ? OR r.shared=0))""",(pid,pid)).fetchone()[0]
    return counts


@router.get("/projects/{pid}/deletion")
def preview(pid: str,db: DB,u: User):
    p = project(db,pid,u["id"],leader=True,trash=True)
    return {"name":p["name"],"trashed":p["trashed"],"expires":p["trashed"]+7*DAY if p["trashed"] else None,
            **impact(db,pid)}


@router.post("/projects/{pid}/trash")
def trash(pid: str,db: DB,u: User):
    p = project(db,pid,u["id"],leader=True,trash=True)
    at = p["trashed"] or stamp()
    update(db,"projects",pid,{"trashed":at})
    # Keep the old project name searchable for private material throughout recovery.
    db.execute("UPDATE records SET former=? WHERE pid=? AND shared=0",(p["name"],pid))
    return {"purge_at":at+7*DAY}


@router.post("/projects/{pid}/restore")
def restore(pid: str,db: DB,u: User):
    p = project(db,pid,u["id"],leader=True,trash=True)
    if p["trashed"] and p["trashed"]+7*DAY<=stamp():
        fail(410,"恢复期限已过")
    update(db,"projects",pid,{"trashed":None})
    db.execute("UPDATE records SET former=NULL WHERE pid=?",(pid,))
    return {"ok":True}


def purge(db,pid):
    db.execute("DELETE FROM records WHERE pid=? AND shared=1",(pid,))
    db.execute("UPDATE tasks SET assigned=0 WHERE pid=?",(pid,))
    db.execute("DELETE FROM projects WHERE id=?",(pid,))


class Confirm(Model):
    confirmed: Literal[True]


@router.post("/projects/{pid}/purge")
def permanent(pid: str,data: Confirm,db: DB,u: User):
    p = project(db,pid,u["id"],leader=True,trash=True)
    if p["trashed"] is None:
        fail(409,"请先移入回收站")
    purge(db,pid)
    return {"ok":True}
