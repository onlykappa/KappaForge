"""Repository map: the files most relevant to a task, with the definitions in each (after Aider's repo map).

The planner otherwise sees only paths and sizes, so it guesses which files matter from their names. The map reads
the whole repository once (one tarball download), finds each file's definitions (functions, classes, constants) and
which files use them, ranks files with a PageRank personalised by the task's words, and lists the top files with
their definitions within a character budget. The ranking also backs up the planner when its answer is unusable.
"""
import ast
import io
import math
import re
import tarfile
import urllib.request
import warnings
from collections import Counter, defaultdict

MAX_FILES = 1500
MAX_FILE_BYTES = 300000
MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024
MAX_DEFS_PER_FILE = 12
MAP_CHARS = 14000
IDENT = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]{2,}")
WORD = re.compile(r"[A-Za-z][a-z]+|[A-Z]+(?![a-z])|\d+")
CODE_EXT = re.compile(r"\.(?:py|js|mjs|cjs|ts|tsx|jsx|swift|kt|java|cs|go|rs|c|h|cpp|hpp|sh)$")
DOC_EXT = re.compile(r"\.(?:md|txt)$")
TEST_PATH = re.compile(r"(?:^|/)(?:tests?|__tests__|spec)/|(?:^|/)test_[^/]*$|[._-](?:test|spec)\.[a-z]+$", re.I)
# Words too common in tasks or code to say anything about which file is meant.
STOP = set("""the and for with that this from into when then than what which while where will would should could must
not are was were has have had but can all any each every only also more most less some such very just like make makes
made use uses used using add adds added new old get gets set sets let var const function return true false none null
self this file files code test tests task app change changes changed fix fixes fixed bug issue please need needs show
shows one two its it's they them their there here now still yet out off our your you about after before over under
again first last next same other own via per run runs see sure way work works working""".split())
JS_DEF = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\("
                    r"|class\s+([A-Za-z_$][\w$]*)"
                    r"|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>|class\b|\{|\[|new\s|Object\.freeze))",
                    re.M)
JS_METHOD = re.compile(r"^\s{1,4}(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{", re.M)
JS_KEYWORDS = {"if", "for", "while", "switch", "catch", "function", "return", "constructor"}
OTHER_DEF = re.compile(r"^\s*(?:public\s+|private\s+|internal\s+|open\s+|static\s+|final\s+|override\s+|export\s+|pub\s+|async\s+)*"
                       r"(?:func|fun|fn|def|class|struct|enum|protocol|interface|record|object|extension)\s+([A-Za-z_][\w]*)", re.M)
SH_DEF = re.compile(r"^\s*(?:function\s+)?([A-Za-z_][\w]*)\s*\(\)\s*\{", re.M)
MD_HEADING = re.compile(r"^#{1,3}\s+(.+)$", re.M)
PY_IMPORT = re.compile(r"^\s*(?:from\s+([\w.]+)\s+import\s+([\w, ]+)|import\s+([\w., ]+))", re.M)
JS_IMPORT = re.compile(r"""(?:import\s[^'"]*?from\s*|import\s*\(?\s*|require\(\s*|<script[^>]+src=)['"]([^'"]+)['"]""")
# Tuning, measured by replaying KappaForge's own history (tests/test_repo_map.py keeps the fixtures honest).
IMPORT_WEIGHT = 1.5
REVERSE_WEIGHT = 0.5
DAMPING = 0.8
CONTENT_WEIGHT = 0.6
MIX = 1.0


def words(text):
    """Lowercase words of identifiers and prose: getUserName and get_user_name both give get, user, name."""
    return [w.lower() for w in WORD.findall(text or "")]


def _signature(line):
    line = " ".join(line.strip().split())
    return (line[:117] + "...") if len(line) > 120 else line


def python_defs(text):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # Invalid escapes in the project's strings are its business, not the map's.
        tree = ast.parse(text)
    defs = []
    lines = text.splitlines()
    for node in tree.body:
        targets = [node]
        if isinstance(node, ast.ClassDef):
            targets += [n for n in node.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and not n.name.startswith("__")]
        for item in targets:
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                defs.append((item.name, _signature(lines[item.lineno - 1]), item is not node))
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id.isupper():
            defs.append((node.targets[0].id, _signature(lines[node.lineno - 1]), False))
    return defs


