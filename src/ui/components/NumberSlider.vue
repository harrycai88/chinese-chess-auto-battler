<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: number
    min: number
    max: number
    step?: number
    suffix?: string
    hint?: string
    accent?: 'vermilion' | 'jade'
  }>(),
  {
    step: 0.01,
    suffix: '',
    hint: '',
    accent: 'vermilion',
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const pct = computed(() => ((props.modelValue - props.min) / (props.max - props.min)) * 100)
const display = computed(() => `${props.modelValue.toFixed(2)}${props.suffix}`)

function onInput(e: Event) {
  emit('update:modelValue', Number((e.target as HTMLInputElement).value))
}
</script>

<template>
  <div>
    <div class="flex items-baseline justify-between gap-3">
      <span class="text-[12px] font-medium text-ink-600">{{ label }}</span>
      <span class="num rounded-md bg-paper-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-700">
        {{ display }}
      </span>
    </div>
    <input
      type="range"
      class="range mt-2.5"
      :class="accent === 'jade' ? 'range-jade' : ''"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :style="{ '--pct': pct + '%' }"
      @input="onInput"
    />
    <p v-if="hint" class="mt-1 text-[10px] leading-relaxed text-ink-300">{{ hint }}</p>
  </div>
</template>
