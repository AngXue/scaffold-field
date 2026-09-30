import { lazy, Suspense, useState } from 'react'
import {
  Box,
  ChevronRight,
  ClipboardCheck,
  Download,
  Layers3,
  Map,
  Menu,
  Save,
  Settings2,
  TriangleAlert,
} from 'lucide-react'
import './App.css'
import { MaterialView } from './components/MaterialView'
import { PlanEditor } from './components/PlanEditor'
import { PIXELS_PER_METER } from './domain/plan'
import { saveTextFile } from './platform/files'
import { exitFullscreenIfActive } from './platform/fullscreen'
import { useAndroidBackButton } from './platform/useAndroidBackButton'
import {
  calculateScaffold,
  countMembers,
  DEFAULT_PARAMETERS,
  type MaterialAdjustments,
  type Point2D,
  type ScaffoldParameters,
} from './domain/scaffold'

type WorkspaceTab = 'plan' | 'model' | 'materials'

const ScaffoldViewer = lazy(() => import('./components/ScaffoldViewer').then((module) => ({
  default: module.ScaffoldViewer,
})))

const INITIAL_POINTS: Point2D[] = [
  { id: 'P1', x: 110, y: 125 },
  { id: 'P2', x: 110 + 7.2 * PIXELS_PER_METER, y: 125 },
  { id: 'P3', x: 110 + 7.2 * PIXELS_PER_METER, y: 125 + 4.8 * PIXELS_PER_METER },
]

const TAB_META = {
  plan: { label: '二维测量', icon: Map },
  model: { label: '三维检查', icon: Box },
  materials: { label: '材料结果', icon: ClipboardCheck },
} as const

function loadStoredProject() {
  try {
    const stored = localStorage.getItem('scaffold-project')
    if (!stored) return null
    const project = JSON.parse(stored) as {
      points: Point2D[]
      lengths: number[]
      parameters: Partial<ScaffoldParameters> & { rowCount?: number }
      adjustments?: MaterialAdjustments
    }
    return {
      ...project,
      adjustments: project.adjustments ?? {},
      parameters: {
        ...DEFAULT_PARAMETERS,
        ...project.parameters,
        deckSupportRailCount: project.parameters.deckSupportRailCount ?? project.parameters.rowCount ?? DEFAULT_PARAMETERS.deckSupportRailCount,
      },
    }
  } catch {
    return null
  }
}

function NumberField({ label, value, unit = 'm', step = 0.1, min = 0.1, max, onChange }: {
  label: string
  value: number
  unit?: string
  step?: number
  min?: number
  max?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="parameter-field">
      <span>{label}</span>
      <span className="number-input">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, Number(event.target.value))))}
        />
        <b>{unit}</b>
      </span>
    </label>
  )
}

