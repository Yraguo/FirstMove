import hmac
import secrets
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Response
from pydantic import Field

from .core import (Clock, DAY, DB, Model, Name, SECURE, User, digest,
                   fail, key, one, password_hash, project, stamp)

router = APIRouter(tags=["账号与邀请"])
Password = Annotated[str, Field(min_length=10, max_length=256)]


class Credentials(Model):
    name: Name
    password: Password


class Registration(Credentials):
    token: str = Field(min_length=16, max_length=150)


class Invitation(Model):
    project_id: UUID | None = None


class Preferences(Model):
    evening: Clock
    device_enabled: bool


class Quota(Model):
    bytes: int = Field(ge=0, le=2**50)


def issue(db, uid, response):
    raw = secrets.token_urlsafe(32)
    db.execute("INSERT INTO sessions(token,uid,expires) VALUES(?,?,?)",
               (digest(raw),uid,stamp()+30*DAY))
    response.set_cookie("workspace_session",raw,max_age=30*DAY,httponly=True,
                        secure=SECURE,samesite="strict",path="/api")
    return {"id":uid}


def consume(db, raw):
    token = digest(raw)
    row = one(db, """SELECT i.pid FROM invites i LEFT JOIN projects p ON i.pid=p.id
                     WHERE token=? AND expires>? AND (i.pid IS NULL OR p.trashed IS NULL)""",(token,stamp()))
    if row["pid"] is None:
        db.execute("DELETE FROM invites WHERE token=?", (token,))
    return row["pid"]


@router.post("/login")
def login(data: Credentials, db: DB, response: Response):
    name = data.name.casefold()
    limit = db.execute("SELECT * FROM login_limits WHERE name=?", (name,)).fetchone()
    if limit and limit["since"] > stamp()-300 and limit["misses"] >= 10:
        fail(429, "稍后再试")
    row = db.execute("SELECT id,password,disabled FROM users WHERE name=?",(data.name,)).fetchone()
    encoded = row["password"] if row else "00"*16 + ":" + "00"*64
    valid = hmac.compare_digest(password_hash(data.password, encoded.split(":")[0]), encoded)
    if not valid or not row:
        db.execute("DELETE FROM login_limits WHERE since<=?",(stamp()-300,))
        db.execute("""INSERT INTO login_limits VALUES(?,?,1) ON CONFLICT(name)
                      DO UPDATE SET misses=misses+1""",(name,stamp()))
        db.commit()
        fail(401, "账号或密码错误")
    if row["disabled"]:
        fail(403, "账号已被停用，请联系工作台所有者")
    db.execute("DELETE FROM login_limits WHERE name=?",(name,))
    return issue(db,row["id"],response)


@router.post("/logout")
def logout(db: DB, u: User, response: Response):
    db.execute("DELETE FROM sessions WHERE token=?",(u["session"],))
    response.delete_cookie("workspace_session",path="/api")
    return {"ok":True}


@router.post("/invites")
def invite(data: Invitation, db: DB, u: User):
    pid = str(data.project_id) if data.project_id else None
    if pid:
        project(db,pid,u["id"],leader=True)
    elif not u["admin"]:
        fail(403, "需要工作台所有者权限")
    raw = secrets.token_urlsafe(32)
    expires = stamp()+7*DAY
    db.execute("INSERT INTO invites VALUES(?,?,?)",(digest(raw),pid,expires))
    return {"token":raw,"expires":expires,"project_id":pid}


@router.post("/register",status_code=201)
def register(data: Registration, db: DB, response: Response):
    pid = consume(db,data.token)
    uid = key()
    db.execute("INSERT INTO users(id,name,password) VALUES(?,?,?)",
               (uid,data.name,password_hash(data.password)))
    if pid:
        db.execute("INSERT INTO members(pid,uid) VALUES(?,?)",(pid,uid))
    return issue(db,uid,response)


class Join(Model):
    token: str = Field(min_length=16, max_length=150)


@router.post("/join")
def join(data: Join, db: DB, u: User):
    pid = consume(db,data.token)
    if not pid:
        fail(422,"需要比赛邀请")
    db.execute("INSERT OR IGNORE INTO members(pid,uid) VALUES(?,?)",(pid,u["id"]))
    return {"project_id":pid}


@router.get("/me")
def me(u: User):
    return {k:u[k] for k in ("id","name","admin","evening","enabled")}


@router.put("/me/preferences")
def preferences(data: Preferences, db: DB, u: User):
    db.execute("UPDATE users SET evening=? WHERE id=?",(data.evening,u["id"]))
    db.execute("UPDATE sessions SET enabled=? WHERE token=?",(data.device_enabled,u["session"]))
    return data


@router.put("/users/{uid}/quota")
def quota(uid: str, data: Quota, db: DB, u: User):
    if not u["admin"]:
        fail(403,"需要工作台所有者权限")
    one(db,"SELECT id FROM users WHERE id=?",(uid,))
    db.execute("UPDATE users SET quota=? WHERE id=?",(data.bytes,uid))
    return {"bytes":data.bytes}
