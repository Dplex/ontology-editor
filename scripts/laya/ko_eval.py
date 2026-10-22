"""한국어 이름(ko-names.json 의 test)을 체크포인트가 얼마나 맞히나 — 학습에 안 넣은 말로 잰다.

    python ko_eval.py <data/laya 폴더> <체크포인트> [...]    # 133 의 ~/laya/run 에서. 체크포인트를 여럿 주면 나란히 잰다.

top1 은 첫 후보, top3 는 셋 안, shown 은 화면에 칩이 뜨는 경우(첫 후보 확률이 LAYA_MIN=0.05 이상)에서 첫 후보가 맞은 수다.
"""
import json
import os
import sys

import laya
from train import question

data, ckpts = sys.argv[1], sys.argv[2:]
labels = json.load(open(os.path.join(data, "labels.json"), encoding="utf8"))["equipment"]
rows = [json.loads(line) for line in open(os.path.join(data, "ko.test.jsonl"), encoding="utf8") if line.strip()]
q = question(labels)
for ckpt in ckpts:
    agent = laya.load(os.path.expanduser(ckpt))
    top1 = top3 = sure = 0
    wrong = []
    for i in range(0, len(rows), 16):
        part = rows[i:i + 16]
        for r, out in zip(part, agent.predict_batch([x["state"] for x in part], q)):
            a = out["answers"]["kind"]
            ranked = [k for k, _ in sorted(a.get("probabilities", {}).items(), key=lambda x: -x[1])]
            top1 += ranked[0] == r["kind"]
            top3 += r["kind"] in ranked[:3]
            sure += ranked[0] == r["kind"] and a.get("confidence", 0) >= 0.5
            if ranked[0] != r["kind"]:
                wrong.append(f'{r["name"]}: {r["kind"]} → {ranked[:2]}')
    n = len(rows)
    print(f"{ckpt}: {n}줄 top1 {top1} top3 {top3} 확신(≥0.5)하고 맞음 {sure}")
    for w in wrong[:25]:
        print("   틀림", w)
