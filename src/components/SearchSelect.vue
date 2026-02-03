<!-- src\components\SearchSelect.vue -->
<template>
  <div class="searchselect" :class="{ disabled }" ref="root" @keydown.stop.prevent="onKeydown" tabindex="0">
    <button
      type="button"
      class="form-select text-start d-flex align-items-center justify-content-between"
      :disabled="disabled"
      @click="toggle"
      :aria-expanded="open ? 'true' : 'false'"
    >
      <span class="truncate">
        <template v-if="displayLabel !== ''">{{ displayLabel }}</template>
        <span v-else class="text-muted">{{ placeholder }}</span>
      </span>
      <span class="d-inline-flex align-items-center gap-1">
        <button
          v-if="clearable && (modelValue !== null && modelValue !== undefined && modelValue !== '')"
          type="button"
          class="btn btn-link btn-sm py-0 px-1 text-muted"
          @click.stop="clear"
          aria-label="Clear"
        >
          <i class="ri-close-line"></i>
        </button>
      </span>
    </button>

    <div v-if="open" class="dropdown-panel shadow rounded border bg-body">
      <div v-if="searchable" class="p-2 border-bottom">
        <div class="input-group input-group-sm">
          <span class="input-group-text"><i class="ri-search-line"></i></span>
          <input
            ref="searchEl"
            v-model="query"
            type="text"
            class="form-control"
            :placeholder="searchPlaceholder"
            @keydown.stop
          />
        </div>
      </div>
      <ul class="list-unstyled mb-0 options" role="listbox">
        <li
          v-if="hasNull"
          :class="['option', isActive(-1) ? 'active' : '']"
          role="option"
          @mouseenter="hoverIndex = -1"
          @click="select(null)"
        >
          {{ nullLabel }}
        </li>
        <li
          v-for="(opt, idx) in filtered"
          :key="opt._valueKey || `r:${idx}:${opt.value}`"
          :class="['option', isActive(idx) ? 'active' : '']"
          role="option"
          @mouseenter="hoverIndex = idx"
          @click="select(opt.value)"
        >
          {{ opt.label }}
        </li>
        <li v-if="loading" class="py-2 px-3 text-muted small">Searching…</li>
        <li v-else-if="!filtered.length" class="py-2 px-3 text-muted small">No matches</li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";

const props = defineProps({
  options: { type: Array, default: () => [] },
  modelValue: { default: null },
  placeholder: { type: String, default: "Select…" },
  searchPlaceholder: { type: String, default: "Type to filter…" },
  clearable: { type: Boolean, default: true },
  searchable: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false },
  nullLabel: { type: String, default: undefined },
  labelKey: { type: String, default: "label" },
  valueKey: { type: String, default: "value" },

  remote: { type: Boolean, default: false },
  fetchOptions: { type: Function, default: null },
  minChars: { type: Number, default: 1 },
  debounceMs: { type: Number, default: 250 },
});

const loading = ref(false);
const remoteOptions = ref([]);
let debounceT;

const open = ref(false);
const query = ref("");
const hoverIndex = ref(-1);
const root = ref(null);
const searchEl = ref(null);

async function loadRemote(q="") {
  if (!props.fetchOptions) return;
  if ((q || "").trim().length < props.minChars) { remoteOptions.value = []; return; }
  loading.value = true;
  try { remoteOptions.value = await props.fetchOptions(q.trim()); }
  finally { loading.value = false; }
}

watch([open, query], ([isOpen, q]) => {
  if (!props.remote) return;
  if (!isOpen) return;
  clearTimeout(debounceT);
  debounceT = setTimeout(() => loadRemote(q), props.debounceMs);
});

onBeforeUnmount(() => clearTimeout(debounceT));
const emit = defineEmits(["update:modelValue"]);

const hasNull = computed(() => props.nullLabel !== undefined && props.nullLabel !== null);
const normalized = computed(() =>
  props.options.map((o, i) => {
    if (typeof o === "string") return { label: o, value: o, _valueKey: `s:${o}` };
    return {
      label: String(o[props.labelKey] ?? o.label ?? ""),
      value: o[props.valueKey] ?? o.value,
      _valueKey: `o:${i}`,
    };
  })
);
const filtered = computed(() => {
  if (props.remote) return remoteOptions.value;
  const q = query.value.trim().toLowerCase();
  if (!q) return normalized.value;
  return normalized.value.filter((o) => o.label.toLowerCase().includes(q));
});
const displayLabel = computed(() => {
  if (props.modelValue === null && hasNull.value) return "";
  const findIn = (arr) => arr.find(o => o.value === props.modelValue)?.label;
  return findIn(normalized.value)
     ?? (props.remote ? findIn(remoteOptions.value) : undefined)
     ?? "";
});

function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
  if (open.value) {
    hoverIndex.value = -1;
    if (props.remote) loadRemote(query.value || "");
    nextTick(() => searchEl.value?.focus());
  }
}
function close() { open.value = false; query.value = ""; }
function clear() { emit("update:modelValue", hasNull.value ? null : undefined); }
function select(v) { emit("update:modelValue", v); close(); }

function onKeydown(e) {
  if (!open.value && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) { toggle(); return; }
  if (!open.value) return;
  if (e.key === "Escape") return close();
  if (e.key === "ArrowDown") hoverIndex.value = Math.min(filtered.value.length - 1, hoverIndex.value + 1);
  else if (e.key === "ArrowUp") hoverIndex.value = Math.max(-1, hoverIndex.value - 1);
  else if (e.key === "Enter") {
    if (hoverIndex.value === -1 && hasNull.value) select(null);
    else {
      const item = filtered.value[hoverIndex.value];
      if (item) select(item.value);
    }
  }
}
function isActive(idx) { return hoverIndex.value === idx; }

function onDocClick(e) { if (!root.value) return; if (!root.value.contains(e.target)) close(); }
onMounted(() => document.addEventListener("click", onDocClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocClick));
watch(open, (v) => { if (v) nextTick(() => searchEl.value?.focus()); });
</script>

<style scoped>
.searchselect { position: relative; }
.searchselect .form-select { cursor: pointer; }
.searchselect .truncate { max-width: 85%; display: inline-block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.searchselect .dropdown-panel {
  position: absolute;
  top: 100%;
  left: 0;
  width: 100%;

  z-index: 99999;
  display: flex;
  flex-direction: column;
  max-height: 280px;
  overflow: hidden;
}

.searchselect .dropdown-panel .searchbar {
  position: sticky; top: 0; z-index: 1;
  background-color: var(--bs-body-bg);
}
.searchselect .dropdown-panel .options {
  flex: 1 1 auto;
  overflow: auto;
}

.searchselect .options .option { padding: .5rem .75rem; cursor: pointer; }
.searchselect .options .option:hover,
.searchselect .options .option.active {
  background: var(--bs-tertiary-bg);
}
.searchselect.disabled { pointer-events: none; opacity: .6; }
</style>
