<script setup lang="ts">
import Icon from './Icon.vue'

defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-ink-900/40 backdrop-blur-[3px]" @click="$emit('close')" />
      <div
        class="modal-enter-active relative max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-ink-200 bg-paper-50 p-6 shadow-float sm:p-8"
      >
        <button class="icon-btn absolute right-4 top-4" type="button" @click="$emit('close')">
          <Icon name="x" :size="16" />
        </button>

        <div class="flex items-center gap-3">
          <div class="seal h-10 w-10 text-lg">棋</div>
          <div>
            <div class="kicker">Spectator Guide</div>
            <h2 class="font-display text-2xl font-bold text-ink-800">这是一场自动对战</h2>
          </div>
        </div>

        <p class="mt-4 text-sm leading-7 text-ink-500">
          你不需要走棋，也不会替任何一方微操。红黑两军各由一套策略指挥，在放大的象棋盘上
          15 对 15 实时厮杀。你做的事只有三件：<b class="text-ink-700">选策略、调参数、看结果</b>。
        </p>

        <div class="mt-6 grid gap-3 sm:grid-cols-2">
          <div class="rounded-xl border border-ink-200/70 bg-white/60 p-4">
            <div class="flex items-center gap-2 text-ink-700">
              <Icon name="flag" :size="16" />
              <span class="text-sm font-semibold">胜负</span>
            </div>
            <p class="mt-2 text-xs leading-6 text-ink-500">
              摧毁敌方基地即获胜。局时归零不判平，进入加时：双方基地等速流血，复活读条按倍率
              缩短——士、象也走这条读条回来，不再白送归队。先扛不住的一方先倒。
            </p>
          </div>
          <div class="rounded-xl border border-ink-200/70 bg-white/60 p-4">
            <div class="flex items-center gap-2 text-ink-700">
              <Icon name="cpu" :size="16" />
              <span class="text-sm font-semibold">决策</span>
            </div>
            <p class="mt-2 text-xs leading-6 text-ink-500">
              策略每秒做 8 次判断，只能表达移动、攻击、架炮、跃击、传送等白名单意图。
              能不能做到、做多快、造成多少伤害，由引擎裁决。
            </p>
          </div>
          <div class="rounded-xl border border-ink-200/70 bg-white/60 p-4">
            <div class="flex items-center gap-2 text-ink-700">
              <Icon name="eye" :size="16" />
              <span class="text-sm font-semibold">观看</span>
            </div>
            <p class="mt-2 text-xs leading-6 text-ink-500">
              点击任意棋子可查看血量、形态、技能冷却与当前意图；空格暂停，1 / 2 / 4
              切换倍速。棋盘上的虚线圈是出生点与复活点，单位阵亡时圈内直接显示复活倒计时。
            </p>
          </div>
          <div class="rounded-xl border border-ink-200/70 bg-white/60 p-4">
            <div class="flex items-center gap-2 text-ink-700">
              <Icon name="spark" :size="16" />
              <span class="text-sm font-semibold">注意</span>
            </div>
            <p class="mt-2 text-xs leading-6 text-ink-500">
              棋子不按象棋走法移动，但保留原版性格：车横扫、马跃击、炮架起、兵击退、
              士巡防、象传送。炮的射程只够压到对面半场，站到能打基地的位置就一定在炮塔射程内；
              士在基地周围巡走，不会站桩。
            </p>
          </div>
        </div>

        <div class="mt-5 rounded-xl border border-gold-400/30 bg-gold-300/10 p-4">
          <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-600">Two Personalities</div>
          <p class="mt-2 text-xs leading-6 text-ink-600">
            <b class="text-vermilion-600">全军冲锋</b> 见谁打谁、不撤退，是最直白的标尺；
            <b class="text-jade-600">防守反击</b> 会读威胁、布阵、集火、残血回城、炮位轮转，
            并在加时按比分死守或换家。
          </p>
        </div>

        <div class="mt-6 flex justify-end">
          <button class="btn-ink" type="button" @click="$emit('close')">明白了</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