function App() {
  const [initialProject] = useState(loadStoredProject)
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('plan')
  const [points, setPoints] = useState<Point2D[]>(initialProject?.points ?? INITIAL_POINTS)
  const [lengths, setLengths] = useState(initialProject?.lengths ?? [7.2, 4.8])
  const [parameters, setParameters] = useState<ScaffoldParameters>(initialProject?.parameters ?? DEFAULT_PARAMETERS)
  const [adjustments, setAdjustments] = useState<MaterialAdjustments>(initialProject?.adjustments ?? {})
  const [saved, setSaved] = useState(false)

  // Android back: leave fullscreen, then walk back to the first tab, then let Android close the app.
  useAndroidBackButton(() => {
    if (exitFullscreenIfActive()) return true
    if (activeTab !== 'plan') {
      setActiveTab('plan')
      return true
    }
    return false
  })

  const layout = calculateScaffold(points, lengths, parameters)
  const counts = countMembers(layout)

  const updateParameter = (key: keyof ScaffoldParameters, value: number) => {
    setParameters({ ...parameters, [key]: value })
    setSaved(false)
  }

  /** Manual correction on top of a calculated quantity, stored as a delta. */
  const adjustMaterial = (key: string, delta: number) => {
    setAdjustments((current) => ({ ...current, [key]: (current[key] ?? 0) + delta }))
    setSaved(false)
  }

  const resetMaterial = (key: string) => {
    setAdjustments((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    setSaved(false)
  }

  const saveProject = () => {
    localStorage.setItem('scaffold-project', JSON.stringify({ points, lengths, parameters, adjustments }))
    setSaved(true)
  }

  const exportProject = async () => {
    const project = { version: '0.4', points, lengths, parameters, adjustments, layout }
    try {
      await saveTextFile({
        fileName: '青岚别墅-脚手架项目.json',
        mimeType: 'application/json',
        contents: JSON.stringify(project, null, 2),
        title: '导出脚手架项目数据',
      })
    } catch (error) {
      window.alert(`导出失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <div className="app-shell">
      {/* One bar: brand, the workflow tabs and the project actions used to be a
          68px topbar plus a 56px tab strip. The project name was dropped with it. */}
      <header className="topbar">
        <div className="brand-block">
          <button className="icon-button mobile-menu" type="button" title="打开菜单"><Menu size={20} /></button>
          <div className="brand-mark"><Layers3 size={24} strokeWidth={1.8} /></div>
          <div className="brand-text"><strong>架算</strong><span>SCAFFOLD FIELD</span></div>
        </div>

        <nav className="workflow-tabs" aria-label="项目流程">
          {(Object.entries(TAB_META) as Array<[WorkspaceTab, typeof TAB_META[WorkspaceTab]]>).map(([key, tab], index) => {
            const Icon = tab.icon
            return (
              <div className="workflow-step-wrap" key={key}>
                <button className={activeTab === key ? 'workflow-step active' : 'workflow-step'} type="button" onClick={() => setActiveTab(key)}>
                  <span>{index + 1}</span><Icon size={18} /> {tab.label}
                </button>
                {index < 2 && <ChevronRight className="workflow-arrow" size={17} />}
              </div>
            )
          })}
        </nav>

        <div className="topbar-actions">
          <span className={saved ? 'save-state saved' : 'save-state'}>{saved ? '已保存到本机' : '有未保存更改'}</span>
          <button className="secondary-button" type="button" onClick={saveProject}><Save size={17} /> 保存</button>
          <button className="icon-button" type="button" onClick={() => { void exportProject() }} title="导出项目数据"><Download size={19} /></button>
        </div>
      </header>

      <main className="workspace">
        <section className="work-surface">
          {activeTab === 'plan' && (
            <PlanEditor
              points={points}
              lengths={lengths}
              onPointsChange={(next) => { setPoints(next); setSaved(false) }}
              onLengthsChange={(next) => { setLengths(next); setSaved(false) }}
            />
          )}
          {activeTab === 'model' && (
            <Suspense fallback={<div className="viewer-loading">正在加载三维引擎…</div>}>
              <ScaffoldViewer layout={layout} />
            </Suspense>
          )}
          {activeTab === 'materials' && (
            <MaterialView
              layout={layout}
              adjustments={adjustments}
              onAdjust={adjustMaterial}
              onResetAdjustment={resetMaterial}
            />
          )}
        </section>

        <aside className="inspector">
          <div className="inspector-heading"><Settings2 size={18} /><strong>脚手架参数</strong><span>住宅模板</span></div>
          <div className="parameter-section">
            <h2>几何参数</h2>
            <div className="parameter-grid">
              <NumberField label="搭设高度" value={parameters.height} onChange={(value) => updateParameter('height', value)} />
              <NumberField label="脚手架宽度" value={parameters.width} onChange={(value) => updateParameter('width', value)} />
              <NumberField label="钢笆纵向杆数" value={parameters.deckSupportRailCount} unit="根" step={1} min={2} max={4} onChange={(value) => updateParameter('deckSupportRailCount', Math.round(value))} />
              <NumberField label="立杆纵距" value={parameters.postSpacing} onChange={(value) => updateParameter('postSpacing', value)} />
              <NumberField label="步距" value={parameters.liftHeight} onChange={(value) => updateParameter('liftHeight', value)} />
              <NumberField label="扫地杆高度" value={parameters.sweepBarHeight} step={0.05} min={0} max={0.5} onChange={(value) => updateParameter('sweepBarHeight', value)} />
              <NumberField label="管端外伸" value={parameters.tubeEndExtension} step={0.05} min={0} max={0.5} onChange={(value) => updateParameter('tubeEndExtension', value)} />
              <NumberField label="立杆顶端外伸" value={parameters.postTopExtension} step={0.1} min={0} max={2} onChange={(value) => updateParameter('postTopExtension', value)} />
              {/* 对接扣件 butts two tubes, so the joint consumes no length; raise
                  this past 1 m and the connection becomes a 搭接, which needs
                  旋转扣件 and is flagged as not modelled. */}
              <NumberField label="搭接长度" value={parameters.spliceOverlap} step={0.1} min={0} max={1.5} onChange={(value) => updateParameter('spliceOverlap', value)} />
              <NumberField label="钢笆铺设间隔" value={parameters.deckLiftInterval} unit="层" step={1} min={1} max={6} onChange={(value) => updateParameter('deckLiftInterval', Math.round(value))} />
              {/* JGJ 130-2011 §7.3.12 mandates the outer row only; 2 is the common
                  site rule and is required when the inner face is open. */}
              <NumberField label="防护栏杆侧数" value={parameters.guardrailSides} unit="侧" step={1} min={0} max={2} onChange={(value) => updateParameter('guardrailSides', Math.round(value))} />
            </div>
            <p className="stock-spec-note">库存钢管规格：{parameters.stockLengths.join(' / ')} m</p>
          </div>

          <div className="live-summary">
            <div className="summary-title"><span>实时估算</span><small>{layout.pipeSegments.length} 根标准管</small></div>
            <div className="summary-grid">
              <div><span>立杆</span><strong>{counts.post}</strong></div>
              <div><span>水平杆</span><strong>{counts.longitudinal}</strong></div>
              <div><span>横向杆</span><strong>{counts.transverse}</strong></div>
              <div><span>防护栏杆</span><strong>{counts.guardrail}</strong></div>
            </div>
            <div className="utilization-row"><span>钢管利用率</span><strong>{layout.materials.utilization}%</strong></div>
            <div className="utilization-track"><i style={{ width: `${layout.materials.utilization}%` }} /></div>
          </div>

          {layout.warnings.length > 0 && (
            <div className="warning-box"><TriangleAlert size={18} /><span>{layout.warnings[0].message}</span></div>
          )}

          <button className="primary-button" type="button" onClick={() => setActiveTab('model')}>
            <Box size={19} /> 计算并生成 3D <ChevronRight size={18} />
          </button>
          <p className="scope-note">结果用于现场材料估算，不替代结构安全验算。</p>
        </aside>
      </main>
    </div>
  )
}

export default App
