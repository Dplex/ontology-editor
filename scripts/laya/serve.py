"""Laya 종류 후보 서버. 133(RTX 5090)에서 돈다(ADR-0057).

    LAYA_CKPT=~/laya/run/out-ko3/final LAYA_CALIB=~/laya/run/out-ko3/calibration.json LAYA_PORT=8096 python serve.py

앱(8084 의 scripts/serve.mjs, dev 의 vite)이 /__laya/kinds 를 여기로 넘긴다. 받는 것은 단서 글뿐이고
(src/lib/family-clues.ts 의 clueText), 질문(지시문·라벨)은 이 서버가 정한다 — 학습할 때와 같은 질문이어야 해서
train.py 의 question() 을 그대로 쓴다. 정하지 않는다: 확률 순서의 후보와 confidence 를 돌려줄 뿐이고, 고르는 것은 사람이다.

    GET  /health            {"ok": true, "model": "...", "labels": 39, "temperature": 3.16}
    POST /kinds             {"states": ["패밀리 이름: …", …]}  (한 번에 200 줄까지)
                         -> {"results": [{"ranked": [{"kind": "fcu", "p": 0.71}, …], "confidence": 0.71}, …], "ms": 41}

ranked 는 라벨 39개 전부다. [설비 더하기] 의 드롭다운이 전체 목록도 확률 순서로 보인다.

LAYA_CALIB 는 calibrate.py --write 가 쓴 온도 파일이다. 체크포인트 안의 온도는 학습 재료로 맞춘 값이라 처음 보는 이름에
99% 로 틀린다. 학습에 안 쓴 줄로 다시 맞춘 온도를 덮는다 — 순위는 그대로이고 확률만 펴진다. 없으면 체크포인트의 온도다.
"""
import json
import os
import time

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import laya
from train import question

CKPT = os.path.expanduser(os.environ.get("LAYA_CKPT", "~/laya/run/out-ko3/final"))
CALIB = os.path.expanduser(os.environ.get("LAYA_CALIB", ""))
LABELS = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "labels.json"), encoding="utf8"))["equipment"]
MAX_STATES = 200

agent = laya.load(CKPT)
if CALIB:
    agent.load_calibration(CALIB)
app = FastAPI()


class KindsRequest(BaseModel):
    states: list[str]


@app.get("/health")
def health():
    return {"ok": True, "model": os.path.basename(os.path.dirname(CKPT)) + "/" + os.path.basename(CKPT), "labels": len(LABELS),
            "temperature": round(float(agent.temperature[0]), 3)}


@app.post("/kinds")
def kinds(req: KindsRequest):
    if len(req.states) > MAX_STATES:
        raise HTTPException(413, f"한 번에 {MAX_STATES} 줄까지")
    started = time.time()
    q = question(LABELS)
    results = []
    for i in range(0, len(req.states), 16):
        for r in agent.predict_batch(req.states[i:i + 16], q):
            a = r["answers"]["kind"]
            ranked = sorted(a.get("probabilities", {}).items(), key=lambda x: -x[1])
            results.append({"ranked": [{"kind": k, "p": round(p, 4)} for k, p in ranked], "confidence": round(a.get("confidence", 0.0), 4)})
    return {"results": results, "ms": round((time.time() - started) * 1000)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.environ.get("LAYA_HOST", "0.0.0.0"), port=int(os.environ.get("LAYA_PORT", "8096")))
