<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import PinLibrary from './PinLibrary.vue'


const states = [
  { value: 'draft', label: 'Borrador', type: 'info' },
  { value: 'ready', label: 'Listo para revisar', type: 'warning' },
  { value: 'approved', label: 'Aprobado', type: 'success' },
  { value: 'published', label: 'Publicado', type: 'primary' },
  { value: 'discarded', label: 'Descartado', type: 'info' },
]
const pins = ref([])
const libraryDirty = ref(false)
function updateCollection(value) { collections.value = collections.value.map(item => item.id === value.id ? value : item) }
const collections = ref([])
const loading = ref(true)
const loadError = ref('')
const saving = ref(false)
const uploadingImage = ref(false), imageInput = ref(null)
const saveError = ref('')
const conflict = ref(false)
const activeCollection = ref('all')
const activeStatus = ref('active')
const search = ref('')
const selectedOrder = ref(null)
const draft = ref({})
const originalDraft = ref('')
const form = ref(null)
const pinterest = ref(null)
const pinterestBusy = ref(false)
const pinterestError = ref('')
async function loadPinterest() {
  pinterestError.value = ''
  try { pinterest.value = await request('/pinterest/status') }
  catch (error) { pinterestError.value = error.message }
}
async function connectPinterest() {
  if (!(await allowDiscard())) return
  pinterestBusy.value = true
  pinterestError.value = ''
  try {
    const result = await request('/pinterest/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    window.location.assign(result.url)
  } catch (error) { pinterestError.value = error.message }
  finally { pinterestBusy.value = false }
}
async function disconnectPinterest() {
  try {
    await ElMessageBox.confirm('Se eliminará la conexión guardada en AsyneStudio. Para revocar el permiso también en Pinterest, usa los ajustes de aplicaciones de Pinterest.', 'Desconectar Pinterest', { confirmButtonText: 'Desconectar', cancelButtonText: 'Cancelar' })
  } catch { return }
  pinterestBusy.value = true
  try {
    await request('/pinterest/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    await loadPinterest()
  } catch (error) { pinterestError.value = error.message }
  finally { pinterestBusy.value = false }
}
const amazonProductUrl = computed(() => {
  const asin = (draft.value.asin || '').trim()
  return /^[A-Z0-9]{10}$/.test(asin) ? `https://www.amazon.es/dp/${asin}` : ''
})
const selected = computed(() => pins.value.find(pin => pin.order === selectedOrder.value) ?? null)
const drawerOpen = computed({ get: () => selected.value !== null, set: value => { if (!value) selectedOrder.value = null } })
const dirty = computed(() => selected.value && JSON.stringify(draft.value) !== originalDraft.value)
const filteredPins = computed(() => pins.value.filter(pin =>
  (activeCollection.value === 'all' || pin.collection === activeCollection.value) &&
  (activeStatus.value === 'all' || (activeStatus.value === 'active' ? pin.status !== 'discarded' : pin.status === activeStatus.value)) &&
  `${pin.title} ${pin.asin} ${pin.product}`.toLocaleLowerCase('es').includes(search.value.toLocaleLowerCase('es'))
))
const count = status => pins.value.filter(pin => pin.status === status).length
const activePins = computed(() => pins.value.filter(pin => pin.status !== 'discarded'))
const pending = computed(() => pins.value.filter(pin => ['draft', 'ready'].includes(pin.status)))
const statusInfo = status => states.find(item => item.value === status) ?? states[0]
const collectionName = id => collections.value.find(item => item.id === id)?.name ?? ''
const formatDate = value => new Date(value).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
const rules = {
  title: [{ required: true, whitespace: true, message: 'Escribe un título.', trigger: 'blur' }],
  product: [],
  asin: [{ pattern: /^[A-Z0-9]{10}$/, message: 'Usa 10 letras mayúsculas o números.', trigger: 'blur' }],
  affiliateUrl: [{ validator: (rule, value, callback) => {
    if (!value.trim()) return callback()
    try {
      const url = new URL(value.trim())
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
      callback()
    } catch { callback(new Error('Introduce un enlace http o https válido.')) }
  }, trigger: 'blur' }],
}

async function request(path, options = {}) {
  let response
  try { response = await fetch(`/api${path}`, { ...options, signal: AbortSignal.timeout(15000) }) }
  catch { throw new Error('No se pudo conectar. Comprueba que Docker sigue iniciado e inténtalo de nuevo.') }
  const data = await response.json().catch(() => null)
  if (!response.ok || data === null) throw Object.assign(new Error(data?.error || 'El servicio no está disponible. Inténtalo de nuevo.'), { status: response.status })
  return data
}
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [newPins, newCollections] = await Promise.all([request('/pins'), request('/collections')])
    pins.value = newPins
    collections.value = newCollections
  } catch (error) { loadError.value = error.message }
  finally { loading.value = false }
}
function setDraft(pin) {
  const { title, description, product, asin, alt, affiliateUrl, board, collection, status, version, notes, prompt, kind, image } = pin
  draft.value = { title, description, product, asin, alt, affiliateUrl, board, collection, status, version, notes, prompt, kind, image,
    scheduledAt: pin.scheduledAt ? new Date(pin.scheduledAt) : null }
  originalDraft.value = JSON.stringify(draft.value)
  saveError.value = ''
  conflict.value = false
  form.value?.clearValidate()
}
async function uploadPinImage(event) {
  const file = event.target.files?.[0]
  if (!file) return
  uploadingImage.value = true
  saveError.value = ''
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('Máximo 8 MB por imagen.')
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Usa PNG, JPG o WebP.')
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
      reader.readAsDataURL(file)
    })
    const result = await request('/reference-images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) })
    draft.value.image = result.image
    ElMessage.success('Imagen cargada. Pulsa Guardar cambios para vincularla al pin.')
  } catch (error) { saveError.value = error.message }
  finally { uploadingImage.value = false; event.target.value = '' }
}
async function copyPinPrompt() { try { await navigator.clipboard.writeText(draft.value.prompt); ElMessage.success('Prompt copiado') } catch { ElMessage.error('Selecciona y copia el texto manualmente.') } }


