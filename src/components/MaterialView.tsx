import { ChevronDown, ChevronUp, Download, FileSpreadsheet, Printer } from 'lucide-react'
import type { ConnectorType, MaterialAdjustments, ScaffoldLayout } from '../domain/scaffold'
import { CONNECTOR_LABELS, MATERIAL_KEYS } from '../domain/scaffold'
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
  materialKey,
  adjustments,
  onAdjust,
  onResetAdjustment,
}: QuantityControlProps) {
  const base = calculated ?? 0
  const quantity = Math.max(0, base + (adjustments[materialKey] ?? 0))
  // Recompute from the clamped value so a stale correction cannot report a
  // difference the user is not actually seeing.
  const delta = quantity - base
  const adjusted = delta !== 0
  const unknown = calculated === null && !adjusted

  return (
    <span className={adjusted ? 'qty-control adjusted' : 'qty-control'}>
      <button
        className="qty-step"
        type="button"
        title="减少"
        disabled={quantity <= 0}
        onClick={() => onAdjust(materialKey, -1)}
      >
        <ChevronDown size={14} />
      </button>
      <strong className={unknown ? 'qty-value unknown' : 'qty-value'}>{unknown ? '--' : quantity}</strong>
      <button className="qty-step" type="button" title="增加" onClick={() => onAdjust(materialKey, 1)}>
        <ChevronUp size={14} />
      </button>
      {adjusted ? (
        <>
          <em className="qty-delta">{delta > 0 ? `+${delta}` : delta}</em>
          <button className="qty-reset" type="button" title="恢复为计算值" onClick={() => onResetAdjustment(materialKey)}>
            原 {calculated === null ? '--' : calculated}
          </button>
        </>
      ) : null}
      {unit ? <small className="qty-unit">{unit}</small> : null}
    </span>
  )
}

export function MaterialView({ layout, adjustments, onAdjust, onResetAdjustment }: MaterialViewProps) {
  const { materials } = layout
  const connectorEntries = Object.entries(materials.connectorSummary) as Array<[ConnectorType, number | null]>
  const pipeCount = Object.values(materials.stockSummary).reduce((sum, count) => sum + count, 0)

  /** The quantity actually shown for a calculated material, after corrections. */
  const shown = (calculated: number, key: string) =>
    Math.max(0, calculated + (adjustments[key] ?? 0))

  const exportCsv = async () => {
    const rows: Array<Array<string | number>> = [['类别', '规格', '数量', '单位', '备注']]
    for (const [length, quantity] of Object.entries(materials.stockSummary)) {
      const key = MATERIAL_KEYS.stock(length)
      const value = shown(quantity, key)
      rows.push(['钢管', length, value, '根', value === quantity ? '' : `计算值 ${quantity}`])
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

  const correctionCount = Object.values(adjustments).filter((delta) => delta !== 0).length

  return (
    <div className="materials-view">
      <div className="material-kpis">
        <div><span>理论需求</span><strong>{materials.theoreticalLength.toFixed(1)}<small> m</small></strong></div>
        <div><span>采购总长</span><strong>{materials.purchasedLength.toFixed(1)}<small> m</small></strong></div>
        <div><span>搭接及富余</span><strong>{materials.wasteLength.toFixed(1)}<small> m</small></strong></div>
        <div className="accent-kpi"><span>综合利用率</span><strong>{materials.utilization}<small> %</small></strong></div>
      </div>

      <div className="material-columns">
        <section className="material-section">
          <div className="section-title">
            <div><span className="field-caption">PIPE INVENTORY</span><h2>标准钢管</h2></div>
            <strong>{pipeCount} 根</strong>
          </div>
          <div className="stock-list">
            {Object.entries(materials.stockSummary).sort(([a], [b]) => Number.parseFloat(b) - Number.parseFloat(a)).map(([length, quantity]) => (
              <div className="stock-row" key={length}>
                <span className="pipe-swatch" style={{ width: `${Math.max(48, Number.parseFloat(length) * 18)}px` }} />
                <strong>{length}</strong>
                <QuantityControl
                  calculated={quantity}
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
                  materialKey={MATERIAL_KEYS.connector(type)}
                  adjustments={adjustments}
                  onAdjust={onAdjust}
                  onResetAdjustment={onResetAdjustment}
                />
              </div>
            ))}
            <div>
              <span className="channel-icon" />
              <span>槽钢 <small>每根 {materials.channelSteel.lengthPerPiece.toFixed(2)} m · 共 {materials.channelSteel.totalLength.toFixed(1)} m</small></span>
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
              <span>钢笆片 <small>{materials.deckArea.toFixed(1)} m²</small></span>
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
          <span className="pending-note">现场需要但不参与计算，数量以 -- 表示；可用箭头手动填入</span>
        </div>
        <div className="connector-list pending-list">
          {materials.pendingMaterials.map((material) => (
            <div key={material.id}>
              <span className="pending-material-icon">?</span>
              <span>{material.label}{material.note ? <small>{material.note}</small> : null}</span>
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
        <span className="adjust-note">
          {correctionCount > 0
            ? `已手动调整 ${correctionCount} 项，箭头旁为调整量，小字为程序计算值`
            : '用上下箭头可按现场需要调整数量，调整后会在小字中保留计算值'}
        </span>
        <button className="secondary-button" type="button" onClick={() => { void printMaterials() }}><Printer size={17} /> 打印 / PDF</button>
        <button className="primary-button export-button" type="button" onClick={() => { void exportCsv() }}><FileSpreadsheet size={18} /> 导出 Excel CSV <Download size={16} /></button>
      </div>
    </div>
  )
}
