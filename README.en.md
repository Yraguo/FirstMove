# FirstMove · 先行

[中文](README.md) · [Download installers](https://github.com/Yraguo/FirstMove/releases)

FirstMove is a self-hosted workspace for assignments, competitions, quick notes and daily routines. Connect your phone and computers to the same server and sign in with the same account to sync your work.

- **Agenda** orders tasks by deadline, distinguishes three priority levels and displays task spans on weekly and monthly calendars. Keep items with an uncertain date in the waiting list.
- **Records** hold text, photos and files. Assign records to a project, convert them to notes or tasks, and download selected attachments for offline use.
- **Projects** group coursework, competitions and personal work. A team lead can assign work, while members keep their personal priorities private.
- **Offline and reminders** use a local snapshot and a queue for pending records. Reminders require a running client page.

## Install a client

Download the appropriate asset and verify its SHA-256 against the release checksums. On Android 7.0 or later, install the signed APK and enter your HTTPS server address. The Android client opens a browser Custom Tab, with the default browser as fallback. On an Apple silicon Mac running macOS 13 or later, open the arm64 DMG and drag 先行 into Applications. On 64-bit Windows, run the Setup executable. Desktop clients open their own window and can switch servers from the 先行 menu. The initial desktop release has no Apple notarization or Windows publisher certificate.

## Run locally

Install Git and Python 3.11 or later. On macOS or Linux:

```sh
git clone https://github.com/Yraguo/FirstMove.git
cd FirstMove/backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python manage.py create-owner --name owner
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

On Windows PowerShell, create the environment with an installed Python version, for example `py -3.13 -m venv .venv`, and use `.\.venv\Scripts\python.exe` in subsequent commands. Set the owner password at the interactive prompt (at least 10 characters). Open the [local workspace](http://127.0.0.1:8000/). Create the owner only once. Other devices need a reachable server address.

## Deploy your own server

1. Point a DNS A record such as `work.example.com` at your Linux server. If you publish an AAAA record, make sure IPv6 works too. Allow inbound TCP ports 80 and 443 in the host firewall and cloud security group, retaining your existing SSH access. The proxy needs both ports available. Install Git, Docker Engine and the Compose plugin. [Docker installation guide](https://docs.docker.com/engine/install/)
2. Log in by SSH and run:

   ```sh
   git clone https://github.com/Yraguo/FirstMove.git
   cd FirstMove
   cp .env.example .env
   nano .env
   ```

   Replace `FIRSTMOVE_DOMAIN` with your hostname. Defaults are the Asia/Shanghai time zone, 128 MiB per account, 1 GiB total attachments and 16 MiB per file. Allow extra disk capacity for temporary uploads, database journals and backups.

3. Start the service and create the owner:

   ```sh
   docker compose up -d --build
   docker compose exec app python manage.py create-owner --name owner
   docker compose ps
   curl --fail https://work.example.com/api/health
   ```

   Substitute your actual hostname. Visit that origin in a browser or enter it in each client. Invite additional users from the account page. Caddy obtains and renews the TLS certificate. Check DNS, open ports and `docker compose logs --tail=80 caddy` if issuance fails. [Caddy HTTPS guide](https://caddyserver.com/docs/quick-starts/reverse-proxy)

## Back up and update

The Docker `workspace` volume holds the SQLite database, including attachments. For a consistent online backup, run the following from the repository on the server:

```sh
umask 077
docker compose exec -T app python -c "import sqlite3; src=sqlite3.connect('/var/lib/firstmove/workspace.sqlite3'); dst=sqlite3.connect('/tmp/firstmove-backup.sqlite3'); src.backup(dst); dst.close(); src.close()"
docker compose cp app:/tmp/firstmove-backup.sqlite3 ./firstmove-backup.sqlite3
docker compose exec -T app python -c "from pathlib import Path; Path('/tmp/firstmove-backup.sqlite3').unlink()"
```

Store private backups separately. Before upgrading, back up the database, run `git pull --ff-only`, then `docker compose up -d --build`. Stop the stack with `docker compose stop`. The `down -v` option deletes named volumes. To restore into a new volume, keep the original volume intact, use the same configuration and run:

```sh
docker compose -p firstmove-restore run --rm --no-deps -T app python -c "import pathlib,sys,shutil; f=pathlib.Path('/var/lib/firstmove/workspace.sqlite3').open('xb'); shutil.copyfileobj(sys.stdin.buffer,f); f.close()" < firstmove-backup.sqlite3
docker compose stop
docker compose -p firstmove-restore up -d
```

Check tasks and attachments after signing in. Keep using `-p firstmove-restore` for the restored instance. Development data defaults to `backend/data/`.

[Backend and tests](backend/README.md) · [Client builds](clients/README.md) · [MIT license](LICENSE)
