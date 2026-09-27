<script setup>
import { ref } from 'vue'
import { Play, Database, AlertTriangle, Loader2 } from 'lucide-vue-next'
import { runSql } from '../services/sqlPlayground.js'

const props = defineProps({
  // The ```sql fenced block's raw content - editable before running, not
  // executed automatically (arbitrary SQL still deserves an explicit click,
  // even though it only ever runs against a disposable in-memory database).
  source: {
    type: String,
    required: true,
  },
})

const sql = ref(props.source)
const isRunning = ref(false)
const output = ref(null) // { resultSets, schema, error } | null

async function execute() {
  isRunning.value = true
  try {
    output.value = await runSql(sql.value)
  } catch (error) {
    output.value = { resultSets: [], schema: [], error: error instanceof Error ? error.message : 'Gagal menjalankan SQL' }
  } finally {
    isRunning.value = false
  }
}
</script>

<template>
  <div class="sql-widget">
    <div class="sql-header">
      <Database :size="14" />
      <span>SQL Playground</span>
      <span class="sql-header-note">dijalankan di database SQLite sementara, hanya di browser - tidak menyentuh data nyata</span>
    </div>

    <textarea v-model="sql" class="sql-editor" rows="6" spellcheck="false"></textarea>

    <div class="sql-actions">
      <button class="sql-run-btn" type="button" :disabled="isRunning || !sql.trim()" @click="execute">
        <Loader2 v-if="isRunning" :size="13" class="spin" />
        <Play v-else :size="13" />
        <span>{{ isRunning ? 'Menjalankan...' : 'Jalankan' }}</span>
      </button>
    </div>

    <div v-if="output?.error" class="sql-error">
      <AlertTriangle :size="13" />
      <span>{{ output.error }}</span>
    </div>

    <template v-else-if="output">
      <!-- Schema visualizer -->
      <div v-if="output.schema.length" class="sql-schema">
        <div v-for="table in output.schema" :key="table.name" class="sql-schema-table">
          <span class="sql-schema-table-name">{{ table.name }}</span>
          <span class="sql-schema-columns">({{ table.columns.join(', ') }})</span>
        </div>
      </div>

      <!-- Result set(s) - a CREATE TABLE/INSERT-only script produces none, which is expected. -->
      <template v-if="output.resultSets.length">
        <div v-for="(result, index) in output.resultSets" :key="index" class="sql-result-wrap">
          <table class="sql-result-table">
            <thead>
              <tr>
                <th v-for="col in result.columns" :key="col">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in result.values" :key="rowIndex">
                <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell === null ? 'NULL' : cell }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <p v-else class="sql-no-rows">Berhasil dijalankan - tidak ada baris yang dikembalikan (mis. hanya CREATE TABLE/INSERT).</p>
    </template>
  </div>
</template>

<style scoped>
.sql-widget {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg-secondary);
  padding: 14px 16px;
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sql-header {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--color-text-accent);
  font-size: 0.85rem;
  font-weight: 600;
}

.sql-header-note {
  color: var(--color-text-muted);
  font-size: 0.68rem;
  font-weight: 400;
}

.sql-editor {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  padding: 10px 12px;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.sql-editor:focus {
  border-color: var(--color-accent);
}

.sql-actions {
  display: flex;
  justify-content: flex-end;
}

.sql-run-btn {
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
}

.sql-run-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sql-error {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.35);
  color: var(--color-danger, #ef4444);
  font-family: var(--font-mono);
  font-size: 0.78rem;
}

.sql-schema {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.sql-schema-table {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 20px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  font-size: 0.72rem;
}

.sql-schema-table-name {
  font-weight: 700;
  color: var(--color-text-accent);
  font-family: var(--font-mono);
}

.sql-schema-columns {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.sql-result-wrap {
  overflow-x: auto;
  border-radius: 8px;
  border: 1px solid var(--color-border);
}

.sql-result-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.76rem;
}

.sql-result-table th,
.sql-result-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  white-space: nowrap;
}

.sql-result-table th {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  font-weight: 600;
}

.sql-result-table td {
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
}

.sql-result-table tr:last-child td {
  border-bottom: none;
}

.sql-no-rows {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.78rem;
}
</style>