def definitions(path, text):
    """(name, signature, is_member) for what a file defines, in source order."""
    if path.endswith(".py"):
        try:
            return python_defs(text)
        except (SyntaxError, ValueError, IndexError):
            pass
    lines = text.splitlines()
    line_of = lambda pos: lines[text.count("\n", 0, pos)] if lines else ""
    found = []
    if re.search(r"\.(?:js|mjs|cjs|ts|tsx|jsx)$", path):
        for m in JS_DEF.finditer(text):
            found.append((m.start(), next(g for g in m.groups() if g), False))
        for m in JS_METHOD.finditer(text):
            if m[1] not in JS_KEYWORDS:
                found.append((m.start(), m[1], True))
    elif path.endswith(".sh"):
        found = [(m.start(), m[1], False) for m in SH_DEF.finditer(text)]
    elif DOC_EXT.search(path):
        return [(h.strip(), "# " + _signature(h), False) for h in MD_HEADING.findall(text)[:6]]
    elif CODE_EXT.search(path):
        found = [(m.start(), m[1], False) for m in OTHER_DEF.finditer(text)]
    seen, result = set(), []
    for pos, name, member in sorted(found):
        if name not in seen:
            seen.add(name)
            result.append((name, _signature(line_of(pos)), member))
    return result


def resolve_imports(path, text, known):
    """Repository files this file imports: Python modules and relative JavaScript, HTML script and require paths."""
    found = set()
    if path.endswith(".py"):
        for m in PY_IMPORT.finditer(text):
            modules = [m[1] + "." + name.strip() for name in m[2].split(",")] + [m[1]] if m[1] else [x.strip() for x in m[3].split(",")]
            for module in modules:
                candidate = module.replace(".", "/")
                for option in (candidate + ".py", candidate + "/__init__.py"):
                    if option in known:
                        found.add(option)
    elif re.search(r"\.(?:js|mjs|cjs|ts|tsx|jsx|html)$", path):
        base = path.rsplit("/", 1)[0] if "/" in path else ""
        for target in JS_IMPORT.findall(text):
            if not target.startswith("."):
                target = "./" + target if path.endswith(".html") and "://" not in target else ""
            if not target:
                continue
            parts = (base.split("/") if base else []) + target.split("/")
            stack = []
            for part in parts:
                if part == "..":
                    if stack:
                        stack.pop()
                elif part not in (".", ""):
                    stack.append(part)
            joined = "/".join(stack)
            for option in (joined, joined + ".js", joined + ".ts", joined + "/index.js"):
                if option in known and option != path:
                    found.add(option)
                    break
    return found


