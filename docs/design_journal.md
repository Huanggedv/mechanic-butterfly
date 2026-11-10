# ACTIAS_01 — Expressive Mechanics: A Mechanical Butterfly

> TDF / Physical Computing · Expressive Mechanics project · Presentation: Thu 11/12 (Group B)
> A black mechanical butterfly rests on an abstract 3D-printed flower. When a camera sees a hand, the butterfly starts to flap, and its digital twin on screen flies to follow the hand.

---

## 1. Brief & Goal

- **Brief:** make a mechanism that *expresses* something through motion, driven by a motor and controlled by Arduino.
- **My goal:** a quiet, almost sculptural object that "wakes up" when a person reaches toward it — nature (butterfly, flower) meeting cold machinery and data.
- **Constraint I set for myself:** all electronics (servo + Arduino) must be hidden inside the flower base; only the butterfly, the rod and two thin pushrods are visible.
- **Change approved by the teacher:** I used a **servo motor (MG90S)** instead of the DC gear motor + H-bridge in the brief, because I need a small, controlled back-and-forth angle (wing flap), not continuous rotation.

## 2. Concept

| Element | Role | Visual language |
|---|---|---|
| Physical butterfly | The "body" that reacts | Black, wireframe-like wings, real mechanism |
| Abstract flower | Pedestal + housing for electronics | Sharp, faceted, dark, parametric — *not* a realistic flower, to contrast with the butterfly |
| Screen visual (p5.js) | The butterfly's "mind" / data twin | 1-bit black & white, inspired by **Ryoji Ikeda** (data, rhythm, glitch) and **Zach Lieberman** (gesture) |
| Hand | The trigger | Detected by the laptop webcam — no sensor touches the object |

**Story:** the butterfly is resting. A hand appears → it notices you, wakes up and flies toward you on screen while the real wings beat. The hand leaves → it flies back and slowly settles.

## 3. Interaction Design (State Machine)

| State | Trigger | Screen | Physical butterfly | Serial command |
|---|---|---|---|---|
| **REST** | no hand | butterfly sits on the flower, calm rhythm | still (servo at 90°) | `R` |
| **FLY** | hand detected | butterfly flies and follows the palm; more glitch, strobe, data | flaps | `G` (normal) / `S` (fast hand → fast flap) |
| **RETURN** | hand gone for > 0.4 s | butterfly flies back to the flower | keeps flapping until it lands | `G` → then `R` |

- The 0.4 s delay stops the butterfly from "dropping" when the hand is lost for a single frame.
- Commands are only sent **when they change**, so the serial line stays quiet.
- Hand height also controls a high sine tone, so sound, image and motion all respond to the same gesture.

## 4. System Overview

```
Webcam ──► p5.js + ml5 HandPose (palm = keypoint 9)
              │   state machine (REST / FLY / RETURN)
              ├──► screen visual + sound (Web Audio)
              └──► Web Serial (115200 baud): 'R' / 'G' / 'S'
                        │
                   Arduino Uno ──► MG90S servo (D9) ──► horn ──► 2 pushrods ──► wings
```

**Wiring (servo → Arduino Uno, no breadboard):**

| Servo wire | Arduino pin |
|---|---|
| Brown | GND |
| Red | 5V |
| Orange (signal) | D9 |

## 5. Materials & Parts

**Bought**
- Butterfly (Amazon)
- Silver metallic spray paint
- Push-rod steel wire (0.8 mm)
- Small screw assortment (M2 / M3 machine screws + nuts)
- 5 mm wooden dowel (support rod)

**Already had:** Arduino Uno, MG90S servo, jumper wires, USB cable, laptop with webcam.

**3D printed (Bambu Studio, 11 plates, ~542 g, ~32 h total)**
- Flower: outer petals, inner petals, core
- Vase / base: lower vase (servo + nut pockets), upper vase
- Servo cradle (M06), horn adapter (M08), eye sleeve (M09)
- Wing hinge ears: fixed ears (B04) + moving ears (B05), butterfly body (B09), collar (B10)
- Fit-test coupon (M00) to check hole and nut sizes before the big prints
- Printed washer (OD 9 / ID 3.4 / 1 mm) to keep the wire loops on the horn
- Printed adjustable pushrods (two-piece, slot + 2 × M2 to set length)

