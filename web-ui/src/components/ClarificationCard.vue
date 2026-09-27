<script setup>
import { computed, reactive } from 'vue'
import { HelpCircle, Send, Check } from 'lucide-vue-next'

const props = defineProps({
  // A ClarificationSchema - see clarificationParser.js's validateSchema for
  // the exact shape. Assumed already-validated: MessageBubble.vue only ever
  // mounts this component for a schema that passed that check.
  schema: {
    type: Object,
    required: true,
  },
})

// 'submit' carries { clarificationId, answers, summaryText } - see
// buildPayload() below. The caller turns this into the next user message
// (summaryText is ready to send as-is; the structured `answers` are there
// for a caller that wants to feed the model JSON instead of prose).
const emit = defineEmits(['submit'])

// answers[questionId] = { selected: string[], other: string }
const answers = reactive({})
for (const question of props.schema.questions) {
  answers[question.id] = { selected: [], other: '' }
}

const submitted = reactive({ value: false })

function isOptionChecked(questionId, optionId) {
  return answers[questionId].selected.includes(optionId)
}

function toggleSingle(questionId, optionId) {
  answers[questionId].selected = [optionId]
}

function toggleMulti(questionId, optionId) {
  const current = answers[questionId].selected
  const index = current.indexOf(optionId)
  if (index === -1) current.push(optionId)
  else current.splice(index, 1)
}

const OTHER_OPTION_ID = '__other__'

function isOtherChecked(questionId) {
  return answers[questionId].selected.includes(OTHER_OPTION_ID)
}

function toggleOther(question) {
  if (question.type === 'single') {
    answers[question.id].selected = [OTHER_OPTION_ID]
  } else {
    toggleMulti(question.id, OTHER_OPTION_ID)
  }
}

/** Every question needs at least one real selection, and if "Other" is picked, non-empty text for it. */
const canSubmit = computed(() => {
  return props.schema.questions.every((question) => {
    const answer = answers[question.id]
    if (!answer.selected.length) return false
    if (answer.selected.includes(OTHER_OPTION_ID) && !answer.other.trim()) return false
    return true
  })
})

/** Turns the raw option ids into a short, readable line per question, e.g. "Fokus: Frontend (web-ui)". */
function summaryLineFor(question) {
  const answer = answers[question.id]
  const labels = answer.selected.map((optionId) => {
    if (optionId === OTHER_OPTION_ID) return answer.other.trim()
    return question.options.find((option) => option.id === optionId)?.label ?? optionId
  })
  return `${question.text}: ${labels.join(', ')}`
}

function buildPayload() {
  const structuredAnswers = props.schema.questions.map((question) => {
    const answer = answers[question.id]
    return {
      questionId: question.id,
      selected: answer.selected.filter((id) => id !== OTHER_OPTION_ID),
      other: answer.selected.includes(OTHER_OPTION_ID) ? answer.other.trim() : null,
    }
  })
  const summaryText = props.schema.questions.map(summaryLineFor).join('\n')
  return { clarificationId: props.schema.id, answers: structuredAnswers, summaryText }
}

function handleSubmit() {
  if (!canSubmit.value || submitted.value) return
  submitted.value = true
  emit('submit', buildPayload())
}
</script>

<template>
  <div class="clarify-card">
    <div class="clarify-header">
      <HelpCircle :size="15" />
      <span>{{ schema.prompt }}</span>
    </div>

    <div v-for="question in schema.questions" :key="question.id" class="clarify-question">
      <p class="clarify-question-text">{{ question.text }}</p>

      <div class="clarify-options" role="group" :aria-label="question.text">
        <label
          v-for="option in question.options"
          :key="option.id"
          class="clarify-option"
          :class="{ 'clarify-option--checked': isOptionChecked(question.id, option.id) }"
        >
          <input
            :type="question.type === 'single' ? 'radio' : 'checkbox'"
            :name="question.id"
            :checked="isOptionChecked(question.id, option.id)"
            :disabled="submitted.value"
            @change="question.type === 'single' ? toggleSingle(question.id, option.id) : toggleMulti(question.id, option.id)"
          />
          <span>{{ option.label }}</span>
        </label>

        <!-- Custom "Other" option - a real selectable choice, not just a stray text field. -->
        <label
          v-if="question.allowOther"
          class="clarify-option clarify-option--other"
          :class="{ 'clarify-option--checked': isOtherChecked(question.id) }"
        >
          <input
            :type="question.type === 'single' ? 'radio' : 'checkbox'"
            :name="question.id"
            :checked="isOtherChecked(question.id)"
            :disabled="submitted.value"
            @change="toggleOther(question)"
          />
          <span>Lainnya:</span>
          <input
            type="text"
            class="clarify-other-input"
            placeholder="Tulis jawabanmu..."
            v-model="answers[question.id].other"
            :disabled="submitted.value"
            @focus="!isOtherChecked(question.id) && toggleOther(question)"
          />
        </label>
      </div>
    </div>

    <div class="clarify-footer">
      <button
        v-if="!submitted.value"
        class="clarify-submit-btn"
        type="button"
        :disabled="!canSubmit"
        @click="handleSubmit"
      >
        <Send :size="13" />
        <span>Kirim Jawaban</span>
      </button>
      <div v-else class="clarify-submitted-note">
        <Check :size="13" />
        <span>Jawaban terkirim</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.clarify-card {
  border: 1px solid var(--color-border-light, var(--color-border));
  border-radius: 12px;
  background: var(--color-bg-tertiary);
  padding: 14px 16px;
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.clarify-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--color-text-accent);
  font-weight: 600;
  font-size: 0.88rem;
  line-height: 1.5;
}

.clarify-header svg {
  flex-shrink: 0;
  margin-top: 2px;
}

.clarify-question {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.clarify-question-text {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.clarify-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.clarify-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  font-size: 0.82rem;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.clarify-option:hover {
  border-color: var(--color-border-light, var(--color-accent));
}

.clarify-option--checked {
  border-color: var(--color-accent);
  background: var(--color-accent-subtle);
  color: var(--color-text-primary);
}

.clarify-option input[type='radio'],
.clarify-option input[type='checkbox'] {
  accent-color: var(--color-accent);
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  cursor: pointer;
}

.clarify-option--other {
  flex-wrap: wrap;
}

.clarify-other-input {
  flex: 1;
  min-width: 120px;
  border: none;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: 0.82rem;
  padding: 2px 4px;
  outline: none;
}

.clarify-other-input:focus {
  border-color: var(--color-accent);
}

.clarify-footer {
  display: flex;
  justify-content: flex-end;
}

.clarify-submit-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: none;
  border-radius: 8px;
  background: var(--color-accent);
  color: var(--color-on-accent, white);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.clarify-submit-btn:hover {
  background: var(--color-accent-hover);
}

.clarify-submit-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.clarify-submitted-note {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
  font-size: 0.78rem;
}
</style>
