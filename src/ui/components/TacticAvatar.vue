<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DEFAULT_AVATAR_URL, resolveModelAvatar } from '../avatars'

const props = withDefaults(
  defineProps<{
    author: string
    size?: 'xs' | 'sm' | 'md' | 'lg'
    team?: 'red' | 'black' | 'neutral'
  }>(),
  {
    size: 'md',
    team: 'neutral',
  },
)

const resolved = computed(() => resolveModelAvatar(props.author))
const failed = ref(false)

watch(
  () => props.author,
  () => {
    failed.value = false
  },
)

const src = computed(() => (failed.value ? DEFAULT_AVATAR_URL : resolved.value.url))

const boxClass = computed(() => {
  switch (props.size) {
    case 'xs':
      return 'h-4 w-4 rounded-[4px] p-[2px]'
    case 'sm':
      return 'h-7 w-7 rounded-lg p-1'
    case 'lg':
      return 'h-11 w-11 rounded-xl p-1.5'
    default:
      return 'h-9 w-9 rounded-xl p-1.5'
  }
})

const ringClass = computed(() => {
  switch (props.team) {
    case 'red':
      return 'border-vermilion-600/30 bg-white shadow-[0_2px_8px_-4px_rgba(163,51,40,.45)]'
    case 'black':
      return 'border-ink-800/25 bg-white shadow-[0_2px_8px_-4px_rgba(33,28,24,.45)]'
    default:
      return 'border-ink-200/90 bg-white'
  }
})
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center overflow-hidden border"
    :class="[boxClass, ringClass]"
    :title="resolved.matched ? `${resolved.provider} · ${author}` : author"
  >
    <img
      :src="src"
      :alt="author"
      class="h-full w-full object-contain"
      loading="lazy"
      @error="failed = true"
    />
  </span>
</template>
