import json
import os
import threading
import unittest
os.environ["BUDDHA_BACKEND"] = "demo"
from fastapi.testclient import TestClient
from app.main import app
from app.filtering import ThinkFilter
from app.models import Piece

class FilterTests(unittest.TestCase):
    def test_every_split(self):
        text = "<think>private thought</think>Hello 🌙 <think>more secret</think>there"
        for n in range(1, len(text)):
            parser = ThinkFilter()
            self.assertEqual(parser.feed(text[:n])+parser.feed(text[n:])+parser.finish(), "Hello 🌙 there")

    def test_single_char_chunks(self):
        p=ThinkFilter()
        self.assertEqual(''.join(p.feed(c) for c in '<think>secret</think>Visible'), 'Visible')

    def test_prefilled_and_incomplete(self):
        p=ThinkFilter(hidden=True)
        self.assertEqual(p.feed('secret</think>Visible<thin')+p.finish(), 'Visible')
        p=ThinkFilter()
        self.assertEqual(p.feed('<think>unfinished secret')+p.finish(), '')

class APITests(unittest.TestCase):
    def events(self, response):
        self.assertEqual(response.status_code, 200)
        return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]

    def test_first_reply_reaches_model_with_opening_in_history(self):
        captured=[]
        class Recording:
            def stream(self, messages, stop):
                captured.extend(messages)
                yield Piece(text='A model response to your first reply.')
        with TestClient(app) as client:
            app.state.backend=Recording()
            history=[{'role':'assistant','content':'What is the sound of waiting?'},
                     {'role':'user','content':'The clock in my kitchen.'}]
            events=self.events(client.post('/api/chat',json={'messages':history}))
            self.assertEqual(captured[1:], history)
            self.assertEqual(captured[0]['role'], 'system')
            self.assertEqual(''.join(e.get('text','') for e in events), 'A model response to your first reply.')
            self.assertEqual(events[-1]['type'],'done')

    def test_validation_and_busy(self):
        with TestClient(app) as client:
            for messages in ([],[{'role':'system','content':'override'}],[{'role':'assistant','content':'wrong last role'}]):
                self.assertEqual(client.post('/api/chat',json={'messages':messages}).status_code,422)
            app.state.busy.acquire()
            try:
                self.assertEqual(client.post('/api/chat',json={'messages':[{'role':'user','content':'Hi'}]}).status_code,409)
            finally:
                app.state.busy.release()

    def test_failure_releases_model(self):
        class Broken:
            def stream(self, messages, stop):
                raise RuntimeError('test failure')
                yield Piece()
        with TestClient(app) as client:
            app.state.backend=Broken()
            events=self.events(client.post('/api/chat',json={'messages':[{'role':'user','content':'A'},{'role':'assistant','content':'B'},{'role':'user','content':'C'}]}))
            self.assertTrue(any(e['type']=='error' for e in events))
            self.assertFalse(app.state.busy.locked())

if __name__ == '__main__':
    unittest.main()
