"""Laya 종류 확률을 학습에 안 쓴 줄로 보정한다 — temperature scaling(Guo et al., ICML 2017). ADR-0057.

    python calibrate.py <data/laya 폴더> <--adds 결과 폴더> <final 체크포인트> [--write <calibration.json>]   # 133 의 ~/laya/run 에서

체크포인트 안의 온도(rl_agent_config.json 의 temperature[0])는 laya 가 학습할 때 학습 재료의 10% 로 맞춘 값이다. 그 10% 도
학습한 건물·이름에서 나와서 모델이 이미 본 말투이고, 그래서 처음 보는 이름에는 99% 로 틀린다("냉온수 헤더" → 냉동기 99%).
여기서는 모델이 정말 처음 보는 줄로 온도 하나를 다시 맞춘다. 순위는 바뀌지 않고(로짓을 같은 수로 나눌 뿐) 확률만 펴진다.

학습에 안 쓴 줄은 두 갈래다.

- 건물 하나를 빼고 배운 체크포인트(`train.py --adds` 의 adds-without-<건물>)에 그 건물의 줄을 묻는다. 이름만으로 사전이 못 읽는
  이름 줄(adds), 이름을 가린 패밀리(hidden), 이름은 보이는데 BIM 타입이 정답인 패밀리(named). 서버가 두 질문을 다 받는다.
- 서버의 체크포인트(final)에 학습에 안 넣은 한국어 이름(ko.test.jsonl, ko-names.json 의 test)을 묻는다.

앞의 것은 서버 체크포인트가 아니라 형제 체크포인트라서, 한쪽으로 맞춘 온도를 다른 쪽에 대 보는 교차 확인을 같이 낸다.
`--write` 를 주면 둘 다로 맞춘 온도를 serve.py 가 읽는 calibration 파일로 쓴다(LAYA_CALIB).
"""
import argparse
import json
import math
import os
import sys

import numpy as np

import laya
from laya.calibrate import calibration_payload, fit_temperature_map, records_from_labeled
from train import ADD_TEST, load_rows, question, test_sets

BINS = 15


def softmax(z, t):
    z = np.asarray(z, dtype=np.float64) / t
    z = z - z.max()
    e = np.exp(z)
    return e / e.sum()


def collect(agent, states, golds, labels):
    """(로짓, 정답 번호) 줄. 로짓은 서버가 온도로 나누기 전의 값이다."""
    keys = list(labels)
    q = question(labels)
    pairs = []
    for s, g in zip(states, golds):
        t = np.zeros(len(keys))
        t[keys.index(g)] = 1.0
        pairs.append((s, q, {"kind": t}))
    recs = records_from_labeled(agent, pairs)
    # 보기 순서가 서버의 답과 같은지 본다 — 어긋나면 엉뚱한 라벨로 온도를 맞춘다.
    got = agent.predict_batch(states[:8], q)
    for (_, z, _, _), r in zip(recs, got):
        top = max(r["answers"]["kind"]["probabilities"].items(), key=lambda x: x[1])[0]
        assert keys[int(np.argmax(z))] == top, (keys[int(np.argmax(z))], top)
    return recs


def metrics(recs, t):
    n = len(recs)
    nll = top1 = top3 = 0.0
    conf, hit, second = [], [], []
    for _, z, y, k in recs:
        p = softmax(z[:k], t)
        g = int(np.argmax(y[:k]))
        order = np.argsort(-p)
        nll -= math.log(max(p[g], 1e-12))
        top1 += order[0] == g
        top3 += g in order[:3]
        conf.append(p[order[0]])
        hit.append(order[0] == g)
        second.append(p[order[1]])
    conf, hit = np.array(conf), np.array(hit, dtype=float)
    ece = 0.0
    for b in range(BINS):
        m = (conf > b / BINS) & (conf <= (b + 1) / BINS)
        if m.any():
            ece += m.mean() * abs(conf[m].mean() - hit[m].mean())
    return {
        "n": n,
        "top1": int(top1),
        "top3": int(top3),
        "nll": round(nll / n, 3),
        "ece": round(float(ece), 3),
        "mean_conf": round(float(conf.mean()), 3),
        "acc": round(float(hit.mean()), 3),
        # 90% 넘게 자신하고 틀린 수 — 화면에서 가장 해로운 경우다.
        "sure_wrong": int(((conf >= 0.9) & (hit == 0)).sum()),
        # 둘째 후보 확률의 가운데 값. 드롭다운의 둘째 줄이 무슨 말을 하는지.
        "second_median": round(float(np.median(second)), 3),
    }


