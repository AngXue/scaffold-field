import type { RuleDefinition } from './contracts.ts'

/** Migration inventory. Adapter status is explicit until a rule is extracted. */
export const RULES: readonly RuleDefinition[] = [
  {
    "id": "I01",
    "revision": 1,
    "title": "缺失参数补默认，保留明确旧值；旧 height、rowCount 迁移；库存补入 5 / 3.5 m",
    "status": "active",
    "implementation": "boundary",
    "source": [
      "src/domain/rules/boundaries/parameters.ts"
    ],
    "cases": [
      "T01",
      "T14",
      "src/domain/project.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "I02",
    "revision": 1,
    "title": "场景米制、旧图 50 px/m；层边界按毫米；覆盖细坐标保留 6 位精度",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/facts/precision.ts",
      "src/domain/polygons.ts"
    ],
    "cases": [
      "T02",
      "T04",
      "T05",
      "src/domain/rules/facts/precision.test.ts",
      "src/domain/site.test.ts"
    ]
  },
  {
    "id": "I03",
    "revision": 1,
    "title": "正交闭合真实轮廓、凹口留空；叠放完整支承、无循环，子体块随父标高变化",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/policies/blocks.ts",
      "src/domain/rules/scene.ts"
    ],
    "cases": [
      "T03",
      "T13",
      "src/domain/site.test.ts"
    ]
  },
  {
    "id": "I04",
    "revision": 1,
    "title": "首层严格高于当地底面，取连续指定全局层；目标已过时新段至少一层并提示",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/policies/levels.ts"
    ],
    "cases": [
      "S1；S测 3.759/3.760/3.761 与目标边界"
    ]
  },
  {
    "id": "I05",
    "revision": 1,
    "title": "自动段按最低地面目标层；手选面的独立层数按当地首层；followGlobal 决定是否跟随",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/policies/levels.ts"
    ],
    "cases": [
      "S1；S测单面独立、全局目标、存档"
    ]
  },
  {
    "id": "G01",
    "revision": 2,
    "title": "共线墙面合并识别，地面沿墙笔画不依赖 automatic 标记，按毫米容差识别并向真实外侧偏移；默认距墙 0.30 m，横管余量可能增加净空",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/policies/routing.ts",
      "src/domain/rules/routing.ts"
    ],
    "cases": [
      "T03",
      "T07",
      "T08",
      "T13",
      "src/domain/rules/routing.test.ts",
      "src/domain/siteEditing.test.ts"
    ]
  },
  {
    "id": "G02",
    "revision": 1,
    "title": "自动笔画按整个双排和底座占用范围识别顶面并分段；手选面不自动换面",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/policies/routing.ts",
      "src/domain/rules/routing.ts"
    ],
    "cases": [
      "T03",
      "T07",
      "T08",
      "T13",
      "src/domain/rules/routing.test.ts",
      "src/domain/siteEditing.test.ts"
    ]
  },
  {
    "id": "G03",
    "revision": 1,
    "title": "纵距为上限，等分排站；距角位 ≤0.25 m 可整站协调，不能超纵距或改原端点",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/topology.ts",
      "src/domain/rules/policies/topology.ts"
    ],
    "cases": [
      "T04",
      "T07",
      "T08",
      "src/domain/rules/topology.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "G04",
    "revision": 1,
    "title": "两侧落地的屋顶中段从两侧端站协调排跨，减少屋顶冗余柱对",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/policies/routing.ts",
      "src/domain/rules/routing.ts"
    ],
    "cases": [
      "T03",
      "T07",
      "T08",
      "T13",
      "src/domain/rules/routing.test.ts",
      "src/domain/siteEditing.test.ts"
    ]
  },
  {
    "id": "G05",
    "revision": 1,
    "title": "单侧屋顶接入口从低侧端柱按纵距定位，远端共用屋顶转角保留；短面保留可行短跨",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/policies/routing.ts",
      "src/domain/rules/routing.ts"
    ],
    "cases": [
      "T03",
      "T07",
      "T08",
      "T13",
      "src/domain/rules/routing.test.ts",
      "src/domain/siteEditing.test.ts"
    ]
  },
  {
    "id": "G06",
    "revision": 1,
    "title": "相向墙末端窄巷满足一套双排净空但放不下两套时，低架接高架已有柱对，显示实际墙距",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/policies/routing.ts",
      "src/domain/rules/routing.ts"
    ],
    "cases": [
      "T03",
      "T07",
      "T08",
      "T13",
      "src/domain/rules/routing.test.ts",
      "src/domain/siteEditing.test.ts"
    ]
  },
  {
    "id": "G07",
    "revision": 1,
    "title": "同落脚面和相连关系计算分组，自动段可有不同层数；编辑组不是物理边界",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/groups.ts",
      "src/domain/rules/policies/groups.ts"
    ],
    "cases": [
      "T04",
      "T08",
      "T11",
      "src/domain/rules/groups.test.ts",
      "src/domain/rules/facts/memberUses.test.ts"
    ]
  },
  {
    "id": "G08",
    "revision": 1,
    "title": "内角合柱、外角延伸补柱、共点取较高柱；闭合首尾同规则；必需跨界端柱对保留",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/posts.ts",
      "src/domain/rules/policies/posts.ts",
      "src/domain/rules/components.ts",
      "src/domain/rules/topology.ts",
      "src/domain/rules/policies/topology.ts",
      "src/domain/rules/policies/components.ts"
    ],
    "cases": [
      "T05",
      "T12",
      "src/domain/rules/posts.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "G09",
    "revision": 1,
    "title": "连续短折返可借相邻已有延伸；冗余端柱受 0.25 m、纵距、交点支承条件限制",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/topology.ts",
      "src/domain/rules/policies/topology.ts"
    ],
    "cases": [
      "T04",
      "T07",
      "T08",
      "src/domain/rules/topology.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "M01",
    "revision": 1,
    "title": "始终两排立杆；填芯数量只改变钢笆纵向支承杆",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/frameRows.ts",
      "src/domain/rules/policies/frameRows.ts"
    ],
    "cases": [
      "T05",
      "T12",
      "src/domain/rules/frameRows.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "M02",
    "revision": 1,
    "title": "当地顶层高度加固定延伸；带栏杆排与开口端按现有较高柱需求，实际定尺另算",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/heights.ts",
      "src/domain/rules/policies/heights.ts"
    ],
    "cases": [
      "T05",
      "T12",
      "src/domain/rules/heights.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "M03",
    "revision": 1,
    "title": "纵杆和填芯按现有转角范围齐长；横杆不加管端外伸；成功转角省其横杆",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/bands.ts",
      "src/domain/rules/policies/bands.ts",
      "src/domain/rules/frameRows.ts",
      "src/domain/rules/policies/frameRows.ts"
    ],
    "cases": [
      "T05",
      "T12",
      "src/domain/rules/bands.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "M04",
    "revision": 1,
    "title": "扫地杆从当地底面算，只有两排普通纵杆及横杆，无钢笆／填芯",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/bands.ts",
      "src/domain/rules/policies/bands.ts"
    ],
    "cases": [
      "T05",
      "T12",
      "src/domain/rules/bands.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "M05",
    "revision": 1,
    "title": "钢笆按选定规格及 0.10 m 搭接计整片；铺板间隔按全局层；外角补角片",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/decks.ts",
      "src/domain/rules/policies/decks.ts"
    ],
    "cases": [
      "T05",
      "T12",
      "src/domain/rules/decks.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "M06",
    "revision": 1,
    "title": "同层重叠覆盖只计一次；内角归进段，裁片不按碎面数重复计片，不留孔洞",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/decks.ts",
      "src/domain/rules/policies/decks.ts",
      "src/domain/rules/components.ts",
      "src/domain/rules/policies/components.ts"
    ],
    "cases": [
      "T05",
      "T12",
      "src/domain/rules/decks.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "M07",
    "revision": 1,
    "title": "每柱对一根与横管等长的槽钢；转角单方向；无柱或支承被更完整底座承接时去重",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/bases.ts",
      "src/domain/rules/policies/bases.ts",
      "src/domain/rules/components.ts",
      "src/domain/rules/policies/components.ts"
    ],
    "cases": [
      "T05",
      "T12",
      "src/domain/rules/bases.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "M08",
    "revision": 1,
    "title": "同高同线同用途直杆合并；纵横共用保留 roles；只组装、渲染、计量一次",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/sharedMembers.ts",
      "src/domain/rules/policies/sharedMembers.ts"
    ],
    "cases": [
      "T04",
      "T08",
      "T11",
      "src/domain/rules/groups.test.ts",
      "src/domain/rules/facts/memberUses.test.ts"
    ]
  },
  {
    "id": "P01",
    "revision": 1,
    "title": "单道居中，两道按现有上皮／居中；顶层多架顶栏杆，最高无板层仍有架顶防护",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/heights.ts",
      "src/domain/rules/policies/guardCourses.ts"
    ],
    "cases": [
      "T05",
      "T12",
      "src/domain/rules/heights.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "P02",
    "revision": 1,
    "title": "外排纵向防护、真实开口横向折返；外侧交叉沿原角部延伸",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/frameRows.ts",
      "src/domain/rules/sharedMembers.ts",
      "src/domain/rules/policies/protectionRanges.ts"
    ],
    "cases": [
      "T05",
      "T12",
      "src/domain/rules/frameRows.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "P03",
    "revision": 1,
    "title": "内侧交叉可能进入同层通道时收至共用角柱，取消交叉端额外伸长",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/frameRows.ts",
      "src/domain/rules/policies/protectionRanges.ts"
    ],
    "cases": [
      "T05",
      "T12",
      "src/domain/rules/frameRows.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "P04",
    "revision": 1,
    "title": "面向较高实墙的低层端栏杆可省，真实外侧及更高独立防护保留",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/guardRemovals.ts",
      "src/domain/rules/policies/guardRemovals.ts"
    ],
    "cases": [
      "T07",
      "T11",
      "src/domain/rules/guardRemovals.test.ts",
      "src/domain/siteEditing.test.ts"
    ]
  },
  {
    "id": "P05",
    "revision": 1,
    "title": "共同全局作业层接通工作杆、钢笆及防护；短角从真实端柱借相邻面栏杆连接",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/transitions.ts",
      "src/domain/rules/policies/transitions.ts"
    ],
    "cases": [
      "T07",
      "T11",
      "src/domain/rules/transitions.test.ts",
      "src/domain/siteEditing.test.ts"
    ]
  },
  {
    "id": "P06",
    "revision": 1,
    "title": "接通后打开双排之间的横向封口；已合并的邻面外栏杆只局部裁其封口区间",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/transitions.ts",
      "src/domain/rules/policies/transitions.ts",
      "src/domain/rules/guardRemovals.ts",
      "src/domain/rules/policies/guardRemovals.ts"
    ],
    "cases": [
      "T07",
      "T11",
      "src/domain/rules/transitions.test.ts",
      "src/domain/siteEditing.test.ts"
    ]
  },
  {
    "id": "P07",
    "revision": 1,
    "title": "栏杆必须有足够柱顶承托；现行无承托时舍弃并提醒；真实连接按组装后柱顶判断",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/transitions.ts",
      "src/domain/rules/policies/transitions.ts",
      "src/domain/rules/heights.ts",
      "src/domain/rules/policies/guardCourses.ts"
    ],
    "cases": [
      "T07",
      "T11",
      "src/domain/rules/transitions.test.ts",
      "src/domain/siteEditing.test.ts"
    ]
  },
  {
    "id": "P08",
    "revision": 1,
    "title": "整管余量尽量移出通道；管和对接扣一起移；无法消除的侵入允许保留",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/placement.ts",
      "src/domain/rules/policies/placementConstraints.ts",
      "src/domain/rules/policies/positioner.ts"
    ],
    "cases": [
      "T10",
      "T11",
      "src/domain/rules/placement.test.ts",
      "src/domain/guardrails.test.ts"
    ]
  },
  {
    "id": "S01",
    "revision": 2,
    "title": "标准规格组合覆盖所需长度，先最少根数再较小有效总长；横管居中分配余量，立杆自底向上",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/policies/stock.ts",
      "src/domain/rules/stock.ts",
      "src/domain/rules/heights.ts",
      "src/domain/rules/policies/heights.ts"
    ],
    "cases": [
      "T05",
      "T10",
      "T12",
      "src/domain/rules/stock.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "S02",
    "revision": 1,
    "title": "立柱所有选管路径禁用 5 m，允许 3.5 m；库存只剩禁用规格时按现行回退并提醒",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/policies/stock.ts",
      "src/domain/rules/stock.ts"
    ],
    "cases": [
      "T05",
      "T10",
      "T12",
      "src/domain/rules/stock.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "S03",
    "revision": 1,
    "title": "邻柱接头错开，优先不同序列及不同总长；按最终现行邻接修复；无解提示",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/policies/stock.ts",
      "src/domain/rules/stock.ts",
      "src/domain/rules/posts.ts",
      "src/domain/rules/policies/posts.ts"
    ],
    "cases": [
      "T05",
      "T10",
      "T12",
      "src/domain/rules/stock.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "S04",
    "revision": 1,
    "title": "跨界及墙边整管可沿轴线移动，保留有效段与全部接点；不以余量优化换穿屋",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/placement.ts",
      "src/domain/rules/policies/placementConstraints.ts",
      "src/domain/rules/policies/positioner.ts"
    ],
    "cases": [
      "T10",
      "T11",
      "src/domain/rules/placement.test.ts",
      "src/domain/guardrails.test.ts"
    ]
  },
  {
    "id": "C01",
    "revision": 1,
    "title": "十字扣按真实相连成员对计一次；填芯只在实际横杆交点计；移走的柱不计虚扣",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/policies/connections.ts",
      "src/domain/rules/connections.ts"
    ],
    "cases": [
      "T05",
      "T12",
      "src/domain/rules/connections.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "C02",
    "revision": 1,
    "title": "每个物理管接头一只对接扣；位置与方向跟随真实组管",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/connections.ts",
      "src/domain/rules/facts/fittings.ts"
    ],
    "cases": [
      "T05",
      "T10",
      "T12",
      "src/domain/rules/stock.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "C03",
    "revision": 1,
    "title": "转向扣和未建模剪刀撑／连墙件不凭空生成数量；待定保持 null/--",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/materials.ts",
      "src/domain/rules/policies/materials.ts",
      "src/domain/rules/facts/materialLedger.ts"
    ],
    "cases": [
      "T05",
      "T06",
      "T12",
      "T14",
      "src/domain/rules/materials.test.ts",
      "src/domain/rules/facts/memberUses.test.ts"
    ]
  },
  {
    "id": "V01",
    "revision": 1,
    "title": "面不可用、轮廓无效、段过短、双排柱脚／底座无足够承托时定位问题，草图可保存",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/sectionValidation.ts",
      "src/domain/rules/siteValidation.ts",
      "src/domain/rules/policies/sectionValidation.ts",
      "src/domain/rules/policies/siteValidation.ts",
      "src/domain/rules/policies/blocks.ts"
    ],
    "cases": [
      "T10",
      "T12",
      "T13",
      "src/domain/rules/validation.test.ts",
      "src/domain/site.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "V02",
    "revision": 1,
    "title": "首层与当地扫地杆冲突时报错；扫地杆超既有高度口径另有提醒",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/sectionValidation.ts",
      "src/domain/rules/policies/sectionValidation.ts",
      "src/domain/rules/policies/pathValidation.ts"
    ],
    "cases": [
      "T10",
      "T12",
      "T13",
      "src/domain/rules/validation.test.ts",
      "src/domain/site.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "V03",
    "revision": 1,
    "title": "实体穿屋、独立架体重叠、接通区碰撞阻断；真实端节点有限接触允许",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/siteValidation.ts",
      "src/domain/rules/policies/siteValidation.ts",
      "src/domain/rules/policies/bridgeValidation.ts",
      "src/domain/rules/policies/collisionGeometry.ts"
    ],
    "cases": [
      "T10",
      "T12",
      "T13",
      "src/domain/rules/validation.test.ts",
      "src/domain/rules/collisionScopes.test.ts",
      "src/domain/rules/draft.test.ts",
      "src/domain/site.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "V04",
    "revision": 1,
    "title": "自交、折返、无法处理的短角、未建模支路等按现行提醒；不虚构交叉构造",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/pathValidation.ts",
      "src/domain/rules/policies/pathValidation.ts",
      "src/domain/rules/policies/topology.ts"
    ],
    "cases": [
      "T10",
      "T12",
      "T13",
      "src/domain/rules/validation.test.ts",
      "src/domain/site.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "O01",
    "revision": 1,
    "title": "钢管、扣件、片数、覆盖面积、槽钢从最终实体统一汇总；房屋不计材料",
    "status": "active",
    "implementation": "native",
    "source": [
      "src/domain/rules/materials.ts",
      "src/domain/rules/policies/materials.ts",
      "src/domain/rules/facts/materialLedger.ts"
    ],
    "cases": [
      "T05",
      "T06",
      "T12",
      "T14",
      "src/domain/rules/materials.test.ts",
      "src/domain/rules/facts/memberUses.test.ts"
    ]
  },
  {
    "id": "O02",
    "revision": 1,
    "title": "手工修正为增量，扣件一包 30 个；规格零数量可加，显示／CSV 共用修正后结果",
    "status": "active",
    "implementation": "boundary",
    "source": [
      "src/domain/rules/boundaries/adjustments.ts"
    ],
    "cases": [
      "T01",
      "T14",
      "src/domain/project.test.ts",
      "src/domain/scaffold.test.ts"
    ]
  },
  {
    "id": "O03",
    "revision": 1,
    "title": "项目／历史保留场景及修正，默认图只保留场景和参数；旧图恢复地面；符合条件才导出 OA 0.6",
    "status": "active",
    "implementation": "boundary",
    "source": [
      "src/domain/rules/boundaries/sceneFiles.ts",
      "src/domain/rules/boundaries/projects.ts",
      "src/domain/rules/boundaries/history.ts"
    ],
    "cases": [
      "T01",
      "T14",
      "src/domain/rules/boundaries/outputs.test.ts",
      "src/domain/site.test.ts",
      "src/domain/history.test.ts"
    ]
  },
  {
    "id": "O04",
    "revision": 1,
    "title": "周长及段号按原测量笔画，自动拆段／桥接不额外加周长；编辑拆组不改变物理语义",
    "status": "active",
    "implementation": "boundary",
    "source": [
      "src/domain/rules/boundaries/dimensions.ts"
    ],
    "cases": [
      "T01",
      "T14",
      "src/domain/rules/boundaries/outputs.test.ts",
      "src/domain/site.test.ts",
      "src/domain/history.test.ts"
    ]
  }
]
