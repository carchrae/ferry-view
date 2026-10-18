// The crosswalk (lineup) classifier's feature-set name, in a file with no
// image-library import so the browser mirror can share it
// (src/composables/useClassifierModels.js); lineup-features.js re-exports it.
//
// localStd-v1 (2026-10-18): per-cell local standard deviation of the native
// pixels, standardised per region — the same arithmetic as the terminal
// camera's set (terminal-feature-math.js). Why: with the old per-cell
// brightness every crosswalk version was seasonal (docs/experiments/
// 2026-10-18-season-generalisation.md); texture carries across the season.
export const LINEUP_FEATURE_SET = 'localStd-v1'
