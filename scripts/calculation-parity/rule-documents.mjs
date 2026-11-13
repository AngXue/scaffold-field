import './loader.mjs'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RULES } from '../../src/domain/rules/catalog.ts'
import { registeredSteps } from './registry.mjs'

const root = resolve(import.meta.dirname, '../..')
const destination = resolve(root, 'docs/规则索引与依赖图.md')
const cell = value => String(value).replaceAll('|', '&#124;').replaceAll('\n', '<br>')
const codeList = values => values.length ? values.map(value => `\`${cell(value)}\``).join('<br>') : '—'
const link = path => `[${path}](../${path})`
const phaseLabels = ['输入', '场景事实', '拓扑与站位', '工作构件与需求', '立杆与支承', '防护与开口', '合并与组管', '整管定位', '真实扣件', '校验与计量']

/** Derived only from the typed registry and actual compiled production steps. */
export function ruleDocuments(entries) {
  const rules = [...RULES].sort((a, b) => a.id.localeCompare(b.id))
  const lines = [
    '# 规则索引与依赖图', '',
    '> 自动生成：`npm run rules:docs`。请修改有类型注册表或步骤声明，不要手工修改本文件。`npm run rules:docs -- --check` 和 `npm run audit:rules` 会拒绝过期内容。', '',
    `当前有 ${rules.length} 个业务规则、${entries.length} 个注册执行步骤。业务解释、确认过的例外及固定手算见[计算规则](计算规则.md)、[规则清单](规则清单.md)和[验收矩阵](qa/规则验收矩阵.md)。`, '',
    '## 业务规则', '',
    '| 规则 / 修订 | 状态 / 实现 | 业务说明 | 执行步骤 | 实现来源 | 验证索引 |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const rule of rules) {
    const owned = entries.filter(entry => entry.step.ruleId === rule.id)
    lines.push(`| ${rule.id} / ${rule.revision} | ${rule.status} / ${rule.implementation} | ${cell(rule.title)} | ${owned.length ? codeList(owned.map(({ step }) => `S${step.phase} ${step.id}`)) : '纯策略或输入输出边界，见实现来源'} | ${rule.source.map(link).join('<br>')} | ${rule.cases.map(value => value.includes('/') ? link(value) : `\`${value}\``).join('<br>')} |`)
  }
  lines.push('', '## 执行合同', '',
    '以下读取字段和提案目标是各步骤实际声明的合同；同名字段属于各自规则包的输入范围，不代表跨包共享可变对象。`after` 是明确的局部先后依赖。跨架体的阶段屏障由生产编排与全局阶段守卫执行，静态图不能替代运行追踪验收。', '',
    '| 阶段 / 步骤 | 所属规则 | 读取 | 提案种类 | 写目标 | 前置步骤 | 注册位置 |',
    '| --- | --- | --- | --- | --- | --- | --- |')
  for (const { step, source, exported } of entries) lines.push(`| S${step.phase} / ${step.id} | ${step.ruleId} | ${codeList(step.reads)} | ${codeList(step.kinds)} | ${codeList(step.targets)} | ${codeList(step.after)} | ${link(source)}<br>\`${exported}\` |`)
  lines.push('', '## 注册依赖图', '',
    '每个节点是一项执行步骤，箭头来自其 `after` 声明；分区表示全局阶段。纯策略复用和输入输出边界未伪装成执行步骤，同阶段没有箭头的节点也不意味着各架体可以跳过阶段屏障。', '', '```mermaid', 'flowchart TD')
  const nodes = new Map(entries.map(({ step }, index) => [step.id, `n${index}`]))
  for (let phase = 0; phase <= 9; phase++) {
    const current = entries.filter(({ step }) => step.phase === phase)
    if (!current.length) continue
    lines.push(`  subgraph s${phase}["S${phase} ${phaseLabels[phase]}"]`)
    for (const { step } of current) lines.push(`    ${nodes.get(step.id)}["${step.id}"]`)
    lines.push('  end')
  }
  for (const { step } of entries) for (const dependency of step.after) lines.push(`  ${nodes.get(dependency)} --> ${nodes.get(step.id)}`)
  lines.push('```', '', '## 明确的细化合同', '',
    '本节只列实际注册的 `refines` 合同；没有登记不能被解释为允许优先级覆盖。业务例外的确认来源仍见计算规则及专项修正记录。', '',
    '| 执行步骤 | 细化前项 | 目标 | 原因 | 固定用例 |', '| --- | --- | --- | --- | --- |')
  const refinements = RULES.flatMap(rule => rule.relations.filter(relation => relation.kind === 'refines' || relation.kind === 'exceptionOf').map(relation => ({ rule, relation })))
  for (const { relation } of refinements) for (const binding of relation.bindings) lines.push(`| ${binding.step} | ${binding.after} | ${codeList(relation.targets)} | ${cell(relation.reason)} | ${codeList(relation.cases)} |`)
  lines.push('', '## 业务关系合同', '',
    '运行器核对规则状态、步骤绑定和具名谓词；发布审计逐项核对全部跨规则依赖。例外只允许声明目标上的条件性变更，条件不满足就拒绝竞争写入。诊断仅在谓词实际通过时记录应用的例外编号。', '',
    '| 规则 / 关系编号 | 类型 → 前项 | 条件 | 保留不变量 | 确认来源 / 回退 |', '| --- | --- | --- | --- | --- |')
  for (const rule of RULES) for (const relation of rule.relations) lines.push(`| ${rule.id} / ${cell(relation.id)} | ${relation.kind} → ${relation.target} | ${cell(relation.condition)} | ${codeList(relation.invariants ?? [])} | ${codeList(relation.confirmation ?? [])} / ${relation.fallback ?? '—'} |`)
  return lines.join('\n') + '\n'
}
export function checkRuleDocuments(entries) {
  assert.equal(readFileSync(destination, 'utf8'), ruleDocuments(entries), 'Generated rule index/dependency graph is stale; run npm run rules:docs')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const entries = await registeredSteps()
  if (process.argv.includes('--check')) checkRuleDocuments(entries)
  else writeFileSync(destination, ruleDocuments(entries))
  console.log(`${process.argv.includes('--check') ? 'Verified' : 'Generated'} ${RULES.length} rules / ${entries.length} steps: docs/规则索引与依赖图.md`)
}
