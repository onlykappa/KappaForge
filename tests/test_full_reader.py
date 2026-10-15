import json
import unittest
from engine.full_reader import inventory, status_from_comments, inspect_batch

class ReaderTests(unittest.TestCase):
    def test_inventory_excludes_generated(self):
        tree={"tree":[{"type":"blob","path":"src/a.py"},
                      {"type":"blob","path":"node_modules/x.js"},
                      {"type":"blob","path":"src/b.ts"},
                      {"type":"blob","path":"photo.png"}]}
        self.assertEqual(inventory(tree),["src/a.py","src/b.ts"])
    def test_resume_pinned(self):
        x={"issue":4,"sha":"abc","next":12,"analyzed":10}
        comments=[{"body":"<!-- KAPPA_AUDIT_STATE:"+json.dumps(x)+" -->"}]
        self.assertEqual(status_from_comments(comments,"abc",4)["next"],12)
        self.assertIsNone(status_from_comments(comments,"changed",4))
    def test_truncated_tree_aborts(self):
        def get(path):
            if path=="repos/onlykappa/KappaForge":
                return {"default_branch":"main"}
            if "/commits/" in path:
                return {"sha":"abc"}
            return {"truncated":True,"tree":[]}
        with self.assertRaisesRegex(RuntimeError,"truncated"):
            inspect_batch("onlykappa/KappaForge",4,None,None,"key",get,None,[])
    def test_batch_counts(self):
        import base64
        def get(path):
            if path=="repos/onlykappa/KappaForge":
                return {"default_branch":"main"}
            if "/commits/" in path:
                return {"sha":"abc"}
            if "/git/trees/" in path:
                return {"truncated":False,"tree":[{"type":"blob","path":"src/a.py"}]}
            if "/contents/" in path:
                return {"encoding":"base64","content":base64.b64encode(b"print('ok')").decode()}
            raise AssertionError(path)
        state,note,complete=inspect_batch("onlykappa/KappaForge",4,None,None,"key",get,
                                         lambda k,p:("mock-model","No issue found"),[])
        self.assertTrue(complete)
        self.assertEqual(state["analyzed"],1)
        self.assertIn("1/1",note)
if __name__=="__main__":
    unittest.main()
