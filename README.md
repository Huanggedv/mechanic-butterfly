# mechanic-butterfly — ACTIAS_01

Interactive visual for a mechanical butterfly (TDF / Physical Computing).

**Live:** https://huanggedv.github.io/mechanic-butterfly/ — open it in **Chrome** (Safari has no Web Serial).

- Raise your hand in front of the webcam → the on-screen butterfly flies to your hand; the physical butterfly (Arduino + MG90S servo) flaps.
- Hand leaves → the butterfly flies back to the flower and rests.

**Keys:** click = sound · `C` connect Arduino · `F` fullscreen · `V` camera box · `M` mute · `B` butterfly style · `E` echoes · `X` flip direction · `G` / `[ ]` glow

Built with p5.js, ml5.js HandPose and p5.webserial. Serial protocol: `R` rest / `G` flap / `S` fast flap at 115200 baud.
