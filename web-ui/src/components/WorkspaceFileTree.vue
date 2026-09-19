<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import {
  ChevronRight,
  ChevronDown,
  File as FileIcon,
  FileCode,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
  AlertCircle,
  ListPlus,
} from 'lucide-vue-next'
import { listWorkspaceTree } from '../services/workspace.ts'
import { addFileAsContext } from '../services/workspaceStore.js'

const props = defineProps({
  activePath: { type: String, default: '' },
  // Drops the border/background meant for standalone use as a grid column,
  // for when this is nested inside another panel (the sidebar) that already
  // draws its own background and edge.
  embedded: { type: Boolean, default: false },
  // Bumped by a parent that changed the tree's contents from elsewhere (e.g.
  // opening a different project, or applying a change from the chat panel) -
  // there is no direct component reference across the sidebar/main-content
  // boundary, so this is how "please refresh" gets signaled instead.
  refreshToken: { type: Number, default: 0 },
  // relPaths with an AI-proposed change nobody has accepted/rejected yet
  // (see pendingFilePaths in workspaceStore.js) - shown as a small dot so the
  // user can see which files would be touched before deciding.
  pendingPaths: { type: [Set, Array], default: () => new Set() },
})

const pendingPathSet = computed(() => (props.pendingPaths instanceof Set ? props.pendingPaths : new Set(props.pendingPaths)))

// Embedded mode sits inside the sidebar, whose project-name header above it
// is indented 12px - matching that here keeps the search box and the tree's
// own rows left-aligned with it instead of sitting 4px further in.
const rowBaseIndent = computed(() => (props.embedded ? 12 : 8))

const emit = defineEmits(['open-file'])

// Directory contents are fetched on demand: a large project would be slow (and
// pointless) to walk in full just to draw a collapsed root.
const childrenByPath = ref({ '': [] })
const expanded = ref(new Set())
const loadingPaths = ref(new Set())
const errorMessage = ref('')
const filterText = ref('')

/**
 * The tree is kept as a flat, indented list rather than nested components.
 * Recursion would mean one component instance per node - a deep project makes
 * that thousands of instances, and Vue has to re-diff them all on every
 * expand. A flat list also makes keyboard navigation and filtering trivial.
 */
const visibleRows = computed(() => {
  const query = filterText.value.trim().toLowerCase()
  const rows = []

  const walk = (parentPath, depth) => {
    const children = childrenByPath.value[parentPath] || []
    for (const entry of children) {
      const isExpanded = expanded.value.has(entry.relPath)
      const matches = !query || entry.name.toLowerCase().includes(query)

      if (entry.type === 'directory') {
        // While filtering, a directory is shown only if something inside matches;
        // that is only knowable for directories already loaded.
        const loadedChildren = childrenByPath.value[entry.relPath]
        const hasMatchingDescendant = query && loadedChildren
          ? subtreeMatches(entry.relPath, query)
          : false
        if (!query || matches || hasMatchingDescendant) {
          rows.push({ ...entry, depth, isExpanded })
        }
        if (isExpanded || (query && hasMatchingDescendant)) walk(entry.relPath, depth + 1)
        continue
      }

      if (matches) rows.push({ ...entry, depth, isExpanded: false })
    }
  }

  const subtreeMatches = (dirPath, needle) => {
    const children = childrenByPath.value[dirPath]
    if (!children) return false
    return children.some((child) => child.name.toLowerCase().includes(needle)
      || (child.type === 'directory' && subtreeMatches(child.relPath, needle)))
  }

  walk('', 0)
  return rows
})

async function loadDirectory(relPath) {
  if (loadingPaths.value.has(relPath)) return
  loadingPaths.value = new Set(loadingPaths.value).add(relPath)
  try {
    const result = await listWorkspaceTree(relPath)
    childrenByPath.value = { ...childrenByPath.value, [relPath]: result.entries || [] }
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Gagal membaca folder'
  } finally {
    const next = new Set(loadingPaths.value)
    next.delete(relPath)
    loadingPaths.value = next
  }
}

async function toggleDirectory(entry) {
  const next = new Set(expanded.value)
  if (next.has(entry.relPath)) {
    next.delete(entry.relPath)
  } else {
    next.add(entry.relPath)
    if (!childrenByPath.value[entry.relPath]) await loadDirectory(entry.relPath)
  }
  expanded.value = next
}

function handleRowClick(entry) {
  if (entry.type === 'directory') {
    toggleDirectory(entry)
    return
  }
  emit('open-file', entry.relPath)
}

function handleAddContext(entry, event) {
  event.stopPropagation()
  addFileAsContext(entry.relPath)
}

// ===== Reveal the active file: expand + load every ancestor directory and
// scroll it into view. Runs whenever the file open elsewhere (the editor, a
// chat proposal) changes, so the sidebar always shows where that file lives
// instead of leaving it hidden inside a collapsed folder. =====
const treeBodyRef = ref(null)

async function revealPath(relPath) {
  const segments = relPath.split('/').filter(Boolean)
  segments.pop() // only ancestor directories need expanding, not the file itself
  let ancestor = ''
  for (const segment of segments) {
    ancestor = ancestor ? `${ancestor}/${segment}` : segment
    if (!childrenByPath.value[ancestor]) await loadDirectory(ancestor)
    if (!expanded.value.has(ancestor)) {
      expanded.value = new Set(expanded.value).add(ancestor)
    }
  }
  await nextTick()
  treeBodyRef.value?.querySelector('.tree-row--active')?.scrollIntoView({ block: 'nearest' })
}

