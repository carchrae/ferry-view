import { Platform } from 'quasar'

// Tooltips need a hover: on phones and tablets they never show, so every
// tooltip in the app renders its text inline instead (see AppTip). Sites that
// can't use AppTip's placement test this flag directly. Fixed at load — a
// device doesn't change kind mid-session.
export const inlineTips = Platform.is.mobile === true
