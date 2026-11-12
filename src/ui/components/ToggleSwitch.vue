<script setup lang="ts">
defineProps<{
  label: string
  description?: string
  modelValue: boolean
}>()

defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    class="flex w-full items-center justify-between gap-4 rounded-lg px-1 py-1.5 text-left transition hover:bg-ink-800/[.03]"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <span class="min-w-0">
      <span class="block text-[12px] font-medium text-ink-600">{{ label }}</span>
      <span v-if="description" class="mt-0.5 block text-[10px] leading-relaxed text-ink-300">
        {{ description }}
      </span>
    </span>
    <span
      class="relative h-[20px] w-[36px] shrink-0 rounded-full border transition-colors duration-200"
      :class="modelValue ? 'border-vermilion-600 bg-vermilion-500' : 'border-ink-300/70 bg-ink-200/60'"
    >
      <span
        class="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all duration-200"
        :class="modelValue ? 'left-[19px]' : 'left-[2px]'"
      />
    </span>
  </button>
</template>
