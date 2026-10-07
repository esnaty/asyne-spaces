<script setup>
import { computed, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import SubboardEditor from './SubboardEditor.vue'
const props = defineProps({ pins: Array, collections: Array })
const emit = defineEmits(['open', 'saved', 'dirty'])
const space = ref('ideas'), search = ref(''), expanded = ref(null), dirty = ref(false)
const showDiscarded = ref(false)
const visiblePins = computed(() => props.pins.filter(p => space.value === 'published' ? p.status === 'published' : p.status !== 'published' && (showDiscarded.value || p.status !== 'discarded')))
const groups = computed(() => {
  const boards = new Map()
  for (const collection of props.collections) {
    const items = visiblePins.value.filter(p => p.collection === collection.id).sort((a,b) => Number(b.kind === 'base') - Number(a.kind === 'base'))
    const grouped = new Map()
    for (const pin of items) {
      const board = space.value === 'published' ? pin.board || collection.boardName || 'Sin tablero asignado' : collection.boardName || 'Sin tablero asignado'
      if (!grouped.has(board)) grouped.set(board, [])
      grouped.get(board).push(pin)
    }
    if (!items.length && space.value === 'ideas' && !props.pins.some(p => p.collection === collection.id)) grouped.set(collection.boardName || 'Sin tablero asignado', [])
    for (const [name, pins] of grouped) {
      if (search.value && !`${name} ${collection.name} ${pins.map(p => `${p.title} ${p.product} ${p.asin}`).join(' ')}`.toLowerCase().includes(search.value.toLowerCase())) continue
      if (!boards.has(name)) boards.set(name, [])
      boards.get(name).push({ collection, pins })
    }
  }
  return [...boards].map(([name, sections]) => ({ name, sections }))
})
async function allowChange() {
  if (!dirty.value) return true
  try { await ElMessageBox.confirm('Hay cambios sin guardar en el subtablero. ¿Descartarlos?', 'Cambios pendientes', { confirmButtonText: 'Descartar', cancelButtonText: 'Seguir editando' }); return true } catch { return false }
}
function setDirty(value) { dirty.value = value; emit('dirty', value) }
async function switchSpace(value) { if (await allowChange()) { expanded.value = null; setDirty(false); space.value = value; search.value = '' } }
async function toggle(id) { if (await allowChange()) { expanded.value = expanded.value === id ? null : id; setDirty(false) } }
const labels = { draft: 'Borrador', ready: 'Listo para revisar', approved: 'Aprobado', published: 'Publicado', discarded: 'Descartado' }
</script>
<template>
  <div class="space-tabs" role="tablist" aria-label="Espacios de contenido">
    <button role="tab" :aria-selected="space === 'ideas'" @click="switchSpace('ideas')">Banco de ideas <span>{{ pins.filter(p => p.status !== 'published' && p.status !== 'discarded').length }}</span></button>
    <button role="tab" :aria-selected="space === 'published'" @click="switchSpace('published')">Pines publicados <span>{{ pins.filter(p => p.status === 'published').length }}</span></button>
  </div>
  <p v-if="space === 'published'" class="library-note">Publicaciones registradas en AsyneStudio. La sincronización con Pinterest sigue pendiente; marca como «Publicado» solo lo que ya hayas subido.</p>
  <p v-else class="library-note">De la idea a la escena: organiza cada subtablero, reúne las referencias reales y copia su prompt para generar en Picsart.</p>
  <div class="library-tools"><el-input v-model="search" :disabled="dirty" clearable placeholder="Buscar tablero, subtablero o producto" aria-label="Buscar contenido" /><el-checkbox v-if="space === 'ideas'" v-model="showDiscarded" :disabled="dirty">Mostrar descartados</el-checkbox></div>
  <section v-for="board in groups" :key="board.name" class="board-group">
    <header><span class="eyebrow">TABLERO</span><h2>{{ board.name }}</h2></header>
    <article v-for="section in board.sections" :key="section.collection.id" class="subboard-group">
      <div class="subboard-heading"><div><span class="eyebrow">SUBTABLERO · {{ section.pins.length }} PINES</span><h3>{{ section.collection.name }}</h3></div><el-button @click="toggle(`${board.name}/${section.collection.id}`)">{{ expanded === `${board.name}/${section.collection.id}` ? 'Cerrar preparación' : 'Prompt y referencias' }}</el-button></div>
      <SubboardEditor v-if="expanded === `${board.name}/${section.collection.id}`" :collection="section.collection" @dirty="setDirty" @saved="emit('saved', $event)" />
      <div class="pin-grid">
        <el-card v-for="pin in section.pins" :key="pin.order" class="pin-card" shadow="hover" role="button" tabindex="0" :aria-label="`Editar ${pin.title}`" @click="emit('open', pin)" @keydown.enter="emit('open', pin)" @keydown.space.prevent="emit('open', pin)">
          <img v-if="pin.image" :src="pin.image" :alt="pin.alt" loading="lazy" /><div v-else class="idea-placeholder">Imagen pendiente</div>
          <div class="pin-body"><p class="eyebrow">{{ pin.kind === 'base' ? 'PIN BASE · CONJUNTO' : 'PIN DE PRODUCTO' }}</p><h3>{{ pin.title }}</h3><el-tag size="small" effect="plain">{{ labels[pin.status] }}</el-tag><p class="pin-date">{{ pin.product || 'Producto pendiente' }}</p></div>
        </el-card>
      </div>
    </article>
  </section>
  <el-empty v-if="!groups.length" :description="space === 'published' ? 'Todavía no hay publicaciones registradas con este filtro' : 'No hay ideas con este filtro'" />
</template>

