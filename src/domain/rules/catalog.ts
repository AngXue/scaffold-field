import type { RuleDefinition } from './contracts.ts'

/** Migration inventory. Adapter status is explicit until a rule is extracted. */
export const RULES: readonly RuleDefinition[] = [
  {
    "id": "I01",
    "revision": 1,
    "title": "缺失参数补默认，保留明确旧值；旧 height、rowCount 迁移；库存补入 5 / 3.5 m",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "J.restoreParameters；K.calculateScaffold 参数适配"
    ],
    "cases": [
      "S0；J测、K测 legacy parameters"
    ]
  },
  {
    "id": "I02",
    "revision": 1,
    "title": "场景米制、旧图 50 px/m；层边界按毫米；覆盖细坐标保留 6 位精度",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "S.mm/roundSite；P；K.deckBetweenStations 等"
    ],
    "cases": [
      "跨阶段数值合同；S测层高边界、K测覆盖及变换"
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
    "implementation": "legacy-adapter",
    "source": [
      "K.calculateScaffold stations/cornerStations"
    ],
    "cases": [
      "S2；K测短折返、几何审计"
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
    "implementation": "legacy-adapter",
    "source": [
      "S.componentGroups/sharedFootingPair；E.splitSectionRange"
    ],
    "cases": [
      "S2；K测不同层、E测划分单段"
    ]
  },
  {
    "id": "G08",
    "revision": 1,
    "title": "内角合柱、外角延伸补柱、共点取较高柱；闭合首尾同规则；必需跨界端柱对保留",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.offsetRowCrossing/requiredEndPairs；S.calculateSiteSpans"
    ],
    "cases": [
      "S2；K测内外角闭环、E测 B2"
    ]
  },
  {
    "id": "G09",
    "revision": 1,
    "title": "连续短折返可借相邻已有延伸；冗余端柱受 0.25 m、纵距、交点支承条件限制",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.offsetPostLimits/nearTrimmedCorner"
    ],
    "cases": [
      "S2；K测 user-short-returns、短边失败"
    ]
  },
  {
    "id": "M01",
    "revision": 1,
    "title": "始终两排立杆；填芯数量只改变钢笆纵向支承杆",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.calculateScaffold postRows/supportRows"
    ],
    "cases": [
      "S3；K测三条支承杆"
    ]
  },
  {
    "id": "M02",
    "revision": 1,
    "title": "当地顶层高度加固定延伸；带栏杆排与开口端按现有较高柱需求，实际定尺另算",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.postHeightAt/theoreticalAt/railedAt"
    ],
    "cases": [
      "S3/S4；K测内外柱、开口端高柱"
    ]
  },
  {
    "id": "M03",
    "revision": 1,
    "title": "纵杆和填芯按现有转角范围齐长；横杆不加管端外伸；成功转角省其横杆",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.memberRows/addHorizontalBand"
    ],
    "cases": [
      "S3；K测 7.1+4.3 齐长、横管、无悬空"
    ]
  },
  {
    "id": "M04",
    "revision": 1,
    "title": "扫地杆从当地底面算，只有两排普通纵杆及横杆，无钢笆／填芯",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.sweepElevation/addHorizontalBand；S.calculateSiteSpans"
    ],
    "cases": [
      "S3；K测 sweep/deckless、S测首层冲突"
    ]
  },
  {
    "id": "M05",
    "revision": 1,
    "title": "钢笆按选定规格及 0.10 m 搭接计整片；铺板间隔按全局层；外角补角片",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.deckPanelCount/deckBetweenStations/cornerDecks"
    ],
    "cases": [
      "S3；K测片数、S测交替铺板及屋顶手算"
    ]
  },
  {
    "id": "M06",
    "revision": 1,
    "title": "同层重叠覆盖只计一次；内角归进段，裁片不按碎面数重复计片，不留孔洞",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.resolveDeckCoverage；polygons.subtractCoverage"
    ],
    "cases": [
      "S3；K测裁片、F测凹形、审计"
    ]
  },
  {
    "id": "M07",
    "revision": 1,
    "title": "每柱对一根与横管等长的槽钢；转角单方向；无柱或支承被更完整底座承接时去重",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.calculateScaffold/finishLayout bases"
    ],
    "cases": [
      "S3；K测 channel、审计 unbased-posts"
    ]
  },
  {
    "id": "M08",
    "revision": 1,
    "title": "同高同线同用途直杆合并；纵横共用保留 roles；只组装、渲染、计量一次",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.mergeSharedRuns/reassembleSiteRuns"
    ],
    "cases": [
      "S6；K测共线及支路重组、E测旋转"
    ]
  },
  {
    "id": "P01",
    "revision": 1,
    "title": "单道居中，两道按现有上皮／居中；顶层多架顶栏杆，最高无板层仍有架顶防护",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.guardrailsFor/guardedThisLift"
    ],
    "cases": [
      "S3 候选、S5 生效；K测 rail courses/coping"
    ]
  },
  {
    "id": "P02",
    "revision": 1,
    "title": "外排纵向防护、真实开口横向折返；外侧交叉沿原角部延伸",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.railRow/endStations"
    ],
    "cases": [
      "S5；K测外排、开口、G测外角"
    ]
  },
  {
    "id": "P03",
    "revision": 1,
    "title": "内侧交叉可能进入同层通道时收至共用角柱，取消交叉端额外伸长",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.clipStart/clipEnd"
    ],
    "cases": [
      "S5；G测内角、不同层"
    ]
  },
  {
    "id": "P04",
    "revision": 1,
    "title": "面向较高实墙的低层端栏杆可省，真实外侧及更高独立防护保留",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "T.isWallEndGuard；W.guardFacesWall"
    ],
    "cases": [
      "S5；S测 corridor、E测双屋"
    ]
  },
  {
    "id": "P05",
    "revision": 1,
    "title": "共同全局作业层接通工作杆、钢笆及防护；短角从真实端柱借相邻面栏杆连接",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "T.connectSiteTransitions ends/matches"
    ],
    "cases": [
      "S3 工作接通、S5 防护接通；S测 corridor、E测 S1 upper guard"
    ]
  },
  {
    "id": "P06",
    "revision": 1,
    "title": "接通后打开双排之间的横向封口；已合并的邻面外栏杆只局部裁其封口区间",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "T.capCuts/openCaps；S.sharedStations"
    ],
    "cases": [
      "S5；E测 S1 连续／旋转／邻面保留"
    ]
  },
  {
    "id": "P07",
    "revision": 1,
    "title": "栏杆必须有足够柱顶承托；现行无承托时舍弃并提醒；真实连接按组装后柱顶判断",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.railsWithin/finishLayout；T.postTops"
    ],
    "cases": [
      "S4→S5；K测 surplus stock support、top-rail-height"
    ]
  },
  {
    "id": "P08",
    "revision": 1,
    "title": "整管余量尽量移出通道；管和对接扣一起移；无法消除的侵入允许保留",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "G.fitGuardrailStock；W.fitSceneGuardrails"
    ],
    "cases": [
      "S7；G测移位／两端受限／避墙"
    ]
  },
  {
    "id": "S01",
    "revision": 1,
    "title": "标准规格组合覆盖所需长度，先最少根数再较小有效总长；横管居中分配余量，立杆自底向上",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.chooseStockLengths/createPipeAssembly"
    ],
    "cases": [
      "S4/S6；K测 stock/long run、S测屋顶"
    ]
  },
  {
    "id": "S02",
    "revision": 1,
    "title": "立柱所有选管路径禁用 5 m，允许 3.5 m；库存只剩禁用规格时按现行回退并提醒",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.postStocks/calculateScaffold"
    ],
    "cases": [
      "S4；K测 expanded stock/no permitted size"
    ]
  },
  {
    "id": "S03",
    "revision": 1,
    "title": "邻柱接头错开，优先不同序列及不同总长；按最终现行邻接修复；无解提示",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.neighbourStockSequence/repairPostSplices"
    ],
    "cases": [
      "S4；K测 stagger、审计"
    ]
  },
  {
    "id": "S04",
    "revision": 1,
    "title": "跨界及墙边整管可沿轴线移动，保留有效段与全部接点；不以余量优化换穿屋",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "T.fitTransitionStock；W.fitStockBesideWalls"
    ],
    "cases": [
      "S7；S测穿屋、G测 wall constraint"
    ]
  },
  {
    "id": "C01",
    "revision": 1,
    "title": "十字扣按真实相连成员对计一次；填芯只在实际横杆交点计；移走的柱不计虚扣",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.finishLayout/addCross"
    ],
    "cases": [
      "S8；K测 main-node/phantom ties/unique pairs"
    ]
  },
  {
    "id": "C02",
    "revision": 1,
    "title": "每个物理管接头一只对接扣；位置与方向跟随真实组管",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.createPipeAssembly；G/T 余量移位"
    ],
    "cases": [
      "S8；K测 sleeve、G测 butt moves"
    ]
  },
  {
    "id": "C03",
    "revision": 1,
    "title": "转向扣和未建模剪刀撑／连墙件不凭空生成数量；待定保持 null/--",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.calculateMaterials/PENDING_MATERIALS"
    ],
    "cases": [
      "S9；K测 pending/excludes ties"
    ]
  },
  {
    "id": "V01",
    "revision": 1,
    "title": "面不可用、轮廓无效、段过短、双排柱脚／底座无足够承托时定位问题，草图可保存",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "S.resolveBlocks/calculateSiteSpans；F"
    ],
    "cases": [
      "S1/S9；F测、S测 short/missing/footing"
    ]
  },
  {
    "id": "V02",
    "revision": 1,
    "title": "首层与当地扫地杆冲突时报错；扫地杆超既有高度口径另有提醒",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "S.calculateSiteSpans；K warnings"
    ],
    "cases": [
      "S1/S9；S测 sweep-conflict、K测 sweep"
    ]
  },
  {
    "id": "V03",
    "revision": 1,
    "title": "实体穿屋、独立架体重叠、接通区碰撞阻断；真实端节点有限接触允许",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "S.pipeEntersBlock/physicalGroups/bridge validation"
    ],
    "cases": [
      "S9；S测 invalid/bridge-overlap、E测原图"
    ]
  },
  {
    "id": "V04",
    "revision": 1,
    "title": "自交、折返、无法处理的短角、未建模支路等按现行提醒；不虚构交叉构造",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.calculateScaffold/calculateScaffoldPlan warnings"
    ],
    "cases": [
      "S2/S9；K测 crossing/short/branch"
    ]
  },
  {
    "id": "O01",
    "revision": 1,
    "title": "钢管、扣件、片数、覆盖面积、槽钢从最终实体统一汇总；房屋不计材料",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.calculateMaterials；S/T 汇总"
    ],
    "cases": [
      "S9；K测 totals、S测固定手算"
    ]
  },
  {
    "id": "O02",
    "revision": 1,
    "title": "手工修正为增量，扣件一包 30 个；规格零数量可加，显示／CSV 共用修正后结果",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "K.materialQuantity/materialAdjustmentStep/stockMaterialRows"
    ],
    "cases": [
      "输出适配；K测 material/bag、网页导出"
    ]
  },
  {
    "id": "O03",
    "revision": 1,
    "title": "项目／默认图／历史保留场景及修正；旧图恢复地面；符合条件才导出 OA 0.6",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "S.readSite/siteFromSnapshot/legacySiteDrawing；H/J"
    ],
    "cases": [
      "输入输出适配；S测旧档、H测、J测、网页"
    ]
  },
  {
    "id": "O04",
    "revision": 1,
    "title": "周长及段号按原测量笔画，自动拆段／桥接不额外加周长；编辑拆组不改变物理语义",
    "status": "active",
    "implementation": "legacy-adapter",
    "source": [
      "S.calculateSite/pathDimensions；K；E"
    ],
    "cases": [
      "输出适配；K测 perimeter、E测 split、网页"
    ]
  }
]
