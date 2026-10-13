"""계통 후보: Laya 확률에 거리 감쇠 exp(-d/τ) 를 곱했을 때 τ 마다 맞힌 수. train.py --picks 가 저장한 확률로 잰다.

    python combine_picks.py <train.py --picks 의 결과 폴더>
    python combine_picks.py <train.py --sysk 의 결과 폴더> --sysk   # 계통 종류 확률 × 거리, 또는 그 종류의 가장 가까운 후보

src/lib/system-suggest.ts 의 rankSystems 와 같은 셈이다. τ=inf 는 Laya 만, "가까운 순" 은 후보 첫째(규칙만)다.
"""
import glob
import json
import math
import os
import sys

TAUS = [0.5, 1, 2, 3, 5, 8, math.inf]


def top(row, tau):
    score = {int(i): p * (math.exp(-row["distances"][int(i)] / tau) if tau != math.inf else 1) for i, p in row["probs"].items()}
    return [i for i, _ in sorted(score.items(), key=lambda x: -x[1])]


def sysk_top(row, tau):
    """후보 점수 = Laya 가 그 후보의 계통 종류에 준 확률 × 거리 감쇠. 종류 모름 후보는 확률 0 이 아니라 가장 낮은 확률로 둔다."""
    q = row["kindProbs"]
    floor = min(q.values()) if q else 0
    score = {}
    for i, (k, d) in enumerate(zip(row["optionKinds"], row["distances"])):
        p = q.get(k, floor) if k else floor
        score[i] = p * (math.exp(-d / tau) if tau != math.inf else 1) + (0 if tau != math.inf else -d * 1e-6)
    return [i for i, _ in sorted(score.items(), key=lambda x: -x[1])]


def sysk_filter(row):
    """Laya 가 고른 종류의 후보 중 가장 가까운 것을 앞에. 그 종류 후보가 없으면 거리 순 그대로."""
    q = row["kindProbs"]
    best = max(q, key=q.get) if q else None
    same = [i for i, k in enumerate(row["optionKinds"]) if k == best]
    rest = [i for i in range(len(row["distances"])) if i not in same]
    return same + rest


def main_sysk(folder):
    total = {}
    for path in sorted(glob.glob(os.path.join(folder, "sysk-*.probs.json"))):
        b = os.path.basename(path)[len("sysk-"):-len(".probs.json")]
        rows = json.load(open(path, encoding="utf8"))
        methods = {"가까운 순": lambda r: list(range(len(r["distances"]))), "종류 맞는 가장 가까운": sysk_filter}
        for tau in TAUS:
            methods[f"τ={tau}"] = (lambda t: (lambda r: sysk_top(r, t)))(tau)
        line = {"n": len(rows)}
        for name, f in methods.items():
            got = [f(r) for r in rows]
            line[name] = [sum(g[0] in r["golds"] for g, r in zip(got, rows)), sum(bool(set(r["golds"]) & set(g[:3])) for g, r in zip(got, rows))]
        print(b, json.dumps(line, ensure_ascii=False))
        for k, v in line.items():
            if k == "n":
                total["n"] = total.get("n", 0) + v
            else:
                t = total.setdefault(k, [0, 0])
                t[0] += v[0]
                t[1] += v[1]
    print("합", json.dumps(total, ensure_ascii=False))


def main():
    folder = sys.argv[1]
    if "--sysk" in sys.argv:
        return main_sysk(folder)
    total = {}
    for path in sorted(glob.glob(os.path.join(folder, "picks-*.probs.json"))):
        b = os.path.basename(path)[len("picks-"):-len(".probs.json")]
        rows = json.load(open(path, encoding="utf8"))
        line = {"n": len(rows), "가까운 순": [sum(0 in r["golds"] for r in rows), sum(bool(set(r["golds"]) & {0, 1, 2}) for r in rows)]}
        for tau in TAUS:
            got = [top(r, tau) for r in rows]
            line[f"τ={tau}"] = [sum(g[0] in r["golds"] for g, r in zip(got, rows)), sum(bool(set(r["golds"]) & set(g[:3])) for g, r in zip(got, rows))]
        print(b, json.dumps(line, ensure_ascii=False))
        for k, v in line.items():
            if k == "n":
                total["n"] = total.get("n", 0) + v
            else:
                t = total.setdefault(k, [0, 0])
                t[0] += v[0]
                t[1] += v[1]
    print("합", json.dumps(total, ensure_ascii=False))


if __name__ == "__main__":
    main()
