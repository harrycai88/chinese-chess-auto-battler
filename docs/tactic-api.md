# 策略协议（v0.1）

策略只表达意图，不修改规则。v0.1 的内置策略和未来的外部策略共用同一套接口。

## 1. 接口

```ts
interface Tactic {
  id: string
  name: string
  author: string
  version: string
  description: string
  style: string
  complexity: number          // 1–5，仅用于界面展示
  tags: string[]
  accent: 'vermilion' | 'jade' | 'gold' | 'ink'
  createMemory(): TacticMemory
  decide(snapshot: Snapshot, memory: TacticMemory): IntentMap
}
```

- `createMemory`：每场对局调用一次，返回策略自己的跨 tick 记忆。引擎不解释它。
- `decide`：每 125ms 调用一次，返回 `{ [unitId]: Intent }`；一个单位每个决策 tick 最多一条意图。
- 策略只能读快照。快照是每 tick 重新构建的纯数据，不含引擎对象、函数引用或可变引用。

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
| `MOVE_TO` | x, y | 单位可移动、目标点 clamp 进棋盘；士额外 clamp 进九宫 |
| `MOVE_DIR` | x, y | 方向非零；位置仍受棋盘与九宫约束 |
| `ATTACK_TARGET` | targetId | 目标存在、存活、属于敌方、可被选中 |
| `DEPLOY` / `UNDEPLOY` | — | 仅炮；形态必须匹配 |
| `CAST_JUMP` | targetId | 仅马；冷却就绪；距离落在起跳窗口；目标可选中 |
| `TELEPORT_ANCHOR` | starId | 仅象；冷却就绪；目标星位与当前星位“田”字相邻；未被其他象占用 |
| `IDLE` | — | 不主动移动；防御性自动攻击仍然生效 |

使用约定：

- `ATTACK_TARGET` 同时承担接近：目标不在攻击距离内时单位会朝它移动，进入距离后停下开火。
- 移动意图不会关闭自动攻击：路过敌人时仍会还手，只是移动会被交战减速。
- 技能意图是瞬时动作；触发后由单位自己的状态机接管，不会每 tick 重复触发。

## 4. 拒绝原因

非法意图不会被静默吞掉。引擎按阵营累计拒绝数，并保留最近若干条样本：

```text
unknown-unit / not-yours / dead / unknown-action / missing-param
illegal-target / out-of-window / cooldown / star-not-adjacent
star-occupied / form-not-allowed / immobile / busy / bad-param
```

控制台左侧的「拒绝」计数与批量仿真统计使用同一份数据。

## 5. 写一个内置策略

1. 在 `src/engine/tactics/builtin/` 新建文件，导出 `Tactic`。
2. 在 `src/engine/tactics/index.ts` 的 `BUILTIN_TACTICS` 注册。
3. 在 `tests/engine.test.ts` 增加针对该策略的回归或契约用例。

最小样例：

```ts
import type { IntentMap, Snapshot, Tactic } from '../api'
import { distance } from '../api'

export const rusher: Tactic = {
  id: 'rusher',
  name: '冲锋',
  author: 'you',
  version: '1.0.0',
  description: '每个单位攻击最近的敌人',
  style: '激进',
  complexity: 1,
  tags: ['简单'],
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
