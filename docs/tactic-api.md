# 策略协议（v0.1）

策略只表达意图，不修改规则。`builtin/` 里的内置策略与 `external/` 里的外部策略共用同一套接口、同一个注册表。

## 1. 接口

```ts
interface Tactic {
  id: string            // 小写 slug，全局唯一
  name: string
  author: string
  version: string
  description: string   // 唯一的一段自述：打法、性格、难度、适用场景
  accent: 'vermilion' | 'jade' | 'gold' | 'ink'
  glyph?: string        // 印章单字，缺省取名字首字
  createMemory(): TacticMemory
  decide(snapshot: Snapshot, memory: TacticMemory): IntentMap
}
```

- `createMemory`：每场对局调用一次，返回策略自己的跨 tick 记忆。引擎不解释它。
- `decide`：每 125ms 调用一次，返回 `{ [unitId]: Intent }`；一个单位每个决策 tick 最多一条意图。
- 策略只能读快照。快照是每 tick 重新构建的纯数据，不含引擎对象、函数引用或可变引用。
- 元数据只有一段 `description`。不拆「风格 / 难度 / 标签」——那几项最后总是半写半空，
  不如让作者用一句话把性格、强度、适用场景说完整，界面上也只呈现这一处。

## 2. 快照

```ts
interface Snapshot {
  time: number
  phase: 'normal' | 'overtime' | 'ended'
  duration: number | null
  remaining: number
  overtimeElapsed: number
  team: Team
  enemyTeam: Team
  board: { width; height; riverY }
  palace: { x0; x1; y0; y1 }
  myBase: UnitView
  enemyBase: UnitView
  allies: UnitView[]        // 含阵亡单位（可读 respawnIn）
  enemies: UnitView[]       // 只含存活敌人
  stars: StarView[]         // 己方星位、邻接与占用
  rules: SnapshotRules      // 当前生效的关键数值
}
```

`UnitView` 里可以读到位置、血量、半径、质量、射程、伤害、当前形态、跃击/传送阶段、硬直、脱战时间、技能冷却、是否可被选中、意图目标等。

`StarView.nearbyEnemies` 是引擎替策略算好的“这个星位落地能震到几个敌人”，减少重复遍历。

## 3. 意图白名单

| 意图 | 参数 | 引擎裁决 |
|:--|:--|:--|
| `MOVE_TO` | x, y | 单位可移动、目标点 clamp 进棋盘；士额外 clamp 进防区（以己方基地为圆心） |
| `MOVE_DIR` | x, y | 方向非零；位置仍受棋盘与防区约束 |
| `ATTACK_TARGET` | targetId | 目标存在、存活、属于敌方、可被选中 |
| `DEPLOY` / `UNDEPLOY` | — | 仅炮；形态必须匹配 |
| `CAST_JUMP` | targetId | 仅马；冷却就绪；距离落在起跳窗口；目标可选中 |
| `TELEPORT_ANCHOR` | starId | 仅象；冷却就绪；目标星位与当前星位“田”字相邻；未被其他象占用 |
| `IDLE` | — | 不主动移动；防御性自动攻击仍然生效。士例外：它会继续在防区里巡走，不会站桩 |

使用约定：

- `ATTACK_TARGET` 同时承担接近：目标不在攻击距离内时单位会朝它移动，进入距离后停下开火。
- 移动意图不会关闭自动攻击：路过敌人时仍会还手，只是移动会被交战减速。
- 技能意图是瞬时动作；触发后由单位自己的状态机接管，不会每 tick 重复触发。
- 士是「不能站桩」的护卫：策略给的点只决定它往哪一侧压，轨迹由引擎的巡防逻辑接管；
  它的射程与防区半径可以从 `rules.advisorGuardRadius` 与单位的 `attackRange` 读到。

## 4. 拒绝原因

非法意图不会被静默吞掉。引擎按阵营累计拒绝数，并保留最近若干条样本：

```text
unknown-unit / not-yours / dead / unknown-action / missing-param
illegal-target / out-of-window / cooldown / star-not-adjacent
star-occupied / form-not-allowed / immobile / busy / bad-param
```

控制台左侧的「拒绝」计数与批量仿真统计使用同一份数据。

## 5. 注册一套策略

内置与外部**分目录存放**，共用同一个注册表：

```text
src/engine/tactics/
├── api.ts          协议
├── registry.ts     校验（validateTactic）与注册（buildRegistry）
├── index.ts        注册表出口：BUILTIN_TACTICS / EXTERNAL_TACTICS / ALL_TACTICS
├── builtin/
│   ├── index.ts    BUILTIN_TACTIC_DEFS
│   ├── charge.ts
│   └── counter.ts
└── external/
    └── index.ts    EXTERNAL_TACTIC_DEFS（默认空）
```

内置策略：

1. 在 `builtin/` 新建文件，导出 `Tactic`。
2. 在 `builtin/index.ts` 的 `BUILTIN_TACTIC_DEFS` 里登记一行。
3. 在 `tests/engine.test.ts` 增加针对该策略的回归或契约用例。

外部策略：同样的两步，只是文件放 `external/`、登记进 `EXTERNAL_TACTIC_DEFS`。
引擎、配置页、仿真脚本都不用改——配置页的下拉会按「内置策略 / 外部策略」分组列出。

**加载时校验**（`validateTactic`）：`id` 形状（小写 slug）与唯一性、必填字段非空、
`accent` 枚举、`glyph` 单字符、`createMemory` / `decide` 是函数。

**取用**：`findTactic(id)` 可能返回 `undefined`；`getTactic(id)` 找不到直接抛错并列出已有 id。
这里刻意不回落——id 打错时宁可炸在调用点，也不要悄悄换一套策略打完一局。

最小样例：

```ts
import type { IntentMap, Snapshot, Tactic } from '../api'
import { distance } from '../api'

export const rusher: Tactic = {
  id: 'rusher',
  name: '冲锋',
  author: 'you',
  version: '1.0.0',
  description: '简单、激进。每个单位攻击最近的敌人，不作撤退。',
  accent: 'vermilion',
  createMemory: () => ({}),
  decide(snap: Snapshot): IntentMap {
    const intents: IntentMap = {}
    const targets = snap.enemies.filter((e) => e.targetable)
    for (const u of snap.allies) {
      if (!u.alive) continue
      let best = targets[0]
      let bestD = best ? distance(u, best) : Infinity
      for (const t of targets) {
        const d = distance(u, t)
        if (d < bestD) { bestD = d; best = t }
      }
      intents[u.id] = best ? { type: 'attack', targetId: best.id } : { type: 'idle' }
    }
    return intents
  },
}
```

## 6. 编写约定

- 不使用 `Math.random`、`Date.now`、DOM、网络或本地存储；这些会破坏可复现性。
- 不修改快照对象；想记住东西就写进 `memory`。
- 策略自己的阈值写在策略里，不要求引擎暴露内部字段。
- 优先使用 `snap.rules` 里的数值（射程、盲区、跃击窗口、复活时间），而不是硬编码。
- 如果一条意图依赖“上一 tick 的状态”，把状态放进 `memory`，并给明确的退出条件，避免在阈值附近振荡。
