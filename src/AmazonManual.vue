<script setup>
import { computed, ref } from 'vue'
import { manualAmazonProduct, readAmazonLink } from './data/amazon.js'
const props = defineProps({ disabled: Boolean })
const emit = defineEmits(['apply'])
const expanded = ref(false)
const name = ref('')
const asin = ref('')
const link = ref('')
const error = ref('')
const confirmed = ref(false)
const parsed = computed(() => { try { return readAmazonLink(link.value) } catch { return null } })
function changedLink() {
  confirmed.value = false
  error.value = ''
  // Never keep the previous product's ASIN after replacing a link.
  asin.value = parsed.value?.asin || ''
}
function apply() {
  error.value = ''
  try {
    const product = manualAmazonProduct({ name: name.value, asin: asin.value, link: link.value })
    if (!confirmed.value) throw new Error('Confirma que has comprobado el producto y el enlace de afiliado.')
    emit('apply', product)
    expanded.value = false
    name.value = ''; asin.value = ''; link.value = ''; confirmed.value = false
  } catch (e) { error.value = e.message }
}
</script>

<template>
  <section class="amazon-manual">
    <h3>Amazon · carga manual</h3>
    <p>Añade el producto de este pin con el enlace que has obtenido en tu cuenta de Afiliados.</p>
    <el-button :disabled="props.disabled" @click="expanded = !expanded">{{ expanded ? 'Ocultar formulario' : 'Cargar producto de Amazon' }}</el-button>
    <div v-if="expanded">
      <p>1. Copia el enlace de afiliado desde Amazon. 2. Completa el nombre y el ASIN. 3. Aplica los datos y guarda el pin.</p>
      <label>Enlace de Amazon<el-input v-model="link" aria-label="Enlace de Amazon manual" :disabled="disabled" maxlength="2048" placeholder="https://amzn.to/… o https://www.amazon.es/…" @input="changedLink" /></label>
      <label>Nombre del producto<el-input v-model="name" aria-label="Nombre del producto manual" :disabled="disabled" maxlength="300" @input="confirmed = false" /></label>
      <label>ASIN<el-input v-model="asin" aria-label="ASIN manual" :disabled="disabled" maxlength="10" @input="confirmed = false" /></label>
      <p v-if="parsed?.short">El enlace corto no muestra el ASIN. Cópialo de la ficha del producto; no podemos verificar su destino automáticamente.</p>
      <p v-else-if="parsed && !parsed.hasTag">Este enlace no contiene una etiqueta de afiliado visible. Revisa que hayas copiado el enlace generado en tu cuenta.</p>
      <p v-else-if="parsed?.asin">ASIN extraído del enlace. Comprueba que coincide con el producto de la imagen.</p>
      <el-checkbox v-model="confirmed" :disabled="disabled">He comprobado el producto y mi enlace de afiliado.</el-checkbox>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-button type="primary" :disabled="disabled" @click="apply">Aplicar a la ficha del pin</el-button>
      <p>Aplicar reemplaza el nombre, ASIN y enlace de esta ficha. Pulsa «Guardar cambios» para conservarlos. No se consultan precios, imágenes ni disponibilidad en Amazon.</p>
    </div>
  </section>
</template>

<style scoped>
.amazon-manual { margin: 20px 0; padding: 16px; border: 1px solid #e4ded3; border-radius: 12px; background: #faf8f4; }
h3 { margin-top: 0; }
p { font-size: 13px; line-height: 1.5; }
label { display: block; margin: 12px 0; font-size: 14px; }
.el-checkbox { height: auto; white-space: normal; margin: 12px 0; }
:deep(.el-checkbox__label) { white-space: normal; }
.el-button { max-width: 100%; white-space: normal; height: auto; min-height: 32px; }
</style>
