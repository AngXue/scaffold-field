import { Cable, ChevronDown, ChevronUp, Download, FileSpreadsheet, Frame, Printer, RectangleHorizontal, X, type LucideIcon } from 'lucide-react'
import type { ConnectorType, MaterialAdjustments, PendingMaterial, ScaffoldLayout } from '../domain/scaffold'
import { CONNECTOR_LABELS, COUPLER_PACK_SIZE, MATERIAL_KEYS, materialAdjustmentStep, materialQuantity, stockMaterialRows } from '../domain/scaffold'

/** One glyph per 待定材料, keyed by the domain id so the two cannot drift. */
const PENDING_ICONS: Record<PendingMaterial['id'], LucideIcon> = {
  brace: X,
  bindingWire: Cable,
  padPlate: RectangleHorizontal,
  formwork: Frame,
}
import { saveTextFile } from '../platform/files'
import { printDocument } from '../platform/print'

type MaterialViewProps = {
  layout: ScaffoldLayout
  adjustments: MaterialAdjustments
  onAdjust: (key: string, delta: number) => void
  onResetAdjustment: (key: string) => void
}

type QuantityControlProps = {
  /** `null` when the material is outside the calculation scope and shows `--`. */
  calculated: number | null
  unit?: string
  /** Optional bulk unit, e.g. couplers bagged 30 to a 包. */
  pack?: { size: number; unit: string }
  materialKey: string
  adjustments: MaterialAdjustments
  onAdjust: (key: string, delta: number) => void
  onResetAdjustment: (key: string) => void
}

/**
 * Shows a calculated quantity with the user's manual correction applied on top.
 *
 * The correction is a delta, so changing a parameter keeps flowing through while
 * the user's fix stays in place. The number shown is what the export and print
 * will contain; the calculated value is kept beside it in small text so the two
 * can never be confused.
 *
 * A pending material (`calculated === null`) has nothing to correct, so it reads
 * `--` until the user enters a quantity of their own.
 */
function QuantityControl({
  calculated,
  unit,
  pack,
  materialKey,
  adjustments,
  onAdjust,
  onResetAdjustment,
}: QuantityControlProps) {
  const base = calculated ?? 0
  const quantity = materialQuantity(calculated, adjustments, materialKey)
  const step = pack?.size ?? 1
  const nudge = (direction: number) => onAdjust(materialKey,
    materialAdjustmentStep(calculated, adjustments, materialKey, direction * step))
  // Recompute from the clamped value so a stale correction cannot report a
  // difference the user is not actually seeing.
  const delta = quantity - base
  const adjusted = delta !== 0
  const unknown = calculated === null && !adjusted

  return (
    <span className={adjusted ? 'qty-control adjusted' : 'qty-control'}>
      {/* The correction opens to the LEFT of the stepper, and the whole control is
          right-aligned, so it grows leftward and the ▲/▼ buttons keep the exact
          same screen position before and after a correction. A button that moves
          under the finger is a bug. */}
      {adjusted ? (
        <span className="qty-expand">
          <em className="qty-delta">{delta > 0 ? '+' : ''}{pack && delta % pack.size === 0 ? `${delta / pack.size} ${pack.unit}` : `${delta}${pack ? ` ${unit}` : ''}`}</em>
          <button className="qty-reset" type="button" title="恢复为计算值" onClick={() => onResetAdjustment(materialKey)}>
            原 {calculated === null ? '--' : calculated}
          </button>
        </span>
      ) : null}
      <span className="qty-stepper">
        <button
          className="qty-step"
          type="button"
          title={pack ? `减少1${pack.unit}（${pack.size}${unit}）` : '减少'}
          disabled={quantity <= 0}
          onClick={() => nudge(-1)}
        >
          <ChevronDown size={14} />
        </button>
        <strong className={unknown ? 'qty-value unknown' : 'qty-value'}>{unknown ? '--' : quantity}</strong>
        <button className="qty-step" type="button" title={pack ? `增加1${pack.unit}（${pack.size}${unit}）` : '增加'} onClick={() => nudge(1)}>
          <ChevronUp size={14} />
        </button>
      </span>
      {unit ? <small className="qty-unit">{unit}</small> : null}
      {/* Rendered even when empty so that reaching the first 包 does not shove the
          stepper sideways. */}
      {pack ? (
        <small className="qty-pack">{quantity > 0 ? `${Math.ceil(quantity / pack.size)} ${pack.unit}` : ''}</small>
      ) : null}
    </span>
  )
}

