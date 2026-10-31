<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowRight, House, Wallet, Users, NotebookPen, Eye, EyeOff } from "@lucide/vue";
import { request, errorMessage } from "../services/api";
import { useWorkspace } from "../stores/workspace";
const route = useRoute(),
  router = useRouter(),
  w = useWorkspace();
const register = computed(() => route.path === "/register"),
  reset = computed(() => route.path === "/reset-password");
const form = ref({ email: "", password: "", nickname: "" }),
  busy = ref(false),
  error = ref(""),
  message = ref(""),
  showPassword = ref(false),
  agreed = ref(false),
  privacy = ref(false);
async function submit() {
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    if (reset.value) {
      if (route.query.token) {
        await request("/auth/reset/complete", "POST", {
          token: route.query.token,
          password: form.value.password,
        });
        w.notify("密码已重置，请重新登录");
        await router.push("/login");
      } else {
        const { data } = await request<{ message: string; devToken?: string }>(
          "/auth/reset/request",
          "POST",
          {
            email: form.value.email,
          },
        );
        message.value = data.message;
        if (data.devToken)
          await router.replace({
            path: "/reset-password",
            query: { token: data.devToken },
          });
      }
      return;
    }
    if (register.value) {
      if (!agreed.value) throw new Error("请先阅读并同意隐私说明");
      await request("/auth/register", "POST", form.value);
    }
    await request("/auth/login", "POST", {
      email: form.value.email,
      password: form.value.password,
    });
    await w.bootstrap();
    const redirect = String(route.query.redirect || "/");
    await router.replace(
      redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/",
    );
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="auth-page">
    <div class="auth-story">
      <RouterLink to="/" class="brand"
        ><span class="brand-mark"><House :size="27" /></span
        ><span>筑家手记<small>MAKE ROOM FOR HOME</small></span></RouterLink
      >
      <div class="story-content">
        <span class="eyebrow">一本手记，一起筑家。</span>
        <h1>把家的模样，<br />一笔一笔记下来。</h1>
        <p>从第一份预算，到最后一盏灯。<br />和家人一起，把装修的每一步安排得更从容。</p>
        <div class="house-illustration" aria-hidden="true">
          <svg viewBox="0 0 420 250" fill="none">
            <path d="M40 218h340" stroke="#cbb9a5" />
            <path d="m84 106 122-78 124 78v112H84Z" fill="#ece4d7" />
            <path
              d="m67 108 139-89 143 89"
              stroke="#97775b"
              stroke-width="4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path d="M98 112v106h216V112" stroke="#b29b80" stroke-width="2" />
            <rect x="183" y="139" width="48" height="79" rx="3" fill="#9a7959" />
            <circle cx="221" cy="181" r="2" fill="#eee6d9" />
            <rect
              x="115"
              y="126"
              width="44"
              height="48"
              rx="2"
              fill="#fffdf8"
              stroke="#b29b80"
              stroke-width="2"
            />
            <path d="M137 126v48m-22-24h44" stroke="#b29b80" stroke-width="2" />
            <rect
              x="255"
              y="126"
              width="40"
              height="48"
              rx="2"
              fill="#fffdf8"
              stroke="#b29b80"
              stroke-width="2"
            />
            <path d="M275 126v48m-20-24h40" stroke="#b29b80" stroke-width="2" />
            <path
              d="M342 218v-72m0 45c-25-4-31-23-25-33 17 0 25 17 25 33Zm0-18c23-5 31-23 24-34-17 2-24 17-24 34Z"
              stroke="#819076"
              stroke-width="3"
              fill="#dfe5d6"
            />
            <path
              d="M61 218v-37m0 20c-16-3-22-14-18-22 12 0 18 12 18 22Zm0-7c14-5 20-16 15-23-11 1-15 12-15 23Z"
              stroke="#819076"
              stroke-width="2"
            />
            <path d="M188 95h36" stroke="#b29b80" stroke-width="2" />
            <circle
              cx="206"
              cy="77"
              r="13"
              fill="#fffdf8"
              stroke="#b29b80"
              stroke-width="2"
            />
          </svg>
        </div>
        <div class="story-features">
          <span><Wallet :size="16" />预算心中有数</span
          ><span><NotebookPen :size="16" />每笔清晰记录</span
          ><span><Users :size="16" />家人共同参与</span>
        </div>
      </div>
      <span class="story-footer">一点一滴，都是家的模样。</span>
    </div>
    <div class="auth-form-side">
      <div class="auth-form-wrap">
        <span class="eyebrow">WELCOME HOME</span>
        <h2>
          {{
            reset
              ? route.query.token
                ? "设置新密码"
                : "找回密码"
              : register
                ? "开启你的筑家手记"
                : "欢迎回到筑家手记"
          }}
        </h2>
        <p class="muted">
          {{
            reset
              ? "让每一份记录，安心回到你手里。"
              : register
                ? "创建个人账号，和家人一起记录家的成长。"
                : "登录账号，继续你和家人的装修计划。"
          }}
        </p>
        <form @submit.prevent="submit">
          <label v-if="register" class="field"
            >你的称呼<input
              v-model="form.nickname"
              placeholder="家人怎么称呼你"
              maxlength="30"
              required
              autocomplete="nickname" /></label
          ><label v-if="!reset || !route.query.token" class="field"
            >邮箱地址<input
              v-model="form.email"
              type="email"
              required
              autocomplete="email"
              placeholder="hello@example.com" /></label
          ><label v-if="!reset || route.query.token" class="field"
            >{{ reset ? "新密码" : "密码" }}
            <div class="password-input">
              <input
                v-model="form.password"
                :type="showPassword ? 'text' : 'password'"
                :minlength="register || reset ? 10 : undefined"
                maxlength="128"
                required
                :autocomplete="register || reset ? 'new-password' : 'current-password'"
                :placeholder="
                  register ? '至少 10 位，建议混合字母与数字' : '输入你的密码'
                "
              /><button
                type="button"
                class="icon-btn"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                @click="showPassword = !showPassword"
              >
                <EyeOff v-if="showPassword" :size="18" /><Eye v-else :size="18" />
              </button></div
          ></label>
          <div v-if="!register && !reset" class="login-helper">
            <span>安心记录，跨设备同步</span
            ><RouterLink to="/reset-password">忘记密码？</RouterLink>
          </div>
          <label v-if="register" class="checkbox-line"
            ><input v-model="agreed" type="checkbox" required /><span
              >我已阅读并同意<button
                type="button"
                class="text-btn"
                @click="privacy = true"
              >
                隐私说明
              </button></span
            ></label
          >
          <div v-if="error" class="error-box" role="alert">{{ error }}</div>
          <div v-if="message" class="info-box" role="status">{{ message }}</div>
          <button class="btn primary auth-submit" :disabled="busy">
            {{
              busy
                ? "请稍候…"
                : reset
                  ? route.query.token
                    ? "保存新密码"
                    : "发送重置邮件"
                  : register
                    ? "注册并开启手记"
                    : "登录"
            }}<ArrowRight :size="18" />
          </button>
        </form>
        <p class="auth-switch">
          {{ reset ? "想起密码了？" : register ? "已经有账号？" : "第一次来到这里？"
          }}<RouterLink
            :to="{
              path: register || reset ? '/login' : '/register',
              query: route.query.redirect ? { redirect: route.query.redirect } : {},
            }"
            >{{ register || reset ? "前往登录" : "创建账号" }}</RouterLink
          >
        </p>
        <p class="auth-bottom"><House :size="13" />家里的事，和家人一起记。</p>
      </div>
    </div>
    <div v-if="privacy" class="modal-backdrop" @click.self="privacy = false">
      <section class="modal-card">
        <h2>隐私说明</h2>
        <p>
          邮箱用于账号登录和密码找回，昵称用于家庭内显示。你的项目、支出和备忘仅对所在家庭的有效成员开放。家庭成员可按角色共同维护记录，移除成员后停止其后续访问。
        </p>
        <p>
          数据保存在应用服务器数据库中，不会因为关闭浏览器丢失。开发版数据保存在本机 .data
          目录。邀请链接仅分享给预期家人。
        </p>
        <button class="btn primary" @click="privacy = false">我知道了</button>
      </section>
    </div>
  </div>
</template>
