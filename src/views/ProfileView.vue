<script setup lang="ts">
import type { User } from "../../shared/api";
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import { Plus, Users, Layers, LogOut, ArrowUpRight, ShieldCheck } from "@lucide/vue";
import { useWorkspace } from "../stores/workspace";
import { request, errorMessage } from "../services/api";
import { roles } from "../../shared/domain";
import { APP_VERSION } from "../../shared/version";
const w = useWorkspace(),
  router = useRouter(),
  client = useQueryClient(),
  nickname = ref(w.user?.nickname || ""),
  error = ref(""),
  busy = ref(false);
async function save() {
  busy.value = true;
  try {
    const { data } = await request<User>("/me", "PATCH", {
      nickname: nickname.value,
    });
    w.user = data;
    w.notify("称呼已更新");
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function logout() {
  busy.value = true;
  try {
    await request("/auth/logout", "POST");
    const uid = w.user?.id;
    for (const k of Object.keys(localStorage))
      if (k.startsWith(`draft:cost:${uid}:`)) localStorage.removeItem(k);
    w.clear();
    client.clear();
    await router.replace("/login");
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function switchFamily(fid: string) {
  w.fid = fid;
  client.clear();
  await w.loadProjects();
  w.notify("已切换家庭");
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">YOUR LITTLE CORNER</span>
      <h1>我的账号</h1>
      <p>家的手记，随时都能接着写。</p>
    </div>
  </div>
  <div class="profile-layout">
    <section class="panel profile-panel">
      <div class="profile-identity">
        <span class="avatar large">{{ w.user?.nickname.slice(0, 1) }}</span>
        <div>
          <h2>{{ w.user?.nickname }}</h2>
          <p>{{ w.user?.email }}</p>
        </div>
      </div>
      <form @submit.prevent="save">
        <label class="field"
          >家人怎么称呼你<input
            v-model="nickname"
            required
            maxlength="30"
            autocomplete="nickname"
        /></label>
        <div v-if="error" class="error-box">{{ error }}</div>
        <button class="btn primary" :disabled="busy">保存称呼</button>
      </form>
      <div class="security-note">
        <ShieldCheck :size="18" /><span>密码经过加密存储 · 家庭数据按权限共享</span>
      </div>
      <RouterLink to="/reset-password" class="text-btn"
        >重置登录密码 <ArrowUpRight :size="15"
      /></RouterLink>
    </section>
    <div>
      <section class="panel family-list-panel">
        <div class="section-head">
          <h2>我的家庭</h2>
          <button class="text-btn" @click="w.open('family')">
            <Plus :size="16" />新建
          </button>
        </div>
        <div v-for="f in w.families" :key="f.id" class="family-list-row">
          <span class="record-icon"><Users :size="19" /></span>
          <div>
            <strong>{{ f.name }}</strong
            ><small>{{ roles[f.role] }} · {{ f.memberCount }} 位家人</small>
          </div>
          <button class="text-btn" :disabled="w.fid === f.id" @click="switchFamily(f.id)">
            {{ w.fid === f.id ? "当前家庭" : "切换" }}
          </button>
        </div>
        <RouterLink to="/family" class="btn secondary"
          >家庭成员与邀请 <ArrowUpRight :size="16"
        /></RouterLink>
      </section>
      <section class="panel profile-projects">
        <h2>装修项目</h2>
        <p class="muted small-text">
          {{ w.projects.length }} 个项目 · {{ w.family?.name }}
        </p>
        <button v-if="w.isAdmin" class="btn secondary" @click="w.open('projects')">
          <Layers :size="17" />切换与管理项目
        </button>
        <div v-else class="field">
          <select v-model="w.pid" aria-label="选择装修项目">
            <option v-for="p in w.projects" :key="p.id" :value="p.id">
              {{ p.name }}
            </option>
          </select>
        </div>
      </section>
      <button class="btn logout-btn" :disabled="busy" @click="logout">
        <LogOut :size="17" />退出登录
      </button>
      <p class="muted small-text" style="text-align: center; margin-top: 18px">
        筑家手记 Web · v{{ APP_VERSION }}
      </p>
    </div>
  </div>
</template>
