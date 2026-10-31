<script setup lang="ts">
import type { Member, Invitation, AuditLog } from "../../shared/api";
import { computed, ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { Users, Link, Copy, ArrowUpRight, Clock3 } from "@lucide/vue";
import { request, errorMessage } from "../services/api";
import { useWorkspace } from "../stores/workspace";
import { roles, dateText } from "../../shared/domain";
import QueryState from "../components/QueryState.vue";
const w = useWorkspace(),
  client = useQueryClient(),
  role = ref("member"),
  invitation = ref(""),
  busy = ref(false),
  error = ref(""),
  confirm = ref(""),
  transfer = ref(""),
  expanded = ref(false);
const members = useQuery({
  queryKey: computed(() => ["family", w.fid, "members"]),
  queryFn: () => request<Member[]>(`/families/${w.fid}/members`),
  enabled: computed(() => !!w.fid),
});
const invitations = useQuery({
  queryKey: computed(() => ["family", w.fid, "invitations"]),
  queryFn: () => request<Invitation[]>(`/families/${w.fid}/invitations`),
  enabled: computed(() => !!w.fid && w.isAdmin),
});
const audit = useQuery({
  queryKey: computed(() => ["family", w.fid, "audit"]),
  queryFn: () => request<AuditLog[]>(`/families/${w.fid}/audit-logs`),
  enabled: computed(() => !!w.fid),
  refetchInterval: 30000,
});
const activeInvites = computed(
  () =>
    invitations.data.value?.data.filter(
      (i) => !i.usedBy && !i.revokedAt && new Date(i.expiresAt) > new Date(),
    ) || [],
);
async function action(fn: () => Promise<void>) {
  busy.value = true;
  error.value = "";
  try {
    await fn();
    await client.invalidateQueries({ queryKey: ["family", w.fid] });
    await w.loadFamilies();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
async function createInvite() {
  await action(async () => {
    const { data } = await request<{ path: string }>(
      `/families/${w.fid}/invitations`,
      "POST",
      {
        role: role.value,
      },
    );
    invitation.value = window.location.origin + data.path;
  });
}
async function copy() {
  try {
    await navigator.clipboard.writeText(invitation.value);
    w.notify("邀请链接已复制，分享给想邀请的家人即可");
  } catch {
    w.notify("请选中并复制下方的邀请链接");
  }
}
function canManage(m: Member) {
  return (
    m.id !== w.user?.id &&
    m.role !== "owner" &&
    (w.family?.role === "owner" || (w.family?.role === "admin" && m.role !== "admin"))
  );
}
function remove(m: Member) {
  if (confirm.value !== m.id) {
    confirm.value = m.id;
    return;
  }
  action(async () => {
    await request(`/families/${w.fid}/members/${m.id}`, "DELETE");
    confirm.value = "";
    w.notify("已移除成员，其历史记录仍保留");
  });
}
function changeRole(m: Member, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  action(async () => {
    await request(`/families/${w.fid}/members/${m.id}`, "PATCH", {
      role: value,
    });
  });
}
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="eyebrow">HOME IS BETTER TOGETHER</span>
      <h1>{{ w.family?.name }}</h1>
      <p>家的大小事，有家人一起商量、一起记。</p>
    </div>
    <button
      v-if="w.family?.role === 'owner'"
      class="btn secondary"
      @click="w.open('familyRename')"
    >
      修改家庭名称<ArrowUpRight :size="17" />
    </button>
  </div>
  <div v-if="error" class="error-box" role="alert">{{ error }}</div>
  <div class="family-layout">
    <div>
      <section class="panel family-members">
        <div class="section-head">
          <h2>
            我们的家人<span class="count-badge">{{
              members.data.value?.data.length || 0
            }}</span>
          </h2>
          <span class="mini-label">共享每一个装修项目</span>
        </div>
        <QueryState
          :loading="members.isPending.value"
          :error="members.error.value"
          @retry="members.refetch()"
        />
        <div v-for="m in members.data.value?.data || []" :key="m.id" class="member-row">
          <span class="avatar" :class="{ sage: m.role === 'viewer' }">{{
            m.nickname.slice(0, 1)
          }}</span>
          <div class="member-info">
            <strong
              >{{ m.nickname }}<small v-if="m.id === w.user?.id">（我）</small></strong
            ><span>{{ dateText(m.joinedAt) }} 加入</span>
          </div>
          <div v-if="canManage(m)" class="member-controls">
            <select
              :value="m.role"
              :aria-label="`调整${m.nickname}的角色`"
              :disabled="busy"
              @change="changeRole(m, $event)"
            >
              <option v-if="w.family?.role === 'owner'" value="admin">管理员</option>
              <option value="member">成员</option>
              <option value="viewer">只读成员</option></select
            ><button class="text-btn danger" :disabled="busy" @click="remove(m)">
              {{ confirm === m.id ? "确认移除" : "移除" }}
            </button>
          </div>
          <span v-else :class="['pill', m.role === 'owner' ? 'wood-pill' : 'neutral']">{{
            roles[m.role]
          }}</span>
        </div>
        <p class="member-explanation">
          成员可以共同维护材料、支出与备忘；管理员可以调整预算和项目结构。只读成员可以查看，不能修改。
        </p>
      </section>
      <section class="panel activity-panel">
        <div class="section-head">
          <h2>家里的新动态</h2>
          <Clock3 :size="18" class="muted" />
        </div>
        <QueryState
          :loading="audit.isPending.value"
          :error="audit.error.value"
          @retry="audit.refetch()"
        />
        <div
          v-for="a in (audit.data.value?.data || []).slice(0, expanded ? 60 : 8)"
          :key="a.id"
          class="activity-row"
        >
          <span class="activity-dot" />
          <div>
            <p>
              <strong>{{ a.actorName }}</strong> {{ a.action }}
              <span>「{{ a.label }}」</span>
            </p>
            <small>{{
              new Date(a.createdAt).toLocaleString("zh-CN", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })
            }}</small>
          </div>
        </div>
        <p v-if="audit.data.value && !audit.data.value.data.length" class="muted">
          一起记录的点滴，会慢慢出现在这里。
        </p>
        <button
          v-if="(audit.data.value?.data.length ?? 0) > 8"
          class="text-btn"
          @click="expanded = !expanded"
        >
          {{ expanded ? "收起动态" : "查看全部动态" }}
        </button>
      </section>
    </div>
    <div>
      <section v-if="w.isAdmin" class="panel invite-card">
        <span class="invite-icon"><Users :size="26" :stroke-width="1.5" /></span>
        <h2>邀请家人，一起筑家</h2>
        <p>分享一条邀请链接，家人注册后即可加入。</p>
        <label class="field"
          >邀请角色<select v-model="role">
            <option value="member">成员 · 共同记账</option>
            <option value="viewer">只读成员 · 只看不改</option>
            <option v-if="w.family?.role === 'owner'" value="admin">
              管理员 · 管理项目与预算
            </option>
          </select></label
        ><button class="btn primary" :disabled="busy" @click="createInvite">
          <Link :size="17" />{{ busy ? "正在生成…" : "生成邀请链接" }}
        </button>
        <div v-if="invitation" class="invite-result">
          <label class="field"
            >邀请链接<input
              :value="invitation"
              readonly
              @focus="($event.target as HTMLInputElement).select()" /></label
          ><button class="btn secondary small-btn" @click="copy">
            <Copy :size="15" />复制链接</button
          ><small>48 小时内有效，单次使用。仅分享给预期家人。</small>
        </div>
        <div v-if="activeInvites.length" class="pending-invites">
          <h3>等待家人加入</h3>
          <div v-for="i in activeInvites" :key="i.id">
            <span
              >{{ roles[i.role] }}<small>{{ dateText(i.expiresAt) }} 到期</small></span
            ><button
              v-if="w.family?.role === 'owner' || i.role !== 'admin'"
              class="text-btn"
              :disabled="busy"
              @click="
                action(async () => {
                  await request(`/families/${w.fid}/invitations/${i.id}`, 'DELETE');
                })
              "
            >
              撤销
            </button>
          </div>
        </div>
      </section>
      <section v-if="w.family?.role === 'owner'" class="panel ownership-card">
        <h3>家庭所有权</h3>
        <p class="muted small-text">
          需要退出家庭前，可将所有权转给一位家人。你将成为管理员。
        </p>
        <label class="field"
          >转给哪位家人<select v-model="transfer">
            <option value="">请选择成员</option>
            <option
              v-for="m in members.data.value?.data.filter((m) => m.id !== w.user?.id) ||
              []"
              :key="m.id"
              :value="m.id"
            >
              {{ m.nickname }}
            </option>
          </select></label
        ><button
          class="btn secondary small-btn"
          :disabled="!transfer || busy"
          @click="
            confirm === 'transfer'
              ? action(async () => {
                  await request(`/families/${w.fid}/transfer-ownership`, 'POST', {
                    userId: transfer,
                  });
                  transfer = '';
                  confirm = '';
                  w.notify('家庭所有权已转让');
                })
              : (confirm = 'transfer')
          "
        >
          {{ confirm === "transfer" ? "确认转让所有权" : "转让所有权" }}</button
        ><button class="text-btn danger dissolve-link" @click="w.open('dissolveFamily')">
          解散这个家庭
        </button>
      </section>
      <section v-else class="panel ownership-card">
        <h3>退出这个家庭</h3>
        <p class="muted small-text">
          退出后将无法查看该家庭项目，你的历史记录会保留给家人。
        </p>
        <button
          class="btn secondary small-btn"
          :disabled="busy"
          @click="
            confirm === 'leave'
              ? action(async () => {
                  await request(`/families/${w.fid}/leave`, 'POST');
                  w.fid = '';
                  await w.loadFamilies();
                  client.clear();
                })
              : (confirm = 'leave')
          "
        >
          {{ confirm === "leave" ? "确认退出家庭" : "退出家庭" }}
        </button>
      </section>
    </div>
  </div>
</template>
