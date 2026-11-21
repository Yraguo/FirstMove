from difflib import SequenceMatcher
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter
from pydantic import Field

from .core import Creation, DB, Model, Title, User, fail, key, one, project, rows, stamp, update
from .schedule import NewTask, insert_task

router = APIRouter(tags=["记录与资料"])
Body = Annotated[str, Field(max_length=100_000)]
Caption = Annotated[str, Field(max_length=240)]

# Use this same relation for list, detail, search and attachment access.
VISIBLE = """FROM records r LEFT JOIN projects p ON p.id=r.pid
    LEFT JOIN members m ON m.pid=r.pid AND m.uid=:viewer
    WHERE ((r.shared=0 AND r.uid=:viewer)
       OR (r.shared=1 AND m.uid IS NOT NULL AND p.trashed IS NULL))"""


def visible_records(db, uid, pid=None):
    clause = " AND r.pid=:pid AND p.trashed IS NULL" if pid else ""
    return [dict(r) for r in db.execute(
        "SELECT r.*,p.trashed project_trashed " + VISIBLE + clause +
        " ORDER BY r.pinned DESC,r.position,r.created DESC,r.rowid DESC",
        {"viewer":uid,"pid":pid})]


def record(db, rid, uid, write=False):
    result = one(db, "SELECT r.* " + VISIBLE + " AND r.id=:rid", {"viewer":uid,"rid":rid})
    if write and result["uid"] != uid:
        fail(403,"仅作者可修改")
    return result


class NewRecord(Creation):
    pid: UUID | None = None
    title: Caption = ""
    body: Body = ""
    kind: Literal["memo","note"] = "memo"


@router.post("/records",status_code=201)
def create(data: NewRecord, db: DB, u: User):
    rid, uid = str(data.id), u["id"]
    if db.execute("SELECT 1 FROM records WHERE id=?",(rid,)).fetchone():
        return record(db,rid,uid,True)
    pid = str(data.pid) if data.pid else None
    if pid:
        project(db,pid,uid)
    db.execute("""INSERT INTO records(id,uid,pid,title,body,kind,created,updated)
                  VALUES(?,?,?,?,?,?,?,?)""",(rid,uid,pid,data.title,data.body,data.kind,stamp(),stamp()))
    db.execute("INSERT INTO revisions VALUES(?,1,?)",(rid,data.body))
    return record(db,rid,uid)


@router.get("/records")
def listing(db: DB,u: User,pid: str | None=None):
    return visible_records(db,u["id"],pid)


@router.get("/records/{rid}")
def detail(rid: str, db: DB,u: User):
    r = record(db,rid,u["id"])
    r["attachments"] = rows(db,"""SELECT a.id,a.name,a.size FROM assets a JOIN links l ON a.id=l.aid
                                   WHERE l.rid=? ORDER BY l.rowid""",(rid,))
    if u["id"]==r["uid"]:
        r["conflicts"] = rows(db,"SELECT id,body,base FROM conflicts WHERE rid=?",(rid,))
    return r


class Metadata(Model):
    title: Caption | None=None
    kind: Literal["memo","note"] | None=None
    pid: UUID | None=None
    shared: bool | None=None
    pinned: bool | None=None
    position: int | None=Field(default=None,ge=0,le=2**31-1)


@router.patch("/records/{rid}")
def metadata(rid: str,data: Metadata,db: DB,u: User):
    r = record(db,rid,u["id"],True)
    changes = data.model_dump(mode="json",exclude_unset=True)
    if any(v is None for k,v in changes.items() if k!="pid"):
        fail(422,"字段不能为空")
    if "pid" in changes:
        if changes["pid"]:
            project(db,changes["pid"],u["id"])
        if changes["pid"]!=r["pid"]:
            changes["former"]=None
            changes.setdefault("shared",False)
    if changes.get("shared"):
        pid = changes.get("pid",r["pid"])
        if not pid:
            fail(422,"先选择要分享的项目")
        project(db,pid,u["id"])
    update(db,"records",rid,changes | {"updated":stamp()})
    return record(db,rid,u["id"])


def merge_body(base, current, incoming):
    if current==incoming or incoming==base:
        return current
    if current==base:
        return incoming
    original = base.splitlines(keepends=True)
    def edits(text):
        lines = text.splitlines(keepends=True)
        return [(i,j,lines[k:l]) for op,i,j,k,l in SequenceMatcher(None,original,lines).get_opcodes()
                if op!="equal"]
    combined = edits(current)
    for change in edits(incoming):
        start,end,_ = change
        if change in combined:
            continue
        for left,right,_ in combined:
            if max(start,left)<min(end,right) or start==left or left<start<right or start<left<end:
                return None
        combined.append(change)
    for start,end,replacement in sorted(combined,reverse=True):
        original[start:end]=replacement
    return "".join(original)


class BodyEdit(Model):
    base_version: int=Field(ge=1)
    body: Body


def save_body(db,r,new_body):
    if new_body!=r["body"]:
        version = r["version"]+1
        update(db,"records",r["id"],{"version":version,"body":new_body,"updated":stamp()})
        db.execute("INSERT INTO revisions VALUES(?,?,?)",(r["id"],version,new_body))


@router.put("/records/{rid}/body")
def body(rid: str,data: BodyEdit,db: DB,u: User):
    r = record(db,rid,u["id"],True)
    base = one(db,"SELECT body FROM revisions WHERE rid=? AND version=?",(rid,data.base_version))
    merged = merge_body(base["body"],r["body"],data.body)
    conflict_id = None
    if merged is None:
        previous = db.execute("SELECT id FROM conflicts WHERE rid=? AND base=? AND body=?",
                              (rid,data.base_version,data.body)).fetchone()
        conflict_id = previous[0] if previous else key()
        if not previous:
            db.execute("INSERT INTO conflicts VALUES(?,?,?,?)",(conflict_id,rid,data.body,data.base_version))
    else:
        save_body(db,r,merged)
    return {"record":record(db,rid,u["id"]),"conflict_id":conflict_id}


@router.post("/records/{rid}/conflicts/{cid}/resolve")
def resolve(rid: str,cid: str,data: BodyEdit,db: DB,u: User):
    r = record(db,rid,u["id"],True)
    one(db,"SELECT id FROM conflicts WHERE rid=? AND id=?",(rid,cid))
    if r["version"]!=data.base_version:
        fail(409,"请先读取最新版本")
    save_body(db,r,data.body)
    db.execute("DELETE FROM conflicts WHERE id=?",(cid,))
    return record(db,rid,u["id"])


@router.post("/records/{rid}/task")
def convert(rid: str,data: NewTask,db: DB,u: User):
    r = record(db,rid,u["id"],True)
    existing = db.execute("SELECT * FROM tasks WHERE rid=? AND uid=?",(rid,u["id"])).fetchone()
    if existing:
        return dict(existing)
    if data.pid and str(data.pid)!=r["pid"]:
        fail(422,"请先在记录中设置项目归属")
    return insert_task(db,data.model_copy(update={"pid":r["pid"]}),u["id"],rid=rid)


@router.delete("/records/{rid}")
def remove(rid: str,db: DB,u: User):
    record(db,rid,u["id"],True)
    if db.execute("SELECT 1 FROM tasks WHERE rid=?",(rid,)).fetchone():
        fail(409,"记录仍被任务使用")
    db.execute("DELETE FROM records WHERE id=?",(rid,))
    return {"ok":True}
