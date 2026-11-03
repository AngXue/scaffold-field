import { lazy, Suspense, useMemo, useState } from 'react'
import {
  Box,
  ChevronRight,
  ClipboardCheck,
  Download,
  BookmarkPlus,
  History,
  Layers3,
  Map,
  Save,
  Settings2,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import './App.css'
import { MaterialView } from './components/MaterialView'
import { NumberField } from './components/NumberField'
import { OptionField } from './components/OptionField'
import { SiteEditor } from './components/SiteEditor'
import { measureDrawing, type PlanSegment } from './domain/plan'
import { calculateSite, EMPTY_SITE, legacySiteDrawing, legacySnapshot, readSite, siteFromSnapshot, siteWithTargetLayers, type Site } from './domain/site'
import type { SiteDemo } from './domain/siteDemos'
import { restoreParameters } from './domain/project'
import {
  addHistoryRecord,
  formatHistoryTime,
  HISTORY_KEY,
  HISTORY_LIMIT,
  parseHistory,
  removeHistoryRecord,
  serialiseHistory,
  type HistoryRecord,
  type HistorySnapshot,
} from './domain/history'
import { saveTextFile } from './platform/files'
import { exitFullscreenIfActive } from './platform/fullscreen'
import { useAndroidBackButton } from './platform/useAndroidBackButton'
import {
  calculateScaffoldPlan,
  countMembers,
  DECK_PANEL_ROW_GAP,
  DECK_PANEL_SIZES,
  DEFAULT_PARAMETERS,
  type MaterialAdjustments,
  type Point2D,
  type ScaffoldParameters,
} from './domain/scaffold'

type WorkspaceTab = 'plan' | 'model' | 'materials'

const ScaffoldViewer = lazy(() => import('./components/ScaffoldViewer').then((module) => ({
  default: module.ScaffoldViewer,
})))

const PROJECT_KEY = 'scaffold-project'
const DEFAULT_DEMO_KEY = 'scaffold-default-demo'
const siteKey = (key: string) => key + '.v07'
type StoredProject = { scene: Site; parameters: ScaffoldParameters; adjustments: MaterialAdjustments }

function loadProject(key: string): StoredProject | null {
  try {
    const raw = localStorage.getItem(siteKey(key)) ?? localStorage.getItem(key)
    if (!raw) return null
    const snapshot = JSON.parse(raw) as { scene?: unknown; points?: Point2D[]; segments?: PlanSegment[];
      parameters?: Partial<ScaffoldParameters>; adjustments?: MaterialAdjustments }
    const parameters = restoreParameters(snapshot.parameters)
    const scene = snapshot.scene === undefined && Array.isArray(snapshot.points)
      ? siteFromSnapshot({ ...snapshot, scene: undefined, parameters })
      : readSite(snapshot.scene)
    return scene ? { scene, parameters, adjustments: snapshot.adjustments ?? {} } : null
  } catch { return null }
}

const TAB_META = {
  plan: { label: '三维绘图', icon: Map },
  model: { label: '三维检查', icon: Box },
  materials: { label: '材料结果', icon: ClipboardCheck },
} as const

function loadHistory(): HistoryRecord[] {
  try { return parseHistory(localStorage.getItem(siteKey(HISTORY_KEY)) ?? localStorage.getItem(HISTORY_KEY)) }
  catch { return [] }
}

function App() {
  const [initialProject] = useState(() => loadProject(PROJECT_KEY))
  const [defaultDemo, setDefaultDemo] = useState<StoredProject>(() => loadProject(DEFAULT_DEMO_KEY)
    ?? { scene: EMPTY_SITE, parameters: DEFAULT_PARAMETERS, adjustments: {} })
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('plan')
  const [site, setSite] = useState(() => initialProject?.scene ?? defaultDemo.scene)
  const [editorRevision, setEditorRevision] = useState(0)
  const [parameters, setParameters] = useState(() => initialProject?.parameters ?? defaultDemo.parameters)
  const [adjustments, setAdjustments] = useState<MaterialAdjustments>(initialProject?.adjustments ?? {})
  const [saved, setSaved] = useState(false)
  const [history, setHistory] = useState(loadHistory)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Android back: leave fullscreen, then walk back to the first tab, then let Android close the app.
  useAndroidBackButton(() => {
    if (historyOpen) {
      setHistoryOpen(false)
      return true
    }
    if (settingsOpen) { setSettingsOpen(false); return true }
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
  const settings = useMemo(() => ({ ...DEFAULT_PARAMETERS, ...parameters }), [parameters])

  const layout = useMemo(() => calculateSite(site, settings), [site, settings])
  const legacy = useMemo(() => site.blocks.length ? undefined : legacySiteDrawing(siteWithTargetLayers(site, settings, [])), [site, settings])
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

  /** Make the drawing and settings on screen the example the app starts from. */
  const saveAsDefaultDemo = () => {
    const demo = { version: '0.7', scene: site, parameters: settings, adjustments: {} }
    try {
      localStorage.setItem(siteKey(DEFAULT_DEMO_KEY), JSON.stringify(demo))
      setDefaultDemo(demo)
      window.alert('已设为默认示例：以后打开应用或点「恢复默认图纸」都会回到这张图。')
    } catch (error) {
      window.alert(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const loadIntoEditor = (next: StoredProject) => {
    setSite(next.scene)
    setParameters(next.parameters)
    setAdjustments(next.adjustments)
    setSaved(false)
    setEditorRevision(value => value + 1)
    setActiveTab('plan')
  }

  const resetToDefaultDemo = () => loadIntoEditor(defaultDemo)
  const loadDemo = (demo: SiteDemo) => loadIntoEditor({ scene: demo.site, parameters: demo.parameters, adjustments: {} })

  const currentSnapshot = (): HistorySnapshot => ({ ...legacySnapshot(site), scene: site, parameters: settings, adjustments })

  const persistHistory = (next: HistoryRecord[]) => {
    setHistory(next)
    try {
      localStorage.setItem(siteKey(HISTORY_KEY), serialiseHistory(next))
    } catch (error) {
      window.alert(`历史记录写入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const saveToHistory = () => {
    const next = addHistoryRecord(history, currentSnapshot())
    if (next === history) {
      window.alert('当前图纸与参数和最新一条记录相同，未重复添加。')
      return
    }
    persistHistory(next)
  }

  const applyHistoryRecord = (record: HistoryRecord) => {
    loadIntoEditor({ scene: siteFromSnapshot(record), parameters: restoreParameters(record.parameters), adjustments: record.adjustments ?? {} })
    setHistoryOpen(false)
  }

  const deleteHistoryRecord = (id: string) => {
    persistHistory(removeHistoryRecord(history, id))
  }

  const saveProject = () => {
    try {
      localStorage.setItem(siteKey(PROJECT_KEY), JSON.stringify({ version: '0.7', scene: site, parameters: settings, adjustments }))
      persistHistory(addHistoryRecord(history, currentSnapshot()))
      setSaved(true)
    } catch (error) {
      window.alert(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const exportProject = async (oa = false) => {
    if (oa && (!legacy || !layout.canExportMaterials)) return
    const project = oa && legacy ? (() => {
      const lengths = measureDrawing(legacy.drawing)
      const parameters = { ...settings, layerCount: legacy.layers ?? settings.layerCount }
      return { version: '0.6', ...legacy.drawing, lengths, parameters, adjustments, layout: calculateScaffoldPlan(legacy.drawing, parameters) }
    })() : { version: '0.7', scene: site, parameters: settings, adjustments, ...(layout.canExportMaterials ? { layout } : {}) }
    try {
      await saveTextFile({
        fileName: oa ? '架算-OA兼容项目.json' : '架算-场景项目.json',
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
          <button className="icon-button settings-toggle" type="button" title="脚手架参数" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(open => !open)}><Settings2 size={19} /></button>
          <span className={saved ? 'save-state saved' : 'save-state'}>{saved ? '已保存到本机' : '有未保存更改'}</span>
          <button className="secondary-button" type="button" onClick={saveProject}><Save size={17} /> 保存</button>
          <button className="icon-button history-toggle" type="button" onClick={() => setHistoryOpen((open) => !open)} title="历史记录">
            <History size={19} />
            {history.length > 0 && <span className="history-badge">{history.length}</span>}
          </button>
          <button className="icon-button" type="button" onClick={saveAsDefaultDemo} title="把当前图纸与参数设为默认示例"><BookmarkPlus size={19} /></button>
          <details className="site-export-menu">
            <summary className="icon-button" aria-label="导出项目数据" title="导出项目数据"><Download size={19} /></summary>
            <div><button className="site-action" type="button" onClick={() => { void exportProject() }}>导出场景 JSON 0.7</button>
              <button className="site-action" type="button" disabled={!legacy || !layout.canExportMaterials} onClick={() => { void exportProject(true) }}>导出 OA 兼容 JSON 0.6</button>
              {!legacy && <small>有体块、辅助线或分段层数时须使用 0.7。</small>}
            </div>
          </details>
        </div>
        {historyOpen && (
          <>
            <button className="history-backdrop" type="button" aria-label="关闭历史记录" onClick={() => setHistoryOpen(false)} />
            <section className="history-panel" aria-label="历史记录">
              <header>
                <strong>历史记录</strong>
                <span className="history-count">{history.length} / {HISTORY_LIMIT}</span>
                <button className="secondary-button" type="button" onClick={saveToHistory}>存入当前</button>
              </header>
              {history.length === 0 ? (
                <p className="history-empty">还没有记录。点「存入当前」，或顶栏「保存」，就会把现在的图纸与参数存成一条。</p>
              ) : (
                <ul className="history-list">
                  {history.map((record) => (
                    <li key={record.id}>
                      <div className="history-meta">
                        <strong>{record.label}</strong>
                        <span>{formatHistoryTime(record.savedAt)}</span>
                      </div>
                      <button className="secondary-button" type="button" onClick={() => applyHistoryRecord(record)}>使用</button>
                      <button className="icon-button" type="button" title="删除这条记录" onClick={() => deleteHistoryRecord(record.id)}><Trash2 size={16} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </header>

      <main className="workspace">
        <section className="work-surface">
          {activeTab === 'plan' && (
            <SiteEditor key={editorRevision} site={site} layout={layout} parameters={settings}
              onChange={(next) => { setSite(next); setSaved(false) }} onDemo={loadDemo} onReset={resetToDefaultDemo} />
          )}
          {activeTab === 'model' && (
            <Suspense fallback={<div className="viewer-loading">正在加载三维引擎…</div>}>
              <ScaffoldViewer layout={layout} blocks={layout.blocks} pipeDiameter={settings.pipeDiameter} />
            </Suspense>
          )}
          {activeTab === 'materials' && (layout.canExportMaterials ? (
            <MaterialView
              layout={layout}
              adjustments={adjustments}
              onAdjust={adjustMaterial}
              onResetAdjustment={resetMaterial}
            />
          ) : <section className="site-blocked" role="status">
            <TriangleAlert size={25} /><h2>整图材料清单暂不可用</h2>
            <p>修正以下问题后即可查看、打印和导出；场景草图仍可保存。</p>
            <ul>{layout.issues.filter(issue => issue.blocking).map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>
            <button className="secondary-button" onClick={() => setActiveTab('plan')}>返回绘图定位</button>
          </section>)}
        </section>

        {settingsOpen && <button className="settings-backdrop" aria-label="关闭参数" onClick={() => setSettingsOpen(false)} />}
        <aside className={`inspector${settingsOpen ? ' is-open' : ''}`}>
          <div className="inspector-heading"><Settings2 size={18} /><strong>脚手架参数</strong><span>住宅模板</span></div>
          <div className="parameter-section">
            <h2>几何参数</h2>
            {/* The four that carry most of the estimate stay in the open; the rest
                are refinements a user only reaches for deliberately. */}
            <div className="parameter-grid">
              <NumberField label="全局目标层数" value={settings.layerCount} unit="层" step={1} min={1} max={20} onChange={(value) => updateParameter('layerCount', Math.round(value))} />
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
                value={settings.swapInnerOuter ? 'path' : 'offset'}
                options={[{ value: 'path', label: '路径侧' }, { value: 'offset', label: '偏移侧' }]}
                onChange={(value) => updateParameter('swapInnerOuter', value === 'path')}
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
            <div className="summary-title"><span>{layout.canExportMaterials ? '实时估算' : '草图预览 · 不可出量'}</span><small>{layout.canExportMaterials ? layout.pipeSegments.length + ' 根标准管' : '待复核'}</small></div>
            <div className="summary-grid">
              <div><span>立杆</span><strong>{counts.post}</strong></div>
              <div><span>水平杆</span><strong>{counts.longitudinal}</strong></div>
              <div><span>横向杆</span><strong>{counts.transverse}</strong></div>
              <div><span>防护栏杆</span><strong>{counts.guardrail}</strong></div>
            </div>
            <div className="utilization-row"><span>最高作业层标高</span>
              <strong>{layout.sections.length ? Math.max(...layout.sections.map(section => section.top)).toFixed(2) + ' m' : '—'}</strong>
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
