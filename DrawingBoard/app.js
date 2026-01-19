// DOM refs
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const debugToggle = document.getElementById("debugToggle");
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const resetBtn = document.getElementById("resetBtn");
const whiteBgToggle = document.getElementById("whiteBgToggle");

// persistent drawing layer (offscreen canvas)
const persistentCanvas = document.createElement('canvas');
persistentCanvas.width = canvas.width;
persistentCanvas.height = canvas.height;
const pctx = persistentCanvas.getContext('2d');

// state
let points = []; // array of [x,y] or [null,null] sentinel
let manualTracking = false; // user toggled tracking on/off
let tracking = false;       // effective tracking (paused while thumb-pinky touching)
let lastCursor = { x: null, y: null, visible: false };
let wasPaused = false; // to insert gap when resuming

// limits & smoothing
const MAX_POINTS = 2000;
const MIN_POINT_DIST = 2; // px

function pushPoint(p) {
  if (!p || p.length !== 2) return;
  // sentinel always accepted and does not draw
  if (p[0] === null || p[1] === null) {
    points.push(p);
  } else {
    // if the most recent stored entry is a sentinel, start a new segment (don't connect)
    const lastEntry = points.length ? points[points.length - 1] : null;
    if (lastEntry && (lastEntry[0] === null || lastEntry[1] === null)) {
      points.push(p); // new segment, no line drawn to previous strokes
    } else {
      // fallback: find last real point and draw if appropriate
      let last = null;
      for (let i = points.length - 1; i >= 0; i--) {
        const v = points[i];
        if (v && v[0] != null && v[1] != null) { last = v; break; }
      }
      if (last) {
        const d = Math.hypot(p[0] - last[0], p[1] - last[1]);
        if (d < MIN_POINT_DIST) return; // skip very close points
        // draw to persistent canvas immediately between last and current
        pctx.save();
        pctx.strokeStyle = "#0077cc";
        pctx.lineWidth = 2;
        pctx.lineCap = "round";
        pctx.beginPath();
        pctx.moveTo(last[0], last[1]);
        pctx.lineTo(p[0], p[1]);
        pctx.stroke();
        pctx.restore();
      } else {
        // no previous real point, just push
        points.push(p);
      }
      points.push(p);
    }
  }
  if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
}

// clear persistent layer
function clearPersistent() {
  pctx.clearRect(0, 0, persistentCanvas.width, persistentCanvas.height);
  if (whiteBgToggle.checked) {
    pctx.fillStyle = "white";
    pctx.fillRect(0, 0, persistentCanvas.width, persistentCanvas.height);
  }
}

// MediaPipe Hands setup (global usage)
let hands;
try {
  hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
  hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });
  hands.onResults(onResults);
} catch (e) {
  console.warn("Hands init failed:", e);
}

// Camera setup
try {
  const camera = new Camera(video, {
    onFrame: async () => { if (hands) await hands.send({ image: video }); },
    width: canvas.width,
    height: canvas.height
  });
  camera.start();
} catch (e) {
  console.warn("Camera start error:", e);
}

// main frame handler
function onResults(results) {
  // draw background (main canvas will show background + persistent drawing)
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (whiteBgToggle.checked) {
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (results.image) {
    // blurred background
    ctx.save();
    ctx.filter = "blur(8px)";
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // draw unblurred hand area (clip)
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      ctx.save();
      ctx.beginPath();
      for (const lm of results.multiHandLandmarks[0]) {
        ctx.lineTo(lm.x * canvas.width, lm.y * canvas.height);
      }
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }

  // draw persistent drawing on top of background — this ensures pausing doesn't "erase" strokes
  ctx.drawImage(persistentCanvas, 0, 0);

  const markerPositions = [];
  let markerDrawn = false;
  let pauseThisFrame = false;

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    for (const landmarks of results.multiHandLandmarks) {
      // optional debug overlays
      if (debugToggle && debugToggle.checked && typeof drawConnectors === "function" && typeof drawLandmarks === "function" && typeof HAND_CONNECTIONS !== "undefined") {
        try {
          drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: "#00FF00", lineWidth: 2 });
          drawLandmarks(ctx, landmarks, { color: "#FF0000", radius: 3 });
        } catch (e) { /* ignore drawing errors */ }
      }

      // thumb-pinky control
      const touching = areThumbAndPinkyTouching(landmarks);
      pauseThisFrame = pauseThisFrame || touching;

      const effectiveTracking = manualTracking && !touching;
      tracking = effectiveTracking;

      // if resuming from pause, insert sentinel so we don't auto-connect segments in points history
      if (effectiveTracking && wasPaused) {
        points.push([null, null]); // keep points history consistent (no drawing happens here — persistent drawing already handled)
        wasPaused = false;
      }
      if (!effectiveTracking && !wasPaused) {
        wasPaused = true;
      }

      const tip = landmarks[8];
      const x = tip.x * canvas.width;
      const y = tip.y * canvas.height;

      if (effectiveTracking) {
        // pushPoint will draw to persistent canvas immediately between last and current real point
        pushPoint([x, y]);
      }

      markerPositions.push({ x, y, tracking: effectiveTracking, paused: touching });
      markerDrawn = true;
      lastCursor = { x, y, visible: true };
    }
  } else {
    lastCursor.visible = false;
    tracking = false;
  }

  // status
  if (!manualTracking) statusEl.textContent = "Stopped";
  else if (pauseThisFrame) statusEl.textContent = "Paused — thumb↔pinky touching";
  else statusEl.textContent = "Recording";

  // draw markers on top
  if (markerPositions.length) {
    for (const m of markerPositions) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.tracking ? 8 : 10, 0, 2 * Math.PI);
      ctx.fillStyle = m.paused ? "#999" : (m.tracking ? "#0077cc" : "blue");
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1.0;
      ctx.restore();
    }
  } else if (!markerDrawn && lastCursor.visible) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(lastCursor.x, lastCursor.y, 8, 0, 2 * Math.PI);
    ctx.fillStyle = "#aaa";
    ctx.globalAlpha = 0.3;
    ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }
}

