<script setup lang="ts">
import { ref } from 'vue'
import SetupScreen from './ui/SetupScreen.vue'
import BattleScreen from './ui/BattleScreen.vue'
import type { LaunchOptions } from './ui/types'

const screen = ref<'setup' | 'battle'>('setup')
const launch = ref<LaunchOptions | null>(null)
const battleKey = ref(0)

function start(options: LaunchOptions) {
  launch.value = options
  battleKey.value++
  screen.value = 'battle'
}

function exitBattle() {
  screen.value = 'setup'
}

function rematch() {
  if (!launch.value) return
  launch.value = {
    ...launch.value,
    seed: Math.floor(100000 + Math.random() * 900000),
  }
  battleKey.value++
}
</script>

<template>
  <SetupScreen v-if="screen === 'setup'" @start="start" />
  <BattleScreen
    v-else-if="launch"
    :key="battleKey"
    :launch="launch"
    @exit="exitBattle"
    @rematch="rematch"
  />
</template>
