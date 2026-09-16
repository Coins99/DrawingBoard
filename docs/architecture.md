# Architecture

Plain ES modules, no framework and no bundler. Accepted diagram objects render as SVG, which keeps them selectable, accessible and cleanly exportable; drafts and the hand cursor are drawn on a Canvas layer above.

## Modules

All paths are under `DrawingBoard/`.

| Module | Responsibility |
|---|---|
| `src/document.js` | Versioned document model, import validation, undo history |
| `src/commands.js` | Add, move, resize, label, delete, duplicate and convert, as single transactions |
| `src/geometry.js` | Ports, edge routing, hit testing, resize handles, marquee, alignment guides |
| `src/coordinates.js` | Camera-to-stage aspect mapping, viewport transforms, zoom about a point |
| `src/recognition.js` | Resampling, simplification, circle and quadrilateral fitting, ranked candidates |
| `src/arrow.js` | Two-stroke shaft-and-head pairing |
| `src/gestures.js` | Timestamp-driven gesture state machine with hysteresis and loss handling |
| `src/calibration.js` | Session thresholds and usable input rectangle |
| `src/camera.js` | Explicit camera start and stop, MediaPipe wiring |
| `src/render.js` | Shared SVG construction for the editor and for export |
| `src/io.js` | Save, open, SVG export, PNG rasterization |
| `src/autosave.js` | Debounced IndexedDB recovery with a localStorage fallback |
| `src/tutorial.js` | Guided walkthrough progress |

`app.js` composes these. Both pointer and gesture input call the same `begin`, `move` and `end` lifecycle, so gesture input cannot reach document state by a different path. Every mutation is validated before it is committed, and an invalid mutation leaves the document untouched.

Outside the editor:

| Path | Responsibility |
|---|---|
| `scripts/serve.mjs` | Dependency-free static server used by both the setup scripts and the browser tests |
| `scripts/evaluate-recognition.js` | Confusion matrix and recognition metrics |
| `scripts/screenshot.mjs` | Regenerates the README demo image from the real editor |

## Document format

Files carry `schemaVersion: 1` and three collections: `nodes`, `strokes` and `edges`.

- Nodes are `{id, kind, x, y, width, height, label, style}`, where `kind` is `rectangle`, `circle` or `diamond`. Circles have equal width and height.
- Strokes are `{id, points: [{x, y, t}], style}` with monotonic timestamps.
- Edges are `{id, from, to, routing, label, style}`. An endpoint is either `{type: "port", nodeId, port}` with a port of `north`, `east`, `south` or `west`, or a free `{type: "point", x, y}`.

Imports are limited to 5 MiB, 2,000 objects and 100,000 total stroke samples. Duplicate IDs, nonfinite coordinates, dangling edge endpoints, collections that are not arrays, edges that start and end at the same point, and style values that are not plain hex colours are all rejected. A rejected import leaves the open diagram alone. Labels are always written with `textContent`, never parsed as markup, and imported diagrams cannot reference external SVG or image content.

## Testing

```
npm test          # unit tests for the pure modules
npm run test:e2e  # Chromium tests for the editor and gesture replay
npm run evaluate  # recognition confusion matrix and metrics
```

The browser tests block the MediaPipe CDN, so they prove the editor works with no model available, and they drive gestures through replayed landmark frames rather than a camera.

Replay is not a hardware test. See [the manual camera checklist](manual-camera-checklist.md) for what still has to be done by a person, and [the recognition evaluation](recognition-evaluation.md) for what the accuracy numbers do and do not mean.

## Related planning documents

The editor was built against a plan kept outside this repository: a milestone plan and a code-level specification for the diagram-editor direction. Where the implementation departs from them, the reason is recorded in the relevant document, most notably the acceptance-threshold choice in [the recognition evaluation](recognition-evaluation.md).
