"""工作台所有者使用的管理接口：账号、配额、存储概览。"""

import secrets

from fastapi import APIRouter
from pydantic import Field

from .core import (DB, PERSONAL, TOTAL, Model, User, fail, one, password_hash,
                   rows, stamp)

router = APIRouter(tags=["管理"])


def owner(u):
    if not u["admin"]:
        fail(403, "需要工作台所有者权限")


def count(db, sql, args=()):
    value = db.execute(sql, args).fetchone()[0]
    return int(value or 0)


class Account(Model):
    quota: int | None = Field(default=None, ge=0, le=2**50)
    admin: bool | None = None
    disabled: bool | None = None


@router.get("/admin/overview")
def overview(db: DB, u: User):
    owner(u)
    return {
        "users": count(db, "SELECT count(*) FROM users"),
        "disabled_users": count(db, "SELECT count(*) FROM users WHERE disabled=1"),
        "admins": count(db, "SELECT count(*) FROM users WHERE admin=1"),
        "projects": count(db, "SELECT count(*) FROM projects WHERE trashed IS NULL"),
        "archived_projects": count(db, "SELECT count(*) FROM projects WHERE trashed IS NULL AND archived=1"),
        "open_tasks": count(db, "SELECT count(*) FROM tasks WHERE status<>'done'"),
        "records": count(db, "SELECT count(*) FROM records"),
        "files": count(db, "SELECT count(*) FROM assets"),
        "bytes": count(db, "SELECT coalesce(sum(size),0) FROM assets"),
        "pending_invites": count(db, "SELECT count(*) FROM invites WHERE expires>?", (stamp(),)),
        "personal_bytes": PERSONAL,
        "total_bytes": TOTAL,
    }


@router.get("/admin/users")
def accounts(db: DB, u: User):
    owner(u)
    return rows(db, """
        SELECT u.id, u.name, u.admin, u.disabled, u.quota, u.evening,
               coalesce((SELECT sum(a.size) FROM assets a WHERE a.uid=u.id), 0) AS used,
               (SELECT count(*) FROM assets a WHERE a.uid=u.id) AS files,
               (SELECT count(*) FROM tasks t WHERE t.uid=u.id AND t.status<>'done') AS open_tasks,
               (SELECT max(s.expires) FROM sessions s WHERE s.uid=u.id) AS session_until
        FROM users u
        ORDER BY u.admin DESC, u.name COLLATE NOCASE""")


@router.put("/admin/users/{uid}")
def change(uid: str, data: Account, db: DB, u: User):
    owner(u)
    target = one(db, "SELECT id, name, admin, disabled FROM users WHERE id=?", (uid,))
    changes = {}

    if data.quota is not None:
        changes["quota"] = data.quota

    if data.admin is not None:
        wanted = 1 if data.admin else 0
        if target["id"] == u["id"] and not wanted:
            fail(422, "不能取消自己的所有者权限")
        if target["admin"] and not wanted and count(db, "SELECT count(*) FROM users WHERE admin=1") <= 1:
            fail(422, "至少要保留一个所有者")
        changes["admin"] = wanted

    if data.disabled is not None:
        wanted = 1 if data.disabled else 0
        if target["id"] == u["id"] and wanted:
            fail(422, "不能停用自己的账号")
        changes["disabled"] = wanted

    if not changes:
        return {"ok": True}

    fields = ", ".join(f"{name}=?" for name in changes)
    db.execute(f"UPDATE users SET {fields} WHERE id=?", (*changes.values(), uid))
    if changes.get("disabled") == 1:
        db.execute("DELETE FROM sessions WHERE uid=?", (uid,))
    elif changes.get("admin") == 0:
        db.execute("DELETE FROM sessions WHERE uid=?", (uid,))
    return {"ok": True}


@router.post("/admin/users/{uid}/password")
def reset(uid: str, db: DB, u: User):
    """重置为一次性临时密码，同时让该账号的所有会话失效。"""
    owner(u)
    target = one(db, "SELECT id, name FROM users WHERE id=?", (uid,))
    if target["id"] == u["id"]:
        fail(422, "请在「我的」里修改自己的密码")
    password = secrets.token_urlsafe(9)
    db.execute("UPDATE users SET password=? WHERE id=?", (password_hash(password), uid))
    db.execute("DELETE FROM sessions WHERE uid=?", (uid,))
    return {"name": target["name"], "password": password}


@router.delete("/admin/users/{uid}/sessions")
def kick(uid: str, db: DB, u: User):
    owner(u)
    one(db, "SELECT id FROM users WHERE id=?", (uid,))
    db.execute("DELETE FROM sessions WHERE uid=?", (uid,))
    return {"ok": True}
