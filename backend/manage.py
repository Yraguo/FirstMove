"""Create the first workspace owner without passing credentials on the command line."""
import argparse
import getpass

from app.core import connect, initialize, key, password_hash


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action",choices=["init","create-owner"])
    parser.add_argument("--name",default="owner")
    args = parser.parse_args()
    initialize()
    if args.action == "init":
        return
    name = args.name.strip()
    if not 1 <= len(name) <= 80:
        parser.error("用户名需要 1–80 个字符")
    password = getpass.getpass("设置所有者密码（至少 10 字符）: ")
    if not 10 <= len(password) <= 256:
        parser.error("密码需要 10–256 个字符")
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM users WHERE admin=1").fetchone():
            parser.error("工作台已有所有者")
        db.execute("INSERT INTO users(id,name,password,admin) VALUES(?,?,?,1)",
                   (key(),name,password_hash(password)))
    print("所有者已创建")


if __name__ == "__main__":
    main()
