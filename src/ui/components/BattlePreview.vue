<script setup lang="ts">
import { computed } from 'vue'

withDefaults(defineProps<{ redName?: string; blackName?: string }>(), {
  redName: '全军冲锋',
  blackName: '防守反击',
})

interface PreviewPiece {
  x: number
  y: number
  char: string
  team: 'red' | 'black'
  kind: string
  delay: number
}

const CELL = 42
const PAD = 34

const custom: Array<Omit<PreviewPiece, 'x' | 'y' | 'delay'> & { x: number; y: number }> = [
  { x: 4, y: 8, char: '帅', team: 'red', kind: 'base' },
  { x: 4, y: 1, char: '将', team: 'black', kind: 'base' },
  { x: 0, y: 9, char: '车', team: 'red', kind: 'rook' },
  { x: 8, y: 9, char: '车', team: 'red', kind: 'rook' },
  { x: 0, y: 0, char: '车', team: 'black', kind: 'rook' },
  { x: 8, y: 0, char: '车', team: 'black', kind: 'rook' },
  { x: 1, y: 7, char: '炮', team: 'red', kind: 'cannon' },
  { x: 7, y: 7, char: '炮', team: 'red', kind: 'cannon' },
  { x: 1, y: 2, char: '炮', team: 'black', kind: 'cannon' },
  { x: 7, y: 2, char: '炮', team: 'black', kind: 'cannon' },
  { x: 2, y: 6, char: '兵', team: 'red', kind: 'pawn' },
  { x: 4, y: 6, char: '兵', team: 'red', kind: 'pawn' },
  { x: 6, y: 6, char: '兵', team: 'red', kind: 'pawn' },
  { x: 2, y: 3, char: '卒', team: 'black', kind: 'pawn' },
  { x: 4, y: 3, char: '卒', team: 'black', kind: 'pawn' },
  { x: 6, y: 3, char: '卒', team: 'black', kind: 'pawn' },
  { x: 7, y: 9, char: '马', team: 'red', kind: 'horse' },
  { x: 1, y: 0, char: '马', team: 'black', kind: 'horse' },
]

const pieces = computed(() => custom)

const px = (x: number) => PAD + x * CELL
const py = (y: number) => PAD + y * CELL
</script>

