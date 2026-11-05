# UI 组件库与界面规范

本页记录「架算」网页的组件库、设计令牌和使用约定。目标是让新页面直接组合已有控件，而不是再写一套按钮或输入框。实现位于：

| 位置 | 内容 |
| --- | --- |
| `src/index.css` | 颜色、深度、圆角、间距等设计令牌 |
| `src/components/ui/ui.css` | 组件基类与状态 |
| `src/components/ui/` | `Button`、`IconButton`、`SegmentedControl`、`Field`/`Input`/`Select`、`Badge`、`SectionHeading`、`EmptyState` |
| `src/components/NumberField.tsx`、`OptionField.tsx` | 参数面板里的数字与选项字段 |
| `src/components/planAnnotations.ts` | 二维标注的避让与选中规则 |
| `src/components/SceneDimensions.tsx` | 三维尺寸线与屏幕空间尺寸标签 |

## 风格：柔和的控件面，扁平的数据面

- 整体保持新拟态（soft UI），但只把阴影花在**控件面**：按钮、工具条、面板、浮层。
- **数据面**继续扁平：画布、材料表、数字读数只用真实发丝线，不加 `box-shadow`。一条新拟态边缘在自身底色上的对比度只有约 1.14–1.45:1，无法承担“字段从哪里开始”“我选中了哪一行”的职责。
- 底色是极浅灰（`--nm-surface: #eef0f1`），不是纯白；纯白没有高光余量，凸起会变成一侧灰印。
- 控件主色只有墨黑（`--accent`）和浅灰；红色只用于阻断错误。数据编码允许使用颜色：三维构件颜色，以及二维画布的两支笔。
- 二维画笔：房屋笔用暖中性色 `--plan-house-line`，脚手架笔用青绿色 `--plan-scaffold`（选中加深为 `--plan-scaffold-strong`），辅助线用灰蓝色 `--plan-guide`。不要再用同一墨色靠线宽区分两支笔；这些颜色只用于画布，不用于按钮或面板。
- 所有输入和开关都必须有 `--nm-edge`，不能只靠阴影；焦点必须是 `3px solid var(--nm-focus)`。

### 设计令牌

| 令牌 | 用途 |
| --- | --- |
| `--nm-surface`、`--nm-sunk` | 控件面 / 凹槽底 |
| `--nm-e0…e4` | 凸起深度，`blur = 2 × offset`，扩散 0 |
| `--nm-i1…i2` | 内凹深度 |
| `--nm-edge` | 1px 内圈边界，所有输入和开关必带 |
| `--nm-focus` | 3px 焦点环 |
| `--nm-r-1…r-4` | 8 / 10 / 14 / 20px 圆角 |
| `--space-1…space-6` | 4 / 8 / 12 / 16 / 20 / 24px 间距 |
| `--nm-speed` | 140ms 状态过渡 |

## 组件

### Button

```tsx
<Button variant="primary" icon={<Box size={18} />} trailing={<ChevronRight size={18} />}>
  计算并生成 3D
</Button>
<Button size="sm" variant="ghost">恢复默认示例</Button>
```

- `primary`：页面提交动作，深底白字；一屏只保留一个主按钮。
- `secondary`（默认）：凸起控件，用于普通操作。
- `ghost`：就地文字动作，不抢视觉。
- 高度默认 44px，`sm` 36px，`lg` 48px；`block` 占满一行。

### IconButton

```tsx
<IconButton label="撤销" icon={<Undo2 size={17} />} size="sm" disabled={!canUndo} />
<IconButton label="网格吸附" icon={<Magnet size={17} />} toggle active={snap} onClick={toggleSnap} />
```

- `label` 必填，同时作为 `aria-label` 和 tooltip。
- 切换键加 `toggle`，会正确输出 `aria-pressed`。
- 尺寸 `xs` 28px / `sm` 36px / `md` 44px。

### SegmentedControl

```tsx
<SegmentedControl<Tool>
  ariaLabel="绘图模式"
  value={tool}
  onChange={setTool}
  options={[
    { value: 'house', label: '房屋笔', icon: <Square size={16} /> },
    { value: 'scaffold', label: '脚手架笔', icon: <Pencil size={16} /> },
  ]}
/>
```

