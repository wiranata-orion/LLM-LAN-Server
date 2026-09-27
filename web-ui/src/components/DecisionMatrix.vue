<script setup>
import { computed } from 'vue'
import { Scale, Trophy, Plus, Minus } from 'lucide-vue-next'

const props = defineProps({
  // A validated DecisionMatrixSchema - see decisionMatrixParser.js.
  schema: {
    type: Object,
    required: true,
  },
})

const totalWeight = computed(() => props.schema.criteria.reduce((sum, c) => sum + c.weight, 0))

/** Weighted average (0-10 scale in, 0-10 scale out) so the total is comparable regardless of how many criteria there are. */
function weightedScore(option) {
  const raw = props.schema.criteria.reduce((sum, c) => sum + (option.scores[c.id] || 0) * c.weight, 0)
  return totalWeight.value > 0 ? raw / totalWeight.value : 0
}

const rankedOptions = computed(() => (
  props.schema.options
    .map((option) => ({ ...option, weightedScore: weightedScore(option) }))
    .sort((a, b) => b.weightedScore - a.weightedScore)
))

const bestOptionId = computed(() => rankedOptions.value[0]?.id)
</script>

<template>
  <div class="decision-widget">
    <div class="decision-header">
      <Scale :size="14" />
      <span>{{ schema.title }}</span>
    </div>

    <div class="decision-table-wrap">
      <table class="decision-table">
        <thead>
          <tr>
            <th>Opsi</th>
            <th v-for="criterion in schema.criteria" :key="criterion.id" :title="`Bobot: ${criterion.weight}`">
              {{ criterion.label }} <span class="decision-weight">(×{{ criterion.weight }})</span>
            </th>
            <th>Skor Akhir</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="option in rankedOptions" :key="option.id" :class="{ 'decision-row--best': option.id === bestOptionId }">
            <td class="decision-option-name">
              <Trophy v-if="option.id === bestOptionId" :size="12" class="decision-trophy" />
              {{ option.label }}
            </td>
            <td v-for="criterion in schema.criteria" :key="criterion.id" class="decision-score-cell">
              {{ option.scores[criterion.id] }}
            </td>
            <td class="decision-final-score">{{ option.weightedScore.toFixed(1) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="decision-pros-cons">
      <div v-for="option in rankedOptions" :key="option.id" class="decision-option-detail">
        <p class="decision-option-detail-title">{{ option.label }}</p>
        <div v-if="option.pros.length" class="decision-list decision-list--pros">
          <span v-for="(pro, index) in option.pros" :key="index" class="decision-list-item">
            <Plus :size="11" /> {{ pro }}
          </span>
        </div>
        <div v-if="option.cons.length" class="decision-list decision-list--cons">
          <span v-for="(con, index) in option.cons" :key="index" class="decision-list-item">
            <Minus :size="11" /> {{ con }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.decision-widget {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg-secondary);
  padding: 14px 16px;
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.decision-header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-accent);
  font-size: 0.85rem;
  font-weight: 600;
}

.decision-table-wrap {
  overflow-x: auto;
}

.decision-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.decision-table th,
.decision-table td {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  text-align: center;
  white-space: nowrap;
}

.decision-table th {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  font-weight: 600;
}

.decision-weight {
  color: var(--color-text-muted);
  font-weight: 400;
}

.decision-option-name {
  text-align: left !important;
  color: var(--color-text-primary);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 5px;
}

.decision-trophy {
  color: #f59e0b;
  flex-shrink: 0;
}

.decision-score-cell {
  color: var(--color-text-secondary);
}

.decision-final-score {
  font-weight: 700;
  color: var(--color-text-accent);
}

.decision-row--best {
  background: var(--color-accent-subtle);
}

.decision-pros-cons {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.decision-option-detail {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
}

.decision-option-detail-title {
  margin: 0 0 6px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.decision-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 4px;
}

.decision-list-item {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  font-size: 0.74rem;
  line-height: 1.4;
}

.decision-list--pros .decision-list-item {
  color: #22c55e;
}

.decision-list--cons .decision-list-item {
  color: var(--color-danger, #ef4444);
}
</style>