<template>
  <div class="relative overflow-hidden rounded-2xl border border-ink-900/10 bg-[#2b1b10] p-[2px] shadow-[0_40px_90px_-40px_rgba(50,30,14,.8)]">
    <div class="relative overflow-hidden rounded-[14px] bg-[#d9b47e]">
      <svg viewBox="0 0 404 456" class="block h-auto w-full" role="img" aria-label="实时象棋战场预览">
        <defs>
          <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#e6c796" />
            <stop offset="0.45" stop-color="#d9b47e" />
            <stop offset="1" stop-color="#c3955d" />
          </linearGradient>
          <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#5d3b22" />
            <stop offset="1" stop-color="#2c1a0d" />
          </linearGradient>
          <linearGradient id="redRim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#c15a49" />
            <stop offset="0.5" stop-color="#9c2f24" />
            <stop offset="1" stop-color="#6a1a13" />
          </linearGradient>
          <linearGradient id="blackRim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#52525c" />
            <stop offset="0.5" stop-color="#2a2a31" />
            <stop offset="1" stop-color="#0e0e12" />
          </linearGradient>
          <radialGradient id="redFace" cx="35%" cy="30%" r="75%">
            <stop offset="0" stop-color="#fbf0db" />
            <stop offset="0.7" stop-color="#ead3ab" />
            <stop offset="1" stop-color="#d3b283" />
          </radialGradient>
          <radialGradient id="blackFace" cx="35%" cy="30%" r="75%">
            <stop offset="0" stop-color="#f8eeda" />
            <stop offset="0.7" stop-color="#e4cfa9" />
            <stop offset="1" stop-color="#c9ae83" />
          </radialGradient>
          <radialGradient id="redGlow">
            <stop offset="0" stop-color="#ffb08a" stop-opacity=".65" />
            <stop offset="1" stop-color="#ffb08a" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="blackGlow">
            <stop offset="0" stop-color="#b8c0d0" stop-opacity=".5" />
            <stop offset="1" stop-color="#b8c0d0" stop-opacity="0" />
          </radialGradient>
          <filter id="pieceShadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="2.4" stdDeviation="2.4" flood-color="#3a2412" flood-opacity=".38" />
          </filter>
          <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>

        <!-- 外框 -->
        <rect x="4" y="4" width="396" height="448" rx="14" fill="url(#frame)" />
        <rect x="14" y="14" width="376" height="428" rx="7" fill="url(#wood)" />
        <rect x="14" y="14" width="376" height="428" rx="7" fill="none" stroke="#c9a45e" stroke-opacity=".5" />

        <!-- 网格 -->
        <g stroke="#4a2f19" stroke-opacity=".55" stroke-width="1.1">
          <line v-for="i in 9" :key="'v' + i" :x1="px(i - 1)" :y1="py(0)" :x2="px(i - 1)" :y2="py(9)" />
          <line v-for="j in 10" :key="'h' + j" :x1="px(0)" :y1="py(j - 1)" :x2="px(8)" :y2="py(j - 1)" />
        </g>
        <!-- 河界留白 -->
        <rect :x="px(0)" :y="py(4.5) - 9" :width="px(8) - px(0)" height="18" fill="#d9b47e" opacity=".92" />
        <g stroke="#4a2f19" stroke-opacity=".55" stroke-width="1.1">
          <line v-for="i in 8" :key="'v2' + i" :x1="px(i)" :y1="py(4.5) - 9" :x2="px(i)" :y2="py(4.5) + 9" opacity=".25" />
        </g>
        <text
          :x="px(2.4)"
          :y="py(4.5) + 5"
          text-anchor="middle"
          fill="#4a2f19"
          fill-opacity=".38"
          font-family="KaiTi, STKaiti, SimSun, serif"
          font-size="15"
        >
          楚 河
        </text>
        <text
          :x="px(5.6)"
          :y="py(4.5) + 5"
          text-anchor="middle"
          fill="#4a2f19"
          fill-opacity=".38"
          font-family="KaiTi, STKaiti, SimSun, serif"
          font-size="15"
        >
          汉 界
        </text>

        <!-- 九宫 -->
        <g stroke="#4a2f19" stroke-opacity=".45" stroke-width="1">
          <line :x1="px(3)" :y1="py(0)" :x2="px(5)" :y2="py(2)" />
          <line :x1="px(5)" :y1="py(0)" :x2="px(3)" :y2="py(2)" />
          <line :x1="px(3)" :y1="py(7)" :x2="px(5)" :y2="py(9)" />
          <line :x1="px(5)" :y1="py(7)" :x2="px(3)" :y2="py(9)" />
        </g>

        <!-- 基地光晕 -->
        <circle :cx="px(4)" :cy="py(8)" r="64" fill="url(#redGlow)" filter="url(#softGlow)" />
        <circle :cx="px(4)" :cy="py(1)" r="64" fill="url(#blackGlow)" filter="url(#softGlow)" />
        <circle
          :cx="px(4)"
          :cy="py(8)"
          r="34"
          fill="none"
          stroke="#a33328"
          stroke-opacity=".45"
          stroke-dasharray="3 4"
        >
          <animate attributeName="r" values="32;36;32" dur="3.2s" repeatCount="indefinite" />
        </circle>
        <circle
          :cx="px(4)"
          :cy="py(1)"
          r="34"
          fill="none"
          stroke="#2a2a31"
          stroke-opacity=".45"
          stroke-dasharray="3 4"
        >
          <animate attributeName="r" values="32;36;32" dur="3.6s" repeatCount="indefinite" />
        </circle>

        <!-- 兵线交汇火花 -->
        <g opacity=".8">
          <circle :cx="px(4)" :cy="py(4.5)" r="2.2" fill="#fff6df">
            <animate attributeName="opacity" values=".2;1;.2" dur="2.4s" repeatCount="indefinite" />
          </circle>
          <circle :cx="px(4.5)" :cy="py(4.2)" r="1.4" fill="#ffd9a0">
            <animate attributeName="opacity" values="1;.2;1" dur="1.8s" repeatCount="indefinite" />
          </circle>
          <circle :cx="px(3.4)" :cy="py(4.7)" r="1.1" fill="#ffe8bf">
            <animate attributeName="opacity" values=".3;1;.3" dur="2.1s" repeatCount="indefinite" />
          </circle>
        </g>

        <!-- 棋子 -->
        <g v-for="p in pieces" :key="p.team + p.char + p.x + p.y" :filter="p.kind === 'base' ? undefined : 'url(#pieceShadow)'">
          <circle
            :cx="px(p.x)"
            :cy="py(p.y) + (p.kind === 'base' ? 6 : 2)"
            :r="p.kind === 'base' ? 24 : 16"
            :fill="p.team === 'red' ? 'url(#redRim)' : 'url(#blackRim)'"
          />
          <circle
            :cx="px(p.x)"
            :cy="py(p.y) + (p.kind === 'base' ? 6 : 2)"
            :r="p.kind === 'base' ? 20 : 13.2"
            :fill="p.team === 'red' ? 'url(#redFace)' : 'url(#blackFace)'"
          />
          <text
            :x="px(p.x)"
            :y="py(p.y) + (p.kind === 'base' ? 15 : 8)"
            text-anchor="middle"
            :fill="p.team === 'red' ? '#a02b21' : '#1d1d22'"
            font-family="KaiTi, STKaiti, SimSun, serif"
            :font-size="p.kind === 'base' ? 27 : 19"
            font-weight="700"
          >
            {{ p.char }}
          </text>
        </g>

        <!-- 冲锋箭头 -->
        <g fill="none" stroke="#a33328" stroke-opacity=".45" stroke-width="1.3" stroke-dasharray="4 4">
          <path :d="`M ${px(2)} ${py(6.4)} Q ${px(3.6)} ${py(5.1)} ${px(5.6)} ${py(5.5)}`" />
          <path :d="`M ${px(6)} ${py(6.2)} Q ${px(5)} ${py(5.2)} ${px(4.4)} ${py(5.6)}`" />
        </g>

        <!-- 角落题字 -->
        <text
          x="24"
          y="440"
          fill="#f8ecd4"
          fill-opacity=".55"
          font-size="8.5"
          letter-spacing="2.6"
          font-family="Microsoft YaHei, sans-serif"
        >
          实时沙盘 · LIVE SANDBOX
        </text>
      </svg>

      <div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <span class="rounded-md border border-white/20 bg-black/25 px-2 py-1 text-[10px] font-semibold tracking-[0.18em] text-paper-50/90 backdrop-blur">
          红 · {{ redName }}
        </span>
        <span class="rounded-md border border-white/20 bg-black/25 px-2 py-1 text-[10px] font-semibold tracking-[0.18em] text-paper-50/90 backdrop-blur">
          黑 · {{ blackName }}
        </span>
      </div>
      <div class="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4">
        <span class="rounded-full border border-white/15 bg-black/20 px-2.5 py-1 text-[10px] text-paper-50/75 backdrop-blur">
          30 单位 · 8Hz 决策
        </span>
        <span class="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/20 px-2.5 py-1 text-[10px] text-paper-50/75 backdrop-blur">
          <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300"></span>
          自动观战
        </span>
      </div>
    </div>
  </div>
</template>
