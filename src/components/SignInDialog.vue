<template>
  <q-dialog v-model="isOpen" persistent>
    <q-card style="min-width: 350px; max-width: 95vw">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">Sign in</div>
        <q-space />
        <q-btn flat dense icon="close" aria-label="Close" @click="isOpen = false" />
      </q-card-section>
      <q-separator />
      <q-card-section>
        <SignInOptions />
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { computed, watch } from 'vue'
import SignInOptions from 'src/components/SignInOptions.vue'
import { useAuth } from 'src/composables/useAuth'

const props = defineProps({
  modelValue: Boolean,
})
const emit = defineEmits(['update:modelValue'])

const { user } = useAuth()

const isOpen = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

watch(user, (u) => {
  if (u && isOpen.value) {
    isOpen.value = false
  }
})
</script>