export function MaterialView({ layout, adjustments, onAdjust, onResetAdjustment }: MaterialViewProps) {
  const { materials } = layout
  const connectorEntries = Object.entries(materials.connectorSummary) as Array<[ConnectorType, number | null]>
  const stockRows = stockMaterialRows(materials.stockSummary, adjustments)
  const pipeCount = stockRows.reduce((sum, row) => sum + row.quantity, 0)

  /** The quantity actually shown for a calculated material, after corrections. */
  const shown = (calculated: number, key: string) =>
    materialQuantity(calculated, adjustments, key)

  const exportCsv = async () => {
    const rows: Array<Array<string | number>> = [['类别', '规格', '数量', '单位', '备注']]
    for (const { length, calculated, quantity } of stockRows) {
      rows.push(['钢管', length, quantity, '根', quantity === calculated ? '' : `计算值 ${calculated}`])
    }
    for (const [type, quantity] of connectorEntries) {
      const key = MATERIAL_KEYS.connector(type)
      const calculated = quantity ?? 0
      const value = shown(calculated, key)
      rows.push([
        '扣件',
        CONNECTOR_LABELS[type],
        value === 0 && quantity === null ? '--' : value,
        '个',
        value === calculated ? '' : quantity === null ? '计算值 --' : `计算值 ${calculated}`,
      ])
    }
    const channelValue = shown(materials.channelSteel.count, MATERIAL_KEYS.channel)
    rows.push(['型钢', '槽钢', channelValue, '根', channelValue === materials.channelSteel.count ? '' : `计算值 ${materials.channelSteel.count}`])
    rows.push(['型钢', '槽钢总长', materials.channelSteel.totalLength, 'm', ''])
    const deckValue = shown(materials.deckCount, MATERIAL_KEYS.deck)
    rows.push(['铺设材料', '钢笆片', deckValue, '片', deckValue === materials.deckCount ? '' : `计算值 ${materials.deckCount}`])
    rows.push(['铺设材料', '钢笆覆盖面积', materials.deckArea, 'm²', ''])
    for (const material of materials.pendingMaterials) {
      // Outside the calculation, so the only quantity is whatever the user enters.
      const value = shown(0, MATERIAL_KEYS.pending(material.id))
      rows.push([
        '待定材料',
        material.label,
        value === 0 ? '--' : value,
        material.unit,
        value === 0 ? '' : '计算值 --',
      ])
    }

    const csv = `\uFEFF${rows.map((row) => row.join(',')).join('\n')}`
    try {
      await saveTextFile({
        fileName: '青岚别墅-材料清单.csv',
        mimeType: 'text/csv;charset=utf-8',
        contents: csv,
        title: '导出材料清单',
      })
    } catch (error) {
      window.alert(`导出失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const printMaterials = async () => {
    try {
      await printDocument('青岚别墅-材料清单')
    } catch (error) {
      window.alert(`打印失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <div className="materials-view">
      <div className="material-kpis">
        <div><span>理论需求</span><strong>{materials.theoreticalLength.toFixed(1)}<small> m</small></strong></div>
        <div><span>实际总长</span><strong>{materials.actualLength.toFixed(1)}<small> m</small></strong></div>
        <div><span>富余长度</span><strong>{materials.wasteLength.toFixed(1)}<small> m</small></strong></div>
        <div className="accent-kpi"><span>综合利用率</span><strong>{materials.utilization}<small> %</small></strong></div>
      </div>

      <div className="material-columns">
        <section className="material-section">
          <div className="section-title">
            <div><span className="field-caption">PIPE INVENTORY</span><h2>标准钢管</h2></div>
            <strong>{pipeCount} 根</strong>
          </div>
          <div className="stock-list">
            {stockRows.map(({ length, calculated }) => (
              <div className="stock-row" key={length}>
                <span className="pipe-swatch" style={{ width: `${Math.max(48, Number.parseFloat(length) * 18)}px` }} />
                <strong>{length}</strong>
                <QuantityControl
                  calculated={calculated}
                  materialKey={MATERIAL_KEYS.stock(length)}
                  adjustments={adjustments}
                  onAdjust={onAdjust}
                  onResetAdjustment={onResetAdjustment}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="material-section">
          <div className="section-title"><div><span className="field-caption">CONNECTORS & STEEL</span><h2>扣件与型钢</h2></div></div>
          <div className="connector-list">
            {connectorEntries.map(([type, quantity]) => (
              <div key={type}>
                <span className={`connector-icon ${type}`}><i /><i /></span>
                <span>{CONNECTOR_LABELS[type]}</span>
                {/* 转向扣 has no calculated count yet, but a user may still need to
                    record how many the site uses, so it is adjustable like the
                    pending materials. */}
                <QuantityControl
                  calculated={quantity}
                  unit="个"
                  pack={{ size: COUPLER_PACK_SIZE, unit: '包' }}
                  materialKey={MATERIAL_KEYS.connector(type)}
                  adjustments={adjustments}
                  onAdjust={onAdjust}
                  onResetAdjustment={onResetAdjustment}
                />
              </div>
            ))}
            <div>
              <span className="channel-icon" />
              <span>槽钢</span>
              <QuantityControl
                calculated={materials.channelSteel.count}
                unit="根"
                materialKey={MATERIAL_KEYS.channel}
                adjustments={adjustments}
                onAdjust={onAdjust}
                onResetAdjustment={onResetAdjustment}
              />
            </div>
            <div>
              <span className="deck-material-icon" />
              <span>钢笆片</span>
              <QuantityControl
                calculated={materials.deckCount}
                unit="片"
                materialKey={MATERIAL_KEYS.deck}
                adjustments={adjustments}
                onAdjust={onAdjust}
                onResetAdjustment={onResetAdjustment}
              />
            </div>
          </div>
        </section>
      </div>

      <section className="material-section pending-section">
        <div className="section-title">
          <div><span className="field-caption">NOT ESTIMATED</span><h2>待定材料</h2></div>
        </div>
        <div className="connector-list pending-list">
          {materials.pendingMaterials.map((material) => (
            <div key={material.id}>
              <span className="pending-material-icon">{(() => {
                const Icon = PENDING_ICONS[material.id]
                return <Icon size={15} />
              })()}</span>
              <span>{material.label}</span>
              <QuantityControl
                calculated={null}
                unit={material.unit}
                materialKey={MATERIAL_KEYS.pending(material.id)}
                adjustments={adjustments}
                onAdjust={onAdjust}
                onResetAdjustment={onResetAdjustment}
              />
            </div>
          ))}
        </div>
      </section>

      <div className="export-actions">
        <button className="secondary-button" type="button" onClick={() => { void printMaterials() }}><Printer size={17} /> 打印 / PDF</button>
        <button className="primary-button export-button" type="button" onClick={() => { void exportCsv() }}><FileSpreadsheet size={18} /> 导出 Excel CSV <Download size={16} /></button>
      </div>
    </div>
  )
}
