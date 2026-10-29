<script setup lang="ts">
defineProps<{ loading?: boolean; error?: unknown }>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <div v-if="loading" class="loading-state">
    <span class="spinner" />正在整理你的装修手记…
  </div>
  <div v-else-if="error" class="error-box">
    {{ (error as Error).message
    }}<button class="text-btn" @click="$emit('retry')">重新加载</button>
  </div>
</template>
