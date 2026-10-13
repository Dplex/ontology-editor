"""Laya 로 설비 종류를 맞혀 본다 — 건물 하나를 빼고 학습하고 그 건물로 잰다(leave-one-building-out).

입력은 scripts/laya/export.test.ts 가 뽑은 data/laya/*.families.jsonl. 133(RTX 5090)에서 돈다.

    python train.py <data/laya 폴더> <결과 폴더> [--zero-shot-only] [--epochs N]   # 건물 하나를 빼고 배워 잰다
    python train.py <data/laya 폴더> <결과 폴더> --within                         # 그 건물의 다른 패밀리도 넣어 5겹으로 잰다
    python train.py <data/laya 폴더> <결과 폴더> --adds                           # [설비 더하기] 이름 줄을 건물 하나씩 빼고 잰다
    python train.py <data/laya 폴더> <결과 폴더> --picks                          # 계통 후보를 건물 하나씩 빼고 잰다
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
INSTRUCTIONS = "건물 설비 하나를 설명하는 글이다. 이 설비의 종류는 무엇인가?"
SYSTEM_INSTRUCTIONS = "건물 설비 하나와 그 근처 계통 후보들이다. 이 설비가 들어갈 계통은 어느 후보인가?"
LETTERS = "ABCDEFGHIJKLMNOP"
# [설비 더하기] 이름 줄(adds)을 잴 건물. 이름만으로 사전이 못 읽는 줄이 있는 곳이다(Office_A·치과는 0줄).
ADD_TEST = ["clinic", "duplex", "ifc4mep", "seongsu"]


def state_of(row, hide_name):
    """단서 글은 앱이 만든 것(src/lib/family-clues.ts 의 clueText)을 그대로 쓴다. 학습한 글과 앱이 묻는 글이 같아야 한다."""
    return row["stateHidden" if hide_name else "state"]


def load_rows(folder, what="families"):
    rows = []
    for path in sorted(glob.glob(os.path.join(folder, f"*.{what}.jsonl"))):
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


def add_train_rows(adds, labels, held_out):
    """[설비 더하기] 이름 줄(src/lib/laya.ts 의 newEquipmentText). 사전이 읽는 이름도 넣는다 — 사전과 같은 답을 내는 것도 배워야 한다."""
    seen, out = set(), []
    for r in adds:
        if r["building"] == held_out or r["kind"] not in labels or (r["state"], r["kind"]) in seen:
            continue
        seen.add((r["state"], r["kind"]))
        out.append({"state": r["state"], "questions": question(labels), "expected": {"kind": r["kind"]}})
    return out


def system_question(options, order=None):
    """계통 후보 질문. 열쇠(A·B·…)를 `order` 대로 붙인다. 학습은 섞고(자리 순서를 외우지 않게), 서버는 받은 순서대로 붙인다."""
    order = order or list(range(len(options)))
    crit = {LETTERS[k]: options[i] for k, i in enumerate(order)}
    return {"system": {"type": "choice", "instructions": SYSTEM_INSTRUCTIONS, "criteria": crit}}, order


def pick_train_rows(picks, held_out, seed=0):
    rng = random.Random(seed)
    out = []
    for r in picks:
        if r["building"] == held_out:
            continue
        order = list(range(len(r["options"])))
        rng.shuffle(order)
        q, order = system_question(r["options"], order)
        out.append({"state": r["state"], "questions": q, "expected": {"system": LETTERS[order.index(r["gold"])]}})
    return out


def rank_systems(agent, state, options):
    """후보 순서(거리 순) 번호를 확률 순서로. 서버(serve.py)도 이 함수를 쓴다."""
    q, order = system_question(options)
    a = agent.predict(state, q)["answers"]["system"]
    probs = a.get("probabilities", {})
    ranked = sorted(probs.items(), key=lambda x: -x[1])
    return [(order[LETTERS.index(k)], p) for k, p in ranked]


SYSK_INSTRUCTIONS = "건물 설비 하나다. 이 설비가 드는 계통의 종류는 무엇인가?"


def kind_of_option(text):
    """후보 글(candidateText)의 둘째 칸이 계통 종류의 우리말 이름이다."""
    parts = text.split(" · ")
    return parts[1] if len(parts) > 1 else None


def sysk_rows(picks, sys_labels, held_out):
    """계통 종류 질문. 정답은 정답 후보의 계통 종류다(종류 모름이면 뺀다)."""
    names = {v: k for k, v in sys_labels.items()}
    out = []
    for r in picks:
        k = names.get(kind_of_option(r["options"][r["gold"]]))
        if r["building"] == held_out or not k:
            continue
        out.append({"state": r["state"], "questions": {"syskind": {"type": "choice", "instructions": SYSK_INSTRUCTIONS, "criteria": sys_labels}}, "expected": {"syskind": k}})
    return out


def sysk_eval(args, rows, adds, picks, labels, sys_labels, base_dir):
    """계통 종류를 Laya 가 고르고, 그 종류인 후보 중 가장 가까운 것을 고른다. 건물 하나를 빼고 배워 잰다. 확률은 저장해 두고
    combine_picks.py --sysk 로 셈을 바꿔 본다."""
    import laya
    from laya.train import TrainConfig, finetune

    names = {v: k for k, v in sys_labels.items()}
    for b in ADD_TEST:
        test = [r for r in picks if r["building"] == b]
        if not test:
            continue
        tr = train_rows(rows, labels, b) + add_train_rows(adds, labels, b) + sysk_rows(picks, sys_labels, b)
        random.Random(0).shuffle(tr)
        path = os.path.join(args.out, f"sysk-without-{b}.jsonl")
        with open(path, "w", encoding="utf8") as f:
            f.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in tr)
        cfg = TrainConfig(epochs=args.epochs, micro_batch=8, grad_accum=1, loss="soft-ce", shuffle_options=("choice",),
                          calib_frac=0.1, log_every=50)
        ckpt = os.path.join(args.out, f"sysk-without-{b}")
        finetune(path, base_dir, ckpt, cfg)
        tuned = laya.load(ckpt)
        q = {"syskind": {"type": "choice", "instructions": SYSK_INSTRUCTIONS, "criteria": sys_labels}}
        saved = []
        for i in range(0, len(test), 16):
            for r, res in zip(test[i:i + 16], tuned.predict_batch([x["state"] for x in test[i:i + 16]], q)):
                probs = res["answers"]["syskind"].get("probabilities", {})
                saved.append({"golds": r["golds"], "distances": r["distances"], "kindHidden": r["kindHidden"],
                              "optionKinds": [names.get(kind_of_option(o)) for o in r["options"]], "kindProbs": probs})
        with open(os.path.join(args.out, f"sysk-{b}.probs.json"), "w", encoding="utf8") as f:
            json.dump(saved, f)
        print(b, "sysk saved", len(saved), file=sys.stderr)
        del tuned


def pick_eval(args, rows, adds, picks, labels, base_dir):
    """계통 후보. 건물 하나를 빼고 셋(패밀리·이름·계통)으로 배운 뒤 그 건물의 계통 줄을 잰다. 기준선은 가장 가까운 계통(후보 첫째)."""
    import laya
    from laya.train import TrainConfig, finetune

    report = {}
    for b in ADD_TEST:
        test = [r for r in picks if r["building"] == b]
        if not test:
            continue
        tr = train_rows(rows, labels, b) + add_train_rows(adds, labels, b) + pick_train_rows(picks, b)
        random.Random(0).shuffle(tr)
        path = os.path.join(args.out, f"picks-without-{b}.jsonl")
        with open(path, "w", encoding="utf8") as f:
            f.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in tr)
        cfg = TrainConfig(epochs=args.epochs, micro_batch=8, grad_accum=1, loss="soft-ce", shuffle_options=("choice",),
                          calib_frac=0.1, log_every=50)
        ckpt = os.path.join(args.out, f"picks-without-{b}")
        finetune(path, base_dir, ckpt, cfg)
        tuned = laya.load(ckpt)
        tally = {"n": 0, "laya_top1": 0, "laya_top3": 0, "base_top1": 0, "base_top3": 0, "kind_hidden": {"n": 0, "laya_top1": 0, "base_top1": 0}}
        saved = []
        t0 = time.time()
        for r in test:
            ranked = rank_systems(tuned, r["state"], r["options"])
            got = [i for i, _ in ranked]
            # 거리 감쇠와 곱해 보는 것(combine_picks)은 저장한 확률로 따로 한다.
            saved.append({"golds": r["golds"], "distances": r["distances"], "kindHidden": r["kindHidden"], "probs": {i: p for i, p in ranked}})
            golds = set(r["golds"])
            tally["n"] += 1
            tally["laya_top1"] += got[0] in golds
            tally["laya_top3"] += bool(golds & set(got[:3]))
            tally["base_top1"] += 0 in golds
            tally["base_top3"] += bool(golds & {0, 1, 2})
            if r["kindHidden"]:
                tally["kind_hidden"]["n"] += 1
                tally["kind_hidden"]["laya_top1"] += got[0] in golds
                tally["kind_hidden"]["base_top1"] += 0 in golds
        tally["ms_per_row"] = round((time.time() - t0) * 1000 / len(test), 1)
        with open(os.path.join(args.out, f"picks-{b}.probs.json"), "w", encoding="utf8") as f:
            json.dump(saved, f)
        tally["train_rows"] = len(tr)
        report[b] = tally
        print(b, "picks", json.dumps(tally), file=sys.stderr)
        del tuned
    with open(os.path.join(args.out, "report-picks.json"), "w", encoding="utf8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)


def add_eval(args, rows, adds, labels, base_dir):
    """이름만 친 새 설비. 건물 하나를 빼고 패밀리 단서 + 이름 줄로 배운 뒤, 그 건물에서 이름만으로 사전이 못 읽는 줄을 잰다.
    기준선은 이름의 낱말 후보(kind-suggest.ts 의 suggestByName)다."""
    import laya
    from laya.train import TrainConfig, finetune

    zero = laya.load(base_dir)
    report = {}
    for b in ADD_TEST:
        test = [r for r in adds if r["building"] == b and not r["dictKind"] and r["kind"] in labels]
        sets = [(r["state"], r["kind"], r["baseline"], r) for r in test]
        tr = train_rows(rows, labels, b) + add_train_rows(adds, labels, b)
        random.Random(0).shuffle(tr)
        path = os.path.join(args.out, f"adds-without-{b}.jsonl")
        with open(path, "w", encoding="utf8") as f:
            f.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in tr)
        cfg = TrainConfig(epochs=args.epochs, micro_batch=8, grad_accum=1, loss="soft-ce", shuffle_options=("choice",),
                          calib_frac=0.1, log_every=50)
        ckpt = os.path.join(args.out, f"adds-without-{b}")
        finetune(path, base_dir, ckpt, cfg)
        tuned = laya.load(ckpt)
        preds = ranked(tuned, [x[0] for x in sets], labels)
        report[b] = {
            "train_rows": len(tr),
            "zero": score(sets, ranked(zero, [x[0] for x in sets], labels)),
            "tuned": score(sets, preds),
            "rows": [{"name": r["name"], "ceiling": r["ceiling"], "gold": gold, "laya": rk[:3], "conf": round(c, 2), "base": base[:3]}
                     for (_, gold, base, r), (rk, c) in zip(sets, preds)],
        }
        print(b, "adds", json.dumps({k: v for k, v in report[b].items() if k != "rows"}), file=sys.stderr)
        del tuned
    with open(os.path.join(args.out, "report-adds.json"), "w", encoding="utf8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)


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
    ap.add_argument("--picks", action="store_true", help="계통 후보를 건물 하나씩 빼고 잰다")
    ap.add_argument("--sysk", action="store_true", help="계통 종류를 Laya 로 고르고 그 종류의 가장 가까운 후보를 잰다")
    ap.add_argument("--adds", action="store_true", help="[설비 더하기] 이름 줄을 건물 하나씩 빼고 잰다")
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
    adds = load_rows(args.data, "adds")
    picks = load_rows(args.data, "picks")
    if args.picks:
        return pick_eval(args, rows, adds, picks, labels, base_dir)
    if args.sysk:
        sys_labels = json.load(open(os.path.join(args.data, "labels.json"), encoding="utf8"))["system"]
        return sysk_eval(args, rows, adds, picks, labels, sys_labels, base_dir)
    if args.within:
        return within(args, rows, labels, base_dir)
    if args.adds:
        return add_eval(args, rows, adds, labels, base_dir)
    if args.final:
        # 서버(serve.py)가 쓰는 체크포인트. 가진 건물 전부로 배운다.
        tr = train_rows(rows, labels, None) + add_train_rows(adds, labels, None) + pick_train_rows(picks, None)
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
