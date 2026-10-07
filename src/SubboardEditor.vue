<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
const props = defineProps({ collection: Object })
const emit = defineEmits(['saved', 'dirty'])
function amazonLink(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && ['amazon.es', 'www.amazon.es', 'amzn.to'].includes(url.hostname) ? url.href : null
  } catch { return null }
}
const draft = ref({}), original = ref(''), error = ref(''), saving = ref(false), uploading = ref(false)
function reset() {
  draft.value = JSON.parse(JSON.stringify({ name: props.collection.name, boardName: props.collection.boardName, prompt: props.collection.prompt, referenceImages: props.collection.referenceImages, version: props.collection.version }))
  original.value = JSON.stringify(draft.value)
}
watch(() => props.collection, reset, { immediate: true })
const dirty = computed(() => JSON.stringify(draft.value) !== original.value)
watch(dirty, value => emit('dirty', value))
onBeforeUnmount(() => emit('dirty', false))
async function save() {
  saving.value = true; error.value = ''
  try {
    const response = await fetch(`/api/collections/${encodeURIComponent(props.collection.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft.value) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error)
    original.value = JSON.stringify(draft.value)
    emit('saved', data); ElMessage.success('Subtablero guardado')
  } catch (e) { error.value = e.message } finally { saving.value = false }
}
async function copy() {
  try { await navigator.clipboard.writeText(draft.value.prompt); ElMessage.success('Prompt copiado') }
  catch { error.value = 'No se pudo copiar. Selecciona el texto del prompt y cópialo manualmente.' }
}
async function upload(event) {
  uploading.value = true; error.value = ''
  try {
    for (const file of event.target.files) {
      if (draft.value.referenceImages.length >= 16) throw new Error('Máximo 16 referencias.')
      if (file.size > 8 * 1024 * 1024) throw new Error('Cada imagen debe ocupar menos de 8 MB.')
      const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(file) })
      const response = await fetch('/api/reference-images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      draft.value.referenceImages.push({ name: file.name, image: result.image, asin: '', sourceUrl: '' })
    }
  } catch (e) { error.value = e.message } finally { uploading.value = false; event.target.value = '' }
}
</script>
<template>
  <div class="subboard-editor">
    <div class="form-row">
      <label>Tablero<el-input v-model="draft.boardName" :disabled="saving" maxlength="200" placeholder="Sin tablero asignado" /></label>
      <label>Subtablero<el-input v-model="draft.name" :disabled="saving" maxlength="200" /></label>
    </div>
    <h3>Visualización inicial</h3>
    <p>Adjunta las fotos originales de los productos a Picsart junto con este prompt. Las imágenes de los pines no sustituyen las referencias reales.</p>
    <el-input v-model="draft.prompt" :disabled="saving" type="textarea" :rows="9" maxlength="12000" aria-label="Prompt del subtablero" placeholder="Describe la escena, cómo usar cada referencia, el estilo y las condiciones de fidelidad al producto." />
    <el-button :disabled="!draft.prompt" @click="copy">Copiar prompt</el-button>
    <h3>Referencias de productos reales</h3>
    <p v-if="!draft.referenceImages.length">Referencias pendientes. Añade las fotos descargadas de Amazon antes de generar.</p>
    <label class="reference-upload">Añadir fotos descargadas de Amazon <input type="file" accept="image/png,image/jpeg,image/webp" multiple :disabled="saving || uploading" @change="upload" /></label>
    <div class="reference-grid">
      <article v-for="(reference, index) in draft.referenceImages" :key="reference.image + index">
        <img :src="reference.image" :alt="reference.name" />
        <label>Referencia {{ index + 1 }} · producto<el-input v-model="reference.name" :disabled="saving" maxlength="300" /></label>
        <label>ASIN<el-input v-model="reference.asin" :disabled="saving" maxlength="10" /></label>
        <div>
          <a v-if="amazonLink(reference.sourceUrl)" :href="amazonLink(reference.sourceUrl)" target="_blank" rel="noopener noreferrer" :aria-label="`Ficha de Amazon de ${reference.name} (abre en otra pestaña)`">Ficha de Amazon ↗</a>
          <span v-else>Ficha de Amazon</span>
          <el-input v-model="reference.sourceUrl" :disabled="saving" maxlength="2048" :aria-label="`URL de Amazon de ${reference.name}`" />
        </div>
        <a :href="reference.image" :download="`referencia-${index + 1}-${reference.asin || 'producto'}.${reference.image.split('.').pop()}`">Descargar referencia {{ index + 1 }}</a>
        <el-button :disabled="saving" text type="danger" @click="draft.referenceImages.splice(index, 1)">Quitar del subtablero</el-button>
      </article>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <div class="subboard-save"><span>{{ dirty ? 'Cambios sin guardar' : 'Guardado' }}</span><el-button type="primary" :disabled="!dirty || uploading" :loading="saving" @click="save">Guardar subtablero</el-button></div>
  </div>
</template>
