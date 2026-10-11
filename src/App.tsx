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
import { NumberField } from './components/NumberField'
import { OptionField } from './components/OptionField'
import { PlanEditor } from './components/PlanEditor'
import { PIXELS_PER_METER } from './domain/plan'
import { saveTextFile } from './platform/files'
import { exitFullscreenIfActive } from './platform/fullscreen'
import { useAndroidBackButton } from './platform/useAndroidBackButton'
import {
  calculateScaffold,
  countMembers,
  DECK_PANEL_ROW_GAP,
  DECK_PANEL_SIZES,
  DEFAULT_PARAMETERS,
  TOP_POST_EXTENSION,
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
      parameters: Partial<ScaffoldParameters> & { rowCount?: number; height?: number; guardrailSides?: number }
      adjustments?: MaterialAdjustments
    }
    // `height` and `guardrailSides` are dropped on the way in: the migration below
    // turns the height into a 作业层 count, and the sides parameter is gone (rails are
    // always on the 外排). A stale copy would only confuse the domain merge.
    const storedParameters = { ...project.parameters }
    const legacyHeight = storedParameters.height
    delete storedParameters.height
    delete storedParameters.guardrailSides
    // A project saved before `layerCount` carried a continuous 搭设高度: keep the
    // 作业层 it stood for rather than silently resetting it to the default.
    const layerCount = storedParameters.layerCount ?? (legacyHeight === undefined
      ? DEFAULT_PARAMETERS.layerCount
      : Math.max(1, Math.round(
        (legacyHeight - TOP_POST_EXTENSION) / (storedParameters.liftHeight ?? DEFAULT_PARAMETERS.liftHeight),
      )))
    return {
      ...project,
      adjustments: project.adjustments ?? {},
      parameters: {
        ...DEFAULT_PARAMETERS,
        ...storedParameters,
        layerCount,
        deckSupportRailCount: storedParameters.deckSupportRailCount ?? storedParameters.rowCount ?? DEFAULT_PARAMETERS.deckSupportRailCount,
      },
    }
  } catch {
    return null
  }
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

  /**
   * The settings every consumer actually reads. State can carry an object that
   * predates a field — an older saved project, or a hot reload that kept the previous
   * state — and a field with no default would then render as unusable. Merging once
   * here means the panel, the calculation and the export always see a complete set.
   */
  const settings: ScaffoldParameters = { ...DEFAULT_PARAMETERS, ...parameters }

  const layout = calculateScaffold(points, lengths, settings)
  const counts = countMembers(layout)

  const updateParameter = <K extends keyof ScaffoldParameters>(key: K, value: ScaffoldParameters[K]) => {
    setParameters({ ...settings, [key]: value })
    setSaved(false)
  }

  /**
   * 排距 follows the chosen 钢笆片 width — the panel spans the two rows with 0.05 m to
   * spare — so `width` is written at the same time. It stays editable afterwards.
   */
  const chooseDeckPanelWidth = (deckPanelWidth: number) => {
    setParameters({
      ...settings,
      deckPanelWidth,
      width: Number((deckPanelWidth - DECK_PANEL_ROW_GAP).toFixed(2)),
    })
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
    localStorage.setItem('scaffold-project', JSON.stringify({ points, lengths, parameters: settings, adjustments }))
    setSaved(true)
  }

  const exportProject = async () => {
    const project = { version: '0.5', points, lengths, parameters: settings, adjustments, layout }
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
            {/* The four that carry most of the estimate stay in the open; the rest
                are refinements a user only reaches for deliberately. */}
            {/* 作业层数 is the one height input: every elevation follows from it, so
                the scaffold grows in whole 步距 instead of stretching to a height. */}
            <div className="parameter-grid">
              <NumberField label="作业层数" value={settings.layerCount} unit="层" step={1} min={1} max={20} onChange={(value) => updateParameter('layerCount', Math.round(value))} />
              <NumberField label="钢笆纵向杆数" value={settings.deckSupportRailCount} unit="根" step={1} min={2} max={4} onChange={(value) => updateParameter('deckSupportRailCount', Math.round(value))} />
              <NumberField label="扫地杆高度" value={settings.sweepBarHeight} step={0.05} min={0} max={0.5} onChange={(value) => updateParameter('sweepBarHeight', value)} />
              {/* §7.3.12(2)(4) gives 上栏杆 + 中栏杆, but a site that only builds the
                  上栏杆 has to be able to say so rather than have the 中栏杆 counted
                  for it. */}
              <NumberField label="栏杆根数" value={settings.guardrailRailCount} unit="根" step={1} min={1} max={2} onChange={(value) => updateParameter('guardrailRailCount', Math.round(value))} />
              {/* Which side of the drawn path faces the building. The 外排 — the railed,
                  taller row — is the other one. */}
              <OptionField
                label="内侧位置"
                value={settings.swapInnerOuter ? 'offset' : 'path'}
                options={[{ value: 'path', label: '路径侧' }, { value: 'offset', label: '偏移侧' }]}
                onChange={(value) => updateParameter('swapInnerOuter', value === 'offset')}
              />
            </div>

            <details className="parameter-more">
              <summary>更多参数</summary>
              <div className="parameter-grid">
                <NumberField label="脚手架宽度" value={settings.width} onChange={(value) => updateParameter('width', value)} />
                <NumberField label="立杆纵距" value={settings.postSpacing} onChange={(value) => updateParameter('postSpacing', value)} />
                <NumberField label="步距" value={settings.liftHeight} onChange={(value) => updateParameter('liftHeight', value)} />
                {/* The 排距 follows the panel width (chosen below), and stays editable. */}
                <NumberField label="管端外伸" value={settings.tubeEndExtension} step={0.05} min={0} max={0.5} onChange={(value) => updateParameter('tubeEndExtension', value)} />
                {/* 对接扣件 butts two tubes, so the joint consumes no length; raise
                    this past 1 m and the connection becomes a 搭接, which needs
                    旋转扣件 and is flagged as not modelled. */}
                <NumberField label="搭接长度" value={settings.spliceOverlap} step={0.1} min={0} max={1.5} onChange={(value) => updateParameter('spliceOverlap', value)} />
                <NumberField label="钢笆铺设间隔" value={settings.deckLiftInterval} unit="层" step={1} min={1} max={6} onChange={(value) => updateParameter('deckLiftInterval', Math.round(value))} />
                <OptionField
                  label="钢笆片长度"
                  value={settings.deckPanelLength}
                  options={DECK_PANEL_SIZES.lengths.map((length) => ({ value: length, label: `${length} m` }))}
                  onChange={(value) => updateParameter('deckPanelLength', value)}
                />
                <OptionField
                  label="钢笆片宽度"
                  value={settings.deckPanelWidth}
                  options={DECK_PANEL_SIZES.widths.map((width) => ({ value: width, label: `${width} m` }))}
                  onChange={chooseDeckPanelWidth}
                />
              </div>
              <p className="stock-spec-note">库存钢管规格：{settings.stockLengths.join(' / ')} m</p>
            </details>
          </div>

          <div className="live-summary">
            <div className="summary-title"><span>实时估算</span><small>{layout.pipeSegments.length} 根标准管</small></div>
            <div className="summary-grid">
              <div><span>立杆</span><strong>{counts.post}</strong></div>
              <div><span>水平杆</span><strong>{counts.longitudinal}</strong></div>
              <div><span>横向杆</span><strong>{counts.transverse}</strong></div>
              <div><span>防护栏杆</span><strong>{counts.guardrail}</strong></div>
            </div>
            {/* The height model in one line: the user sets 作业层数, everything else is
                derived, and the two 立杆 rows come out different lengths. */}
            <div className="utilization-row"><span>理论搭设高度</span><strong>{layout.materials.postHeights.theoretical} m</strong></div>
            <div className="utilization-row">
              <span>立杆 内 / 外</span>
              <strong>{layout.materials.postHeights.inner} / {layout.materials.postHeights.outer} m</strong>
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
