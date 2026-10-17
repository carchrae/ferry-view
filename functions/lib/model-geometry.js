// Region geometry comparison shared by the classifier runtimes, the model
// loader and the trainers. A model's weights only mean something against the
// exact crops they were trained on, so before any model (bundled, archived or
// read from Firestore) is scored or shipped, its regions must match the
// feature code's REGIONS — by geometry alone. Region NAMES are report labels
// and have been renamed without retraining (2026-10); comparing them silently
// invalidated every archived version.
export function regionGeometry(regions) {
  return JSON.stringify(
    (Array.isArray(regions) ? regions : []).map(({ roi, width, height }) => ({
      roi: roi ? { left: roi.left, top: roi.top, width: roi.width, height: roi.height } : null,
      width,
      height,
    })),
  )
}

export function sameGeometry(a, b) {
  return regionGeometry(a) === regionGeometry(b)
}

// Masks have only an roi; same rule — what the mask is called is irrelevant.
export function maskGeometry(masks) {
  return JSON.stringify(
    (Array.isArray(masks) ? masks : []).map(({ roi }) =>
      roi ? { left: roi.left, top: roi.top, width: roi.width, height: roi.height } : null,
    ),
  )
}

export function sameMasks(a, b) {
  return maskGeometry(a) === maskGeometry(b)
}