// simple thumb-pinky touching test (normalized coordinates)
function areThumbAndPinkyTouching(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  const t = landmarks[4];  // thumb tip
  const p = landmarks[20]; // pinky tip
  const dx = t.x - p.x;
  const dy = t.y - p.y;
  const dist = Math.hypot(dx, dy);
  // threshold tuned for normalized coords; adjust if needed
  return dist < 0.05;
}

// UI handlers
startBtn.onclick = () => {
  points = [];
  manualTracking = true;
  tracking = false;
  wasPaused = false;
  scoreEl.innerText = "Score: N/A";
  statusEl.textContent = "Recording (waiting for control)";
  // clear both canvases
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  clearPersistent();
  // draw white persistent background if toggled
  if (whiteBgToggle.checked) {
    pctx.fillStyle = "white";
    pctx.fillRect(0, 0, persistentCanvas.width, persistentCanvas.height);
  }
};

stopBtn.onclick = () => {
  manualTracking = false;
  tracking = false;
  const realPoints = points.filter(p => p[0] != null);
  if (realPoints.length < 10) {
    scoreEl.innerText = "Too few points";
    return;
  }
  const circle = fitCircle(realPoints);
  drawFittedCircle(circle);
  const score = computeScore(realPoints, circle);
  const shape = guessShape(realPoints, score);
  scoreEl.innerText = `Score: ${(score * 100).toFixed(1)}% | Shape: ${shape}`;
  statusEl.textContent = "Stopped";
};

resetBtn.onclick = () => {
  points = [];
  manualTracking = false;
  tracking = false;
  wasPaused = false;
  scoreEl.innerText = "Score: N/A";
  statusEl.textContent = "Stopped";
  // clear both canvases
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  pctx.clearRect(0, 0, persistentCanvas.width, persistentCanvas.height);
  if (whiteBgToggle.checked) { pctx.fillStyle = "white"; pctx.fillRect(0,0,persistentCanvas.width,persistentCanvas.height); }
};

// --- Shape recognition & helpers (operate on filtered points) ---
function guessShape(pts, circleScore) {
  if (circleScore > 0.85) return "Circle";
  const simplified = rdp(pts, 10);
  const corners = findCorners(simplified);
  if (corners.length === 3) return "Triangle";
  if (corners.length === 4) {
    const sides = [];
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = corners[i];
      const [x2, y2] = corners[(i + 1) % 4];
      sides.push(Math.hypot(x2 - x1, y2 - y1));
    }
    const avg = sides.reduce((a, b) => a + b, 0) / 4;
    const maxDev = Math.max(...sides.map(s => Math.abs(s - avg)));
    if (avg > 0 && (maxDev / avg) < 0.2) return "Square";
    return "Rectangle";
  }
  if (corners.length === 5) return "Pentagon";
  if (corners.length === 6) return "Hexagon";
  if (corners.length > 6 && corners.length < 12) return "Polygon";
  return "Unknown";
}

function rdp(points, epsilon) {
  if (points.length < 3) return points.slice();
  let dmax = 0, idx = 0;
  const start = points[0], end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], start, end);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > epsilon) {
    const left = rdp(points.slice(0, idx + 1), epsilon);
    const right = rdp(points.slice(idx), epsilon);
    return left.slice(0, -1).concat(right);
  } else {
    return [start, end];
  }
}

function perpDist(p, a, b) {
  const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
  const num = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1);
  const den = Math.hypot(y2 - y1, x2 - x1);
  return den === 0 ? 0 : num / den;
}

function findCorners(pts) {
  const corners = [];
  if (!pts || pts.length < 3) return corners;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const v1 = [x0 - x1, y0 - y1];
    const v2 = [x2 - x1, y2 - y1];
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const mag1 = Math.hypot(v1[0], v1[1]), mag2 = Math.hypot(v2[0], v2[1]);
    if (mag1 === 0 || mag2 === 0) continue;
    const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    const angle = Math.acos(cos);
    if (angle < Math.PI * 0.75) corners.push([x1, y1]);
  }
  if (corners.length > 2) {
    const [fx, fy] = corners[0];
    const [lx, ly] = corners[corners.length - 1];
    if (Math.hypot(fx - lx, fy - ly) < 30) {
      corners[corners.length - 1] = [(fx + lx) / 2, (fy + ly) / 2];
    }
  }
  return corners;
}

function fitCircle(pts) {
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= pts.length; cy /= pts.length;
  let r = 0;
  for (const [x, y] of pts) { r += Math.hypot(x - cx, y - cy); }
  r /= pts.length;
  return { cx, cy, r };
}

function computeScore(pts, {cx, cy, r}) {
  if (!r || r <= 0) return 0;
  const distances = pts.map(([x, y]) => Math.hypot(x - cx, y - cy));
  const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
  const variance = distances.reduce((a, b) => a + (b - mean) ** 2, 0) / distances.length;
  const stddev = Math.sqrt(variance);
  return Math.max(0, 1 - stddev / r);
}

function drawFittedCircle({cx, cy, r}) {
  ctx.save();
  ctx.strokeStyle = "red";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
