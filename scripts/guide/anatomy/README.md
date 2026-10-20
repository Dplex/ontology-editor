# anatomy kit (vendored)

사용 가이드의 원리 그림(`scripts/guide/figures/*`)을 그리는 아이소메트릭 SVG 도구다.
<https://github.com/wheresryan22/anatomy> 의 `1482e84` 에서 `kit/` 중 그림이 쓰는 네 파일(`iso-kit` · `lathe` · `tube` · `audit`)과
`scripts/inline-kit.mjs` 만 가져왔다. 3D·WebGL 쪽은 쓰지 않아 뺐다. 라이선스는 MIT 이고 원문이 `LICENSE` 에 있다.

- 파일은 원본 그대로 둔다. 판을 올릴 때 같은 자리에 다시 받으면 되게 하려는 것이다.
- `inline-kit.mjs` 는 `kitScript()` 만 쓴다. 나머지 함수는 뺀 파일을 읽으려 해서 부르면 실패한다.
- 그림 검증 스크립트(`capture.mjs`·`lines.mjs`·`drive.mjs`)는 원본 저장소에 있다. 그림을 고치면 원본을 받아 그쪽 스크립트로
  선 끝 검사(`line ends: 0`)를 돌리고, 흐름 그림은 `node scripts/guide/figures/flow/build.mjs --audit` 까지 본다.
