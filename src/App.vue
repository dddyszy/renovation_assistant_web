<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import {
  House,
  LayoutDashboard,
  Layers,
  Package,
  NotebookPen,
  BookOpen,
  ChartNoAxesCombined,
  Users,
  Settings,
  Plus,
  ChevronDown,
  ArrowUpRight,
  Check,
} from "@lucide/vue";
import { useWorkspace } from "./stores/workspace";
import ModalHost from "./components/ModalHost.vue";
import EmptyState from "./components/EmptyState.vue";
const w = useWorkspace(),
  route = useRoute(),
  router = useRouter(),
  client = useQueryClient();
const publicPage = computed(() =>
  ["/login", "/register", "/reset-password"].includes(route.path),
);
const nav = [
  { path: "/", label: "装修总览", icon: LayoutDashboard },
  { path: "/stages", label: "阶段计划", icon: Layers },
  { path: "/materials", label: "材料清单", icon: Package },
  { path: "/ledger", label: "装修账本", icon: NotebookPen },
  { path: "/notes", label: "装修备忘", icon: BookOpen },
  { path: "/statistics", label: "预算统计", icon: ChartNoAxesCombined },
];
const pageLabel = computed(
  () =>
    nav.find((n) => n.path === route.path)?.label ||
    ({ "/family": "家庭管理", "/me": "我的账号" } as Record<string, string>)[
      route.path
    ] ||
    "筑家手记",
);
async function switchFamily(event: Event) {
  w.fid = (event.target as HTMLSelectElement).value;
  w.close();
  client.removeQueries();
  await w.loadProjects();
}
async function recover() {
  client.clear();
  w.projects = [];
  w.pid = "";
  await w.loadFamilies().catch(() => {});
  w.notify("家庭或项目权限已变化，已更新可访问内容");
}
watch(
  () => route.path,
  () => {
    w.close();
    if (w.ready && !w.user && !publicPage.value)
      router.replace({ path: "/login", query: { redirect: route.fullPath } });
  },
);
watch(
  () => [w.fid, w.pid],
  () => {
    w.close();
    client.removeQueries({ queryKey: ["project"] });
  },
);
watch(
  () => [route.fullPath, w.fid, w.pid],
  () => {
    if (
      w.user &&
      w.fid &&
      !publicPage.value &&
      !route.path.startsWith("/invite/") &&
      (route.query.family !== w.fid || route.query.project !== (w.pid || undefined))
    )
      router.replace({
        path: route.path,
        query: { ...route.query, family: w.fid, project: w.pid || undefined },
      });
  },
);
onMounted(async () => {
  await w.bootstrap();
  if (!w.user && !publicPage.value && !w.failure)
    await router.replace({
      path: "/login",
      query: route.path === "/" ? {} : { redirect: route.fullPath },
    });
  else if (w.user && publicPage.value && route.path !== "/reset-password")
    await router.replace("/");
  window.addEventListener("session-expired", () => {
    w.clear();
    client.clear();
    router.replace("/login");
  });
  window.addEventListener("workspace-unavailable", recover);
});
const needsProject = computed(
  () => !["/family", "/me"].includes(route.path) && !route.path.startsWith("/invite/"),
);
</script>
<template>
  <div v-if="!w.ready" class="boot">
    <img src="/icon.svg" alt="" />
    <h2>筑家手记</h2>
    <p>把家的每一步，慢慢记好。</p>
    <span class="spinner" />
  </div>
  <div v-else-if="w.failure" class="boot">
    <h2>暂时连不上服务</h2>
    <p>{{ w.failure }}</p>
    <button class="btn primary" @click="w.bootstrap()">重新连接</button>
  </div>
  <RouterView v-else-if="publicPage" />
  <div v-else-if="w.user" class="app-layout">
    <aside class="sidebar">
      <RouterLink to="/" class="brand"
        ><span class="brand-mark"><House :size="26" :stroke-width="1.5" /></span
        ><span>筑家手记<small>MAKE ROOM FOR HOME</small></span></RouterLink
      >
      <div class="family-switch">
        <span class="overline">我们的家庭</span>
        <div class="select-wrap">
          <Users :size="17" /><select
            aria-label="切换家庭"
            :value="w.fid"
            @change="switchFamily"
          >
            <option v-if="!w.families.length" value="">创建你的家庭</option>
            <option v-for="f in w.families" :key="f.id" :value="f.id">
              {{ f.name }}
            </option></select
          ><ChevronDown :size="14" />
        </div>
      </div>
      <span class="nav-caption">筑家的每一步</span>
      <nav class="main-nav">
        <RouterLink
          v-for="n in nav"
          :key="n.path"
          :to="n.path"
          :class="{ active: route.path === n.path }"
          ><component :is="n.icon" :size="19" :stroke-width="1.6" /><span>{{
            n.label
          }}</span
          ><span v-if="route.path === n.path" class="nav-dot"
        /></RouterLink>
      </nav>
      <div class="sidebar-bottom">
        <div class="home-note">
          <House :size="28" :stroke-width="1.1" />
          <p>把预算记清楚，<br />把日子过成喜欢的样子。</p>
          <span>一点一滴，都是家的模样</span>
        </div>
        <RouterLink
          to="/family"
          :class="['utility-link', { active: route.path === '/family' }]"
          ><Users :size="18" />家庭管理<ArrowUpRight :size="15" /></RouterLink
        ><RouterLink to="/me" :class="['account-link', { active: route.path === '/me' }]"
          ><span class="avatar">{{ w.user.nickname.slice(0, 1) }}</span
          ><span
            ><strong>{{ w.user.nickname }}</strong
            ><small>我的账号与设置</small></span
          ><Settings :size="17"
        /></RouterLink>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <span class="breadcrumb"
          ><House :size="15" /><span class="crumb-divider">/</span>{{ pageLabel }}</span
        >
        <div class="top-actions">
          <div class="project-switch">
            <select v-model="w.pid" aria-label="切换装修项目">
              <option v-if="!w.projects.length" value="">尚无装修项目</option>
              <option v-for="p in w.projects" :key="p.id" :value="p.id">
                {{ p.name }}{{ p.status === "archived" ? "（已归档）" : "" }}
              </option></select
            ><ChevronDown :size="14" />
          </div>
          <button
            v-if="w.isAdmin"
            class="icon-btn"
            aria-label="管理装修项目"
            @click="w.open('projects')"
          >
            <Layers :size="19" /></button
          ><RouterLink to="/me" class="avatar small">{{
            w.user.nickname.slice(0, 1)
          }}</RouterLink>
        </div>
      </header>
      <div class="mobile-context">
        <div><img src="/icon.svg" alt="" /><strong>筑家手记</strong></div>
        <select aria-label="手机端切换家庭" :value="w.fid" @change="switchFamily">
          <option v-if="!w.families.length" value="">创建家庭</option>
          <option v-for="f in w.families" :key="f.id" :value="f.id">
            {{ f.name }}
          </option>
        </select>
      </div>
      <main class="main-content">
        <div v-if="w.project?.status === 'archived' && needsProject" class="info-box">
          当前项目已归档，所有内容仅供查看。<button
            v-if="w.isAdmin"
            class="text-btn"
            @click="w.open('projects')"
          >
            管理项目
          </button>
        </div>
        <RouterView v-if="route.path.startsWith('/invite/')" />
        <div v-else-if="!w.family && route.path !== '/me'" class="welcome-panel">
          <span class="eyebrow">家的故事，从这里开始</span>
          <h1>一个家，一本共同的手记。</h1>
          <p>
            创建家庭，邀请家人一起规划预算、记录支出。<br />你的每一份用心，都有家人一起看见。
          </p>
          <button class="btn primary" @click="w.open('family')">
            <Plus :size="18" />创建我的家庭
          </button>
          <p class="muted small-text">收到邀请？直接打开家人分享的链接即可加入。</p>
        </div>
        <EmptyState
          v-else-if="needsProject && !w.project"
          title="从第一套装修计划开始"
          description="设置预算和工期，后续每一笔都更从容。"
          :action="w.isAdmin ? '创建装修项目' : undefined"
          @action="w.open('project')"
        />
        <RouterView v-else :key="`${w.fid}:${w.pid}`" />
      </main>
      <footer class="desktop-footer">
        <span>筑家手记 · 和家人一起，把家慢慢筑好</span
        ><span>记录每一笔，也珍惜每一步。</span>
      </footer>
    </div>
    <nav class="mobile-nav">
      <RouterLink to="/" :class="{ active: route.path === '/' }"
        ><House :size="21" /><span>首页</span></RouterLink
      ><RouterLink to="/ledger" :class="{ active: route.path === '/ledger' }"
        ><NotebookPen :size="21" /><span>账本</span></RouterLink
      ><button class="mobile-add" :disabled="!w.canWrite" @click="w.open('cost')">
        <span><Plus :size="24" /></span><small>记一笔</small></button
      ><RouterLink to="/notes" :class="{ active: route.path === '/notes' }"
        ><BookOpen :size="21" /><span>备忘</span></RouterLink
      ><RouterLink to="/me" :class="{ active: route.path === '/me' }"
        ><Users :size="21" /><span>我的</span></RouterLink
      >
    </nav>
    <ModalHost />
  </div>
  <Transition name="toast"
    ><div v-if="w.toast" class="toast-message" role="status">
      <Check :size="17" />{{ w.toast
      }}<button v-if="w.undoAction" class="undo-button" @click="w.undoAction?.()">
        撤销
      </button>
    </div></Transition
  >
</template>
