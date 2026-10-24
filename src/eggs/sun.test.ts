import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { ref } from 'vue'
import * as WebIFC from 'web-ifc'
import { modelToGeoJSON } from '../lib/export/geojson'
import { modelToTTL } from '../lib/export/ttl'
import { compoundAngleToDegrees, importIfc } from '../lib/ifc/import'
import { mergeModels } from '../lib/merge'
import type { Model } from '../lib/model'
import {
  enable,
  formatDayOfYear,
  formatMinutesOfDay,
  maxSolarAltitude,
  resolveSite,
  SEOUL_LAT,
  SEOUL_LON,
  solarPosition,
  sunSceneDirection,
} from './sun'
import type { EggContext, SceneLayer } from './types'

let api: WebIFC.IfcAPI
let mepBytes: Uint8Array
let mepModel: Model

beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
  const path = fileURLToPath(new URL('../lib/ifc/fixtures/mep.ifc', import.meta.url))
  mepBytes = new Uint8Array(readFileSync(path))
  mepModel = importIfc(api, mepBytes)
})

function makeContext(m: Model) {
  const hud = {
    style: { cssText: '' },
    textContent: '',
    ownerDocument: null,
  } as unknown as HTMLElement
  const layers: SceneLayer[] = []
  const lightCalls: { hemi?: number; sun?: number }[] = []
  const ctx: EggContext = {
    model: () => m,
    modelVersion: () => 1,
    addLayer(layer) {
      layers.push(layer)
      return () => {
        layer.dispose?.()
      }
    },
    lights(o) {
      lightCalls.push(o)
      return () => {}
    },
    wide() {},
    still: () => false,
    dark: () => false,
    hud,
    signals: {
      violations: ref(0),
      storeyViolations: ref(new Map()),
      accepted: ref(true),
      flying: ref(false),
      replaying: ref(false),
      storeyId: ref(null),
    },
  }
  return { ctx, hud, layers, lightCalls }
}

