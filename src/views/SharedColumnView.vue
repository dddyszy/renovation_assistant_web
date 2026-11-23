<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import LinkText from "../components/LinkText.vue";
import { errorMessage, request } from "../services/api";
import type { SharedColumn } from "../../shared/api";

const token = useRoute().params.token as string;
const column = ref<SharedColumn | null>(null);
const error = ref("");

function imageUrl(imageId: string) {
  return `/api/v1/share/columns/${token}/images/${imageId}`;
}
onMounted(async () => {
  try {
    column.value = (await request<SharedColumn>(`/share/columns/${token}`)).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
});
</script>

<template>
  <main class="share-page">
    <header class="share-brand">筑家手记<small>只读分享 · READ ONLY</small></header>
    <article v-if="column" class="panel share-card share-column-card">
      <p class="share-eyebrow">备忘专栏 · {{ column.total }} 条</p>
      <h1>{{ column.name }}</h1>
      <p class="share-meta">{{ column.creatorName }}整理</p>
      <section
        v-for="(note, index) in column.notes"
        :key="note.id"
        class="share-column-note"
      >
        <h2>{{ note.title }}</h2>
        <p class="share-note-meta">
          {{ note.status === "confirmed" ? "已确认" : "待确认" }}
          <span v-if="note.starred"> · 重点</span>
          <span> · {{ note.creatorName }}</span>
        </p>
        <ul v-if="note.details.length">
          <li v-for="(detail, i) in note.details" :key="i">
            <LinkText :text="detail" />
          </li>
        </ul>
        <div v-if="note.images.length" class="share-images">
          <a
            v-for="image in note.images"
            :key="image.id"
            :href="imageUrl(image.id)"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img :src="imageUrl(image.id)" :alt="note.title" loading="lazy" />
          </a>
        </div>
        <span v-if="index < column.notes.length - 1" class="share-column-divider" />
      </section>
      <p v-if="!column.notes.length" class="share-empty">这个专栏还没有备忘</p>
      <p v-else-if="column.total > column.notes.length" class="share-hint">
        仅显示最近 {{ column.notes.length }} 条，共 {{ column.total }} 条。
      </p>
      <footer>{{ column.creatorName }}整理 · 只读分享</footer>
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
