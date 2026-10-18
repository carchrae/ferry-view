# Experiments

Every experiment we run gets saved here: the question it set out to answer,
how it was run, and what came out — with the script in a tracked location and
images where they help. Results that live only in a chat transcript or a
gitignored folder are lost the next time someone asks the same question.

## The rule

When an experiment is run (a classifier variant, a rule sweep, a data audit,
a replay of production decisions):

1. **Script in `scripts/experiments/`** (tracked). Large inputs and caches go
   under `training-data/experiments/` (gitignored); the script must be able
   to rebuild them. Paths repo-relative, never a machine's home or scratchpad.
2. **One write-up per experiment** in this folder, named
   `YYYY-MM-DD-<slug>.md`, with these sections: Question · Setup · Results ·
   Conclusion · What changed because of it · Files. Keep the numbers that
   drove the decision in the doc itself, not only in a JSON.
3. **Images** in `docs/experiments/img/`, named with the same date prefix,
   referenced from the write-up. Contact sheets of the actual frames beat
   prose for anything about the cameras.
4. **A row in the index below**, added the same day. One line: date,
   question, answer.

Older experiments predate this rule; their scripts sit in the gitignored
`training-data/experiments/` and their findings in commit messages,
`docs/lineup-classifier.md`, and memory notes. They are listed below from
those sources so the index is complete; a write-up is still owed for each.

## Index

| Date | Question | Answer | Write-up |
|---|---|---|---|
| 2026-10-18 | Why does the terminal-cars model read an empty road as "cars" at daybreak, and which features fix it? | Brightness features + a +1.79 bias; per-cell local texture (std / Sobel / high-pass) lifts frame F1 0.924 → 0.971, room-sailing not-full coverage 58% → 71% with 0 wrong flags. Adopted as feature set `localStd-v1`. | [2026-10-18-terminal-features-daybreak.md](2026-10-18-terminal-features-daybreak.md) |
| 2026-10-17 | Which production sailings would change if the robot's FULL call required the effective crosswalk mark rather than its sticky detection? | Exactly one in six weeks (Sat 2026-10-17 10:00, detection refuted at 09:34, stamped full at 09:56). Gate changed in `webcam.js`. The same frames exposed the daybreak misread above. | [2026-10-17-full-gate-refuted-detection.md](2026-10-17-full-gate-refuted-detection.md) |
| 2026-10-07 | Can min/stable composites of trailing frames let the day crosswalk model work at night? | Minimum composites over 3 frames cut night false positives 96 → 16 of 191 with little day cost; but the day model misses real pre-dawn queues entirely — a night model with night labels is required. | pending — `training-data/experiments/stable-composite.mjs`, findings in `docs/lineup-classifier.md` |
| 2026-09-05 | Are the crosswalk robot's dark-hour detections real? | All 26 dark (sun < −6°) detections in 45 days were wrong (0 confirmed, 9 refuted, 14 on Not-Full sailings). Dark gate added (`isDarkAt`), boundary later moved to −7°. | pending — `training-data/experiments/dark-frame-analysis.mjs` |
| 2026-09-05 | Does down-weighting labels near the crosswalk mark help the lineup model? | Looked good on the single split, but 5-fold CV doubled phantoms (2 → 4); left off by default. | pending — `training-data/experiments/boundary-weight-experiment.mjs` |
| 2026-08-16 | Should the not-full verdict need a more confident empty pair? | No: every wrong flag was an empty window MID-sailing, not low confidence. Tail rule ("empties after the LAST solid cars") = 62% coverage, 0 wrong. Implemented in `lineup-labels.js`. | pending — `training-data/experiments/empty-threshold-sweep.mjs` |
| 2026-08-16 | Can the terminal camera alone call a ferry FULL? | Cars-to-the-end alone is 54–67% precise; with the crosswalk veto 95.7% precision / 87% coverage. Implemented. | pending — same sweep script, section H |
| 2026-08-10 | Can a sailing-level model beat the per-frame rules? | Terminal image + crosswalk features → AUC 0.957; confident not-full wrong 2.7% vs the deployed 12.9%. Prototype only. | pending — `training-data/experiments/train-sailing-model.mjs` |
| 2026-08-10 | Do rider per-frame labels help train the terminal model? | No — they are unsure-band frames by construction; training on them did not help, and even v5 drops to P 0.62 on them. | pending — `training-data/experiments/terminal-rider-label-eval.mjs` |
