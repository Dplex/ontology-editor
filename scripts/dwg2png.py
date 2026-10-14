# 준공 도면 DWG 를 평면도 배경 PNG 로 바꾼다(OE-MAN-02). 서버(src/server/dwg.ts)가 이 스크립트를 돌린다.
#
#   python3 scripts/dwg2png.py in.dwg out.png      바꾼다. 마지막 줄에 DWG2PNG {...} 로 크기·범위·단위를 찍는다
#   python3 scripts/dwg2png.py --probe             쓸 수 있는지만 본다. DWG2PNG-PROBE {...} 를 찍는다
#
# **DWG 는 LibreDWG 의 dwg2dxf 로 DXF 로 바꾸고, DXF 는 ezdxf 로 그린다.** 브라우저에는 DWG 를 읽는 것이 없다. LibreDWG 에는
# dwg2SVG 도 있지만 그림 범위를 엉뚱하게 잡아(샘플 example_2018.dwg 가 빈 화면) 쓰지 않는다. ezdxf 는 DXF 의 블록·글자·해치까지
# 그리고 범위(extents)를 그린 것에서 다시 잰다.
#
# 찍는 값: 그림의 픽셀 크기(width·height), 그 그림이 덮는 도면 좌표 범위(extents, 도면 단위), 도면 단위($INSUNITS → unit, m 로 몇인지
# metersPerUnit). 화면은 단위를 알면 1 픽셀이 몇 m 인지로 처음 축척을 맞춘다. 단위를 모르면 사람이 두 점으로 맞춘다.
#
# 실행 파일은 환경변수로 바꾼다: DWG2DXF(기본 PATH 의 dwg2dxf).
import json
import os
import subprocess
import sys
import tempfile

# $INSUNITS 코드 → (이름, m 로 몇). AutoCAD 의 단위 표 중 도면에 나오는 것만. 0 은 단위 없음이다.
UNITS = {1: ('in', 0.0254), 2: ('ft', 0.3048), 4: ('mm', 0.001), 5: ('cm', 0.01), 6: ('m', 1.0), 14: ('dm', 0.1)}
# 긴 변의 픽셀. 50m 건물이면 1 픽셀이 약 1.2cm 다. 더 키우면 PNG 가 수십 MB 가 된다.
LONG_SIDE = 4096
DWG2DXF = os.environ.get('DWG2DXF', 'dwg2dxf')


def fail(message):
    print(f'DWG2PNG-ERROR {message}', flush=True)
    sys.exit(1)


