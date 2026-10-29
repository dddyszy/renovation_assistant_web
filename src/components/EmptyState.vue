<script setup lang="ts">
import { Sprout } from "@lucide/vue";
defineProps<{ title: string; description?: string; action?: string }>();
defineEmits<{ action: [] }>();
</script>
<template>
  <div class="empty-state">
    <span class="empty-icon"><Sprout :size="30" :stroke-width="1.4" /></span>
    <h3>{{ title }}</h3>
    <p v-if="description">{{ description }}</p>
    <button v-if="action" class="btn primary" @click="$emit('action')">
      {{ action }}
    </button>
  </div>
</template>