class RepoMap:
    def __init__(self, sources):
        """sources: {path: text}. Only text that decodes is used; nothing is executed."""
        # A very large repository keeps its code files first; the rest fill what is left.
        self.paths = sorted(sorted(sources, key=lambda p: (not CODE_EXT.search(p), p))[:MAX_FILES])
        self.defs, self.refs, self.terms = {}, {}, {}
        for path in self.paths:
            text = sources[path][:MAX_FILE_BYTES]
            self.defs[path] = definitions(path, text) if not path.endswith((".json", ".css", ".html", ".yml", ".yaml", ".toml")) else []
            self.refs[path] = Counter(IDENT.findall(text)) if CODE_EXT.search(path) or path.endswith(".html") else Counter()
            self.terms[path] = Counter(words(text))
        self.definers = defaultdict(set)
        for path, defs in self.defs.items():
            for name, _, _ in defs:
                if len(name) >= 3 and not DOC_EXT.search(path):
                    self.definers[name].add(path)
        self.imports = {path: resolve_imports(path, sources[path][:MAX_FILE_BYTES], set(self.paths)) for path in self.paths}
        self._edges = None

    def edges(self):
        """file -> {file it uses: weight}. A name defined in many files says little, so it counts less."""
        if self._edges is None:
            graph = defaultdict(Counter)
            for path, counts in self.refs.items():
                for name, count in counts.items():
                    owners = self.definers.get(name)
                    if not owners or len(owners) > 5:
                        continue
                    for owner in owners:
                        if owner != path:
                            graph[path][owner] += math.sqrt(count) / len(owners)
            for path, targets in self.imports.items():
                for target in targets:
                    graph[path][target] += IMPORT_WEIGHT
            # A file's users matter too (its tests, its callers), a little less than what it uses.
            for path in list(graph):
                for target, weight in list(graph[path].items()):
                    graph[target][path] += REVERSE_WEIGHT * weight
            self._edges = graph
        return self._edges

    def relevance(self, task):
        """How directly the task points at each file: its path, what it defines, and the words in it."""
        task_words = Counter(w for w in words(task) if len(w) >= 3 and w not in STOP)
        if not task_words:
            return {}
        rarity, spread = Counter(), Counter()
        for path in self.paths:
            for w in set(words(path)) | {w for name, _, _ in self.defs[path] for w in words(name)}:
                rarity[w] += 1
            for w in task_words:
                if self.terms[path][w]:
                    spread[w] += 1
        idf = lambda w: math.log(1 + len(self.paths) / (1 + rarity[w]))
        body_idf = lambda w: math.log(1 + len(self.paths) / (1 + spread[w]))
        average = sum(sum(t.values()) for t in self.terms.values()) / max(1, len(self.paths))
        scores = {}
        for path in self.paths:
            path_words = set(words(path))
            def_words = Counter(w for name, _, _ in self.defs[path] for w in set(words(name)))
            score = sum(idf(w) * 2.0 for w in task_words if w in path_words)
            score += sum(idf(w) * min(def_words[w], 3) * 0.5 for w in task_words if w in def_words)
            # Words anywhere in the file (an HTTP status, a setting's name), BM25-weighted so long files don't win.
            terms, length = self.terms[path], sum(self.terms[path].values()) or 1
            score += CONTENT_WEIGHT * sum(body_idf(w) * terms[w] * 2.2 / (terms[w] + 1.2 * (0.25 + 0.75 * length / average))
                                          for w in task_words if terms[w])
            # Whole identifiers named in the task (a function, a class, a constant) point straight at their file.
            score += sum(4.0 for name, _, _ in self.defs[path] if len(name) >= 4 and re.search(r"\b" + re.escape(name) + r"\b", task))
            if path in task:
                score += 25.0
            elif path.rsplit("/", 1)[-1] in task:
                score += 8.0
            if score:
                scores[path] = score
        return scores

    def rank(self, task, iterations=30, relevance=None):
        """Files ordered by relevance to the task: personalised PageRank over who-uses-whose-definitions."""
        relevance = self.relevance(task) if relevance is None else relevance
        total = sum(relevance.values())
        if not total:
            personal = {p: 1 / len(self.paths) for p in self.paths} if self.paths else {}
        else:
            personal = {p: relevance.get(p, 0) / total for p in self.paths}
        graph = self.edges()
        out = {p: sum(graph[p].values()) for p in self.paths}
        rank, damping = dict(personal), DAMPING
        for _ in range(iterations):
            nxt = {p: (1 - damping) * personal[p] for p in self.paths}
            dangling = sum(rank[p] for p in self.paths if not out[p])
            for p in self.paths:
                if out[p]:
                    share = damping * rank[p] / out[p]
                    for q, w in graph[p].items():
                        nxt[q] += share * w
            for p in self.paths:
                nxt[p] += damping * dangling * personal[p]
            rank = nxt
        # The task's own words lead; the graph adds the callers and definitions around them.
        top = max(relevance.values(), default=0) or 1
        score = {p: rank[p] + MIX * relevance.get(p, 0) / top * max(rank.values(), default=0) for p in self.paths}
        return sorted(self.paths, key=lambda p: (-score[p], p))

    def render(self, task, budget=MAP_CHARS, skip=()):
        """The ranked map as text for the planner, cut to budget; files in skip are left out."""
        lines, used = [], 0
        wanted = {w for w in words(task) if len(w) >= 3 and w not in STOP}
        for path in self.rank(task):
            if path in skip:
                continue
            # Definitions the task mentions come first, so a big file still shows the ones that matter.
            defs = sorted(self.defs[path], key=lambda d: not (set(words(d[0])) & wanted))
            shown = [sig for _, sig, member in defs if not member][:MAX_DEFS_PER_FILE]
            shown += [sig for _, sig, member in defs if member][:max(0, MAX_DEFS_PER_FILE - len(shown))]
            block = path + ":\n" + "".join("  " + s + "\n" for s in shown) if shown else path + "\n"
            if used + len(block) > budget:
                if used + len(path) + 1 > budget:
                    break
                block = path + "\n"
            lines.append(block)
            used += len(block)
        return "".join(lines)


def download_sources(repo, sha, token, paths, opener=urllib.request.urlopen):
    """{path: text} for paths, from one tarball of the commit. Raises on failure; callers treat the map as optional."""
    wanted = set(paths)
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "KappaForge"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}/tarball/{sha}", headers=headers)
    with opener(req, timeout=60) as response:
        data = response.read(MAX_DOWNLOAD_BYTES + 1)
    if len(data) > MAX_DOWNLOAD_BYTES:
        raise ValueError("Repository archive is too large for a map")
    sources = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            if not member.isfile() or member.size > MAX_FILE_BYTES:
                continue
            path = member.name.split("/", 1)[1] if "/" in member.name else ""
            if path in wanted:
                try:
                    sources[path] = archive.extractfile(member).read().decode("utf-8")
                except (UnicodeDecodeError, AttributeError):
                    continue
    return sources
