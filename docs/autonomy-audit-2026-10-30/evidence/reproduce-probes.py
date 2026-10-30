"""Read-only audit probes. Run from repository root: python docs/autonomy-audit-2026-10-30/evidence/reproduce-probes.py"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from engine.budget_ledger import Ledger
from engine.requirements import split
class Journal:
    def __init__(self): self.state = {}
    def persist(self): pass
j=Journal(); ledger=Ledger(j,"investigation")
ledger.record({"calls":10,"bytes":100}); ledger.record({"calls":11})
print("Sparse update state:",j.state)
request="\n".join(f"{i}. Implement separate requirement number {i}." for i in range(1,41))
print("Tracked requirements:",len(split(request)),"of40")