**Fasteners**
- Wing hinges: M2 × 16 + M2 lock nuts + M2 washers
- Horn eye / pushrod pivot: M3 × 10–12 + M3 nut captured in the horn adapter
- Servo cradle: 2 × M3 × 10 + nuts; base: 4 × M3 × 8 + nuts in the printed hex pockets
- Note: the kit I first bought had pointed (self-tapping) screws — they can't take nuts, so machine screws are needed.

## 6. Mechanism — Iterations

**How it works:** the servo lies on its side inside the base. Its horn swings back and forth; two pushrods run up through the flower centre, next to the 5 mm support rod, and attach to each wing about 1–1.5 cm from the wing hinge. Pushing/pulling the rods rotates the wings around their hinges → flap.

| # | Version | What happened | What I learned / changed |
|---|---|---|---|
| 1 | 0.8 mm steel wire pushrods hooked into the horn | Wire **buckled** when pushing; wings barely moved; hooking wire into the tiny horn holes was very hard | Thin wire is fine in tension but bends under compression; buckling gets 4× worse when the rod is 2× longer |
| 2 | Increased servo swing 30° → 60° | Still not enough lift — the extra motion was "eaten" by the bending wire | Fix the rod stiffness before increasing angle |
| 3 | Wire taped to bamboo skewers | Stiffer, but bulky and still awkward at the horn | Need a clean pivot at both ends |
| 4 | Idea: **pull-only** (fishing line pulls wings down, rubber band pulls them back up) | A string in tension can never buckle | Kept as backup |
| 5 | **3D-printed adjustable pushrods** (two pieces, slot + 2 screws; M3 eye at the horn, M2 eye at the wing) | Rigid, easy to assemble, length adjustable for symmetric wings | Pivots left slightly loose (lock nuts) so the rods can rotate |

**Servo surprise:** at one point the servo spun continuously in one direction instead of swinging. Possible cause: a 360° (continuous) MG90S looks identical to the 180° one. Testing with the Arduino *Sweep* example tells them apart. Lesson: always test the motor alone first.

**Other checks I learned:** close the Arduino IDE Serial Monitor (it blocks the port); if the servo hums but doesn't move or gets hot, the mechanism is jammed — unplug immediately.

`[Add: photos of each mechanism version / close-up of hinge and pushrods]`

## 7. Fabrication Notes (3D printing)

- Split the parts across **11 build plates**; supports only on petals and the core.
- **Plate 2 failed twice ("spaghetti")** — tall thin parts detached. Fixes: clean the bed, brim, tree supports, and move the tallest part to its own plate.
- Printed **trial parts at final scale** first (hinges, fit coupon) to check screw holes (2.2 mm for M2, 3.4 mm for M3, 6.3 mm hex for M3 nuts) before printing the big flower.
- Black PLA for flower + butterfly mechanism, natural wood dowel as the "stem".

`[Add: print photos, failed print photo, Bambu screenshot]`

## 8. Code

### Arduino (MG90S)

```cpp
#include <Servo.h>
Servo wing;
const int SERVO_PIN = 9;
int REST_ANGLE = 90;   // middle position = resting pose
int SWING = 30;        // swing ± degrees (60°–120°)
int UP, DOWN;
char mode = 'R';
int current = 90;

void readSerial() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == 'R' || c == 'G' || c == 'S') mode = c;
  }
}
void moveTo(int target, int wait) {          // 1° at a time, still listening
  while (current != target) {
    current += (target > current) ? 1 : -1;
    wing.write(current); delay(wait); readSerial();
  }
}
void setup() {
  Serial.begin(115200);
  UP = REST_ANGLE - SWING; DOWN = REST_ANGLE + SWING;
  wing.attach(SERVO_PIN); wing.write(current);
}
void loop() {
  readSerial();
  if (mode == 'G')      { moveTo(UP, 6); moveTo(DOWN, 6); delay(200); }
  else if (mode == 'S') { moveTo(UP, 2); moveTo(DOWN, 2); }
  else                  { moveTo(REST_ANGLE, 15); delay(20); }   // settle slowly
}
```

