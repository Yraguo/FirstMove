import tempfile
from uuid import UUID
from urllib.parse import quote

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from . import core
from .core import DB, User, fail, one
from .records import VISIBLE, record

router = APIRouter(tags=["附件与配额"])
CHUNK = 256 * 1024


def usage(db,uid):
    used, total_used = db.execute(
        "SELECT coalesce(sum(CASE WHEN uid=? THEN size ELSE 0 END),0),coalesce(sum(size),0) FROM assets",
        (uid,)).fetchone()
    quota = one(db,"SELECT quota FROM users WHERE id=?",(uid,))["quota"]
    quota = core.PERSONAL if quota is None else quota
    return {"used":used,"quota":quota,"available":max(0,min(quota-used,core.TOTAL-total_used)),
            "file_limit":core.FILE_LIMIT,"large_file_hint":core.LARGE}


@router.get("/me/storage")
def storage(db: DB,u: User):
    return usage(db,u["id"])


def directory(db,uid):
    return [dict(row) for row in db.execute(
        """SELECT r.id rid,a.id,a.name,a.size FROM assets a JOIN links l ON l.aid=a.id
           JOIN (SELECT r.id """ + VISIBLE + ") r ON r.id=l.rid ORDER BY l.rowid",
        {"viewer":uid})]


def write_blob(db,uid,rid,aid,name,size,stream,session):
    db.execute("BEGIN IMMEDIATE")
    if not db.execute("SELECT 1 FROM sessions WHERE token=? AND expires>?",(session,core.stamp())).fetchone():
        fail(401,"请重新登录")
    record(db,rid,uid,True)
    existing = db.execute("SELECT rowid,uid,name,size FROM assets WHERE id=?",(aid,)).fetchone()
    if existing:
        linked = db.execute("SELECT 1 FROM links WHERE aid=? AND rid=?",(aid,rid)).fetchone()
        if existing["uid"]!=uid or not linked or existing["size"]!=size or existing["name"]!=name:
            fail(409,"附件编号已使用")
        # Reusing an offline UUID must never acknowledge different content as saved.
        stream.seek(0)
        if size:
            with db.blobopen("assets","content",existing["rowid"],readonly=True) as blob:
                while incoming := stream.read(CHUNK):
                    if blob.read(len(incoming)) != incoming:
                        fail(409,"该编号已对应另一份文件")
        return {"id":aid,"name":name,"size":size}
    if size>usage(db,uid)["available"]:
        fail(413,"剩余空间不足，可以改存外部链接")
    inserted = db.execute("INSERT INTO assets VALUES(?,?,?,?,zeroblob(?))",(aid,uid,name,size,size))
    if size:
        stream.seek(0)
        with db.blobopen("assets","content",inserted.lastrowid) as blob:
            while chunk := stream.read(CHUNK):
                blob.write(chunk)
    db.execute("INSERT INTO links VALUES(?,?)",(rid,aid))
    return {"id":aid,"name":name,"size":size}


@router.put("/records/{rid}/files/{aid}/content")
async def upload(rid: str,aid: UUID,request: Request,db: DB,u: User,
                 name: str=Query(min_length=1,max_length=240)):
    record(db,rid,u["id"],True)
    if any(ord(c)<32 for c in name) or "/" in name or "\\" in name:
        fail(422,"文件名无效")
    length = request.headers.get("content-length")
    if length is not None and (not length.isdecimal() or int(length)>core.FILE_LIMIT):
        fail(413,"超过单文件上限")
    size = 0
    with tempfile.TemporaryFile() as stream:
        async for chunk in request.stream():
            size += len(chunk)
            if size>core.FILE_LIMIT:
                fail(413,"超过单文件上限")
            await run_in_threadpool(stream.write,chunk)
        return await run_in_threadpool(write_blob,db,u["id"],rid,str(aid),name,size,stream,u["session"])


@router.put("/records/{rid}/files/{aid}")
def link(rid: str,aid: str,db: DB,u: User):
    record(db,rid,u["id"],True)
    # Only the uploader can introduce new references; verify an accessible source too.
    accessible_file(db,aid,u["id"])
    one(db,"SELECT id FROM assets WHERE id=? AND uid=?",(aid,u["id"]))
    db.execute("INSERT OR IGNORE INTO links VALUES(?,?)",(rid,aid))
    return {"id":aid}


@router.delete("/records/{rid}/files/{aid}")
def unlink(rid: str,aid: str,db: DB,u: User):
    record(db,rid,u["id"],True)
    db.execute("DELETE FROM links WHERE rid=? AND aid=?",(rid,aid))
    return {"ok":True}


def accessible_file(db,aid,uid):
    return one(db,"""SELECT a.rowid blob_id,a.name,a.size FROM assets a WHERE a.id=:aid AND EXISTS
               (SELECT 1 FROM links l WHERE l.aid=a.id AND l.rid IN (SELECT r.id """ + VISIBLE + "))",
               {"viewer":uid,"aid":aid})


@router.get("/files/{aid}")
def download(aid: str,u: User):
    # A stream owns its read transaction until the last byte or a disconnect.
    db = core.connect()
    try:
        db.execute("BEGIN")
        info = accessible_file(db,aid,u["id"])
        blob = db.blobopen("assets","content",info["blob_id"],readonly=True)
    except BaseException:
        db.close()
        raise
    async def chunks():
        try:
            while chunk := await run_in_threadpool(blob.read,CHUNK):
                yield chunk
        finally:
            blob.close()
            db.close()
    return StreamingResponse(chunks(),media_type="application/octet-stream",
                             headers={"Content-Length":str(info["size"]),
                                      "Content-Disposition":"attachment; filename*=UTF-8''"+quote(info["name"],safe=""),
                                      "X-Content-Type-Options":"nosniff"})
