from concurrent.futures import Future
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

import test_app
from fastshare_app.engine import Engine
from fastshare_app.provider import FastShare
from fastshare_app.storage import Store


class PriorityTests(unittest.TestCase):
    setUp = test_app.AddonTests.setUp
    tearDown = test_app.AddonTests.tearDown
    post = test_app.AddonTests.post

    def jobs(self, count=4):
        return [self.engine.add(f'https://fastshare.cloud/{100+i}/movie-{i}.mp4')['id'] for i in range(count)]

    def active(self, job_id):
        event,future=threading.Event(),Future()
        self.engine.active[job_id]=(event,future)
        self.store.update(job_id,status='downloading')
        return event,future

    def finish(self, job_id, status='completed'):
        self.store.update(job_id,status=status)
        self.engine.active[job_id][1].set_result(None)

    def test_order_survives_restart_and_new_jobs_append(self):
        a,b,c=self.jobs(3)
        self.assertEqual(self.post(f'jobs/{c}/up',{}).status_code,200)
        self.assertEqual([j['id'] for j in self.engine.snapshot()['jobs']],[a,c,b])
        self.engine.action(b,'first')
        self.engine.action(b,'down')
        self.assertEqual([j['id'] for j in self.engine.snapshot()['jobs']],[a,b,c])
        self.engine.action(c,'first')
        reopened=Store(self.tmp.name)
        try:self.assertEqual([j['id'] for j in reopened.query('SELECT id FROM jobs ORDER BY queue_order,id')],[c,a,b])
        finally:reopened.db.close()
        d=self.engine.add('https://fastshare.cloud/199/new.mp4')['id']
        self.assertEqual([j['id'] for j in self.engine.snapshot()['jobs']],[c,a,b,d])
        self.assertEqual([j['queue_position'] for j in self.engine.snapshot()['jobs']],[1,2,3,4])

    def test_priority_frees_only_one_slot_and_waits_for_it(self):
        a,b,c,d=self.jobs()
        self.settings.save({'fastshare_session':{'token':'test'},'parallel_downloads':2},internal=True)
        event_a,_=self.active(a);event_b,_=self.active(b)
        self.engine.action(d,'priority','slot')
        with patch.object(self.engine.pool,'submit',side_effect=lambda *args:Future()) as submit:
            self.engine.schedule();self.engine.schedule();self.engine.schedule()
            self.assertFalse(event_a.is_set());self.assertTrue(event_b.is_set())
            submit.assert_not_called()
            self.finish(b,'queued');self.engine.schedule()
            self.assertEqual(set(self.engine.active),{a,d})
            self.assertEqual(submit.call_args.args[1]['id'],d)
            self.finish(d);self.engine.schedule()
            self.assertIsNone(self.engine.priority)
            self.assertEqual(set(self.engine.active),{a,b})

    def test_exclusive_waits_for_all_and_restores_normal_limits(self):
        a,b,c,d=self.jobs()
        self.settings.save({'fastshare_session':{'token':'test'},'parallel_downloads':3},internal=True)
        ea,_=self.active(a);eb,_=self.active(b);ec,_=self.active(c)
        self.engine.action(d,'priority','exclusive')
        with patch.object(self.engine.pool,'submit',side_effect=lambda *args:Future()) as submit:
            self.engine.schedule()
            self.assertTrue(all(e.is_set() for e in [ea,eb,ec]))
            self.finish(a,'queued');self.finish(b,'queued');self.engine.schedule();submit.assert_not_called()
            self.finish(c,'queued');self.engine.schedule()
            self.assertEqual(set(self.engine.active),{d});self.assertEqual(self.engine.snapshot()['limit'],1)
            self.finish(d);self.engine.schedule()
            self.assertEqual(set(self.engine.active),{a,b,c});self.assertEqual(self.engine.snapshot()['limit'],3)
            self.assertIsNone(json.loads(self.store.cursor('priority_override')))

    def test_active_target_and_cancel_or_failure_release_exclusive(self):
        a,b,c=self.jobs(3)
        self.settings.save({'fastshare_session':{'token':'test'},'parallel_downloads':2},internal=True)
        ea,_=self.active(a);eb,_=self.active(b)
        self.engine.action(a,'priority','exclusive')
        with patch.object(self.engine.pool,'submit',side_effect=lambda *args:Future()):
            self.engine.schedule();self.assertFalse(ea.is_set());self.assertTrue(eb.is_set())
            self.engine.action(a,'cancel');self.finish(a,'cancelled');self.finish(b,'queued')
            self.engine.schedule();self.assertIsNone(self.engine.priority)
            self.assertEqual(set(self.engine.active),{b,c})
            self.engine.action(b,'priority','exclusive');self.finish(b,'needs_action');self.engine.schedule()
            self.assertIsNone(self.engine.priority)

    def test_priority_persists_and_global_pause_still_wins(self):
        a,b=self.jobs(2)
        self.settings.save({'paused':True})
        self.engine.action(b,'priority','exclusive')
        self.assertFalse(self.settings.get()['paused'])
        recovered=Engine(self.settings,self.store)
        try:self.assertEqual(recovered.priority,{'job_id':b,'mode':'exclusive'})
        finally:recovered.close()
        self.settings.save({'paused':True})
        with patch.object(self.engine.pool,'submit') as submit:
            self.engine.schedule();submit.assert_not_called()
        self.engine.clear_priority();self.assertIsNone(self.engine.priority)
        self.assertEqual(self.post(f'jobs/{a}/priority',{'mode':'bad'}).status_code,400)

    def test_preempted_partial_resumes_without_losing_bytes(self):
        job=self.engine.add('https://fastshare.cloud/123/test.mp4');event=threading.Event()
        class Interrupted(test_app.Response):
            def iter_content(self,size):
                yield b'abcd'
                event.set()
                yield b'efghij'
        with patch.object(FastShare,'download',return_value=(Interrupted(),'test.mp4')):
            self.engine.download(job,self.settings.get(),event)
        row=self.store.query('SELECT * FROM jobs')[0];partial=Path(row['path']+'.part')
        self.assertEqual(row['status'],'queued');self.assertEqual(partial.read_bytes(),b'abcd')
        with patch.object(FastShare,'download',return_value=(test_app.Response(b'efghij',206,{'Content-Range':'bytes 4-9/10'}),'test.mp4')) as download:
            self.engine.download(row,self.settings.get(),threading.Event())
            self.assertEqual(download.call_args.args[1],4)
        self.assertEqual(Path(row['path']).read_bytes(),b'abcdefghij')

    def test_old_database_migrates_without_losing_jobs(self):
        with tempfile.TemporaryDirectory() as directory:
            db=sqlite3.connect(str(Path(directory)/'queue.sqlite3'))
            db.execute('CREATE TABLE jobs (id INTEGER PRIMARY KEY, file_id TEXT, status TEXT, speed REAL, eta REAL)')
            db.execute("INSERT INTO jobs VALUES(8,'123','downloading',100,30)");db.commit();db.close()
            migrated=Store(directory)
            try:
                row=migrated.query('SELECT * FROM jobs')[0]
                self.assertEqual((row['id'],row['file_id'],row['queue_order'],row['status']),(8,'123',8,'queued'))
            finally:migrated.db.close()


if __name__=='__main__':unittest.main()
