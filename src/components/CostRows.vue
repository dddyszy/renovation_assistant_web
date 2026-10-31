<script setup lang="ts">
import type { Cost, Stage } from "../../shared/api";
import { ReceiptText, ChevronRight } from "@lucide/vue";
import { money, dateText } from "../../shared/domain";
import { useWorkspace } from "../stores/workspace";
defineProps<{ items: Cost[]; stages?: Stage[] }>();
const w = useWorkspace();
</script>
<template>
  <div class="cost-list">
    <button
      v-for="cost in items"
      :key="cost.id"
      class="cost-row"
      @click="w.open('cost', cost)"
    >
      <span class="record-icon"><ReceiptText :size="19" :stroke-width="1.6" /></span
      ><span class="cost-info"
        ><strong>{{ cost.title }}</strong
        ><small
          >{{ dateText(cost.incurredAt) }} <span class="dot">·</span>
          {{ cost.creatorName || "家人" }} <span class="dot">·</span>
          {{ stages?.find((s) => s.id === cost.stageId)?.name || cost.category }}</small
        ></span
      ><span class="cost-value"
        ><strong>{{ money(cost.amountCents) }}</strong
        ><small
          :class="['status-text', cost.paymentStatus === 'paid' ? 'green' : 'amber']"
          >{{ cost.paymentStatus === "paid" ? "已支付" : "待支付" }}</small
        ></span
      ><ChevronRight class="row-chevron" :size="16" />
    </button>
  </div>
</template>
