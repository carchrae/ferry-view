<template>
  <div>
    <div class="text-subtitle2 q-mb-xs">Sign in with</div>
    <div class="row q-gutter-sm">
      <q-btn
        no-caps
        class="col"
        icon="login"
        label="Google"
        :outline="authMethod !== 'google'"
        color="primary"
        @click="authMethod = 'google'; signInWithGoogle()"
      />
      <q-btn
        no-caps
        class="col"
        icon="email"
        label="Email"
        :outline="authMethod !== 'email'"
        color="primary"
        @click="authMethod = 'email'"
      />
      <q-btn
        aria-describedby="phone"
        no-caps
        class="col"
        id="phone"
        icon="phone"
        label="Phone"
        :outline="authMethod !== 'phone'"
        color="primary"
        @click="authMethod = 'phone'"
      />
    </div>
    <div class="text-caption text-grey-7 q-mb-md q-mt-xs">Choose any of these three options to sign in</div>

    <!-- Email -->
    <div v-if="authMethod === 'email'">
      <q-input v-model="emailForm.name" dense outlined label="Name" class="q-mb-sm" v-if="emailForm.isSignUp" />
      <q-input v-model="emailForm.email" dense outlined label="Email" type="email" class="q-mb-sm" />
      <q-input v-model="emailForm.password" dense outlined label="Password" type="password" class="q-mb-sm" />
      <div class="row q-gutter-sm">
        <q-btn
          color="primary" no-caps dense
          :label="emailForm.isSignUp ? 'Create Account' : 'Sign In'"
          :loading="authLoading"
          @click="handleEmailAuth"
          class="col"
        />
      </div>
      <q-btn flat dense no-caps size="sm" class="q-mt-xs"
        :label="emailForm.isSignUp ? 'Already have an account? Sign in' : 'No account? Create one'"
        @click="emailForm.isSignUp = !emailForm.isSignUp"
      />
      <div v-if="authError" class="text-negative text-caption q-mt-xs">{{ authError }}</div>
    </div>

    <!-- Phone -->
    <div v-if="authMethod === 'phone'">
      <div v-if="!phoneCodeSent">
        <q-input v-model="phoneForm.number" dense outlined label="Phone number" placeholder="+1 604 555 1234" class="q-mb-sm" />
        <q-btn id="phone-sign-in-btn" color="primary" no-caps dense label="Send Code" :loading="authLoading" @click="handleSendCode" class="full-width" />
      </div>
      <div v-else>
        <q-input v-model="phoneForm.code" dense outlined label="Verification code" class="q-mb-sm" inputmode="numeric" autocomplete="one-time-code" />
        <q-btn color="primary" no-caps dense label="Verify" :loading="authLoading" @click="handleVerifyCode" class="full-width" />
      </div>
      <div v-if="authError" class="text-negative text-caption q-mt-xs">{{ authError }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onUnmounted } from 'vue'
import { useAuth } from 'src/composables/useAuth'

const { signInWithGoogle, signInWithEmail, signUpWithEmail, sendPhoneCode, verifyPhoneCode } = useAuth()

const authMethod = ref()
const authLoading = ref(false)
const authError = ref(null)
const phoneCodeSent = ref(false)
const emailForm = reactive({ email: '', password: '', name: '', isSignUp: false })
const phoneForm = reactive({ number: '', code: '' })

async function handleEmailAuth() {
  authLoading.value = true
  authError.value = null
  try {
    if (emailForm.isSignUp) {
      await signUpWithEmail(emailForm.email, emailForm.password, emailForm.name)
    } else {
      await signInWithEmail(emailForm.email, emailForm.password)
    }
  } catch (e) {
    authError.value = e.message.replace('Firebase: ', '')
  } finally {
    authLoading.value = false
  }
}

function normalizePhone(raw) {
  let digits = raw.replace(/[^\d+]/g, '')
  if (!digits.startsWith('+')) {
    if (digits.length === 11 && digits.startsWith('1')) {
      digits = '+' + digits
    } else {
      digits = '+1' + digits
    }
  }
  return digits
}

let otpAbort = null

onUnmounted(() => {
  otpAbort?.abort()
})

async function handleSendCode() {
  authLoading.value = true
  authError.value = null
  try {
    const phone = normalizePhone(phoneForm.number)
    await sendPhoneCode(phone, 'phone-sign-in-btn')
    phoneCodeSent.value = true
    listenForOtp()
  } catch (e) {
    authError.value = e.message.replace('Firebase: ', '')
  } finally {
    authLoading.value = false
  }
}

function listenForOtp() {
  if (!('OTPCredential' in window)) return
  otpAbort?.abort()
  otpAbort = new AbortController()
  navigator.credentials
    .get({ otp: { transport: ['sms'] }, signal: otpAbort.signal })
    .then((otp) => {
      if (otp?.code) {
        phoneForm.code = otp.code
        handleVerifyCode()
      }
    })
    .catch(() => {})
}

async function handleVerifyCode() {
  authLoading.value = true
  authError.value = null
  try {
    await verifyPhoneCode(phoneForm.code)
    otpAbort?.abort()
    otpAbort = null
  } catch (e) {
    authError.value = e.message.replace('Firebase: ', '')
  } finally {
    authLoading.value = false
  }
}
</script>
