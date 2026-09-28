/**
 * Message branching for a conversation - editing a past message, or hitting
 * "Regenerate", no longer destroys what was there before. Every message
 * version that has ever existed is kept as a node in a tree; the classic
 * flat `conv.messages` array (which ChatView, MessageBubble, App.vue's send/
 * stream logic, and the agent-server all already expect) is always just the
 * *active path* through that tree, rebuilt after every tree edit.
 *
 * Shape added to a conversation object:
 *
 *   conv.nodes            { [id]: MessageNode }  - every version, ever
 *   conv.rootChildrenIds  string[]               - root-level message ids
 *                                                   (almost always length 1;
 *                                                   >1 only if the very FIRST
 *                                                   message itself was edited)
 *   conv.activeRootId     string | null          - which root is on the active path
 *   conv.messages         MessageNode[]          - UNCHANGED shape, but now
 *                                                   always derived, never
 *                                                   hand-edited directly
 *
 * A MessageNode is a normal message object (role, content, images, model,
 * rating, performance, ...) plus:
 *
 *   id             string
 *   parentId       string | null   - null only for a root-level message
 *   childrenIds    string[]        - every branch that continues from here
 *   activeChildId  string | null   - which child is currently on the active path
 *   siblingIndex   number          - written by syncActivePath(); this node's
 *   siblingCount   number            position among its siblings, for a
 *                                     "‹ 2/3 ›" branch switcher in the UI
 *
 * Callers never touch these fields directly - go through the functions below,
 * which all end by calling syncActivePath() so conv.messages is always
 * consistent with the tree.
 */

/**
 * crypto.randomUUID() needs a secure context (https, or localhost) - this
 * app's web-ui is usually opened that way, but can also be reached over a
 * plain-http LAN address (see the PC Server / Laptop engine switcher), where
 * it's simply undefined. This never has to be cryptographically strong, just
 * unique within one conversation, so a timestamp+random fallback is enough.
 */
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Builds a new, unattached message node. Pass it to appendMessage() or
 * editMessage() - this alone does not touch the tree.
 * @param {'user' | 'assistant'} role
 * @param {Record<string, unknown>} fields Everything else the message needs
 *   (content, images, model, rating, ...) - merged in as-is.
 */
export function createNode(role, fields = {}) {
  return {
    id: generateId(),
    role,
    parentId: null,
    childrenIds: [],
    activeChildId: null,
    ...fields,
  }
}

/**
 * Migrates a conversation loaded from storage (or never touched by this
 * module yet) into the tree shape, by chaining its existing flat `messages`
 * array into a straight line with no branches. Idempotent - does nothing
 * once `conv.nodes` already exists - so every exported function below can
 * just call this first instead of every caller having to remember to.
 */
export function ensureTreeShape(conv) {
  if (conv.nodes) return
  conv.nodes = {}
  conv.rootChildrenIds = []
  conv.activeRootId = null

  let parentId = null
  for (const message of conv.messages) {
    const node = {
      ...message,
      id: message.id || generateId(),
      parentId,
      childrenIds: [],
      activeChildId: null,
    }
    conv.nodes[node.id] = node
    if (parentId === null) {
      conv.rootChildrenIds.push(node.id)
      conv.activeRootId = node.id
    } else {
      conv.nodes[parentId].childrenIds.push(node.id)
      conv.nodes[parentId].activeChildId = node.id
    }
    parentId = node.id
  }
  syncActivePath(conv)
}

/**
 * Rebuilds `conv.messages` by walking root -> activeChildId -> activeChildId
 * -> ... to the current leaf, and stamps each node's siblingIndex/siblingCount
 * along the way. Every tree mutation ends with this - it is the one place
 * that turns "the tree" back into "the flat array everything else reads".
 *
 * Mutates conv.messages in place (splice, not reassignment) so any existing
 * reference to that array - Vue's reactivity, a `const conv = ...` closure
 * mid-stream in App.vue - keeps seeing the update instead of a stale copy.
 */
export function syncActivePath(conv) {
  const path = []
  let currentId = conv.activeRootId ?? null
  let parent = null

  while (currentId) {
    const node = conv.nodes[currentId]
    if (!node) break // dangling pointer (shouldn't happen) - stop rather than throw
    const siblingIds = parent ? parent.childrenIds : conv.rootChildrenIds
    node.siblingIndex = siblingIds.indexOf(node.id)
    node.siblingCount = siblingIds.length
    path.push(node)
    parent = node
    currentId = node.activeChildId
  }

  conv.messages.splice(0, conv.messages.length, ...path)
}

