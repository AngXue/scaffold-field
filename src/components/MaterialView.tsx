import { Download, FileSpreadsheet, Printer } from 'lucide-react'
import type { ConnectorType, ScaffoldLayout } from '../domain/scaffold'
import { CONNECTOR_LABELS } from '../domain/scaffold'
import { saveTextFile } from '../platform/files'
import { printDocument } from '../platform/print'

type MaterialViewProps = {
  layout: ScaffoldLayout
}

export function MaterialView({ layout }: MaterialViewProps) {
  const { materials } = layout
  const connectorEntries = Object.entries(materials.connectorSummary) as Array<[ConnectorType, number | null]>
  const pipeCount = Object.values(materials.stockSummary).reduce((sum, count) => sum + count, 0)

  const exportCsv = async () => {
    const rows: Array<Array<string | number>> = [
      ['类别', '规格', '数量', '单位'],
      ...Object.entries(materials.stockSummary).map(([length, quantity]) => ['钢管', length, quantity, '根']),
      ...connectorEntries.map(([type, quantity]) => ['扣件', CONNECTOR_LABELS[type], quantity ?? '--', '个']),
      ['型钢', `槽钢 ${materials.channelSteel.size} ${materials.channelSteel.lengthPerPiece}m`, materials.channelSteel.count, '根'],
      ['型钢', '槽钢总长', materials.channelSteel.totalLength, 'm'],
      ['型钢', '槽钢总重', materials.channelSteel.totalMass, 'kg'],
      ['铺设材料', '钢笆片', materials.deckCount, '片'],
      ['铺设材料', '钢笆覆盖面积', materials.deckArea, 'm²'],
      ...materials.pendingMaterials.map((material) => ['待定材料', material.label, '--', material.unit]),
    ]
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
        <div><span>采购总长</span><strong>{materials.purchasedLength.toFixed(1)}<small> m</small></strong></div>
        <div><span>搭接及富余</span><strong>{materials.wasteLength.toFixed(1)}<small> m</small></strong></div>
        <div className="accent-kpi"><span>综合利用率</span><strong>{materials.utilization}<small> %</small></strong></div>
      </div>

      <div className="material-columns">
        <section className="material-section">
          <div className="section-title"><div><span className="field-caption">PIPE INVENTORY</span><h2>标准钢管</h2></div><strong>{pipeCount} 根</strong></div>
          <div className="stock-list">
            {Object.entries(materials.stockSummary).sort(([a], [b]) => Number.parseFloat(b) - Number.parseFloat(a)).map(([length, quantity]) => (
              <div className="stock-row" key={length}>
                <span className="pipe-swatch" style={{ width: `${Math.max(48, Number.parseFloat(length) * 18)}px` }} />
                <strong>{length}</strong><span>× {quantity}</span>
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
                <strong>{quantity ?? '--'}</strong><small>个</small>
              </div>
            ))}
            <div>
              <span className="channel-icon" />
              <span>槽钢 {materials.channelSteel.size} <small>每根 {materials.channelSteel.lengthPerPiece.toFixed(2)} m · 共 {materials.channelSteel.totalLength.toFixed(1)} m · 约 {materials.channelSteel.totalMass.toFixed(0)} kg</small></span>
              <strong>{materials.channelSteel.count}</strong>
              <small>根</small>
            </div>
            <div>
              <span className="deck-material-icon" />
              <span>钢笆片 <small>{materials.deckArea.toFixed(1)} m²</small></span>
              <strong>{materials.deckCount}</strong>
              <small>片</small>
            </div>
          </div>
        </section>
      </div>

      <section className="material-section pending-section">
        <div className="section-title">
          <div><span className="field-caption">NOT ESTIMATED</span><h2>待定材料</h2></div>
          <span className="pending-note">现场需要，但暂不纳入估算范围，数量以 -- 表示</span>
        </div>
        <div className="connector-list pending-list">
          {materials.pendingMaterials.map((material) => (
            <div key={material.id}>
              <span className="pending-material-icon">?</span>
              <span>{material.label}{material.note ? <small>{material.note}</small> : null}</span>
              <strong>--</strong>
              <small>{material.unit}</small>
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
