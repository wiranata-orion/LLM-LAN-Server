<script setup>
import { ref, computed } from 'vue'
import { ChevronLeft, ChevronRight, RotateCw, Check, X as XIcon } from 'lucide-vue-next'

const props = defineProps({
  // A validated FlashcardSchema - see flashcardParser.js. MessageBubble.vue
  // only ever mounts this for a schema that already passed validation.
  schema: {
    type: Object,
    required: true,
  },
})

const isQuiz = computed(() => props.schema.mode === 'quiz')
const items = computed(() => (isQuiz.value ? props.schema.questions : props.schema.cards))

const currentIndex = ref(0)
const isFlipped = ref(false) // flashcard mode only

// Tracks the user's pick per question across the whole quiz (not just the
// current one) so a final score/summary can be shown after the last
// question, and so navigating back to a previous question still shows what
// was picked instead of resetting it.
const answers = ref(new Array(isQuiz.value ? props.schema.questions.length : 0).fill(null))

const currentItem = computed(() => items.value[currentIndex.value])
const isLast = computed(() => currentIndex.value === items.value.length - 1)
const isFirst = computed(() => currentIndex.value === 0)

const quizScore = computed(() => {
  if (!isQuiz.value) return 0
  return answers.value.filter((answer, index) => answer === props.schema.questions[index].correctIndex).length
})

function goNext() {
  if (isLast.value) return
  currentIndex.value += 1
  isFlipped.value = false
}

function goPrev() {
  if (isFirst.value) return
  currentIndex.value -= 1
  isFlipped.value = false
}

function flip() {
  isFlipped.value = !isFlipped.value
}

function selectQuizOption(index) {
  if (answers.value[currentIndex.value] !== null) return
  answers.value[currentIndex.value] = index
}

const showSummary = ref(false)

function finishQuiz() {
  showSummary.value = true
}

function restart() {
  currentIndex.value = 0
  isFlipped.value = false
  answers.value = new Array(items.value.length).fill(null)
  showSummary.value = false
}
</script>

<template>
  <div class="flashcard-widget">
    <div class="flashcard-progress">
      <span>{{ isQuiz ? 'Quiz' : 'Flashcard' }} {{ currentIndex + 1 }}/{{ items.length }}</span>
      <button class="flashcard-restart-btn" type="button" title="Mulai ulang" @click="restart">
        <RotateCw :size="12" />
      </button>
    </div>

    <!-- Quiz summary, shown after "Selesai" on the last question -->
    <div v-if="isQuiz && showSummary" class="flashcard-summary">
      <p class="flashcard-summary-score">Skor: {{ quizScore }} / {{ items.length }}</p>
      <button class="flashcard-nav-btn flashcard-nav-btn--primary" type="button" @click="restart">Ulangi Quiz</button>
    </div>

    <template v-else>
      <!-- Flashcard mode: click to flip -->
      <button
        v-if="!isQuiz"
        class="flashcard-face"
        :class="{ 'flashcard-face--flipped': isFlipped }"
        type="button"
        @click="flip"
      >
        <span class="flashcard-face-label">{{ isFlipped ? 'Jawaban' : 'Pertanyaan' }}</span>
        <p class="flashcard-face-text">{{ isFlipped ? currentItem.back : currentItem.front }}</p>
        <span class="flashcard-flip-hint">Klik untuk membalik</span>
      </button>

      <!-- Quiz mode: pick an option, see the result immediately -->
      <div v-else class="quiz-question">
        <p class="quiz-question-text">{{ currentItem.question }}</p>
        <div class="quiz-options">
          <button
            v-for="(option, index) in currentItem.options"
            :key="index"
            class="quiz-option"
            :class="{
              'quiz-option--correct': answers[currentIndex] !== null && index === currentItem.correctIndex,
              'quiz-option--wrong': answers[currentIndex] === index && index !== currentItem.correctIndex,
            }"
            type="button"
            :disabled="answers[currentIndex] !== null"
            @click="selectQuizOption(index)"
          >
            <Check v-if="answers[currentIndex] !== null && index === currentItem.correctIndex" :size="13" />
            <XIcon v-else-if="answers[currentIndex] === index" :size="13" />
            <span>{{ option }}</span>
          </button>
        </div>
        <p v-if="answers[currentIndex] !== null && currentItem.explanation" class="quiz-explanation">
          {{ currentItem.explanation }}
        </p>
      </div>

      <div class="flashcard-nav">
        <button class="flashcard-nav-btn" type="button" :disabled="isFirst" @click="goPrev">
          <ChevronLeft :size="14" /><span>Sebelumnya</span>
        </button>
        <button
          v-if="isQuiz && isLast"
          class="flashcard-nav-btn flashcard-nav-btn--primary"
          type="button"
          :disabled="answers[currentIndex] === null"
          @click="finishQuiz"
        >
          <span>Selesai</span>
        </button>
        <button v-else class="flashcard-nav-btn" type="button" :disabled="isLast" @click="goNext">
          <span>Selanjutnya</span><ChevronRight :size="14" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.flashcard-widget {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg-secondary);
  padding: 14px 16px;
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.flashcard-progress {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.72rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.flashcard-restart-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}

.flashcard-restart-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.flashcard-face {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-tertiary);
  padding: 24px 18px;
  min-height: 110px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.flashcard-face:hover {
  border-color: var(--color-accent);
}

.flashcard-face--flipped {
  background: var(--color-accent-subtle);
}

.flashcard-face-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-accent);
  font-weight: 600;
}

.flashcard-face-text {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 0.92rem;
  line-height: 1.5;
}

.flashcard-flip-hint {
  font-size: 0.68rem;
  color: var(--color-text-muted);
}

.quiz-question-text {
  margin: 0 0 10px;
  color: var(--color-text-primary);
  font-size: 0.9rem;
  font-weight: 600;
}

.quiz-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.quiz-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  font-size: 0.82rem;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.quiz-option:hover:not(:disabled) {
  border-color: var(--color-accent);
}

.quiz-option:disabled {
  cursor: default;
}

.quiz-option--correct {
  border-color: #22c55e;
  background: rgba(34, 197, 94, 0.12);
  color: #22c55e;
}

.quiz-option--wrong {
  border-color: var(--color-danger, #ef4444);
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-danger, #ef4444);
}

.quiz-explanation {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-secondary);
  font-size: 0.78rem;
  line-height: 1.5;
}

.flashcard-nav {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.flashcard-nav-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: none;
  color: var(--color-text-secondary);
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.flashcard-nav-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-text-primary);
}

.flashcard-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.flashcard-nav-btn--primary {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: var(--color-on-accent, white);
}

.flashcard-summary {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 20px 0;
}

.flashcard-summary-score {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary);
}
</style>