/** The single mutation primitive every other exported function reduces to. */
function addChild(conv, parentId, node) {
  node.parentId = parentId
  conv.nodes[node.id] = node
  if (parentId === null) {
    conv.rootChildrenIds.push(node.id)
    conv.activeRootId = node.id
  } else {
    const parent = conv.nodes[parentId]
    parent.childrenIds.push(node.id)
    parent.activeChildId = node.id
  }
  syncActivePath(conv)
  return node
}

/**
 * The ordinary "send a message" / "here's the assistant's reply" case: adds
 * `node` as a new child of whatever is currently the last message in the
 * active path (or as a new root if the conversation is empty).
 */
export function appendMessage(conv, node) {
  ensureTreeShape(conv)
  const leaf = conv.messages[conv.messages.length - 1]
  return addChild(conv, leaf ? leaf.id : null, node)
}

/**
 * Edits an existing message. Does NOT mutate the original - it creates a new
 * sibling node (same parent) carrying the new content, and makes that sibling
 * the active branch. Because the new node starts with no children of its
 * own, syncActivePath() naturally stops there: everything that used to come
 * after the edited message (the old reply, and anything after that) simply
 * drops off the active view - it is not deleted, only no longer on the path
 * the user is currently looking at, and is still reachable by switching back
 * to the old sibling with switchBranch().
 *
 * @param nodeId The node being edited (must exist in conv.nodes).
 * @param changes Fields to overwrite, e.g. `{ content: newText }`.
 * @returns The new node - the caller (App.vue) still has to append a fresh
 *   assistant reply under it to actually get a new answer.
 */
export function editMessage(conv, nodeId, changes) {
  ensureTreeShape(conv)
  const original = conv.nodes[nodeId]
  if (!original) throw new Error(`Message ${nodeId} not found in this conversation`)

  const edited = {
    ...original,
    ...changes,
    id: generateId(),
    childrenIds: [],
    activeChildId: null,
  }
  return addChild(conv, original.parentId, edited)
}

/**
 * Un-points the current leaf's parent, so that parent (normally the last
 * user message) becomes the active leaf again. This is all "Regenerate"
 * needs before re-running the normal send flow: appendMessage() will then
 * attach the fresh reply as a new sibling of the reply being regenerated,
 * instead of a child of it - so the old reply is kept, reachable via the
 * branch switcher, rather than deleted outright.
 * No-op if the conversation is empty.
 */
export function retractLastReply(conv) {
  ensureTreeShape(conv)
  const leaf = conv.messages[conv.messages.length - 1]
  if (!leaf || leaf.parentId == null) return
  conv.nodes[leaf.parentId].activeChildId = null
  syncActivePath(conv)
}

/**
 * Removes a leaf node (one with no children yet) and re-points its parent's
 * active branch back to whichever sibling was previously active, or null if
 * none. For undoing a failed send: the node being removed was always just
 * added by appendMessage()/editMessage() moments earlier, so it is
 * guaranteed to still be a childless leaf - this never has to re-parent
 * descendants.
 */
export function deleteLeaf(conv, nodeId) {
  ensureTreeShape(conv)
  const node = conv.nodes[nodeId]
  if (!node || node.childrenIds.length) return

  const parentId = node.parentId
  const siblingIds = parentId == null ? conv.rootChildrenIds : conv.nodes[parentId].childrenIds
  const index = siblingIds.indexOf(nodeId)
  if (index !== -1) siblingIds.splice(index, 1)
  delete conv.nodes[nodeId]

  const previousSiblingId = siblingIds[siblingIds.length - 1] ?? null
  if (parentId == null) conv.activeRootId = previousSiblingId
  else conv.nodes[parentId].activeChildId = previousSiblingId
  syncActivePath(conv)
}

/**
 * Moves the active branch at `nodeId`'s position to the next/previous
 * sibling (delta = +1 / -1, wrapping around both ends) - the "‹ ›" control.
 * No-op if the node has no siblings to switch to.
 */
export function switchBranch(conv, nodeId, delta) {
  ensureTreeShape(conv)
  const node = conv.nodes[nodeId]
  if (!node) return

  const parent = node.parentId != null ? conv.nodes[node.parentId] : null
  const siblingIds = parent ? parent.childrenIds : conv.rootChildrenIds
  const currentIndex = siblingIds.indexOf(nodeId)
  if (currentIndex === -1 || siblingIds.length < 2) return

  const nextIndex = (currentIndex + delta + siblingIds.length) % siblingIds.length
  const nextId = siblingIds[nextIndex]
  if (parent) parent.activeChildId = nextId
  else conv.activeRootId = nextId
  syncActivePath(conv)
}