watch(() => props.activePath, (next) => {
  if (next) revealPath(next)
}, { immediate: true })

/** Reloads the root and every directory currently expanded, keeping the shape. */
async function refresh() {
  const openDirectories = ['', ...expanded.value]
  childrenByPath.value = {}
  await Promise.all(openDirectories.map((dirPath) => loadDirectory(dirPath)))
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

onMounted(() => loadDirectory(''))

watch(() => props.refreshToken, () => refresh())

defineExpose({ refresh })
</script>

<template>
  <div class="file-tree" :class="{ 'file-tree--embedded': embedded }">
    <div class="file-tree-toolbar">
      <div class="file-tree-search">
        <Search :size="13" />
        <input
          v-model="filterText"
          type="text"
          placeholder="Cari file..."
          class="file-tree-search-input"
        />
      </div>
      <button class="file-tree-refresh" title="Muat ulang file tree" @click="refresh">
        <RefreshCw :size="13" />
      </button>
    </div>

    <div v-if="errorMessage" class="file-tree-error">
      <AlertCircle :size="13" />
      <span>{{ errorMessage }}</span>
    </div>

    <div ref="treeBodyRef" class="file-tree-body">
      <div
        v-for="row in visibleRows"
        :key="row.relPath"
        class="tree-row"
        :class="{
          'tree-row--active': row.relPath === activePath,
          'tree-row--dimmed': row.type === 'file' && !row.indexable,
        }"
        :style="{ paddingLeft: `${rowBaseIndent + row.depth * 13}px` }"
        :title="row.type === 'file' && pendingPathSet.has(row.relPath)
          ? `${row.relPath} - ada perubahan dari AI belum diterima/ditolak`
          : (row.type === 'file' && !row.indexable
            ? `${row.relPath} - tidak diindeks (format atau ukurannya di luar jangkauan)`
            : row.relPath)"
        role="button"
        tabindex="0"
        @click="handleRowClick(row)"
        @keydown.enter="handleRowClick(row)"
      >
        <template v-if="row.type === 'directory'">
          <ChevronDown v-if="row.isExpanded" :size="12" class="tree-chevron" />
          <ChevronRight v-else :size="12" class="tree-chevron" />
          <FolderOpen v-if="row.isExpanded" :size="13" class="tree-icon tree-icon--folder" />
          <Folder v-else :size="13" class="tree-icon tree-icon--folder" />
        </template>
        <template v-else>
          <span class="tree-chevron"></span>
          <span class="tree-icon-wrap">
            <FileCode v-if="row.indexable" :size="13" class="tree-icon tree-icon--code" />
            <FileIcon v-else :size="13" class="tree-icon" />
            <span v-if="row.type === 'file' && pendingPathSet.has(row.relPath)" class="tree-pending-dot"></span>
          </span>
        </template>

        <span class="tree-name">{{ row.name }}</span>
        <span v-if="row.type === 'file' && row.size" class="tree-size">{{ formatSize(row.size) }}</span>
        <button
          v-if="row.type === 'file'"
          class="tree-add-context-btn"
          title="Tambahkan file ini sebagai context untuk AI Coding Assistant"
          @click="handleAddContext(row, $event)"
        >
          <ListPlus :size="12" />
        </button>
      </div>

      <p v-if="!visibleRows.length" class="file-tree-empty">
        {{ filterText ? 'Tidak ada file yang cocok.' : 'Folder kosong.' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.file-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-bg-sidebar);
  border-right: 1px solid var(--color-border);
}

/* Nested inside another panel (the app sidebar) that already has its own
   background and right-edge border/resize handle - drawing another set here
   would look like a doubled-up seam. */
.file-tree--embedded {
  background: transparent;
  border-right: none;
}

.file-tree-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

/* Lines the search box's left edge up with the 12px-indented project-name
   header above it in the sidebar, instead of sitting 4px further in. */
.file-tree--embedded .file-tree-toolbar {
  padding-left: 12px;
  padding-right: 12px;
}

.file-tree-search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: var(--color-bg-input);
  color: var(--color-text-muted);
}

.file-tree-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: 0.76rem;
  outline: none;
}

.file-tree-refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: var(--color-bg-input);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.18s ease;
  flex-shrink: 0;
}

.file-tree-refresh:hover {
  color: var(--color-text-accent);
  border-color: var(--color-accent);
}

.file-tree-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  color: var(--color-danger);
  font-size: 0.72rem;
}

.file-tree-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0 12px;
  min-height: 0;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 3px 8px 3px 8px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-family: var(--font-sans);
  font-size: 0.75rem;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.tree-row:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.tree-row--active {
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
}

.tree-row--dimmed {
  opacity: 0.5;
}

.tree-chevron {
  width: 12px;
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.tree-icon {
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.tree-icon--folder {
  color: var(--color-text-accent);
}

.tree-icon--code {
  color: var(--color-success);
}

.tree-icon-wrap {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

/** A file with an AI-proposed change nobody has accepted/rejected yet. */
.tree-pending-dot {
  position: absolute;
  top: -2px;
  right: -3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f59e0b;
  box-shadow: 0 0 0 1.5px var(--color-bg-sidebar);
}

.tree-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-size {
  flex-shrink: 0;
  font-size: 0.65rem;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

.tree-add-context-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}

.tree-row:hover .tree-add-context-btn {
  opacity: 1;
}

.tree-add-context-btn:hover {
  background: var(--color-accent-subtle);
  color: var(--color-text-accent);
}

.file-tree-empty {
  padding: 16px 12px;
  color: var(--color-text-muted);
  font-size: 0.74rem;
  text-align: center;
}
</style>
