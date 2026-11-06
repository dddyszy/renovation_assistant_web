<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import LinkText from "../components/LinkText.vue";
import { errorMessage, request } from "../services/api";
import type { SharedNote } from "../../shared/api";

const token = useRoute().params.token as string;
const note = ref<SharedNote | null>(null);
const error = ref("");

onMounted(async () => {
  try {
    note.value = (await request<SharedNote>(`/share/notes/${token}`)).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
});
</script>

<template>
  <main class="share-page">
    <header class="share-brand">筑家手记<small>只读分享 · READ ONLY</small></header>
    <article v-if="note" class="panel share-card">
      <p class="share-eyebrow">{{ note.columnName }}</p>
      <h1>{{ note.title }}</h1>
      <p class="share-meta">
        {{ note.status === "confirmed" ? "已确认" : "待确认" }}
        <span v-if="note.starred"> · 重点</span>
      </p>
      <ul v-if="note.details.length">
        <li v-for="(d, i) in note.details" :key="i"><LinkText :text="d" /></li>
      </ul>
      <p v-else class="share-empty">暂无具体描述</p>
      <footer>
        {{ note.creatorName }}记录 ·
        {{ note.createdAt.slice(0, 10).replaceAll("-", ".") }}
      </footer>
    </article>
    <div v-else-if="error" class="panel share-card share-error">
      <h1>链接不可用</h1>
      <p>{{ error }}</p>
      <p class="share-hint">分享可能已过期或被停止，请联系分享者重新生成。</p>
    </div>
    <div v-else class="share-loading">正在打开…</div>
    <p class="share-footnote">此页面只读，内容来自分享链接。</p>
  </main>
</template>
