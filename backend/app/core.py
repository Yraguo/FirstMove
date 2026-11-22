import hashlib
import os
import secrets
import sqlite3
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import Cookie, Depends, HTTPException, Request
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

DATA = Path(os.getenv("WORKSPACE_DATA", Path(__file__).resolve().parents[1] / "data"))
ZONE = ZoneInfo(os.getenv("WORKSPACE_ZONE", "Asia/Shanghai"))
DAY = 86400
TOTAL = int(os.getenv("WORKSPACE_TOTAL_BYTES", 1024**3))
PERSONAL = int(os.getenv("WORKSPACE_USER_BYTES", 128 * 1024**2))
FILE_LIMIT = int(os.getenv("WORKSPACE_FILE_BYTES", 16 * 1024**2))
LARGE = int(os.getenv("WORKSPACE_LARGE_BYTES", 5 * 1024**2))
SECURE = os.getenv("WORKSPACE_HTTPS", "0") == "1"


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Priority = Annotated[int, Field(ge=1, le=3)]


def date_string(value):
    if date.fromisoformat(value).isoformat() != value:
        raise ValueError("Use YYYY-MM-DD")
    return value


def deadline(value):
    if len(value) == 10:
        return date_string(value)
    parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M")
    if parsed.strftime("%Y-%m-%dT%H:%M") != value:
        raise ValueError("Use YYYY-MM-DDTHH:MM")
    return value


Day = Annotated[str, AfterValidator(date_string)]
Due = Annotated[str, AfterValidator(deadline)]
Clock = Annotated[str, Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")]


def now():
    return datetime.now(ZONE)


def stamp():
    return int(time.time())


def key():
    return str(uuid4())


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    result = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**15, r=8, p=1, maxmem=64*1024**2)
    return salt + ":" + result.hex()


def connect():
    db = sqlite3.connect(DATA / "workspace.sqlite3", timeout=15, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def initialize():
    DATA.mkdir(mode=0o700, parents=True, exist_ok=True)
    db = connect()
    try:
        db.execute("PRAGMA auto_vacuum=FULL")
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(Path(__file__).with_name("schema.sql").read_text())
        migrate(db)
    finally:
        db.close()


def migrate(db):
    """给已有的库补列，重复执行不会报错。"""
    for ddl in ("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0",):
        try:
            db.execute(ddl)
        except sqlite3.OperationalError:
            pass


def database(request: Request):
    db = connect()
    try:
        uploading = request.method == "PUT" and request.url.path.endswith("/content")
        if not uploading:
            db.execute("BEGIN" if request.method in ("GET", "HEAD") else "BEGIN IMMEDIATE")
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


DB = Annotated[sqlite3.Connection, Depends(database, scope="function")]


def fail(status, message):
    raise HTTPException(status, message)


def one(db, sql, args=()):
    row = db.execute(sql, args).fetchone()
    if row is None:
        fail(404, "找不到该资源")
    return dict(row)


def rows(db, sql, args=()):
    return [dict(row) for row in db.execute(sql, args)]


def user(db: DB, workspace_session: Annotated[str | None, Cookie()] = None):
    token = digest(workspace_session or "")
    row = db.execute("""SELECT u.*,s.token session,s.enabled FROM users u JOIN sessions s ON s.uid=u.id
                        WHERE s.token=? AND s.expires>?""", (token, stamp())).fetchone()
    if row is None:
        fail(401, "请登录")
    if row["disabled"]:
        fail(403, "账号已被停用，请联系工作台所有者")
    return dict(row)


User = Annotated[dict, Depends(user)]


def project(db, pid, uid, leader=False, trash=False):
    p = one(db, """SELECT p.*,m.pinned,m.hidden FROM projects p JOIN members m ON m.pid=p.id
                   WHERE p.id=? AND m.uid=?""", (pid,uid))
    if p["trashed"] is not None and not trash:
        fail(404, "项目已移入回收站")
    if leader and p["lead"] != uid:
        fail(403, "需要队长权限")
    return p


def update(db, table, ident, changes):
    # Keys originate exclusively from explicit request model fields or internal maps.
    if changes:
        fields = ", ".join(f"{k}=?" for k in changes)
        db.execute(f"UPDATE {table} SET {fields} WHERE id=?", (*changes.values(),ident))


def deadline_instant(value):
    day = date.fromisoformat(value[:10])
    if len(value) == 10:
        return datetime.combine(day + timedelta(days=1), datetime.min.time(), ZONE)
    return datetime.fromisoformat(value).replace(tzinfo=ZONE)


class Creation(Model):
    id: UUID = Field(default_factory=uuid4)
