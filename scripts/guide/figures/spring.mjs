// 기둥에 감긴 세운 코일 스프링. kit 의 coil() 은 x·y 축으로 누운 코일만 그려서(kit 은 원본 그대로 둔다), 같은 방식으로
// z 축 판을 여기 둔다. 돌려주는 { back, front } 는 kit 의 coil() 과 같다 — back 은 기둥보다 먼저, front 는 기둥 뒤에 그린다.
import { iso, depthOf, pathOf } from "../anatomy/kit/iso-kit.mjs";

export function springZ(cx, cy, radius, from, to, turns, projection, perTurn = 16) {
  const count = Math.max(1, Math.round(turns * perTurn));
  const back = [];
  const front = [];
  let run = [];
  let near = null;
  for (let index = 0; index <= count; index++) {
    const share = index / count;
    const angle = share * turns * Math.PI * 2;
    const flat = iso([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), from + (to - from) * share], projection);
    const facing = depthOf([Math.cos(angle), Math.sin(angle), 0], projection) > 0;
    if (near === null) near = facing;
    if (facing !== near) {
      run.push(flat);
      (near ? front : back).push(pathOf(run));
      run = [flat];
      near = facing;
      continue;
    }
    run.push(flat);
  }
  if (run.length > 1) (near ? front : back).push(pathOf(run));
  return { back: back.join(""), front: front.join("") };
}