凹槽轨道 + 凸起选中块；选中态不依赖颜色。用于工具切换、二选一参数和图层模式。

### Field / Input / Select

```tsx
<Field label="高度 (m)" htmlFor={id}>
  <Input id={id} inputMode="decimal" />
</Field>

<Field label="架段落脚面">
  <Select aria-label="架段落脚面" options={options} value={value} onChange={onChange} />
</Field>
```

- 输入和下拉都是内凹井，带 `--nm-edge`。
- `Field` 只负责标签、控件与提示的排布；表单位置用 `className` 接入现有网格。
- 数字参数使用 `NumberField`（带显式 −/+，因为 Android WebView 不画原生步进器）。

### Badge / SectionHeading / EmptyState

```tsx
<Badge>住宅模板</Badge>
<SectionHeading title="标准钢管" caption="PIPE INVENTORY" action={<strong>220 根</strong>} />
<EmptyState title="未选择对象" description="点选一个体块或架段。" />
```

这三类都是**扁平数据面**：只使用边框、字重和留白，不加凸起阴影。

## 页面模式

- **顶栏**：一条 60px 横条同时承担品牌、流程标签和项目动作；不要再加第二层标签栏。
- **参数抽屉**：宽屏常驻右栏；≤1200px 变成右上抽屉，关闭按钮使用 X。
- **画布浮条**：二维画布里的浮动工具条是一条凹槽胶囊；内部按钮自身不再叠加重阴影。
- **选中浮层**：三维规格卡位于画布右上（手机在底部），`z-index` 必须高于三维 HTML 标签（当前 30 > 20）。
- **数据表**：材料表是白底、1px 发丝线、无阴影；手工修正用浅灰底和 `--nm-edge` 标出，原计算值继续显示。

## 二维标注

- 选中体块：四条边全部标注，标签优先靠近自己的边，即使压到相邻体块上；数字恢复墨色并加粗。
- 未选中体块：每个轴向最多一个标签；只选择标注带不与其它体块相交、且边没有被更高体块盖住的方向。尺寸数字使用 `--plan-dimension` 中等灰、常规字重，尺寸线也降为浅灰，避免和选中的编辑对象抢视觉。
- 体块完全被叠放体块盖住时，下方体块不再标注；上方体块继续标注。
- 线段标注：未选中只显示「第 N 段」的短标签；选中后才显示编号和长度。标签有白底发丝胶囊，避免与体块尺寸数字混在一起。
- 轮廓绘制：当前边实时显示吸附后的长度，已落笔的边保留读数。尺寸线与数字偏离笔画，字形大小和偏移不随缩放改变；底部同步显示当前边长，触屏手指遮住笔尖时也能读数。取消、撤销或闭合轮廓后同步清理临时标注。
- 所有标注最后绘制且 `pointer-events: none`，不会抢画布点击，也不会被后面的大体块盖住。

## 三维交互

- 钢管、扣件、槽钢和钢笆都是可选构件；点击后显示规格浮层。钢管有不可见的加粗拾取代理，避免细管点不中而选到下方钢笆。
- 体块也可选中，浮层显示平面尺寸、高度、底面/顶面标高和依赖；选中体块有描边高亮和投影尺寸标签。
- 叠放体块每块都有独立描边和轻微色阶，避免共享面在光照下融成一块。
- 三维尺寸由「尺寸」图层控制：尺寸线画在场景中，数字是屏幕空间标签，会随相机拉远保持完整。标注默认参与深度测试并启用 HTML 遮挡，被墙体或构件挡住时不显示；工具栏眼睛按钮可切换「透视显示」，透视状态使用虚线标签边框并在提示栏显示「尺寸透视：开」。
- 空点画布清除选择；`Esc` 也可清除。隐藏当前选中对象所属图层时自动收起规格卡。

## 新增界面的检查单

1. 能组合已有组件就不新增控件；重复三次才考虑抽新组件。
2. 控件面用凸起/内凹，数据面保持白底发丝线。
3. 图标按钮必须有 `label`；切换按钮必须有 `toggle`；表单控件必须有可读标签。
4. 检查 `320 / 390 / 720 / 1024 / 1440px` 宽度以及横屏高度；页面不应出现横向滚动。
5. 验证键盘 focus、触屏 44px 命中区、`prefers-reduced-motion`，以及打印时阴影清零。
