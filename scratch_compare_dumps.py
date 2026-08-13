import json
import os
import glob
from pathlib import Path

def compare_mage_dumps():
    current_dir = Path(r"E:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh\server\trading\optimizer\mage\mage_optimizer_dump")
    prev_dir = current_dir / "last_optimization_run"
    
    current_states = {f.name: f for f in current_dir.glob("state_*.json")}
    prev_states = {f.name: f for f in prev_dir.glob("state_*.json")}
    
    all_keys = set(current_states.keys()).union(set(prev_states.keys()))
    
    analysis = {
        "added": [],
        "removed": [],
        "unchanged": [],
        "changed": {}
    }
    
    for key in all_keys:
        if key not in prev_states:
            analysis["added"].append(key)
        elif key not in current_states:
            analysis["removed"].append(key)
        else:
            with open(current_states[key], 'r') as f1, open(prev_states[key], 'r') as f2:
                c1 = json.load(f1)
                c2 = json.load(f2)
                
                # Check for fitness/metrics improvements
                best1 = c1[0] if isinstance(c1, list) and c1 else {}
                best2 = c2[0] if isinstance(c2, list) and c2 else {}
                
                f1_val = best1.get("totalNetR", 0)
                f2_val = best2.get("totalNetR", 0)
                
                setup1 = best1.get("setup", "")
                setup2 = best2.get("setup", "")
                
                if setup1 == setup2 and f1_val == f2_val:
                    analysis["unchanged"].append(key)
                else:
                    diffs = []
                    if setup1 != setup2:
                        diffs.append(f"Setup changed: {setup2} -> {setup1}")
                    
                    analysis["changed"][key] = {
                        "fitness_old": f2_val,
                        "fitness_new": f1_val,
                        "improvement": f1_val - f2_val,
                        "diffs": diffs
                    }
                    
    print("MAGE DUMP ANALYSIS:")
    print(f"Added pairs: {len(analysis['added'])} {analysis['added']}")
    print(f"Removed pairs: {len(analysis['removed'])} {analysis['removed']}")
    print(f"Unchanged pairs: {len(analysis['unchanged'])} {analysis['unchanged']}")
    print(f"Changed pairs: {len(analysis['changed'])}")
    for k, v in analysis["changed"].items():
        print(f"  {k}: Fitness {v['fitness_old']} -> {v['fitness_new']} (Diff: {v['improvement']})")
        for d in v["diffs"]:
            print(f"    - {d}")

def compare_grandmaster():
    gm_file = Path(r"E:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh\server\trading\optimizer\grandmaster_holy_grail_portfolios.md")
    gm_copy = Path(r"E:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh\server\trading\optimizer\grandmaster_holy_grail_portfolios - Copy.md")
    
    if not gm_file.exists() or not gm_copy.exists():
        print("Grandmaster files not found.")
        return
        
    with open(gm_file, 'r', encoding='utf-8') as f1, open(gm_copy, 'r', encoding='utf-8') as f2:
        l1 = f1.readlines()
        l2 = f2.readlines()
        
    print("\nGRANDMASTER DIFFERENCES:")
    print("This requires line-by-line or diff analysis. Outputting first few diff lines:")
    import difflib
    diff = list(difflib.unified_diff(l2, l1, fromfile='copy', tofile='current'))
    if not diff:
        print("  No differences found in Grandmaster portfolios!")
    else:
        with open("scratch_grandmaster_diff.txt", "w", encoding="utf-8") as out:
            for d in diff:
                out.write(d)
        print("Grandmaster diff written to scratch_grandmaster_diff.txt")
            
compare_mage_dumps()
compare_grandmaster()
