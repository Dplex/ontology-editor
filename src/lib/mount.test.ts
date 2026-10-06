import { describe, expect, it } from 'vitest'
import { allowedSurfaces, canMountOn, MOUNT, surfaceOf } from './mount'
import { equipmentKind } from './kinds'

// OE-OBJ-08 설치면. 표는 PRD 가 정한 것이고, 표에 없는 종류는 정하지 않는다.
describe('설치면', () => {
  it('표의 종류는 전부 사전에 있는 종류다(오타로 조용히 빠지지 않게)', () => {
    for (const kind of Object.keys(MOUNT)) expect(equipmentKind(kind), kind).not.toBeNull()
  })

  it('허용 면이 하나면 그 면, 둘 이상이면 모름, 표에 없으면 정하지 않음', () => {
    expect(surfaceOf({ kind: 'air_diffuser' })).toBe('ceiling')
    expect(surfaceOf({ kind: 'ahu' })).toBe('floor')
    expect(surfaceOf({ kind: 'receptacle' })).toBe('wall')
    expect(surfaceOf({ kind: 'camera' })).toBeNull()
    expect(allowedSurfaces('camera')).toEqual(['ceiling', 'wall'])
    expect(allowedSurfaces('chiller')).toBeNull()
    expect(allowedSurfaces(null)).toBeNull()
  })

  it('정하지 않은 종류는 막지 않는다', () => {
    expect(canMountOn({ kind: 'ahu' }, 'ceiling')).toBe(false)
    expect(canMountOn({ kind: 'fcu' }, 'ceiling')).toBe(true)
    expect(canMountOn({ kind: 'chiller' }, 'ceiling')).toBe(true)
    expect(canMountOn({ kind: null }, 'ceiling')).toBe(true)
  })
})
