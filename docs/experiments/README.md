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
| 2026-10-18 | One model for every season, or a model per season? Train on one slice of time, score on another, both cameras, brightness vs texture. | Brightness is seasonal on both cameras (summer→autumn and back both fail; terminal autumn→summer files 21 wrong flags). Texture generalises both ways and in every held-out month on both cameras (terminal 0.93–0.96, 0 wrong flags; crosswalk 0.94–0.98, 0 phantoms, crosswalk CV severity 200 → 131, twilight recall 0.53 → 0.94). One model is possible; the crosswalk needs the texture feature set to get it. | [2026-10-18-season-generalisation.md](2026-10-18-season-generalisation.md) |
| 2026-10-18 | Run every model version over the whole archive: are successive versions converging or seasonal, and do they agree? | Terminal-cars converges: a texture model trained on summer only keeps rider-label precision 0.98 and 73% not-full coverage in October, where a summer brightness model falls to 0.58 / 40%; texture versions agree on 99–100% of verdicts. The crosswalk model is seasonal, shown time-forward: the current recipe trained through September keeps precision 0.91 but recall falls to 0.47 in the week of October 12 (the in-sample v6 reads 0.95 there); nightly recency retraining is what keeps it current, a texture feature for that camera the next experiment. | [2026-10-18-model-history-report.md](2026-10-18-model-history-report.md) |
| 2026-10-18 | Does the texture terminal model survive review: parity server/browser/experiment, reproduction on the full label set, trainer vs experiment, threshold, convergence, remaining failures? | Yes. Parity within 0.009; F1 0.971 / 71% / 0 wrong reproduce; hand+rider training (the trainer) is slightly better (F1 0.975, night R 0.82); threshold 0.5 and 600 epochs are right; a brightness stack adds nothing. Remaining misses are single vehicles and far-queue dots at night, benign for verdicts. Trimming the far-queue box's top edge (0.15/0.20/0.25) does not help and costs night recall. v10 stands (v11 after the dusk labels). | [2026-10-18-terminal-texture-review.md](2026-10-18-terminal-texture-review.md) |
| 2026-10-18 | Why does the terminal-cars model read an empty road as "cars" at daybreak, and which features fix it? | Brightness features + a +1.79 bias; per-cell local texture (std / Sobel / high-pass) lifts frame F1 0.924 → 0.971, room-sailing not-full coverage 58% → 71% with 0 wrong flags. Adopted as feature set `localStd-v1`. Daylight bands on top of texture: no gain (F1 0.961 one model vs 0.958 horizon pair, same sailing-level numbers, worse night recall), so one model, no members. | [2026-10-18-terminal-features-daybreak.md](2026-10-18-terminal-features-daybreak.md) |
| 2026-10-17 | Should the day crosswalk model, or the terminal camera, classify stable-pixel composites instead of raw frames? | No to both: day crosswalk cost 165 raw vs 184 composite (two genuine empty-scene phantoms at 5-minute spacing); terminal F1 0.906 raw vs 0.896 composite, and inside the banded design raw wins every band (0.928 vs 0.918). Composites stay the night design. | [2026-10-17-composites-day-and-terminal.md](2026-10-17-composites-day-and-terminal.md) |
| 2026-10-17 | Where does the terminal-cars model fail by daylight, and does a model per lighting regime help? | False cars between civil twilight and 8° (precision 0.59–0.65 vs 0.90–0.95 elsewhere). A pair split at sunrise (0°, ±6° overlap) lifts CV F1 0.906 → 0.928, below-horizon precision 0.82 → 0.98; shipped as banded v8 (`functions/lib/model-members.js`). Brightness features; retested on texture 2026-10-18. | [2026-10-17-terminal-daylight-bands.md](2026-10-17-terminal-daylight-bands.md) |
| 2026-10-17 | How far had the crosswalk model drifted since September, does weighting recent frames fix it, and do daylight bands help it? | v4 autumn recall 0.70 (0.455 at 25–35° sun, mid-day shadows). Recency weights 1 + 3·e^(−age/21d) cut CV severity cost 204 → 177 with summer unchanged; now the trainer default (v5, v6). Bands do not pay for this camera (misses 211 → 197, twilight recall worse). | [2026-10-17-lineup-seasonal-drift.md](2026-10-17-lineup-seasonal-drift.md) |
| 2026-10-17 | Which production sailings would change if the robot's FULL call required the effective crosswalk mark rather than its sticky detection? | Exactly one in six weeks (Sat 2026-10-17 10:00, detection refuted at 09:34, stamped full at 09:56). Gate changed in `webcam.js`. The same frames exposed the daybreak misread above. | [2026-10-17-full-gate-refuted-detection.md](2026-10-17-full-gate-refuted-detection.md) |
| 2026-10-07 | Can min/stable composites of trailing frames let the day crosswalk model work at night? | Minimum composites over 3 frames cut night false positives 96 → 16 of 191 with little day cost; but the day model misses real pre-dawn queues entirely — a night model with night labels is required. | pending — `training-data/experiments/stable-composite.mjs`, findings in `docs/lineup-classifier.md` |
| 2026-09-05 | Are the crosswalk robot's dark-hour detections real? | All 26 dark (sun < −6°) detections in 45 days were wrong (0 confirmed, 9 refuted, 14 on Not-Full sailings). Dark gate added (`isDarkAt`), boundary later moved to −7°. | pending — `training-data/experiments/dark-frame-analysis.mjs` |
| 2026-09-05 | Does down-weighting labels near the crosswalk mark help the lineup model? | Looked good on the single split, but 5-fold CV doubled phantoms (2 → 4); left off by default. | pending — `training-data/experiments/boundary-weight-experiment.mjs` |
| 2026-08-16 | Should the not-full verdict need a more confident empty pair? | No: every wrong flag was an empty window MID-sailing, not low confidence. Tail rule ("empties after the LAST solid cars") = 62% coverage, 0 wrong. Implemented in `lineup-labels.js`. | pending — `training-data/experiments/empty-threshold-sweep.mjs` |
| 2026-08-16 | Can the terminal camera alone call a ferry FULL? | Cars-to-the-end alone is 54–67% precise; with the crosswalk veto 95.7% precision / 87% coverage. Implemented. | pending — same sweep script, section H |
| 2026-08-10 | Can a sailing-level model beat the per-frame rules? | Terminal image + crosswalk features → AUC 0.957; confident not-full wrong 2.7% vs the deployed 12.9%. Prototype only. | pending — `training-data/experiments/train-sailing-model.mjs` |
| 2026-08-10 | Do rider per-frame labels help train the terminal model? | No — they are unsure-band frames by construction; training on them did not help, and even v5 drops to P 0.62 on them. | pending — `training-data/experiments/terminal-rider-label-eval.mjs` |
