import asyncio
import hashlib
import json
import logging
import sqlite3
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth, core, files, projects, records, schedule
from .core import DB, Day, User, fail


def sweep():
    db = core.connect()
    try:
        with db:
            db.execute("BEGIN IMMEDIATE")
            for row in db.execute("SELECT id FROM projects WHERE trashed<=?",(core.stamp()-7*core.DAY,)).fetchall():
                projects.purge(db,row["id"])
            db.execute("DELETE FROM sessions WHERE expires<=?",(core.stamp(),))
            db.execute("DELETE FROM invites WHERE expires<=?",(core.stamp(),))
    finally:
        db.close()


async def janitor():
    while True:
        await asyncio.sleep(60)
        try:
            await asyncio.to_thread(sweep)
        except sqlite3.Error:
            logging.exception("回收站清理稍后重试")


@asynccontextmanager
async def lifespan(app):
    core.initialize()
    sweep()
    worker = asyncio.create_task(janitor())
    try:
        yield
    finally:
        worker.cancel()
        await asyncio.gather(worker,return_exceptions=True)


app = FastAPI(title="先行 API",version="1.0",lifespan=lifespan)

# Serve only browser assets. API routes, OpenAPI and documentation keep their own paths.
FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
if FRONTEND.is_dir():
    for folder in ("src", "styles"):
        app.mount("/" + folder, StaticFiles(directory=FRONTEND / folder), name=folder)

    @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
    @app.api_route("/index.html", methods=["GET", "HEAD"], include_in_schema=False)
    def homepage():
        return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-cache"})

    @app.get("/sw.js", include_in_schema=False)
    def service_worker():
        return FileResponse(FRONTEND / "sw.js", media_type="application/javascript",
                            headers={"Cache-Control": "no-cache"})

    @app.get("/manifest.json", include_in_schema=False)
    def manifest():
        return FileResponse(FRONTEND / "manifest.json", media_type="application/manifest+json")


@app.middleware("http")
async def origin_guard(request: Request, call_next):
    if request.method not in ("GET","HEAD","OPTIONS"):
        origin = request.headers.get("origin")
        if (origin and urlsplit(origin).netloc!=request.headers.get("host")
                or request.headers.get("sec-fetch-site")=="cross-site"):
            return JSONResponse({"detail":"需要同源请求"},status_code=403)
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"]="private, no-store"
    return response


@app.exception_handler(sqlite3.IntegrityError)
async def integrity_error(request,exc):
    return JSONResponse({"detail":"数据冲突，请刷新后重试"},status_code=409)


for router in (auth.router,schedule.router,projects.router,records.router,files.router):
    app.include_router(router,prefix="/api")


@app.get("/api/health",tags=["服务"])
def health(db: DB):
    db.execute("SELECT 1 FROM users LIMIT 1").fetchone()
    return {"ok":True}


@app.get("/api/calendar",tags=["日程、打卡与提醒"])
def calendar(start: Day,end: Day,db: DB,u: User):
    if not 0 <= (date.fromisoformat(end)-date.fromisoformat(start)).days <= 366:
        fail(422,"请选择一年内的日期区间")
    spans = []
    for p in projects.project_list(db,u["id"]):
        first,last = p["start"] or p["end"],p["end"] or p["start"]
        if first and first<=end and last>=start and not(p["hidden"] or p["trashed"] or p["archived"]):
            spans.append({"id":p["id"],"name":p["name"],"start":first,"end":last,
                          "color":p["color"],"priority":p["priority"]})
    items = [t for t in schedule.task_list(db,u["id"],"all") if t["status"]!="cancelled"
             and (any(start<=value[:10]<=end for value in (t["due"],t["prepare"],t["handle"]) if value)
                  or (t["prepare"] and t["due"] and t["prepare"]<=end and t["due"][:10]>=start))]
    return {"projects":sorted(spans,key=lambda p:-p["priority"]),"tasks":items}


@app.get("/api/search",tags=["搜索与同步"])
def search(db: DB,u: User,q: str=Query(min_length=1,max_length=240)):
    term = q.casefold().strip()
    if not term:
        fail(422,"请输入搜索词")
    matches = [r for r in records.visible_records(db,u["id"])
               if any(term in (r[k] or "").casefold() for k in ("title","body","former"))]
    return {"projects":[p for p in projects.project_list(db,u["id"])
                        if not p["trashed"] and term in p["name"].casefold()],
            "records":matches,"files":[a for a in files.directory(db,u["id"]) if term in a["name"].casefold()]}


@app.get("/api/sync",tags=["搜索与同步"])
def snapshot(db: DB,u: User,request: Request):
    uid = u["id"]
    # One SQLite read transaction yields a consistent permission-filtered replacement manifest.
    data = {"user":auth.me(u),"projects":projects.project_list(db,uid),
            "tasks":schedule.task_list(db,uid,"all"),"records":records.visible_records(db,uid),
            "files":files.directory(db,uid),"habits":core.rows(db,"SELECT * FROM habits WHERE uid=?",(uid,)),
            "checks":core.rows(db,"SELECT c.* FROM checks c JOIN habits h ON c.hid=h.id WHERE h.uid=?",(uid,)),
            "conflicts":core.rows(db,"SELECT c.id,c.rid FROM conflicts c JOIN records r ON r.id=c.rid WHERE r.uid=?",(uid,)),
            "reminders":schedule.reminders(db,u),"storage":files.usage(db,uid)}
    raw = json.dumps(data,ensure_ascii=False,separators=(",",":")).encode()
    etag = '"' + hashlib.sha256(raw).hexdigest() + '"'
    if request.headers.get("if-none-match")==etag:
        return Response(status_code=304,headers={"ETag":etag})
    return Response(raw,media_type="application/json",headers={"ETag":etag})
