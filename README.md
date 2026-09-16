# DrawingBoard

A browser-based diagram editor you can drive with a mouse or with your hand in front of a webcam. Rough sketches become editable flowchart objects: shapes you can move, resize, label and connect, then export as SVG or PNG.

Everything runs in the page. There is no server, no build step and no account.

## What it does

- **Six tools.** Select, freehand, rectangle, circle, diamond and connector.
- **Shape recognition.** A freehand circle, rectangle or diamond is offered as a conversion you accept or reject. Rejecting keeps the original stroke.
- **Two-stroke arrows.** Draw a straight shaft, then a V-shaped head at its tip, and the pair is offered as a connector.
- **Connectors that stay attached.** Edges bind to north/east/south/west ports and follow nodes as they move and resize.
- **Full editing.** Multi-select, marquee select, move, resize handles, duplicate, delete, keyboard nudging, labels, colours, grid snapping, alignment guides, pan and zoom, and undo/redo across all of it.
- **Hand tracking.** MediaPipe Hands drives the same editing lifecycle as the mouse. Thumb to pinky lifts and lowers the pen; in Select, dwell highlights and a pinch drags.
- **Session calibration.** A short routine measures your own finger distances and, optionally, the part of the camera frame you can comfortably reach.
- **Persistence.** Explicit JSON save and open, plus debounced local recovery in IndexedDB with a restore prompt on the next visit.
- **Export.** Standalone SVG and rasterized PNG, both built from a fresh document render. Camera pixels, selection handles, guides and proposals are never in the file.
- **Keyboard and screen-reader access.** Every action has a keyboard path, and the canvas has a live text description of its contents.

## Requirements

- Node 20.11 or newer, for the development server and tests only.
- A current Chromium, Firefox or Safari build.
- For gesture input: a webcam, and permission to use it. The camera never starts on its own.

The MediaPipe Hands scripts load from a CDN at pinned versions. With no network the editor still works; only gesture input is unavailable.

## Getting started

```
npm install
npm run dev
```

Then open <http://127.0.0.1:4173/DrawingBoard/index.html>.

You can also open `DrawingBoard/index.html` directly from disk for mouse editing. Gesture input needs the page served over `http://` or `https://`, because camera access is blocked on `file://`.

## Using gesture input

1. Press **Enable camera** and allow camera access.
2. Press **Calibrate** and follow the four prompts. If the measured distances overlap, the defaults are kept and the reason is shown.
3. Optionally press **Set corner** at two opposite corners of the area you can reach comfortably. Anything outside that area ends the current stroke rather than sliding along the border.
4. Tick **Arm gesture drawing**.
5. Touch your thumb to your pinky once to ready the pen, then move your index fingertip to draw. Touch thumb to pinky again to lift.
6. In the Select tool, hold your fingertip over a shape to highlight it, then pinch thumb and index to drag it.

If tracking is lost, the stroke ends there. Reacquiring requires a fresh pen-up before a new stroke starts, so a dropped frame never joins two strokes together.

There is a nine-step in-app tutorial under **Start tutorial** that walks through the same path and ends at export.

## Keyboard

| Key | Action |
|---|---|
| `V` `P` `R` `O` `D` `C` | Select, freehand, rectangle, circle, diamond, connector |
| Arrow keys | Nudge selection by 1 unit |
| Shift + arrows | Nudge selection by 10 units |
| `Ctrl`/`Cmd` + `Z` | Undo |
| `Shift` + `Ctrl`/`Cmd` + `Z` | Redo |
| `Ctrl`/`Cmd` + `D` | Duplicate selection |
| `Delete` / `Backspace` | Delete selection |
| `Enter` | Edit the selected object's label |
| `Enter` / `Escape` | Accept / reject a recognition proposal |
| `Escape` | Cancel the current draft |
| Space + drag, or middle-drag | Pan |
| Scroll | Zoom about the pointer |

Shortcuts are ignored while a text field is focused.

## How it is built

Plain ES modules, no framework and no bundler. Accepted diagram objects render as SVG, which keeps them selectable, accessible and cleanly exportable; drafts and the hand cursor are drawn on a Canvas layer above.

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

### Document format

Files carry `schemaVersion: 1` and three collections: `nodes`, `strokes` and `edges`. Imports are limited to 5 MiB, 2,000 objects and 100,000 total stroke samples. Duplicate IDs, nonfinite coordinates, dangling edge endpoints and style values that are not plain hex colours are rejected, and a rejected import leaves the open diagram alone. Labels are always written with `textContent`, never parsed as markup.

## Testing

```
npm test          # 171 unit tests for the pure modules
npm run test:e2e  # 22 Chromium tests for the editor and gesture replay
npm run evaluate  # recognition confusion matrix and metrics
```

Browser tests block the MediaPipe CDN, so they prove the editor works with no model available, and they drive gestures through replayed landmark frames. Replay is not a hardware test: see [the manual camera checklist](docs/manual-camera-checklist.md) for what still has to be done by hand.

## Recognition quality

The current numbers on the synthetic development set are in [docs/recognition-evaluation.md](docs/recognition-evaluation.md), along with the method and its limits. In short: the fixtures are generated, from no participants, so they guard against regressions and say nothing about how well recognition works for real hands. A real measurement needs recorded strokes from several people, split by person before any threshold is tuned.

## Known limits

- Recognition covers circles, rectangles, diamonds and one arrow vocabulary. Triangles, other polygons and other arrow styles stay freehand; the connector tool is the fallback.
- A rectangle rotated near 45 degrees is offered as a diamond, because its corners genuinely sit at the bounding-box extremes.
- Connector waypoints cannot be edited by hand. Orthogonal routing is derived and does not avoid obstacles.
- Gesture selection acts on one object at a time. Labels are always typed, never spoken or drawn.
- Local recovery is per browser and per origin. It is a crash net, not a backup: use **Save JSON** for anything you care about.
- PNG output is capped at 16 million pixels and 8,192 pixels per side. Larger diagrams export at a reduced scale, and the status line says so.
- Performance has not been profiled on a real camera. No frame-rate or latency figure is claimed.