### p5.js (screen) — key ideas
- **ml5 HandPose** → palm position; the on-screen butterfly eases toward it.
- **@gohai/p5.webserial** → sends `R/G/S` only on change.
- Everything is packed into **one HTML file** (`butterfly.html`), opened in Chrome (Safari has no Web Serial).
- Keys: `C` connect Arduino · `F` fullscreen · `V` camera box · `M` mute · `B` butterfly style · `E` echoes · `X` flip direction · `G` / `[ ]` glow.

## 9. Visual Design — Iterations

| Version | Change | Why |
|---|---|---|
| v1 | Simple line butterfly + point-cloud flower | First working interaction |
| v2 | Butterfly = luna moth contour lines (traced from my reference image); flower = point cloud from my Blender model | Dots (flower, "soft") vs lines (butterfly, "solid") → point–line–surface contrast |
| v3 | Flower made of **white barcode blocks** that blink like lights, slowly rotate, shift between order and disorder; bigger, lower, partly outside the frame; webcam box with hand skeleton | Make the flower feel like data, not a picture |
| v4 | **"More Ikeda":** pure 1-bit (no gray), 128 BPM clock, hard cuts between order and glitch, full-screen invert strobe, rulers, coordinate labels, hex data stream, sound (drone, clicks, noise, hand-controlled tone) | Feedback: "not artistic / not Ikeda enough" — Ikeda's work is rhythmic, binary and audio-visual |
| v5 | Butterfly styles: contour / **scanline** / **sound-wave** (lines vibrate with the hand tone), auto-switching on the beat; stroboscopic echoes (T-01…); slice glitch; annotations (span, servo angle, flap Hz) | Connect the screen butterfly to the real one (servo angle shown live) |
| Polish | Retina 2× resolution (was blurry), glow on flower blocks, softer film-grain camera box, mirrored direction fixed so the butterfly follows the hand naturally, skeleton aligned with the hand | User testing on my own laptop |

**Bugs I fixed along the way**
- Page stuck on "Loading…": `p5.sound` is blocked when opening a local file → rewrote the sound with the browser's Web Audio API.
- Butterfly moved opposite to my hand / skeleton didn't match my hand → separate left-right flip settings.
- Blurry text → pixel density matched to the Retina screen.

`[Add: screenshots of v1 → v5]`

## 10. Documentation & Film

- Photographed the piece outdoors on a wooden bench under oak trees, with a red autumn leaf as accent — dark machine vs. warm nature.
- Made a 1-minute film (`ACTIAS_01 – One Minute`): object shots + live screen recording of the interaction; created a golden-hour graded version.
- `[Add: final photos + video link]`

## 11. Reflection

**What worked**
- Hiding all electronics in the base keeps the object clean and sculptural.
- Using the webcam instead of a physical sensor makes the interaction feel magical — you don't touch anything.
- Sending only state changes over serial made the Arduino side very simple and reliable.

**What was hard**
- Mechanics were harder than code: thin wire buckling, small horn holes, and tight hinges cost the most time.
- Matching the "feel" of motion: the real flap is stiffer than the screen animation.

**Next steps**
- Smoother wing motion (easing curve on the servo instead of constant speed).
- Lighter wings, rigid pushrods, external 5 V supply for the servo.
- Sync the screen butterfly's wingbeat with the real servo angle.

## 12. References / Inspiration
- Ryoji Ikeda — *test pattern*, *data.tron*, *datamatics*
- Zach Lieberman — gestural, hand-drawn code animation
- Adafruit cosplay wings (servo wing mechanism reference)
