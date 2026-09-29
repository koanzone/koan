"""Exercise web integration without requiring Metal or loading model weights."""
import ast
from pathlib import Path
from threading import Event
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from app.models import MLXBackend, Piece
from app.rag_backend import RAGBackend

# Load only the pure prompt functions from the actual script.
source = ast.parse(Path('app/rag_answer.py').read_text())
names = {'format_references', 'build_answer_messages'}
selected = [n for n in source.body if isinstance(n, ast.FunctionDef) and n.name in names]
selected += [n for n in source.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'DEFAULT_BUDDHA_SYSTEM_PROMPT' for t in n.targets)]
ns = {}
exec(compile(ast.Module(body=selected, type_ignores=[]), '<rag prompt>', 'exec'), ns)

class RAGTests(unittest.TestCase):
    def backend(self):
        b = RAGBackend()
        b.model, b.tokenizer = object(), object()
        b.chunks, b.embeddings, b.embedder = [], object(), object()
        b.rag = SimpleNamespace(
            generate_retrieval_query=Mock(return_value='attention and distraction'),
            retrieve=Mock(return_value=[{'id':'mn1:1', 'text':'A reference.'}]),
            build_answer_messages=ns['build_answer_messages'],
            DEFAULT_BUDDHA_SYSTEM_PROMPT=ns['DEFAULT_BUDDHA_SYSTEM_PROMPT'],
            DEFAULT_TOP_K=5, mx=SimpleNamespace(random=SimpleNamespace(seed=Mock())),
        )
        return b

    def test_script_prompt_retrieval_and_history_reach_stream(self):
        b=self.backend()
        history=[{'role':'user','content':'Jeff'}, {'role':'assistant','content':'Why are you here?'}, {'role':'user','content':'I am distracted.'}]
        with patch.object(MLXBackend, '_load'), patch.object(MLXBackend, 'stream', return_value=iter([Piece(text='Try this.')])) as stream:
            result=list(b.stream([{'role':'system','content':'OLD PROMPT'}]+history, Event()))
        prepared=stream.call_args.args[0]
        self.assertEqual(prepared[1:], history)
        self.assertIn('You are Echo', prepared[0]['content'])
        self.assertIn('Source: mn1:1', prepared[0]['content'])
        self.assertNotIn('OLD PROMPT', prepared[0]['content'])
        b.rag.generate_retrieval_query.assert_called_once_with(b.model,b.tokenizer,'I am distracted.',max_tokens=128)
        self.assertEqual(b.rag.retrieve.call_args.kwargs['k'],5)
        self.assertEqual(result[0].text, 'Try this.')

    def test_cancel_after_query_skips_retrieval_and_answer(self):
        b=self.backend()
        stop=Event()
        def query(*args,**kwargs):
            stop.set()
            return 'query'
        b.rag.generate_retrieval_query.side_effect=query
        with patch.object(MLXBackend, '_load'):
            self.assertEqual(list(b.stream([{'role':'user','content':'hello'}],stop)),[])
        b.rag.retrieve.assert_not_called()

    def test_cancel_before_load(self):
        b=RAGBackend()
        stop=Event(); stop.set()
        with patch.object(b,'_load_rag') as load:
            self.assertEqual(list(b.stream([],stop)),[])
        load.assert_not_called()

if __name__=='__main__': unittest.main()