async function allowDiscard() {
  if (saving.value || uploadingImage.value) return false
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('Tienes cambios sin guardar. ¿Quieres descartarlos?', 'Cambios pendientes', {
      confirmButtonText: 'Descartar cambios', cancelButtonText: 'Seguir editando', type: 'warning',
    })
    return true
  } catch { return false }
}
async function openPin(pin) {
  if (!(await allowDiscard())) return
  selectedOrder.value = pin.order
  setDraft(pin)
}
async function beforeClose(done) { if (await allowDiscard()) done() }
async function closeDrawer() { if (await allowDiscard()) selectedOrder.value = null }
function reviewNext() { if (pending.value.length) openPin(pending.value[0]) }
async function save(nextStatus) {
  if (saving.value || uploadingImage.value || !(await form.value.validate().catch(() => false))) return
  saving.value = true
  saveError.value = ''
  try {
    const payload = { ...draft.value, scheduledAt: draft.value.scheduledAt ? new Date(draft.value.scheduledAt).toISOString() : null }
    if (typeof nextStatus === 'string') payload.status = nextStatus
    const pin = await request(`/pins/${selected.value.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    pins.value = pins.value.map(item => item.id === pin.id ? pin : item)
    setDraft(pin)
    ElMessage.success(nextStatus === 'discarded' ? 'Pin descartado. Puedes recuperarlo desde el filtro Descartados.' : nextStatus === 'draft' ? 'Pin recuperado como borrador' : 'Cambios guardados')
  } catch (error) {
    saveError.value = error.message
    conflict.value = error.status === 409
  } finally { saving.value = false }
}
async function reloadSelected() {
  if (!(await allowDiscard())) return
  saving.value = true
  try {
    const pin = await request(`/pins/${selected.value.id}`)
    pins.value = pins.value.map(item => item.id === pin.id ? pin : item)
    setDraft(pin)
  } catch (error) { saveError.value = error.message }
  finally { saving.value = false }
}
function beforeUnload(event) { if (dirty.value || libraryDirty.value || uploadingImage.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => {
  load(); loadPinterest(); window.addEventListener('beforeunload', beforeUnload)
  const url = new URL(window.location.href)
  const result = url.searchParams.get('pinterest')
  if (result) {
    const messages = {
      connected: 'Pinterest conectado correctamente.',
      denied: 'Has cancelado la autorización de Pinterest.',
      invalid_state: 'La autorización caducó o no corresponde a este navegador. Vuelve a conectar.',
      permissions: 'No se concedieron los permisos necesarios. Vuelve a conectar.',
      failed: 'No se pudo conectar Pinterest. Comprueba el acceso Trial, las credenciales y la dirección de retorno.',
    }
    if (result === 'connected') ElMessage.success(messages.connected)
    else ElMessage.error(messages[result] || 'No se pudo completar la conexión.')
    url.searchParams.delete('pinterest')
    window.history.replaceState({}, '', url)
  }
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="monogram">AS</div><div><strong>Asyne Studio</strong><span>Espacio editorial</span></div></div>
<div class="side-label">TU ESPACIO EDITORIAL</div><p>Banco de ideas</p><p>Pines publicados</p><p class="sidebar-note">Organizados por tablero y subtablero.</p>
      <div class="side-bottom"><span class="side-label">INTEGRACIONES</span><p>Pinterest</p><el-tag :type="pinterest?.connected ? 'success' : 'info'" effect="plain" size="small">{{ pinterest?.connected ? 'Conectado' : 'Sin conectar' }}</el-tag><p>Amazon · fichas de productos</p><p>Picsart pendiente</p></div>
    </aside>

    <main v-loading="loading" class="main" :aria-busy="loading">
      <div class="topline"><span>TUS COLECCIONES · TU RITMO</span><el-tag :type="loadError ? 'danger' : 'success'" effect="plain">{{ loadError ? 'Sin conexión' : 'Espacio local' }}</el-tag></div>
      <header class="page-header"><div><h1>Tu estudio de contenido</h1><p>Ideas, referencias y publicaciones en un solo lugar.</p></div><el-button type="primary" :disabled="!pending.length || loading" @click="reviewNext">Revisar siguiente <span class="button-count">{{ pending.length }}</span></el-button></header>
      <div v-if="loadError" class="load-error" role="alert"><el-alert :title="loadError" type="error" :closable="false" show-icon /><el-button @click="load">Volver a intentar</el-button></div>
      <details class="pinterest-panel"><summary>Conexión con Pinterest</summary>
        <h2>Conexión con Pinterest</h2>
        <p v-if="pinterest?.connected">Conectado como {{ pinterest.username }} · autorización válida hasta {{ formatDate(pinterest.expiresAt) }}.</p>
        <p v-else-if="pinterest?.needsReconnect">La conexión guardada necesita autorización de nuevo.</p>
        <p v-else>Conecta tu cuenta cuando Pinterest apruebe el acceso Trial. AsyneStudio todavía no comprueba esa aprobación automáticamente.</p>
        <p v-if="pinterest && !pinterest.configured">Falta configurar la aplicación de Pinterest en el servidor. Las instrucciones están en el README del proyecto.</p>
        <p v-if="pinterest && !pinterest.connected">Dirección de retorno para registrar en Pinterest: <code>{{ pinterest.redirectUri }}</code></p>
        <p>Esta conexión permite identificar tu cuenta y autorizar la consulta de tableros. La publicación de pines se añadirá en un paso posterior.</p>
        <el-alert v-if="pinterestError" :title="pinterestError" type="error" :closable="false" show-icon />
        <el-button type="primary" :disabled="!pinterest?.configured || pinterestBusy" :loading="pinterestBusy" @click="connectPinterest">{{ pinterest?.connected || pinterest?.needsReconnect ? 'Volver a conectar Pinterest' : 'Conectar Pinterest' }}</el-button>
        <el-button :disabled="pinterestBusy" @click="loadPinterest">Actualizar estado</el-button>
        <el-button v-if="pinterest?.connected || pinterest?.needsReconnect" :disabled="pinterestBusy" @click="disconnectPinterest">Desconectar</el-button>
      </details>

<PinLibrary v-if="!loading && !loadError" :pins="pins" :collections="collections" @open="openPin" @saved="updateCollection" @dirty="libraryDirty = $event" />
    </main>

    <el-drawer v-model="drawerOpen" title="Editar pin" direction="rtl" size="min(520px, 100vw)" :before-close="beforeClose" :close-on-press-escape="!saving" :close-on-click-modal="!saving" :show-close="!saving">
      <template v-if="selected">
        <div class="editor-heading"><img v-if="draft.image" class="drawer-image" :src="draft.image" :alt="selected.alt" /><p v-else>Imagen pendiente</p><p class="eyebrow">PIN {{ String(selected.order).padStart(2, '0') }}</p><h2>{{ selected.title }}</h2><p class="collection-name">{{ collectionName(selected.collection) }}</p></div>
        <input ref="imageInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="uploadPinImage" /><el-button :loading="uploadingImage" :disabled="saving || uploadingImage" @click="imageInput.click()">{{ draft.image ? 'Cambiar imagen del pin' : 'Subir imagen del pin' }}</el-button><p>PNG, JPG o WebP · máximo 8 MB. Después pulsa Guardar cambios.</p>
        <el-alert v-if="selected.status === 'discarded'" title="Este pin está descartado. Conserva su contenido y puedes recuperarlo como borrador." type="info" :closable="false" />
        <div v-if="selected.kind !== 'base' && pins.find(p => p.collection === selected.collection && p.kind === 'base')?.image"><p>Escena base para adjuntar junto a la foto original del producto:</p><a :href="pins.find(p => p.collection === selected.collection && p.kind === 'base').image" download>Descargar escena base</a></div>
        <el-form ref="form" :model="draft" :rules="rules" label-position="top" :disabled="saving" class="pin-form" @submit.prevent="save">
          <p>{{ selected.kind === 'base' ? 'Pin base · escena completa' : 'Pin de producto · derivado de la escena base' }}</p><el-form-item label="Prompt de este pin"><el-input v-model="draft.prompt" type="textarea" :rows="8" maxlength="12000" /><el-button :disabled="!draft.prompt" @click="copyPinPrompt">Copiar prompt</el-button></el-form-item>
          <el-form-item label="Título" prop="title"><el-input v-model="draft.title" maxlength="100" show-word-limit /></el-form-item>
          <el-form-item label="Descripción" prop="description"><el-input v-model="draft.description" type="textarea" :rows="4" maxlength="5000" show-word-limit placeholder="El texto que acompañará a tu pin" /></el-form-item>
          <el-form-item label="Notas de preparación y pendientes" prop="notes"><el-input v-model="draft.notes" type="textarea" :rows="3" maxlength="5000" placeholder="Referencias, idea visual, comprobaciones pendientes…" /></el-form-item>
          <div class="form-row"><el-form-item label="Subtablero" prop="collection"><el-select v-model="draft.collection"><el-option v-for="collection in collections" :key="collection.id" :label="collection.shortName" :value="collection.id" /></el-select></el-form-item><el-form-item label="Estado" prop="status"><el-select v-model="draft.status"><el-option v-for="state in states" :key="state.value" :label="state.label" :value="state.value" /></el-select></el-form-item></div>
          <el-form-item label="Producto" prop="product"><el-input v-model="draft.product" maxlength="300" /></el-form-item>
          <p v-if="amazonProductUrl"><a :href="amazonProductUrl" target="_blank" rel="noopener noreferrer">Ficha de Amazon ↗</a></p>
          <el-form-item label="ASIN" prop="asin"><el-input v-model="draft.asin" maxlength="10" /></el-form-item>
          <el-form-item label="Enlace de afiliado" prop="affiliateUrl"><el-input v-model="draft.affiliateUrl" maxlength="2048" placeholder="https://…" /></el-form-item>
          <p v-if="!draft.image" class="drawer-note">Texto alternativo propuesto: lo revisaré cuando esté subida la imagen final.</p><el-form-item label="Texto alternativo de la imagen" prop="alt"><el-input v-model="draft.alt" type="textarea" :rows="2" maxlength="1000" /></el-form-item>
          <el-form-item label="Fecha y hora previstas" prop="scheduledAt"><el-date-picker v-model="draft.scheduledAt" type="datetime" format="DD/MM/YYYY HH:mm" placeholder="Elegir fecha y hora" clearable /></el-form-item>
          <p class="drawer-note">La fecha es una referencia en tu hora local. Cambiar a «Publicado» registra una publicación que ya hiciste; no envía el pin a Pinterest.</p>
        </el-form>
      </template>
      <template #footer>
        <div v-if="selected" class="editor-footer">
          <el-alert v-if="saveError" :title="saveError" type="error" :closable="false" show-icon />
          <el-button v-if="conflict" :disabled="saving" @click="reloadSelected">Recargar ficha guardada</el-button>
          <p class="save-status" aria-live="polite">{{ saving ? 'Guardando…' : dirty ? 'Cambios sin guardar' : `Guardado · ${formatDate(selected.updatedAt)}` }}</p>
          <el-button v-if="selected.status === 'discarded'" :disabled="saving || conflict" @click="save('draft')">{{ dirty ? 'Guardar y recuperar como borrador' : 'Recuperar como borrador' }}</el-button>
          <el-button v-else type="danger" plain :disabled="saving || conflict" @click="save('discarded')">{{ dirty ? 'Guardar y descartar pin' : 'Descartar pin' }}</el-button>
          <div class="editor-actions"><el-button :disabled="saving" @click="closeDrawer">Cerrar</el-button><el-button type="primary" :loading="saving" :disabled="!dirty || conflict || uploadingImage" @click="save">Guardar cambios</el-button></div>
        </div>
      </template>
    </el-drawer>
  </div>
</template>





