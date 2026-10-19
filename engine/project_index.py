"""Bounded repository graph for authorized read-only project understanding."""
import ast
import re
from collections import Counter

MAX_INDEX_FILES = 300
MAX_READ_FILES = 20
MAX_SOURCE_CHARS = 12000
TEXT_EXTENSIONS = (".py",".js",".ts",".tsx",".jsx",".json",".md",".yml",".yaml",".toml",".cs",".java",".kt",".xml",".html",".css",".sh")

def safe_paths(tree):
    result=[]
    for obj in tree:
        path=obj.get("path","")
        if (obj.get("type")!="blob" or not isinstance(path,str) or
            len(path)>250 or path.startswith("/") or ".." in path.split("/") or
            not path.lower().endswith(TEXT_EXTENSIONS) or
            any(part in ("node_modules",".git","vendor","dist","build") for part in path.split("/"))):
            continue
        result.append(path)
        if len(result)>=MAX_INDEX_FILES:break
    return result

def summarize_source(path,source):
    text=source[:MAX_SOURCE_CHARS]
    if path.endswith(".py"):
        try:
            tree=ast.parse(text)
            symbols=[n.name for n in ast.walk(tree) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef))]
            imports=[n.module for n in ast.walk(tree) if isinstance(n,ast.ImportFrom) and n.module]
            imports += [a.name for n in ast.walk(tree) if isinstance(n,ast.Import) for a in n.names]
            return {"path":path,"symbols":symbols[:35],"imports":imports[:35],"lines":text.count("\n")+1}
        except SyntaxError:pass
    symbols=re.findall(r"(?:function|class|interface|export const|def)\s+([A-Za-z_][A-Za-z0-9_]*)",text)
    imports=re.findall(r"(?:from|require\()\s*['\"]([^'\"]+)['\"]",text)
    return {"path":path,"symbols":symbols[:35],"imports":imports[:35],"lines":text.count("\n")+1}

def index_repository(repo,token,github,reader,ref="main"):
    from engine.runner import allowed_repo
    if not allowed_repo(repo):
        raise ValueError("Repository not authorized")
    branch=github(f"repos/{repo}/branches/{ref}",token)
    sha=branch["commit"]["sha"]
    tree=github(f"repos/{repo}/git/trees/{sha}?recursive=1",token)
    paths=safe_paths(tree.get("tree",[]))
    ranked=sorted(paths,key=lambda p:(0 if p in ("README.md","pyproject.toml","package.json") else 1,
                                      p.count("/"),p))
    files=[]
    for path in ranked[:MAX_READ_FILES]:
        try:
            source=reader(repo,path,sha)
            if source:files.append(summarize_source(path,source))
        except (ValueError,KeyError,UnicodeError):continue
    counts=dict(Counter(p.rsplit(".",1)[-1] for p in paths).most_common(10))
    return {"repo":repo,"commit":sha,"total_indexed":len(paths),"truncated":bool(tree.get("truncated")) or len(paths)>=MAX_INDEX_FILES,
            "extensions":counts,"files":files,"paths":paths}
