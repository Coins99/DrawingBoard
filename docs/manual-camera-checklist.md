# Manual camera checklist

Automated tests replay landmark frames and block the MediaPipe CDN. They prove the state machine and the editor behave correctly, and they prove nothing about real hardware. The checks below have to be done by a person with a camera.

**Status: not yet performed.** Record the results in the table at the end when you run it, and keep the device and browser details with the numbers. Do not treat a passing replay test as evidence for any of these rows.

## Before you start

Note the device, camera, operating system, browser build, room lighting and your distance from the camera. Recognition and tracking behaviour depend on all of them, and a result without that context cannot be compared to a later one.

Serve the page over `http://` or `https://`; camera access is blocked on `file://`.

```
npm run dev
```

## 1. Permission and lifecycle

- [ ] The camera does not start on page load. The preview says "Camera off".
- [ ] **Enable camera** prompts for permission the first time.
- [ ] Denying permission shows an actionable message, and mouse editing still works.
- [ ] Allowing permission shows the preview and enables **Arm gesture drawing** and **Calibrate**.
- [ ] **Disable camera** stops the stream. The camera indicator light goes out.
- [ ] Switching browser tabs stops the camera. Returning does not restart it silently.
- [ ] Reloading the page releases the device; a second tab can then acquire it.
- [ ] Unplugging a USB camera mid-session reports the loss instead of hanging.

## 2. Tracking and the pen gesture

- [ ] The cursor follows your index fingertip with no visible mirror-inversion mismatch against the preview.
- [ ] Toggling **Mirror camera** flips both the preview and the cursor together, never just one.
- [ ] Touching thumb to pinky readies the pen; the state card changes.
- [ ] Moving the fingertip with the pen down draws one continuous stroke.
- [ ] Touching thumb to pinky again lifts the pen and ends the stroke exactly once.
- [ ] Holding the fingers near the threshold does not flicker between drawing and not drawing.
- [ ] Moving your hand out of frame ends the stroke at that point, with no line jumping to the edge.
- [ ] Bringing the hand back does not continue the old stroke. A fresh pen-up is required.
- [ ] Holding the hand far from the camera reports "Hand too far away" rather than drawing wild lines.
- [ ] Covering the camera entirely ends any stroke in progress within about half a second.

## 3. Calibration

- [ ] The four prompts each collect for about one second and advance on their own.
- [ ] After calibration the panel shows numeric thresholds rather than "default".
- [ ] Deliberately keeping the fingers in the same position for both prompts keeps the defaults and explains why.
- [ ] **Set corner** at two opposite reachable corners sets an input area.
- [ ] With an input area set, reaching outside it ends the stroke instead of sliding along the border.
- [ ] Two corners placed close together are refused, and the full frame is kept.
- [ ] **Reset** returns to defaults.

## 4. Drawing and recognition with your hand

- [ ] A hand-drawn circle is offered as a circle.
- [ ] A hand-drawn rectangle is offered as a rectangle.
- [ ] A hand-drawn diamond is offered as a diamond.
- [ ] A deliberate scribble is not offered as anything.
- [ ] Rejecting a proposal keeps the stroke exactly as drawn.
- [ ] Accepting a proposal, then undo, restores the original stroke samples.
- [ ] A straight shaft followed promptly by a V head is offered as an arrow.
- [ ] Waiting several seconds between the two strokes does not pair them.
- [ ] Changing tools between the two strokes does not pair them.

## 5. Gesture editing

- [ ] In Select, holding the fingertip over a shape highlights it after a short dwell.
- [ ] Pinching then moving drags the shape; its connectors stay attached.
- [ ] Releasing the pinch commits the move as one undo step.
- [ ] Losing tracking mid-drag leaves the shape where it started, not half-moved.
- [ ] A hand that appears already pinching does not immediately grab something.
- [ ] Unticking **Arm gesture drawing** stops all gesture editing at once.

## 6. Conditions to vary

Repeat sections 2 and 4 under each of these, and record what changed:

- [ ] Bright room and dim room.
- [ ] Close to the camera (roughly 40 cm) and far from it (roughly 100 cm).
- [ ] Left hand and right hand.
- [ ] A second person's hand entering the frame.
- [ ] Mouse-only, with the camera disabled, to confirm the fallback is complete.

## 7. Performance, if you measure it

The plan's initial targets are 30 frames per second for the preview where supported, and a median end-to-end cursor response below 150 ms. If you record these:

- Report the sample size, the device and the browser build.
- Separate software timestamp estimates from physical latency. They are not the same measurement, and a software figure must not be presented as the latter.
- Publish the conditions that failed, not only the ones that passed.

## Results

| Date | Device | Browser | Lighting | Distance | Sections passed | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