describe('S4 해가 지나가는 건물(sun)', () => {
  it('NOAA 해 자리 — 서울 위도(37.5665°N)에서 하루 최고 고도가 하지 75.9° · 동지 29.0° (±0.5°)다', () => {
    const summerMax = maxSolarAltitude(SEOUL_LAT, SEOUL_LON, 172)
    const winterMax = maxSolarAltitude(SEOUL_LAT, SEOUL_LON, 355)
    expect(Math.abs(summerMax - 75.9)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(winterMax - 29.0)).toBeLessThanOrEqual(0.5)

    // 오전(09:00)은 동쪽(0~180°), 오후(15:00)는 서쪽(180~360°), 한밤중(00:00)은 지평선 아래다.
    const morning = solarPosition(SEOUL_LAT, SEOUL_LON, 172, 9 * 60)
    const afternoon = solarPosition(SEOUL_LAT, SEOUL_LON, 172, 15 * 60)
    const midnight = solarPosition(SEOUL_LAT, SEOUL_LON, 172, 0)
    expect(morning.altitudeDeg).toBeGreaterThan(30)
    expect(morning.azimuthDeg).toBeGreaterThan(0)
    expect(morning.azimuthDeg).toBeLessThan(180)
    expect(afternoon.altitudeDeg).toBeGreaterThan(30)
    expect(afternoon.azimuthDeg).toBeGreaterThan(180)
    expect(afternoon.azimuthDeg).toBeLessThan(360)
    expect(midnight.altitudeDeg).toBeLessThan(0)
  })

  it('IfcSite 의 도·분·초·백만분의 일초(IfcCompoundPlaneAngleMeasure)와 TrueNorth 를 읽어 모델에 담는다', () => {
    expect(compoundAngleToDegrees([37, 33, 59, 400_000])).toBeCloseTo(37.5665, 5)
    expect(compoundAngleToDegrees([-33, -51, -54, -0])).toBeCloseTo(-33.865, 5)
    expect(compoundAngleToDegrees(null)).toBeNull()

    const rawText = new TextDecoder('latin1').decode(mepBytes)
    const withCoordsText = rawText
      .replace("#7= IFCDIRECTION((0.,1.));", "#7= IFCDIRECTION((0.6,0.8));")
      .replace(
        "#11= IFCSITE('0MEP$Site$0000000000',$,'Site',$,$,#10,$,$,.ELEMENT.,$,$,$,$,$);",
        "#11= IFCSITE('0MEP$Site$0000000000',$,'Site',$,$,#10,$,$,.ELEMENT.,(37,33,59,400000),(126,58,40,800000),$,$,$);",
      )
    const parsed = importIfc(api, new TextEncoder().encode(withCoordsText))
    // facts.siteLatLong(BIM 요건 R7 의 문구)은 egg 가 바꾸지 않는다. 기본 화면이라서다(G2).
    expect(parsed.facts).toEqual(mepModel.facts)
    expect(parsed.site?.latitude).toBeCloseTo(37.5665, 4)
    expect(parsed.site?.longitude).toBeCloseTo(126.978, 4)
    expect(parsed.site?.trueNorth).toEqual([0.6, 0.8])

    // Revit 2013 이 (0, 1) 을 적는 꼴 `(2., 6.1E-17, 1.)` 은 수평이 아니라 진북으로 읽지 않는다. 읽으면 북이 +x 로 돈다.
    const revit2013 = importIfc(api, new TextEncoder().encode(withCoordsText.replace('#7= IFCDIRECTION((0.6,0.8));', '#7= IFCDIRECTION((2.,6.12303176911189E-17,1.));')))
    expect(revit2013.site?.trueNorth).toBeUndefined()
    expect(revit2013.site?.latitude).toBeCloseTo(37.5665, 4)

    // 두 모델을 합쳐도 대지 좌표와 진북 방향이 보존된다.
    const { model: merged } = mergeModels(mepModel, parsed)
    expect(merged.site?.latitude).toBeCloseTo(37.5665, 4)
    expect(merged.site?.longitude).toBeCloseTo(126.978, 4)
    expect(merged.site?.trueNorth).toEqual([0.6, 0.8])
  })

  it('대지 좌표가 없는 파일은 서울시청(37.5665, 126.9780)과 +y 를 북으로 쓰고 HUD 에 알린다', () => {
    const resolved = resolveSite(mepModel)
    expect(resolved.hasSiteCoords).toBe(false)
    expect(resolved.latitude).toBe(SEOUL_LAT)
    expect(resolved.longitude).toBe(SEOUL_LON)
    expect(resolved.trueNorth).toEqual([0, 1])

    const dirNorth = sunSceneDirection({ east: 0, north: 1, up: 0 }, [0, 1])
    expect(dirNorth.x).toBeCloseTo(0, 5)
    expect(dirNorth.y).toBeCloseTo(0, 5)
    expect(dirNorth.z).toBeCloseTo(-1, 5)

    expect(formatDayOfYear(172)).toBe('6월 21일')
    expect(formatMinutesOfDay(840)).toBe('14:00')
  })

  it('켜고 끈 뒤 모델·TTL·GeoJSON 이 켜기 전과 완전히 같다(G3)', () => {
    const before = {
      ttl: modelToTTL(mepModel),
      geo: JSON.stringify(modelToGeoJSON(mepModel)),
      model: JSON.stringify(mepModel),
    }
    const { ctx, hud, layers, lightCalls } = makeContext(mepModel)
    const handle = enable(ctx)
    const info = handle.inspect?.() as {
      hasSiteCoords: boolean
      latitude: number
      longitude: number
      altitudeDeg: number
    }
    expect(info.hasSiteCoords).toBe(false)
    expect(info.latitude).toBe(SEOUL_LAT)
    expect(info.longitude).toBe(SEOUL_LON)
    expect(info.altitudeDeg).toBeGreaterThan(50)
    expect(lightCalls.length).toBe(1)
    expect(hud.textContent).toContain('이 파일에는 대지 좌표가 없어 서울 기준으로 그렸습니다')
    expect(hud.textContent).toContain('화면에서만')

    handle.off()
    for (const l of layers) l.dispose?.()

    expect(modelToTTL(mepModel)).toBe(before.ttl)
    expect(JSON.stringify(modelToGeoJSON(mepModel))).toBe(before.geo)
    expect(JSON.stringify(mepModel)).toBe(before.model)
  })
})