def probe():
    try:
        import ezdxf  # noqa: F401
        import matplotlib  # noqa: F401
    except ImportError as e:
        fail(f'파이썬 모듈이 없습니다({e.name}). ezdxf·matplotlib 을 설치합니다')
    try:
        out = subprocess.run([DWG2DXF, '--version'], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as e:
        fail(f'dwg2dxf 를 실행하지 못했습니다({DWG2DXF}: {e}). DWG2DXF 환경변수로 경로를 줍니다')
    version = (out.stdout or out.stderr).strip().splitlines()[0] if (out.stdout or out.stderr).strip() else 'unknown'
    print('DWG2PNG-PROBE ' + json.dumps({'ezdxf': ezdxf.__version__, 'libredwg': version}), flush=True)


def insunits(dxf):
    """DXF 머리의 $INSUNITS(도면 단위 코드). 머리를 글자로 읽는다 — ezdxf 가 그 DXF 를 못 읽어도 단위는 안다. 없으면 0(단위 없음)."""
    with open(dxf, encoding='utf-8', errors='replace') as f:
        lines = [line.strip() for _, line in zip(range(200000), f)]
    for i, line in enumerate(lines[:-2]):
        if line == '$INSUNITS':
            try:
                return int(lines[i + 2])
            except ValueError:
                return 0
        if line == 'ENDSEC':
            break
    return 0


def drawing_range(msp, bbox):
    """
    그릴 범위(도면 좌표). 개체마다 범위를 재서 중심의 2~98% 안을 잡고 5% 여백을 둔다. 도면 전체 범위를 그대로 쓰면 멀리 떨어진 선 하나에
    범위가 끌려가 도면이 점이 된다(LibreDWG 샘플 example_2018.dwg 는 범위가 3,400km 다). 범위 밖으로 걸친 개체는 잘린다.
    """
    centers = []
    for e in msp:
        box = bbox.extents([e], fast=True)
        if box.has_data:
            centers.append(((box.extmin.x + box.extmax.x) / 2, (box.extmin.y + box.extmax.y) / 2, box))
    if not centers:
        fail('모델 공간에 그릴 것이 없습니다')
    xs = sorted(c[0] for c in centers)
    ys = sorted(c[1] for c in centers)
    cut = lambda v, q: v[min(len(v) - 1, max(0, round(q * (len(v) - 1))))]
    lo_x, hi_x, lo_y, hi_y = cut(xs, 0.02), cut(xs, 0.98), cut(ys, 0.02), cut(ys, 0.98)
    # 남긴 개체의 실제 범위(중심만이 아니라 끝까지).
    kept = [c[2] for c in centers if lo_x <= c[0] <= hi_x and lo_y <= c[1] <= hi_y]
    x0 = min(b.extmin.x for b in kept)
    y0 = min(b.extmin.y for b in kept)
    x1 = max(b.extmax.x for b in kept)
    y1 = max(b.extmax.y for b in kept)
    # 한쪽이 거의 0 이면(선 하나뿐인 도면) 다른 쪽의 1% 로 둔다. 그림이 1 픽셀 폭이 되지 않게.
    side = max(x1 - x0, y1 - y0, 1e-6)
    pad_x = max((x1 - x0) * 0.05, side * 0.01)
    pad_y = max((y1 - y0) * 0.05, side * 0.01)
    return x0 - pad_x, y0 - pad_y, x1 + pad_x, y1 + pad_y


def convert(src, dst):
    import ezdxf
    from ezdxf import recover
    from ezdxf.addons.drawing import Frontend, RenderContext
    from ezdxf.addons.drawing.config import BackgroundPolicy, ColorPolicy, Configuration
    from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
    from ezdxf import bbox
    import matplotlib

    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    with tempfile.TemporaryDirectory() as tmp:
        dxf = os.path.join(tmp, 'in.dxf')
        r = subprocess.run([DWG2DXF, '-y', '-o', dxf, src], capture_output=True, text=True, timeout=600)
        if not os.path.exists(dxf) or os.path.getsize(dxf) == 0:
            tail = ' '.join((r.stderr or r.stdout).strip().splitlines()[-2:])
            fail(f'DWG 를 읽지 못했습니다(dwg2dxf {r.returncode}{": " + tail if tail else ""})')
        code = insunits(dxf)
        minimal = False
        try:
            doc, _ = recover.readfile(dxf)
        except Exception:
            # LibreDWG 가 핸들이 겹치는 DXF 를 쓰는 도면이 있다(LibreDWG 로 쓴 DWG 가 그랬다). 개체만 담은 최소 DXF 로 다시 그린다 — 블록 정의가
            # 빠져 블록으로 넣은 기호(문·가구)는 안 그려진다. 단위는 위에서 전체 DXF 머리로 읽었다.
            small = os.path.join(tmp, 'min.dxf')
            subprocess.run([DWG2DXF, '-y', '-m', '-o', small, src], capture_output=True, text=True, timeout=600)
            try:
                doc, _ = recover.readfile(small)
            except Exception as e:
                fail(f'DXF 로 바꾼 도면을 읽지 못했습니다({type(e).__name__}: {e})')
            minimal = True

    msp = doc.modelspace()
    x0, y0, x1, y1 = drawing_range(msp, bbox)
    w, h = x1 - x0, y1 - y0
    scale = LONG_SIDE / max(w, h)
    width, height = max(1, round(w * scale)), max(1, round(h * scale))

    fig = plt.figure(figsize=(width / 100, height / 100), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_axis_off()
    # 배경은 흰색, 선은 검정 — 3D 바닥에 깔아 반투명으로 겹쳐 보이는 도면이라 색보다 대비가 중요하다.
    # 선은 4096px 그림에서 3~4px 이상으로 둔다(min_lineweight 는 1/300 인치, 그림은 100dpi). 도면 선 굵기 그대로면 1px 아래라 흐려서, 반투명으로 깐 바닥에서 안 보였다.
    config = Configuration(background_policy=BackgroundPolicy.WHITE, color_policy=ColorPolicy.BLACK, min_lineweight=10)
    Frontend(RenderContext(doc), MatplotlibBackend(ax), config=config).draw_layout(msp, finalize=True)
    # ezdxf 의 마무리(finalize)가 그림 크기와 축 범위를 도면 전체에 맞춰 바꾼다. 우리가 정한 범위·픽셀로 되돌린다 — 머리에 적는 크기와 PNG 가 같아야
    # 화면이 축척을 맞는 값으로 잡는다.
    fig.set_size_inches(width / 100, height / 100)
    ax.set_position([0, 0, 1, 1])
    ax.set_xlim(x0, x1)
    ax.set_ylim(y0, y1)
    ax.set_aspect('auto')
    fig.savefig(dst, dpi=100, facecolor='white')
    from PIL import Image
    with Image.open(dst) as im:
        if im.size != (width, height):
            fail(f'그림 크기가 어긋났습니다({im.size} ≠ {(width, height)})')
    plt.close(fig)

    unit, meters = UNITS.get(code, (None, None))
    stats = {'width': width, 'height': height, 'extents': [x0, y0, x1, y1], 'unit': unit, 'metersPerUnit': meters, 'minimal': minimal}
    print('DWG2PNG ' + json.dumps(stats), flush=True)


if __name__ == '__main__':
    args = sys.argv[1:]
    if args == ['--probe']:
        probe()
    elif len(args) == 2:
        convert(args[0], args[1])
    else:
        fail('쓰는 법: dwg2png.py in.dwg out.png | --probe')
