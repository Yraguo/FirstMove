import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, closing
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app import core, main


class WorkspaceAPI(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        directory = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.stack.enter_context(patch.object(core,"DATA",Path(directory)))
        self.owner = self.stack.enter_context(TestClient(main.app))
        self.member = TestClient(main.app)
        self.stack.callback(self.member.close)
        self.owner_id = core.key()
        self.password = "test-only-credentials"
        with closing(core.connect()) as db,db:
            db.execute("INSERT INTO users(id,name,password,admin) VALUES(?,?,?,1)",
                       (self.owner_id,"owner",core.password_hash(self.password)))
        self.req(self.owner,"post","/login",name="owner",password=self.password)
        self.pid = self.req(self.owner,"post","/projects",name="萌芽杯",end="2030-11-22")["id"]
        invitation = self.req(self.owner,"post","/invites",project_id=self.pid)
        self.uid = self.req(self.member,"post","/register",name="member",password=self.password,
                            token=invitation["token"])["id"]

    def req(self,client,method,path,**payload):
        args = {"json":payload} if payload else {}
        r = client.request(method.upper(),"/api"+path,**args)
        self.assertLess(r.status_code,300,(method,path,r.text))
        return r.json()

    def test_agenda_and_completion(self):
        clock = datetime(2030,11,22,10,tzinfo=core.ZONE)
        with patch("app.schedule.now",return_value=clock):
            ids = {}
            for title,due,priority in [("普通","2030-11-22T15:00",1),("低","2030-11-22T17:00",1),
                                       ("全天","2030-11-22",2),("高","2030-11-22T17:00",3)]:
                ids[title] = self.req(self.owner,"post","/tasks",title=title,due=due,priority=priority)["id"]
            def agenda():
                return [t["title"] for t in self.req(self.owner,"get","/tasks")]
            self.assertEqual(agenda(),["全天","普通","高","低"])
            self.req(self.owner,"patch","/tasks/"+ids["低"],today_pin=True)
            self.assertEqual(agenda()[0],"低")
            self.req(self.owner,"patch","/tasks/"+ids["普通"],status="done")
            self.assertEqual(agenda()[-1],"普通")
            with patch("app.schedule.now",return_value=clock.replace(hour=16)):
                self.assertNotIn("普通",agenda())
            with patch("app.schedule.now",return_value=clock+timedelta(days=1)):
                self.assertEqual(agenda()[0],"全天")
                self.assertTrue(self.req(self.owner,"get","/tasks")[0]["overdue"])
            self.req(self.owner,"patch","/tasks/"+ids["全天"],handle="2030-11-24")
            self.assertEqual(self.req(self.owner,"get","/tasks/"+ids["全天"])["due"],"2030-11-22")

    def test_same_origin_workbench(self):
        home = self.owner.get("/")
        self.assertEqual(home.status_code, 200)
        self.assertIn('src="/src/main.js"', home.text)
        for path in ("/index.html", "/styles/app.css", "/src/main.js", "/sw.js", "/manifest.json",
                     "/docs", "/openapi.json", "/api/health"):
            with self.subTest(path=path):
                self.assertEqual(self.owner.get(path).status_code, 200)
        self.assertEqual(self.owner.get("/api/unknown").status_code, 404)
        self.assertEqual(self.owner.get("/dev_server.py").status_code, 404)

    def test_team_and_suggestions(self):
        team = "/projects/"+self.pid
        suggestions = self.req(self.member,"get",team+"/suggestions")
        self.assertEqual(self.req(self.member,"get","/tasks"),[])
        self.req(self.member,"post","/tasks",**suggestions[0])
        task = self.req(self.owner,"post",team+"/assignments",task={"title":"答辩","due":"2030-11-22"},
                        assignee=self.uid)
        tid = task["id"]
        self.req(self.member,"patch","/tasks/"+tid,priority=3,prepare="2030-11-21")
        self.req(self.owner,"patch",team+"/assignments/"+tid,due="2030-11-20")
        t = next(t for t in self.req(self.member,"get","/tasks") if t["id"]==tid)
        self.assertTrue(t["review_prepare"])
        self.assertEqual(t["previous_due"],"2030-11-22")
        self.assertEqual(self.owner.get("/api/tasks/"+tid).status_code,404)
        public = self.req(self.owner,"get",team+"/team")["assignments"][0]
        self.assertFalse(set(public) & {"status","priority","prepare","done"})
        self.assertEqual(self.member.post("/api"+team+"/trash").status_code,403)
        self.req(self.owner,"post","/projects",name="数模",priority=3,end="2030-11-28")
        self.assertEqual(self.req(self.owner,"get","/projects")[0]["id"],self.pid)
        calendar = self.req(self.owner,"get","/calendar?start=2030-11-01&end=2030-11-30")
        self.assertEqual(len(calendar["projects"]),2)

    def test_offline_retry_privacy_and_trash(self):
        rid = str(uuid4())
        data = dict(id=rid,pid=self.pid,title="个人复盘",body="复盘关键词")
        self.req(self.member,"post","/records",**data)
        self.req(self.member,"post","/records",**data)
        aid = str(uuid4())
        upload = f"/api/records/{rid}/files/{aid}/content"
        for _ in range(2):
            res = self.member.put(upload,params={"name":"黑板照片.png"},content=b"blackboard")
            self.assertEqual(res.status_code,200,res.text)
        self.assertEqual(self.req(self.member,"get","/me/storage")["used"],10)
        self.assertEqual(self.owner.get("/api/files/"+aid).status_code,404)
        self.assertEqual(self.req(self.owner,"get","/search?q=复盘")["records"],[])
        task = self.req(self.member,"post","/records/"+rid+"/task",title="老师提到的作业",status="waiting")
        self.req(self.member,"patch","/tasks/"+task["id"],status="open",due="2030-11-22")
        self.assertEqual(self.req(self.member,"get","/records/"+rid)["attachments"][0]["id"],aid)
        shared = self.req(self.member,"post","/records",pid=self.pid,title="答辩通知")["id"]
        self.req(self.member,"put",f"/records/{shared}/files/{aid}")
        self.req(self.member,"patch","/records/"+shared,shared=True)
        self.assertEqual(self.owner.get("/api/files/"+aid).content,b"blackboard")
        self.assertEqual(self.req(self.owner,"get","/search?q=黑板")["files"][0]["rid"],shared)
        prefix = "/projects/"+self.pid
        self.assertEqual(self.req(self.owner,"get",prefix+"/deletion")["shared_records"],1)
        self.req(self.owner,"post",prefix+"/trash")
        self.assertEqual(self.owner.get("/api/files/"+aid).status_code,404)
        self.req(self.owner,"post",prefix+"/restore")
        self.assertEqual(self.owner.get("/api/files/"+aid).status_code,200)
        self.req(self.owner,"post",prefix+"/trash")
        self.req(self.owner,"post",prefix+"/purge",confirmed=True)
        self.assertEqual(self.member.get("/api/records/"+shared).status_code,404)
        private = self.req(self.member,"get","/records/"+rid)
        self.assertEqual(private["former"],"萌芽杯")
        self.assertIsNone(private["pid"])
        self.assertEqual(self.member.get("/api/files/"+aid).content,b"blackboard")
        self.assertEqual([r["id"] for r in self.req(self.member,"get","/search?q=萌芽")["records"]],[rid])

    def test_sync_and_edits(self):
        rid = self.req(self.owner,"post","/records",body="a\nb\nc\n")["id"]
        path = "/records/"+rid+"/body"
        self.req(self.owner,"put",path,base_version=1,body="A\nb\nc\n")
        merged = self.req(self.owner,"put",path,base_version=1,body="a\nb\nC\n")
        self.assertEqual(merged["record"]["body"],"A\nb\nC\n")
        collision = self.req(self.owner,"put",path,base_version=1,body="X\nb\nc\n")
        self.assertIsNotNone(collision["conflict_id"])
        self.req(self.owner,"post",f"/records/{rid}/conflicts/{collision['conflict_id']}/resolve",
                 body="X\nb\nC\n",base_version=3)
        r = self.owner.get("/api/sync")
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(self.owner.get("/api/sync",headers={"If-None-Match":r.headers["etag"]}).status_code,304)
        other = TestClient(main.app)
        self.addCleanup(other.close)
        self.req(other,"post","/login",name="owner",password=self.password)
        self.assertEqual(self.req(other,"get","/records/"+rid)["body"],"X\nb\nC\n")

    def test_quota_and_cleanup(self):
        rid = self.req(self.member,"post","/records",pid=self.pid)["id"]
        self.req(self.member,"patch","/records/"+rid,shared=True)
        self.req(self.owner,"put",f"/users/{self.uid}/quota",bytes=3)
        path = f"/api/records/{rid}/files/{uuid4()}/content?name=a.txt"
        self.assertEqual(self.member.put(path,content=b"1234").status_code,413)
        self.assertEqual(self.member.put(path,content=b"123").status_code,200)
        self.req(self.owner,"post",f"/projects/{self.pid}/trash")
        with closing(core.connect()) as db,db:
            db.execute("UPDATE projects SET trashed=? WHERE id=?",(core.stamp()-8*core.DAY,self.pid))
        main.sweep()
        self.assertEqual(self.req(self.member,"get","/me/storage")["used"],0)

    def test_concurrent_uploads_share_one_quota(self):
        rid = self.req(self.member,"post","/records",title="答辩资料")["id"]
        self.req(self.owner,"put",f"/users/{self.uid}/quota",bytes=6)
        urls = [f"/api/records/{rid}/files/{uuid4()}/content?name={i}.txt" for i in range(2)]
        def upload(url):
            return self.member.put(url,content=b"data").status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(upload,urls))
        self.assertEqual(sorted(results),[200,413])
        saved = urls[results.index(200)]
        self.assertEqual(self.member.put(saved,content=b"edit").status_code,409)
        self.assertEqual(self.req(self.member,"get","/me/storage")["used"],4)

    def test_invitation_scope_and_personal_device_preferences(self):
        anonymous = TestClient(main.app)
        self.addCleanup(anonymous.close)
        self.assertEqual(anonymous.get("/api/sync").status_code,401)
        # A project invite represents one project, even when several teammates join.
        invite = self.req(self.owner,"post","/invites",project_id=self.pid)
        self.req(anonymous,"post","/register",name="teammate",password=self.password,token=invite["token"])
        self.req(self.member,"post","/join",token=invite["token"])
        own_invite = self.req(self.owner,"post","/invites",project_id=None)
        individual = TestClient(main.app)
        self.addCleanup(individual.close)
        self.req(individual,"post","/register",name="independent",password=self.password,token=own_invite["token"])
        self.assertEqual(self.req(individual,"get","/projects"),[])
        self.assertEqual(individual.get(f"/api/projects/{self.pid}/team").status_code,404)
        second = TestClient(main.app)
        self.addCleanup(second.close)
        self.req(second,"post","/login",name="member",password=self.password)
        self.req(self.member,"put","/me/preferences",evening="19:30",device_enabled=False)
        self.assertEqual(self.req(second,"get","/me")["evening"],"19:30")
        self.assertTrue(self.req(second,"get","/me")["enabled"])

    def test_habits_and_reminders(self):
        hid = self.req(self.member,"post","/habits",title="日常",days=[1,2,3,4,5,6,7])["id"]
        day = core.now().date().isoformat()
        self.req(self.member,"put",f"/habits/{hid}/checks/{day}")
        self.assertTrue(self.req(self.member,"get","/habits")[0]["completed"])
        tid = self.req(self.member,"post","/tasks",title="实验报告",due="2030-11-22")["id"]
        self.req(self.member,"patch","/tasks/"+tid,independent="2030-11-20T09:00")
        self.req(self.member,"patch","/tasks/"+tid,due="2030-11-25")
        dates = [i["at"][:16] for i in self.req(self.member,"get","/reminders")]
        self.assertEqual(dates,["2030-11-20T09:00","2030-11-24T20:00"])
        self.req(self.member,"patch","/tasks/"+tid,status="done")
        self.assertEqual(self.req(self.member,"get","/reminders"),[])


if __name__=="__main__":
    unittest.main()
