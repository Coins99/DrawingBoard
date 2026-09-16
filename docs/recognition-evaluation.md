# Recognition evaluation

Last run: September 16, 2026, against the synthetic development fixtures in `tests/fixtures/dataset.js`.

## What this measures, and what it does not

Every sample in the current set is generated in code from seeded noise. No camera and no participants were involved. That has one honest use: it pins the classifier's decision boundaries so a change that quietly starts accepting scribbles or rejecting clean shapes fails in CI.

It is not a measurement of recognition quality for real input. Synthetic noise is uniform and independent per sample; real hand tremor is correlated, drifts, and pauses. Treat the numbers below as a regression baseline only.

A real measurement needs, per the plan: roughly 30 examples each of rectangle, circle, diamond and arrow plus at least 40 unknowns, from at least five people, recorded as coordinates with collection conditions and no video by default. The set must be split by person and session **before** any threshold is tuned, with a held-out evaluation split. With one person it is a single-user pilot and must be labelled as one.

## How to run it

```
npm run evaluate                    # printed report
npm run evaluate -- --json          # machine-readable
npm run evaluate -- --min-score=0.8 # sweep the acceptance threshold
```

`npm test` also asserts the gates below, so a regression fails the unit suite.

## Method

Each sample is one or two strokes with an expected class. Two-stroke samples are offered to the arrow recognizer first; everything else goes to single-stroke classification. A sample that clears no gate is predicted `unknown`.

Reported metrics, all with counts and denominators:

- **Accepted-shape accuracy** — of the known shapes that were accepted at all, the share labelled correctly.
- **Known-shape coverage** — the share of known shapes that were accepted rather than left freehand. Coverage is reported so that a classifier which rejects everything cannot pass.
- **Known-shape rejection** — the complement of coverage.
- **Unknown false acceptance** — the share of unknowns wrongly converted into a shape.

Scores are normalized residual quality in the range 0 to 1. A residual equal to its tolerance scores 0. **A score is not a probability and not a confidence value.**

## Gates

| Metric | Gate | Source |
|---|---|---|
| Accepted-shape accuracy | at least 85% | implementation plan |
| Known-shape coverage | at least 70% | implementation plan |
| Unknown false acceptance | below 5% | implementation plan |

## Current result

```
Recognition evaluation — 87 samples, minimum score 0.34
Source: synthetic, 0 participants. Synthetic fixtures cannot establish recognition quality for real input.

expected\got  circle        rectangle     diamond       arrow         unknown       
circle        15            0             0             0             0             
rectangle     0             13            0             0             2             
diamond       0             0             14            0             1             
arrow         0             0             0             15            0             
unknown       0             0             0             0             27            

class         support       precision     recall        
circle        15/15         100.0%        100.0%        
rectangle     13/15         100.0%        86.7%         
diamond       14/15         100.0%        93.3%         
arrow         15/15         100.0%        100.0%        
unknown       27/27         90.0%         100.0%        

Accepted-shape accuracy   100.0%  (57/57)
Known-shape coverage      95.0%  (57/60)
Known-shape rejection     5.0%  (3/60)
Unknown false acceptance  0.0%  (0/27)

Tolerances: {"circleRadialRms":0.12,"circleGapDegrees":60,"closure":0.22,"quadEdgeRms":0.06,"rectangleAngle":20,"rectangleAxis":18,"diamondExtreme":0.14,"diamondMidpoint":0.1}

Misclassified (3):
  rectangle-tall-3: expected rectangle, got unknown (score 0)
  rectangle-4: expected rectangle, got unknown (score 0)
  diamond-wide-4: expected diamond, got unknown (score 0)
```

All three gates pass on this set. The three rejections are all at the highest noise level, which is the behaviour the design wants: an uncertain stroke stays freehand rather than being converted silently.

## Why the acceptance threshold is 0.34, not 0.80

The plan proposed a minimum score of 0.80. That number was written before the scoring function existed, and it assumed a score clamped into a narrow band. Scores are now genuine normalized residuals, so the same figure means something much stricter.

Sweeping the threshold on this set:

| Minimum score | Accepted-shape accuracy | Known-shape coverage | Unknown false acceptance |
|---|---|---|---|
| 0.20 | 100.0% | 95.0% | 0.0% |
| 0.34 | 100.0% | 95.0% | 0.0% |
| 0.50 | 100.0% | 95.0% | 0.0% |
| 0.60 | 100.0% | 93.3% | 0.0% |
| 0.70 | 100.0% | 83.3% | 0.0% |
| 0.80 | 100.0% | 73.3% | 0.0% |

The hard geometric gates, not the score, do the discrimination: no threshold in this range admits a single unknown. Raising the minimum only rejects shapes a person would have accepted. 0.34 sits in the flat part of that curve, so it is the value in `src/recognition.js`. The plan's 0.80 is retained as the strict comparison case in the unit suite.

This choice was tuned on synthetic data and must be revisited against recorded human strokes before any accuracy claim is made.

## Known failure cases

- A rectangle rotated near 45 degrees is offered as a diamond. Its corners really do sit at the bounding-box extremes, so the diamond gate describes it correctly. The accept-or-reject prompt is the remedy.
- A rectangle rotated between roughly 15 and 35 degrees is rejected entirely: the sides are neither axis-aligned nor at the extremes.
- Triangles and other polygons are always `unknown` by design.
- A near-square diamond and a rectangle can score within the ambiguity margin. The proposal then offers both, and nothing converts without a choice.
