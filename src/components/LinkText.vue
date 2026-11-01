<script setup lang="ts">
import { computed } from "vue";
import { linkify } from "../../shared/linkify";
const props = defineProps<{ text: string }>();
const parts = computed(() => linkify(props.text));
</script>

<template>
  <template v-for="(part, i) in parts" :key="i">
    <a
      v-if="part.type === 'link'"
      :href="part.href"
      target="_blank"
      rel="noopener noreferrer"
      class="text-link"
      >{{ part.value }}</a
    >
    <template v-else>{{ part.value }}</template>
  </template>
</template>
