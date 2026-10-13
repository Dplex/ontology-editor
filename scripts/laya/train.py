"""Laya 로 설비 종류를 맞혀 본다 — 건물 하나를 빼고 학습하고 그 건물로 잰다(leave-one-building-out).

입력은 scripts/laya/export.test.ts 가 뽑은 data/laya/*.families.jsonl. 133(RTX 5090)에서 돈다.

    python train.py <data/laya 폴더> <결과 폴더> [--zero-shot-only] [--epochs N]   # 건물 하나를 빼고 배워 잰다
    python train.py <data/laya 폴더> <결과 폴더> --within                         # 그 건물의 다른 패밀리도 넣어 5겹으로 잰다
    python train.py <data/laya 폴더> <결과 폴더> --final                          # 전부로 배워 <결과>/final (serve.py 용)

venv 는 133 의 ~/laya/.venv(torch cu128 + laya[serve]). 2026-10-13 숫자는 ADR-0057.

패밀리 한 줄을 편집 화면의 "종류를 모르는 패밀리" 칸과 같은 단서 글로 바꿔 Laya 의 choice 질문 하나로 묻는다.
두 갈래로 잰다.

- hidden: 이름을 "(이름 없음)" 으로 가린다. 성수의 `P12`·`CH1` 처럼 이름이 아무것도 말하지 않는 패밀리를 흉내 낸 것이다.
  기준선은 닮은 패밀리(kind-suggest.ts 의 lookalikes, check:sample 의 evaluateSuggestions 와 같은 셈).
- bim-named: 이름은 보이지만 이름 사전이 못 읽어 BIM 타입에서 종류를 얻은 패밀리. 이름에 뜻이 있는데 사전이 놓친 경우다.
  기준선은 화면의 후보(이름의 낱말 + 닮은 패밀리, suggestKinds). 단서 글에는 타입(declaredType)을 넣지 않는다 — 넣으면 답을 준다.

사전으로 종류를 얻은 패밀리에 이름을 보여 주고 재는 것은 하지 않는다. 사전이 이미 100% 맞히는 문제다.
"""
import argparse
import glob
import json
import os
import random
import sys
import time

TEST_BUILDINGS = ["clinic", "seongsu", "duplex"]
INSTRUCTIONS = "건물 설비 패밀리 하나의 단서다. 이 설비의 종류는 무엇인가?"


def state_of(row, hide_name):
    """단서 글은 앱이 만든 것(src/lib/family-clues.ts 의 clueText)을 그대로 쓴다. 학습한 글과 앱이 묻는 글이 같아야 한다."""
    return row["stateHidden" if hide_name else "state"]


def load_rows(folder):
    rows = []
    for path in sorted(glob.glob(os.path.join(folder, "*.families.jsonl"))):
        with open(path, encoding="utf8") as f:
            rows += [json.loads(line) for line in f if line.strip()]
    return rows


def question(labels):
    return {"kind": {"type": "choice", "instructions": INSTRUCTIONS, "criteria": labels}}


def train_rows(rows, labels, held_out):
    """학습 줄. 이름을 보인 것과 가린 것을 둘 다 넣는다. 같은 글이 여러 번 나오면(ifc4Mep 의 설비 한 대 한 묶음) 한 번만."""
    seen, out = set(), []
    for r in rows:
        if r["building"] == held_out or not r["kind"] or r["kind"] not in labels:
            continue
        for hide in (False, True):
            s = state_of(r, hide)
            if (s, r["kind"]) in seen:
                continue
            seen.add((s, r["kind"]))
            out.append({"state": s, "questions": question(labels), "expected": {"kind": r["kind"]}})
    return out


def test_sets(rows, building):
    known = [r for r in rows if r["building"] == building and r["kind"] and r["key"].startswith("family:") and r.get("baseline")]
    return {
        "hidden": [(state_of(r, True), r["kind"], r["baseline"]["byLook"], r) for r in known],
        "bim-named": [(state_of(r, False), r["kind"], r["baseline"]["combined"], r) for r in known if r["kindSource"] == "bim"],
    }


def ranked(agent, states, labels):
    q = question(labels)
    out = []
    for i in range(0, len(states), 16):
        res = agent.predict_batch(states[i:i + 16], q) if hasattr(agent, "predict_batch") else [agent.predict(s, q) for s in states[i:i + 16]]
        for r in res:
            a = r["answers"]["kind"]
            probs = a.get("probabilities", {})
            out.append(([k for k, _ in sorted(probs.items(), key=lambda x: -x[1])], a.get("confidence", 0.0)))
    return out


def score(sets, preds):
    n = len(sets)
    t1 = sum(1 for (_, gold, _, _), (rk, _) in zip(sets, preds) if rk[:1] == [gold])
    t3 = sum(1 for (_, gold, _, _), (rk, _) in zip(sets, preds) if gold in rk[:3])
    b1 = sum(1 for (_, gold, base, _) in sets if base[:1] == [gold])
    b3 = sum(1 for (_, gold, base, _) in sets if gold in base[:3])
    return {"n": n, "laya_top1": t1, "laya_top3": t3, "base_top1": b1, "base_top3": b3}


