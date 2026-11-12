<script setup lang="ts">
export interface SegmentOption {
  value: string | number
  label: string
  hint?: string
}

const props = defineProps<{
  modelValue: string | number
  options: SegmentOption[]
  compact?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()
</script>

<template>
  <div class="segment" :class="props.compact ? '!p-0.5' : ''">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      :class="{ active: opt.value === modelValue }"
      @click="emit('update:modelValue', opt.value)"
    >
      <span class="block leading-tight">{{ opt.label }}</span>
      <span v-if="opt.hint" class="mt-0.5 block text-[9px] font-normal opacity-60">{{ opt.hint }}</span>
    </button>
  </div>
</template>
