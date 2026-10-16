// 편집기 상태(src/editor/*.ts)를 화면에 붙인다. 짜임은 docs/dev/app-structure.md.
//
// 상태(ref·computed)와 함수는 모듈 최상위에 있어 import 만으로 쓸 수 있다. watch·이벤트·타이머처럼 화면 수명에 묶인 것은
// 모듈마다 setupXxx() 안에 있고, 여기서 나누기 전 App.vue 의 순서 그대로 부른다(같은 때 도는 watch 의 순서가 그 순서다).
import { setupCore } from './core'
import { setupPeople } from './people'
import { setupReadSettings } from './read-settings'
import { setupIdfZones } from './idf-zones'
import { setupEquipmentShape } from './equipment-shape'
import { setupHistory } from './history'
import { setupKeyboard } from './keyboard'
import { setupEditFilter } from './edit-filter'
import { setupScene } from './scene'
import { setupRooms } from './rooms'
import { setupVertical } from './vertical'
import { setupVerticalCreate } from './vertical-create'
import { setupSpaceObjects } from './space-objects'
import { setupGridSnap } from './grid-snap'
import { setupFlowRules } from './flow-rules'
import { setupFlowMap } from './flow-map'
import { setupChecks } from './checks'
import { setupKinds } from './kinds'
import { setupSystems } from './systems'
import { setupChatView } from './chat-view'
import { setupMultiView } from './multi-view'
import { setupViewFilter } from './view-filter'
import { setupContextMenu } from './context-menu'
import { setupLabels } from './labels'
import { setupPlace } from './place'
import { setupSpaceEdit } from './space-edit'
import { setupCeiling } from './ceiling'
import { setupManualDraw } from './manual-draw'
import { setupBackground } from './background'
import { setupOffset } from './offset'
import { setupEquipmentEdit } from './equipment-edit'
import { setupExportCompare } from './export-compare'
import { setupFacade } from './facade'
import { setupConnections } from './connections'
import { setupAutosave } from './autosave'
import { setupLayoutStoreys } from './layout-storeys'
import { setupProjects } from './projects'
import { setupExitEdit } from './exit-edit'
import { setupVersions } from './versions'
import { setupShell } from './shell'
import { setupOpenFile } from './open-file'
import { setupPanels } from './panels'
import { setupOpenMany } from './open-many'
import { setupStoreyProgress } from './storey-progress'
import { setupPublish } from './publish'
import { setupReports } from './reports'

/** App.vue 의 setup 에서 한 번 부른다. */
export function setupEditor() {
  setupCore()
  setupPeople()
  setupReadSettings()
  setupIdfZones()
  setupEquipmentShape()
  setupHistory()
  setupKeyboard()
  setupEditFilter()
  setupScene()
  setupRooms()
  setupVertical()
  setupVerticalCreate()
  setupSpaceObjects()
  setupGridSnap()
  setupFlowRules()
  setupFlowMap()
  setupChecks()
  setupKinds()
  setupSystems()
  setupChatView()
  setupMultiView()
  setupViewFilter()
  setupContextMenu()
  setupLabels()
  setupPlace()
  setupSpaceEdit()
  setupCeiling()
  setupManualDraw()
  setupBackground()
  setupOffset()
  setupEquipmentEdit()
  setupExportCompare()
  setupFacade()
  setupConnections()
  setupAutosave()
  setupLayoutStoreys()
  setupProjects()
  setupExitEdit()
  setupVersions()
  setupOpenFile()
  setupPanels()
  setupOpenMany()
  setupStoreyProgress()
  setupPublish()
  setupReports()
  setupShell()
}