def within(args, rows, labels, base_dir):
    """그 건물에서 종류를 아는 패밀리도 학습에 넣는다(앱에서 사전이 맞힌 패밀리로 그 자리에서 더 배우는 경우).
    패밀리를 k 겹으로 갈라, 한 겹을 가리고 나머지 + 다른 건물로 배운 뒤 가린 겹을 잰다."""
    import laya
    from laya.train import TrainConfig, finetune

    report = {}
    for b in TEST_BUILDINGS:
        sets = test_sets(rows, b)
        keys = sorted({x[3]["key"] for x in sets["hidden"]})
        random.Random(1).shuffle(keys)
        folds = [set(keys[i::args.folds]) for i in range(args.folds)]
        tally = {v: {"n": 0, "laya_top1": 0, "laya_top3": 0, "base_top1": 0, "base_top3": 0} for v in sets}
        for i, fold in enumerate(folds):
            tr = train_rows([r for r in rows if not (r["building"] == b and r["key"] in fold)], labels, None)
            random.Random(0).shuffle(tr)
            path = os.path.join(args.out, f"within-{b}-{i}.jsonl")
            with open(path, "w", encoding="utf8") as f:
                f.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in tr)
            cfg = TrainConfig(epochs=args.epochs, micro_batch=8, grad_accum=1, loss="soft-ce", shuffle_options=("choice",),
                              calib_frac=0.1, log_every=50)
            ckpt = os.path.join(args.out, f"within-{b}-{i}")
            finetune(path, base_dir, ckpt, cfg)
            agent = laya.load(ckpt)
            for view, s in sets.items():
                part = [x for x in s if x[3]["key"] in fold]
                if not part:
                    continue
                sc = score(part, ranked(agent, [x[0] for x in part], labels))
                for k in tally[view]:
                    tally[view][k] += sc[k]
            del agent
            print(f"[{b}] fold {i + 1}/{args.folds} {json.dumps(tally)}", file=sys.stderr)
        report[b] = tally
        print(b, "within", json.dumps(tally), file=sys.stderr)
    with open(os.path.join(args.out, "report-within.json"), "w", encoding="utf8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("out")
    ap.add_argument("--zero-shot-only", action="store_true")
    ap.add_argument("--within", action="store_true", help="그 건물의 다른 패밀리도 학습에 넣는다(k 겹)")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--final", action="store_true", help="가진 건물 전부로 배워 <out>/final 에 둔다(serve.py 용)")
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--base", default="convaiinnovations/laya-multilingual")
    args = ap.parse_args()

    import laya
    from laya.train import TrainConfig, finetune, resolve_checkpoint_dir

    labels = json.load(open(os.path.join(args.data, "labels.json"), encoding="utf8"))["equipment"]
    rows = load_rows(args.data)
    os.makedirs(args.out, exist_ok=True)
    base_dir = resolve_checkpoint_dir(args.base)
    if args.within:
        return within(args, rows, labels, base_dir)
    if args.final:
        # 서버(serve.py)가 쓰는 체크포인트. 가진 건물 전부로 배운다.
        tr = train_rows(rows, labels, None)
        random.Random(0).shuffle(tr)
        path = os.path.join(args.out, "train-all.jsonl")
        with open(path, "w", encoding="utf8") as f:
            f.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in tr)
        cfg = TrainConfig(epochs=args.epochs, micro_batch=8, grad_accum=1, loss="soft-ce", shuffle_options=("choice",),
                          calib_frac=0.1, log_every=50)
        finetune(path, base_dir, os.path.join(args.out, "final"), cfg)
        print(f"final: {len(tr)} rows", file=sys.stderr)
        return
    zero = laya.load(base_dir)
    report = {}
    for b in TEST_BUILDINGS:
        sets = test_sets(rows, b)
        report[b] = {}
        tuned = None
        if not args.zero_shot_only:
            data_path = os.path.join(args.out, f"train-without-{b}.jsonl")
            tr = train_rows(rows, labels, b)
            random.Random(0).shuffle(tr)
            with open(data_path, "w", encoding="utf8") as f:
                f.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in tr)
            cfg = TrainConfig(epochs=args.epochs, micro_batch=8, grad_accum=1, loss="soft-ce", shuffle_options=("choice",),
                              calib_frac=0.1, log_every=50)
            t = time.time()
            summary = finetune(data_path, base_dir, os.path.join(args.out, f"without-{b}"), cfg)
            print(f"[{b}] trained on {len(tr)} rows in {time.time() - t:.0f}s", file=sys.stderr)
            report[b]["train_rows"] = len(tr)
            tuned = laya.load(os.path.join(args.out, f"without-{b}"))
        for view, s in sets.items():
            if not s:
                continue
            states = [x[0] for x in s]
            entry = {"zero": score(s, ranked(zero, states, labels))}
            if tuned:
                preds = ranked(tuned, states, labels)
                entry["tuned"] = score(s, preds)
                entry["misses"] = [
                    {"label": r["label"], "gold": gold, "laya": rk[:3], "conf": round(c, 2), "base": base}
                    for (_, gold, base, r), (rk, c) in zip(s, preds) if rk[:1] != [gold]
                ]
            report[b][view] = entry
            print(b, view, json.dumps({k: v for k, v in entry.items() if k != "misses"}), file=sys.stderr)
        del tuned
    with open(os.path.join(args.out, "report.json"), "w", encoding="utf8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
