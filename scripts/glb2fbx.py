# 에디터가 낸 GLB 를 FBX 로 바꾼다. 서버(src/server/fbx.ts)가 Blender 를 띄워 이 스크립트를 돌린다(ADR-0052).
#
#   blender -b --factory-startup --python-exit-code 1 --python scripts/glb2fbx.py -- in.glb out.fbx
#
# **GLB 를 Blender 의 glTF 임포터로 읽지 않는다.** 임포터는 메시마다 임시 객체를 만들었다 지우는데, 지우는 비용이 객체 수에
# 비례해서 성수(메시 22,285개)에서 읽기만 226초 걸렸다. 우리 GLB 는 모양이 정해져 있어(mesh3d.ts — 노드마다 메시 하나·
# 프리미티브 하나, 삼각형, 재질은 색 하나) numpy 로 직접 읽는다. 성수 전체가 46초(읽기 20 · 쓰기 25)다.
#
# **건물 노드는 FBX 에 넣지 않고 층을 맨 위에 둔다.** Blender FBX 내보내기의 축 굽기(bake_space_transform)가 두 단 아래
# 자식(건물 → 층 → 메시의 메시)에 보정 행렬을 남겨, 메시마다 회전 90°·크기 0.01 이 붙었다. 한 단(층 → 메시)이면 변환이
# 모두 단위 행렬이다. 건물의 id·이름·스키마는 층마다 buildingId·buildingName·schema 속성으로 내린다.
#
# 파일 모양: y 가 위, 미터(UnitScaleFactor 100), 노드 변환은 모두 단위 행렬, 꼭짓점은 GLB 와 같은 값. 객체 이름은 GlobalId 이고
# GLB extras(kind·name·systemId …)는 FBX 사용자 속성으로 남는다. FBX 사용자 속성에는 bool 이 없어 true 가 1 로 읽힌다.
import json
import struct
import sys
import time

import bpy
import numpy as np

DTYPE = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}


def read_glb(path):
    data = open(path, 'rb').read()
    if data[:4] != b'glTF':
        raise ValueError('GLB 가 아닙니다')
    json_len = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + json_len])
    # 둘째 조각(BIN)의 머리 8바이트(길이·종류) 뒤가 버퍼다.
    return gltf, data, 20 + json_len + 8


def accessor(gltf, data, bin_at, index):
    a = gltf['accessors'][index]
    view = gltf['bufferViews'][a['bufferView']]
    width = WIDTH[a['type']]
    dtype = DTYPE[a['componentType']]
    stride = view.get('byteStride')
    if stride and stride != np.dtype(dtype).itemsize * width:
        raise ValueError('섞어 둔(interleaved) 버퍼는 읽지 않습니다')
    at = bin_at + view.get('byteOffset', 0) + a.get('byteOffset', 0)
    out = np.frombuffer(data, dtype=dtype, count=a['count'] * width, offset=at)
    return out.reshape(-1, width) if width > 1 else out


def to_blender(v):
    """glTF(y 위) → Blender(z 위): (x, y, z) → (x, -z, y). FBX 로 쓸 때 axis_up='Y' 가 되돌린다."""
    out = np.empty_like(v)
    out[:, 0] = v[:, 0]
    out[:, 1] = -v[:, 2]
    out[:, 2] = v[:, 1]
    return out


def build(gltf, data, bin_at):
    materials = []
    for i, m in enumerate(gltf.get('materials', [])):
        color = m.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])
        mat = bpy.data.materials.new('m%d' % i)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Alpha'].default_value = color[3]
        bsdf.inputs['Roughness'].default_value = 1
        mat.diffuse_color = color
        materials.append(mat)

    collection = bpy.context.scene.collection

    def make(index, parent, inherited):
        node = gltf['nodes'][index]
        extras = node.get('extras') or {}
        if extras.get('kind') == 'building' and 'mesh' not in node:
            down = {'buildingId': extras.get('id'), 'buildingName': node.get('name'), 'schema': extras.get('schema')}
            for c in node.get('children', []):
                make(c, None, down)
            return
        name = node.get('name') or 'node%d' % index
        mesh = None
        if 'mesh' in node:
            prim = gltf['meshes'][node['mesh']]['primitives'][0]
            if prim.get('mode', 4) != 4:
                raise ValueError('삼각형이 아닌 프리미티브: %s' % name)
            pos = accessor(gltf, data, bin_at, prim['attributes']['POSITION'])
            idx = accessor(gltf, data, bin_at, prim['indices']) if 'indices' in prim else np.arange(len(pos), dtype=np.uint32)
            tri = len(idx) // 3
            mesh = bpy.data.meshes.new(name)
            mesh.vertices.add(len(pos))
            mesh.vertices.foreach_set('co', to_blender(pos).ravel())
            mesh.loops.add(len(idx))
            mesh.loops.foreach_set('vertex_index', idx.astype(np.int32))
            mesh.polygons.add(tri)
            mesh.polygons.foreach_set('loop_start', np.arange(0, 3 * tri, 3, dtype=np.int32))
            mesh.update()
            # BIM 법선을 그대로 둔다. 없으면 면마다 각진 법선이 되어 둥근 덕트·배관이 각져 보인다(성수에서 +12초).
            if 'NORMAL' in prim['attributes']:
                mesh.normals_split_custom_set_from_vertices(to_blender(accessor(gltf, data, bin_at, prim['attributes']['NORMAL'])))
            if 'material' in prim:
                mesh.materials.append(materials[prim['material']])
        ob = bpy.data.objects.new(name, mesh)
        collection.objects.link(ob)
        if parent:
            ob.parent = parent
        for k, v in list(extras.items()) + list(inherited.items()):
            if v is not None:
                ob[k] = v
        for c in node.get('children', []):
            make(c, ob, {})

    for root in gltf['scenes'][gltf.get('scene', 0)]['nodes']:
        make(root, None, {})


def main():
    src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
    started = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build(*read_glb(src))
    read_s = time.time() - started
    bpy.ops.export_scene.fbx(
        filepath=dst,
        use_custom_props=True,
        axis_forward='-Z',
        axis_up='Y',
        # 미터를 FBX 단위(UnitScaleFactor 100)로 적고 노드에는 크기를 남기지 않는다.
        apply_unit_scale=True,
        apply_scale_options='FBX_SCALE_UNITS',
        bake_space_transform=True,
        add_leaf_bones=False,
        bake_anim=False,
    )
    # 서버 로그가 읽는 한 줄. 그 밖의 Blender 출력은 버린다.
    print('GLB2FBX ' + json.dumps({'objects': len(bpy.data.objects), 'readS': round(read_s, 1), 'writeS': round(time.time() - started - read_s, 1)}))


try:
    main()
except Exception as e:
    # 서버가 이 줄을 사용자에게 보인다. 종료 코드는 --python-exit-code 1 이 1 로 만든다.
    print('GLB2FBX-ERROR ' + str(e))
    raise
