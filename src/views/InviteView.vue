<script setup lang="ts">
import type { Role } from "../../shared/api";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { Users, ArrowRight } from "@lucide/vue";
import { request, errorMessage } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import { roles } from "../../shared/domain";
import QueryState from "../components/QueryState.vue";
const route = useRoute(),
  router = useRouter(),
  w = useWorkspace(),
  busy = ref(false),
  error = ref("");
const query = useQuery({
  queryKey: computed(() => ["invite", route.params.token]),
  queryFn: () =>
    request<{ familyName: string; role: Role; expiresAt: string }>(
      `/invitations/${route.params.token}/preview`,
    ),
});
async function accept() {
  busy.value = true;
  try {
    const { data } = await request<{ familyId: string }>(
      `/invitations/${route.params.token}/accept`,
      "POST",
    );
    await w.loadFamilies();
    w.fid = data.familyId;
    await w.loadProjects();
    w.notify("已加入家庭，欢迎一起筑家");
    await router.replace("/");
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="invitation-page panel">
    <span class="empty-icon"><Users :size="32" /></span
    ><span class="eyebrow">一起记录家的点滴</span>
    <h1>家人邀请你一起筑家</h1>
    <QueryState
      :loading="query.isPending.value"
      :error="query.error.value"
      @retry="query.refetch()"
    /><template v-if="query.data.value"
      ><h2>{{ query.data.value.data.familyName }}</h2>
      <p>
        加入后，你将成为「{{
          roles[query.data.value.data.role]
        }}」，<br />可以查看家庭内全部装修项目{{
          query.data.value.data.role === "viewer" ? "。" : "，按角色共同维护装修记录。"
        }}
      </p>
      <div v-if="error" class="error-box">{{ error }}</div>
      <button class="btn primary" :disabled="busy" @click="accept">
        {{ busy ? "加入中…" : "确认加入这个家庭" }}<ArrowRight :size="17" /></button
    ></template>
  </div>
</template>