def fit(recs):
    return fit_temperature_map(recs)["temperature"][0]


def selective(recs, t):
    """첫 후보 확률이 문턱 이상인 것만 '자신 있음' 으로 볼 때, 몇 %가 그 안에 들고 그 안에서 몇 %가 틀리나."""
    rows = []
    for cut in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
        kept = wrong = 0
        for _, z, y, k in recs:
            p = softmax(z[:k], t)
            if p.max() >= cut:
                kept += 1
                wrong += int(np.argmax(p)) != int(np.argmax(y[:k]))
        rows.append({"cut": cut, "coverage": round(kept / len(recs), 3), "error": round(wrong / kept, 3) if kept else None})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("folds", help="train.py --adds 의 결과 폴더(adds-without-<건물>)")
    ap.add_argument("final", help="serve.py 의 체크포인트")
    ap.add_argument("--write", help="둘 다로 맞춘 온도를 이 calibration 파일로 쓴다")
    args = ap.parse_args()

    labels = json.load(open(os.path.join(args.data, "labels.json"), encoding="utf8"))["equipment"]
    rows = load_rows(args.data)
    adds = load_rows(args.data, "adds")
    ko = [json.loads(line) for line in open(os.path.join(args.data, "ko.test.jsonl"), encoding="utf8") if line.strip()]

    groups = {}
    for b in ADD_TEST:
        agent = laya.load(os.path.join(args.folds, f"adds-without-{b}"))
        test = [r for r in adds if r["building"] == b and not r["dictKind"] and r["kind"] in labels]
        groups[f"adds:{b}"] = collect(agent, [r["state"] for r in test], [r["kind"] for r in test], labels)
        for view, s in test_sets(rows, b).items():
            s = [x for x in s if x[1] in labels]
            if s:
                groups[f"{view}:{b}"] = collect(agent, [x[0] for x in s], [x[1] for x in s], labels)
        del agent
    final = laya.load(os.path.abspath(os.path.expanduser(args.final)))
    t_now = float(final.temperature[0])
    groups["ko"] = collect(final, [r["state"] for r in ko], [r["kind"] for r in ko], labels)

    folds = [r for g, v in groups.items() if g != "ko" for r in v]
    every = folds + groups["ko"]
    t_folds, t_ko, t_all = fit(folds), fit(groups["ko"]), fit(every)
    report = {
        "temperature": {"checkpoint": round(t_now, 3), "fit_on_folds": round(t_folds, 3), "fit_on_ko": round(t_ko, 3), "fit_on_all": round(t_all, 3)},
        # 교차 확인 — 한쪽으로 맞춘 온도를 다른 쪽에 댄다.
        "cross": {
            "ko_with_fold_t": {"before": metrics(groups["ko"], t_now), "after": metrics(groups["ko"], t_folds)},
            "folds_with_ko_t": {"before": metrics(folds, t_now), "after": metrics(folds, t_ko)},
        },
        "groups": {g: {"before": metrics(v, t_now), "after": metrics(v, t_all)} for g, v in groups.items()},
        "all": {"before": metrics(every, t_now), "after": metrics(every, t_all)},
        "selective_after": selective(every, t_all),
        "selective_before": selective(every, t_now),
    }
    json.dump(report, sys.stdout, ensure_ascii=False, indent=1)
    print()
    if args.write:
        cfg = dict(final.cfg)
        payload = calibration_payload([t_all, final.temperature[1], final.temperature[2]], {}, model_id_or_path=getattr(final, "model_id_or_path", None),
                                      subfolder=getattr(final, "subfolder", None), config=cfg)
        payload["fitted_on"] = {"records": len(every), "groups": {g: len(v) for g, v in groups.items()}}
        with open(args.write, "w", encoding="utf8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"wrote {args.write} (T {t_now:.3f} -> {t_all:.3f})", file=sys.stderr)


if __name__ == "__main__":
    main()
