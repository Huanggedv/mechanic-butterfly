// =====================================================
//  机械蝴蝶 · Expressive Mechanics   v5（池田亮司风格）
//
//  原则：1-bit（只有纯白 / 纯黑，没有灰）· 一切按节拍切换 · 精确的像素网格
//        · 数据标注 · 声音和画面同步
//
//  花   = 你 Blender 花模型的形状，由白色条码方块组成，缓慢旋转；
//         每个 16 分音符，方块像灯一样开 / 关；
//         有序 = 对齐成一行行条码；无序 = 整行错位、竖线拉长（数字故障）
//  蝴蝶 = 月形天蚕蛾，四种样式：CONTOUR 等高线 / SCAN 扫描线 / WAVE 声波（等高线随手的高度振动）
//         / AUTO 跟着节拍在三者之间硬切；飞行时留下频闪残影（T-01…），故障时和花一起整行错位；
//         旁边标注翼展、舵机角度、扇动频率；飞行轨迹是带坐标的折线
//  数据 = 刻度尺、方块编号与坐标、右侧滚动的数据流
//  声音 = 低频正弦 + 节拍咔哒 + 白噪声爆发；手的高度控制高频正弦的音高
//
//  交互：
//  - 没有手：蝴蝶停在花上，花慢慢在有序 / 故障之间切换；实体蝴蝶不动（发 R）
//  - 识别到手：全屏频闪一下，蝴蝶起飞跟着手，节奏变快、更乱；实体蝴蝶扇翅膀（G，手快时 S）
//  - 手离开：蝴蝶飞回花上，花重新整齐；飞回途中继续扇，落下后才停（R）
//
//  依赖：p5.js 1.x、ml5 1.x、p5.webserial、flower_points.js、moth_shape.js
//  操作：点一下画面开启声音 / F 全屏 / V 摄像头小窗 / M 静音 / C 连接或断开 Arduino
//        B 切换蝴蝶样式 / E 频闪残影开关 / X 左右方向翻转 / G 辉光开关 / [ ] 辉光强弱
// =====================================================

// ---------- 可以调的参数 ----------
const BAUD = 115200;        // 要和 Arduino 里的 Serial.begin 一样
const HAND_LOST_MS = 400;   // 手消失多久才算真的离开（防止识别闪烁）
const FAST_SPEED = 18;      // 手移动速度超过这个值 → 快速扇（S）
const FOLLOW = 0.07;        // 蝴蝶跟手的快慢
const BPM = 128;            // 节拍速度：所有切换、闪烁、声音都跟着它
const VIEW_TILT = 0.62;     // 看花的俯视角
const FLOWER_SIZE = 0.74;   // 花的大小（相对画面短边）
const FLOWER_Y = 0.84;      // 花心的高度（0 = 顶，1 = 底）
const ROTATE_SPEED = 0.14;  // 花旋转速度（0 = 不转）
const COL = 3;              // 像素网格：列宽
const ROW = 5;              // 像素网格：行高（条码的行）
const BLINK_OFF = 0.14;     // 每一拍熄灭的方块比例
const LABELS = 30;          // 每次挑多少个方块做数据标注（重叠的会自动跳过）

// ---------- 内部变量 ----------
const HAS_SERIAL = 'serial' in navigator;   // 只有 Chrome / Edge 能连 Arduino
let video, handPose;
let hands = [];
let lastHandTime = -99999;
let port;
let lastSent = '';
let fastUntil = 0;

let state = 'REST';          // REST / FLY / RETURN
let prevState = 'REST';
let pos, prevPos, home, flowerC;
let handPt = null, prevHandPt = null, handSpeed = 0;
// 蝴蝶的左右方向：true = 和手同方向；如果又反了，按 X 键切换，或把这里改成 false
let FLIP_X = true;
// 小框里的手部骨骼左右翻转，让骨骼贴合画面里的手（如果又反了，改成 false）
let CAM_SKEL_FLIP = true;
let flapPhase = 0, heading = 0, flapRate = 0;
let trail = [];
let frameCountTrail = 0;

let step = -1;               // 当前是第几个 16 分音符
let order = 1;               // 1 = 有序，0 = 完全故障（直接跳变，不渐变）
let rowShift = {};           // 故障时每一行的水平错位
let rowKill = {};            // 故障时整行消失
let spikes = new Set();      // 故障时被拉成长竖线的方块
let labelIdx = [];           // 被标注的方块
let strobe = 0;              // 剩余频闪帧数
let barW = [];
let streamOffset = 0;

let S = 20, R = 200, U = 1;
let OUTER = 0;
let showCam = true;
let camG;

// ---- 蝴蝶的样式 ----
// B 键切换：AUTO（跟着节拍自动硬切）→ CONTOUR 等高线 → SCAN 扫描线 → WAVE 声波
const BODY_MODES = ['AUTO', 'CONTOUR', 'SCAN', 'WAVE'];
let styleMode = 'AUTO';
let bodyStyle = 'CONTOUR';
let showEcho = true;         // E 键：频闪残影开/关
const ECHO_MAX = 7;          // 最多留几个残影
let echoes = [];
let bfG;                     // 蝴蝶先画在这张离屏画布上，再按行切片贴到画面（故障时整行错位）
let wavePhase = 0, waveK = 2, waveA = 0;

// 声音
let audioOn = false, muted = false;
let drone, hiTone, clickOsc, noiseSrc;

const HAND_LINKS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

// ---- 清晰度 + 辉光 ----
let PD = 1;                    // 像素密度：Retina 屏 = 2，画面更锐利
let GLOW = 1.0;                // 花的辉光强度：G 键开关，[ 和 ] 键调弱 / 调强
let glowOn = true;
const glowLayers = [
  { div: 3, alpha: 0.42 },     // 贴近方块的小光晕
  { div: 8, alpha: 0.6 },     // 大范围的柔光
];
const flowerRects = [];        // 这一帧要画的方块（先画辉光，再把清晰的方块画在上面）

// ---- 摄像头小框的画面 ----
let CAM_CONTRAST = 1.6;        // 对比度：1 = 原样，越大越黑白分明（之前是 40）
let CAM_BRIGHT = 1.05;         // 亮度
let GRAIN = 0.3;               // 颗粒感强度（0 = 没有颗粒）
const grainTiles = [];         // 预先生成几张噪点图，每帧换一张，颗粒就会“跳动”

let modelStatus = 'LOADING';   // 手势模型：LOADING → READY / ERROR

function setup() {
  createCanvas(windowWidth, windowHeight);
  PD = Math.min(2, displayDensity());   // Retina 屏用 2 倍分辨率
  pixelDensity(PD);
  textFont('monospace');
  noSmooth();

  video = createCapture(VIDEO, { flipped: true });
  video.size(640, 480);
  video.hide();
  // 手势模型在后台加载，画面先跑起来（以前放在 preload 里，加载时整页是黑的）
  if (typeof ml5 === 'undefined') {
    modelStatus = 'ERROR  ml5 未加载，检查网络';
  } else {
    try {
      handPose = ml5.handPose({ flipped: true, maxHands: 1 }, () => {
        modelStatus = 'READY';
        handPose.detectStart(video, gotHands);
      });
    } catch (e) {
      modelStatus = 'ERROR  ' + e.message;
    }
  }

  port = createSerial();
  if (HAS_SERIAL) {
    const used = usedSerialPorts();                 // 以前连过的 Arduino：自动连上
    if (used.length > 0) port.open(used[0], BAUD);
  }

  camG = createGraphics(240, 180);
  camG.pixelDensity(PD);                // 和屏幕一样的清晰度，颗粒更细
  for (let k = 0; k < 6; k++) {
    const c = document.createElement('canvas');
    c.width = 240 * PD; c.height = 180 * PD;
    const g = c.getContext('2d');
    const img = g.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() < 0.5 ? Math.random() * 90 : 165 + Math.random() * 90;  // 偏暗或偏亮的随机点
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainTiles.push(c);
  }
  for (let i = 0; i < MOTH.contours.length; i++) {
    if (MOTH.contours[i].length > MOTH.contours[OUTER].length) OUTER = i;
  }
  const widths = [1, 1, 1, 1, 1, 2, 2, 3, 5, 8];   // 大多是 1px 细线，少数粗块
  for (let i = 0; i < FLOWER_PTS.length; i++) barW[i] = random(widths);
  pickLabels();
  layout();
  pos = home.copy();
  prevPos = pos.copy();
}

function gotHands(results) {
  hands = results;
  if (results.length > 0) lastHandTime = millis();
}

function layout() {
  U = min(width, height);
  R = U * FLOWER_SIZE;
  S = U * 0.046;
  flowerC = createVector(width / 2, height * FLOWER_Y);
  home = createVector(flowerC.x, flowerC.y - R * 0.42);
  const side = Math.ceil(S * 12 / ROW) * ROW;
  if (bfG) bfG.remove();
  bfG = createGraphics(side, side);
  bfG.pixelDensity(PD);

  for (const L of glowLayers) {
    L.c = L.c || document.createElement('canvas');
    L.c.width = Math.ceil(width / L.div);
    L.c.height = Math.ceil(height / L.div);
    L.ctx = L.c.getContext('2d');
  }
}

// 花的辉光：画花时每个方块也同时画到很小的画布上（1/4、1/12 大小），
// 再把小画布平滑放大、用“相加”混合叠到画面上，方块周围就有光晕。
// 只处理小画布，所以很省性能。
function beginGlow() {
  for (const L of glowLayers) {
    const g = L.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, L.c.width, L.c.height);
  }
  const g0 = glowLayers[0].ctx;
  g0.setTransform(1 / glowLayers[0].div, 0, 0, 1 / glowLayers[0].div, 0, 0);
  g0.fillStyle = '#fff';
  return g0;
}

function drawGlow() {
  if (!glowOn || GLOW <= 0) return;
  // 第一层再缩小一次到第二层（缩小时会被平滑，自然就模糊了）
  for (let k = 1; k < glowLayers.length; k++) {
    const a = glowLayers[k - 1], b = glowLayers[k];
    b.ctx.imageSmoothingEnabled = true;
    b.ctx.drawImage(a.c, 0, 0, b.c.width, b.c.height);
  }
  const ctx = drawingContext;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true;
  for (const L of glowLayers) {
    ctx.globalAlpha = Math.min(1, L.alpha * GLOW);
    ctx.drawImage(L.c, 0, 0, width, height);
  }
  ctx.restore();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  layout();
  if (state === 'REST') pos = home.copy();
}

// 简单的确定性随机数：同一个 (a, b) 永远得到同一个 0~1 的值
function hash(a, b) {
  return fract(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);
}

// =====================================================
//  主循环
// =====================================================
function draw() {
  background(0);
  updateHand();
  updateState();
  updateMotion();
  clock();
  sendSerial();
  updateSound();

  drawRulers();
  drawFlower();
  drawLabels();
  drawTrail();
  drawHandMarker();
  drawEchoes();
  drawButterfly(pos.x, pos.y, heading, wingOpen());
  drawStream();
  drawHUD();
  if (showCam) drawCam();
  if (!audioOn) drawStartHint();

  // 全屏反色频闪
  if (strobe > 0) {
    const ctx = drawingContext;
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    strobe--;
  }
}

// =====================================================
//  节拍：每个 16 分音符触发一次
// =====================================================
function clock() {
  const s = Math.floor(millis() / (60000 / BPM / 4));
  if (s === step) return;
  step = s;

  // 什么时候切换"有序 / 故障"
  let changeEvery = state === 'FLY' ? 4 : state === 'RETURN' ? 8 : 16;
  if (s % changeEvery === 0) {
    const before = order;
    if (state === 'FLY') order = random([1, 0.5, 0, 0]);
    else if (state === 'RETURN') order = random([1, 1, 0.5]);
    else order = order === 1 ? (random() < 0.5 ? 0.5 : 1) : 1;
    if (order !== before) {
      burst(order < 1 ? 0.18 : 0.08);
      if (styleMode === 'AUTO') pickBodyStyle();
    }
    if (order < 1) makeGlitch();
  } else if (order < 1 && s % 2 === 0) {
    makeGlitch();                                  // 故障时每两拍重新错位
  }

  if (s % 4 === 0) pickLabels();
  if (state === 'FLY' && s % 16 === 0 && random() < 0.5) strobe = 2;

  // 声音：节拍咔哒
  if (state === 'FLY' || (state === 'RETURN' && s % 2 === 0)) click(s % 4 === 0 ? 0.22 : 0.1);
  else if (s % 8 === 0) click(0.05);

  streamOffset += state === 'FLY' ? 3 : 1;

  // 频闪残影：每两拍"拍"下一个蝴蝶的轮廓（像马雷的连续摄影）
  if (state !== 'REST' && s % 2 === 0) {
    echoes.push({ x: pos.x, y: pos.y, a: heading, o: wingOpen() });
    if (echoes.length > ECHO_MAX) echoes.shift();
  } else if (state === 'REST' && echoes.length > 0) {
    echoes.shift();
  }
}

// AUTO 模式：秩序时多是等高线 / 扫描线，故障时多是声波 / 扫描线
function pickBodyStyle() {
  if (state === 'FLY') bodyStyle = order === 1 ? random(['CONTOUR', 'SCAN']) : random(['WAVE', 'WAVE', 'SCAN']);
  else bodyStyle = order === 1 ? 'CONTOUR' : 'SCAN';
}

function makeGlitch() {
  const chaos = 1 - order;
  rowShift = {};
  rowKill = {};
  spikes = new Set();
  const rows = Math.ceil(height / ROW);
  for (let r = 0; r < rows; r++) {
    if (random() < 0.35 * chaos) rowShift[r] = Math.round(random(-40, 40) * chaos) * COL;
    if (random() < 0.12 * chaos) rowKill[r] = true;
  }
  const n = Math.floor(FLOWER_PTS.length * 0.04 * chaos);
  for (let k = 0; k < n; k++) spikes.add(Math.floor(random(FLOWER_PTS.length)));
}

function pickLabels() {
  labelIdx = [];
  for (let k = 0; k < LABELS; k++) labelIdx.push(Math.floor(random(FLOWER_PTS.length)));
}

// =====================================================
//  手 / 状态 / 运动
// =====================================================
function updateHand() {
  prevHandPt = handPt;
  if (hands.length > 0) {
    const k = hands[0].keypoints[9];     // 中指根部 ≈ 手掌中心
    let hx = k.x * width / video.width;
    if (FLIP_X) hx = width - hx;         // 左右方向翻转（X 键切换）
    handPt = createVector(hx, k.y * height / video.height);
  } else if (millis() - lastHandTime > HAND_LOST_MS) {
    handPt = null;
  }
  if (handPt && prevHandPt) handSpeed = lerp(handSpeed, p5.Vector.dist(handPt, prevHandPt), 0.3);
  else handSpeed = lerp(handSpeed, 0, 0.2);
}

function updateState() {
  prevState = state;
  if (handPt !== null) state = 'FLY';
  else if (state === 'FLY') state = 'RETURN';
  else if (state === 'RETURN' && p5.Vector.dist(pos, home) < 3) {
    state = 'REST';
    pos = home.copy();
  }
  if (state !== prevState && styleMode === 'AUTO') pickBodyStyle();
  if (state === 'FLY' && prevState !== 'FLY') {   // 刚识别到手：频闪 + 噪声
    strobe = 4;
    burst(0.3);
  }
}

function updateMotion() {
  prevPos = pos.copy();
  let target = home;
  if (state === 'FLY') {
    const t = millis() * 0.001;
    target = createVector(
      handPt.x + (noise(t * 0.7) - 0.5) * U * 0.12,
      handPt.y - U * 0.05 + (noise(t * 0.7 + 50) - 0.5) * U * 0.10
    );
  }
  if (state !== 'REST') pos.lerp(target, state === 'RETURN' ? 0.05 : FOLLOW);

  const v = p5.Vector.sub(pos, prevPos);
  let targetHeading = 0;
  if (v.mag() > 1.2) {
    let a = Math.atan2(v.y, v.x) + HALF_PI;
    if (a > PI) a -= TWO_PI;
    targetHeading = constrain(a, -0.6, 0.6);
  }
  heading = lerp(heading, targetHeading, 0.08);

  let dPhase = 0.025;
  if (state === 'FLY') dPhase = 0.30 + min(handSpeed, 30) * 0.008;
  else if (state === 'RETURN') dPhase = 0.22;
  flapPhase += dPhase;
  flapRate = dPhase * 60 / TWO_PI;   // 每秒扇几下（按 60fps 算）

  // 轨迹：每 3 帧记一个点（折线，不是柔和的曲线）
  frameCountTrail++;
  if (state !== 'REST') {
    if (frameCountTrail % 3 === 0) {
      trail.push(createVector(Math.round(pos.x / COL) * COL, Math.round(pos.y / ROW) * ROW));
      if (trail.length > 90) trail.shift();
    }
  } else if (trail.length > 0 && frameCountTrail % 2 === 0) {
    trail.shift();
  }
}

function wingOpen() {
  if (state === 'REST') return 0.85 + 0.15 * (0.5 + 0.5 * Math.cos(flapPhase));
  return map(Math.cos(flapPhase), -1, 1, 0.12, 1);
}

// =====================================================
//  串口：只在状态变化时发送
// =====================================================
function currentCommand() {
  if (state === 'REST') return 'R';
  if (state === 'RETURN') return 'G';
  if (handSpeed > FAST_SPEED) fastUntil = millis() + 600;
  return millis() < fastUntil ? 'S' : 'G';
}

function sendSerial() {
  const cmd = currentCommand();
  if (port.opened() && cmd !== lastSent) {
    port.write(cmd);
    lastSent = cmd;
  }
  if (!port.opened()) lastSent = '';
}

// =====================================================
//  声音（点一下画面后开启）
// =====================================================
// 用浏览器自带的 Web Audio（不用 p5.sound：它在直接打开本地文件时会被 Chrome 挡住，页面卡在 Loading）
let actx, master, droneG, hiOsc, hiG, clickG, noiseG;

function startAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  actx = new AC();
  actx.resume();
  master = actx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(actx.destination);
  const now = actx.currentTime;

  // 低频嗡鸣 55Hz，2 秒淡入
  const drone = actx.createOscillator();
  drone.type = 'sine';
  drone.frequency.value = 55;
  droneG = actx.createGain();
  droneG.gain.setValueAtTime(0, now);
  droneG.gain.linearRampToValueAtTime(0.12, now + 2);
  drone.connect(droneG).connect(master);
  drone.start();

  // 高频正弦：跟着手的高度
  hiOsc = actx.createOscillator();
  hiOsc.type = 'sine';
  hiOsc.frequency.value = 3000;
  hiG = actx.createGain();
  hiG.gain.value = 0;
  hiOsc.connect(hiG).connect(master);
  hiOsc.start();

  // 节拍上的“咔哒”
  const clickOsc = actx.createOscillator();
  clickOsc.type = 'square';
  clickOsc.frequency.value = 7000;
  clickG = actx.createGain();
  clickG.gain.value = 0;
  clickOsc.connect(clickG).connect(master);
  clickOsc.start();

  // 白噪声（循环播放一段 2 秒的随机噪声）
  const buf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noiseSrc = actx.createBufferSource();
  noiseSrc.buffer = buf;
  noiseSrc.loop = true;
  noiseG = actx.createGain();
  noiseG.gain.value = 0;
  noiseSrc.connect(noiseG).connect(master);
  noiseSrc.start();

  audioOn = true;
}

// 包络：迅速升到 v，再衰减到 0
function envelope(g, v, attack, release) {
  const t = actx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(g.gain.value, t);
  g.gain.linearRampToValueAtTime(v, t + attack);
  g.gain.linearRampToValueAtTime(0, t + attack + release);
}

function click(v) {
  if (!audioOn) return;
  envelope(clickG, v, 0.001, 0.025);
}

function burst(v) {
  if (!audioOn) return;
  envelope(noiseG, v, 0.002, 0.12);
}

function updateSound() {
  if (!audioOn) return;
  const t = actx.currentTime;
  if (state === 'FLY' && handPt) {
    hiOsc.frequency.setTargetAtTime(map(handPt.y, 0, height, 6400, 1600), t, 0.05);   // 手越高，音越高
    hiG.gain.setTargetAtTime(0.035, t, 0.05);
  } else {
    hiG.gain.setTargetAtTime(0, t, 0.15);
  }
}

function mousePressed() {
  if (!audioOn) startAudio();
}

// =====================================================
//  刻度尺（左边和底边）
// =====================================================
function drawRulers() {
  stroke(255);
  strokeWeight(1);
  for (let y = 0; y < height; y += 10) {
    const big = y % 100 === 0;
    line(0, y + 0.5, big ? 14 : 5, y + 0.5);
  }
  for (let x = 0; x < width; x += 10) {
    const big = x % 100 === 0;
    line(x + 0.5, height, x + 0.5, height - (big ? 14 : 5));
  }
  noStroke();
  fill(255);
  textSize(9);
  for (let y = 100; y < height; y += 100) text(nf(y, 4), 18, y + 3);
  for (let x = 100; x < width; x += 100) text(nf(x, 4), x + 3, height - 18);
}

// =====================================================
//  花：1-bit 条码方块
// =====================================================
let projected = [];   // 记下每个方块的屏幕位置，给数据标注用

function drawFlower() {
  const t = millis() * 0.001;
  const rot = t * ROTATE_SPEED;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const ce = Math.cos(VIEW_TILT), se = Math.sin(VIEW_TILT);
  const glitch = order < 1;
  const ctx = drawingContext;
  ctx.fillStyle = '#fff';
  const gg = glowOn ? beginGlow() : null;
  flowerRects.length = 0;

  for (let i = 0; i < FLOWER_PTS.length; i++) {
    const p = FLOWER_PTS[i];
    const xr = p[0] * cr - p[1] * sr;
    const yr = p[0] * sr + p[1] * cr;
    let sx = flowerC.x + xr * R;
    let sy = flowerC.y - (p[2] * ce - yr * se) * R;
    projected[i] = null;

    // 远处的方块少一些（用数量表示远近，而不是用灰色）
    if (yr > 0.25 && i % 3 === 0) continue;
    if (yr > 0.6 && i % 3 === 1) continue;
    // 像灯一样：每个 16 分音符决定开或关
    const lit = hash(i, step + (i % 7));
    if (lit < BLINK_OFF) continue;

    // 对齐像素网格
    const row = Math.round(sy / ROW);
    if (glitch && rowKill[row]) continue;
    let x = Math.round(sx / COL) * COL;
    const y = row * ROW;
    if (glitch && rowShift[row]) x += rowShift[row];

    let w = barW[i];
    let h = ROW - 2;
    if (lit > 0.965) w += 6;                     // 闪亮：变成粗块
    if (yr < -0.4) w += 1;                       // 近处稍粗
    if (glitch && spikes.has(i)) {               // 故障：拉成长竖线
      h = 20 + hash(i, step) * 160 * (1 - order);
      w = 1;
      flowerRects.push(x, y - h, w, h);
      if (gg) gg.fillRect(x, y - h, w, h);
      projected[i] = [x, y];
      continue;
    }
    if (y > height + ROW || x + w < 0 || x > width) continue;
    flowerRects.push(x, y - h / 2, w, h);
    if (gg) gg.fillRect(x, y - h / 2, w, h);
    projected[i] = [x, y];
  }
  drawGlow();                                   // 先画光晕
  for (let k = 0; k < flowerRects.length; k += 4) {
    ctx.fillRect(flowerRects[k], flowerRects[k + 1], flowerRects[k + 2], flowerRects[k + 3]);
  }
}

// 随机挑几个方块，标出编号和三维坐标
function drawLabels() {
  textSize(9);
  const placed = [];
  for (const i of labelIdx) {
    const pp = projected[i];
    if (!pp) continue;
    const [x, y] = pp;
    const p = FLOWER_PTS[i];
    const lx = x + 26, ly = y - 18;
    // 标注之间不重叠，也不压在蝴蝶身上
    if (placed.some(q => Math.abs(q[0] - lx) < 190 && Math.abs(q[1] - ly) < 16)) continue;
    if (Math.abs(lx - pos.x) < S * 4.5 && ly > pos.y - S * 2 && ly < pos.y + S * 4.6) continue;
    placed.push([lx, ly]);
    stroke(255);
    strokeWeight(1);
    line(x + 0.5, y + 0.5, lx - 2, ly + 3);
    noFill();
    rect(x - 2.5, y - 2.5, 5, 5);
    noStroke();
    fill(255);
    text('#' + nf(i, 4) + ' ' + nf(p[0], 1, 3) + ' ' + nf(p[1], 1, 3) + ' ' + nf(p[2], 1, 3), lx, ly);
  }
}

// =====================================================
//  蝴蝶 + 轨迹 + 手的十字线
// =====================================================
function drawTrail() {
  if (trail.length < 2) return;
  stroke(255);
  strokeWeight(1);
  noFill();
  beginShape();
  for (const p of trail) vertex(p.x + 0.5, p.y + 0.5);
  endShape();
  noStroke();
  fill(255);
  textSize(9);
  for (let i = trail.length - 1; i >= 0; i -= 10) {
    const p = trail[i];
    rect(p.x - 1.5, p.y - 1.5, 4, 4);
    if (i > trail.length - 30) text(nf(p.x / width, 1, 3) + ',' + nf(p.y / height, 1, 3), p.x + 6, p.y + 12);
  }
}

function drawHandMarker() {
  if (!handPt) return;
  stroke(255);
  strokeWeight(1);
  drawingContext.setLineDash([2, 4]);
  line(Math.round(handPt.x) + 0.5, 0, Math.round(handPt.x) + 0.5, height);
  line(0, Math.round(handPt.y) + 0.5, width, Math.round(handPt.y) + 0.5);
  drawingContext.setLineDash([]);
  noFill();
  rectMode(CENTER);
  rect(handPt.x, handPt.y, 14, 14);
  rectMode(CORNER);
  noStroke();
  fill(255);
  textSize(9);
  text('HAND ' + nf(handPt.x / width, 1, 3) + ' ' + nf(handPt.y / height, 1, 3), handPt.x + 12, handPt.y - 10);
}

// 蝴蝶上的一个点（WAVE 样式时，每条等高线都被一条正弦波推动；波的密度 = 手的高度 = 高音的音高）
function bfPt(p, kx, ci, wave) {
  let y = p[1] * S;
  if (wave) y += waveA * Math.sin(p[0] * waveK + wavePhase + ci * 0.45);
  return [p[0] * kx, y];
}

function tracePath(ctx, c, kx, ci, wave) {
  ctx.beginPath();
  for (let i = 0; i < c.length; i++) {
    const q = bfPt(c[i], kx, ci, wave);
    if (i === 0) ctx.moveTo(q[0], q[1]);
    else ctx.lineTo(q[0], q[1]);
  }
  ctx.closePath();
}

// 频闪残影：只画外轮廓，越旧的点线越稀
function drawEchoes() {
  if (!showEcho || echoes.length < 2) return;
  const ctx = drawingContext;
  const outer = MOTH.contours[OUTER];
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.font = '9px monospace';
  const n = echoes.length;
  for (let k = 0; k < n - 1; k++) {
    const e = echoes[k];
    const age = n - 1 - k;
    ctx.setLineDash(age <= 1 ? [] : [1, age * 2]);
    ctx.save();
    ctx.translate(Math.round(e.x), Math.round(e.y));
    ctx.rotate(e.a);
    tracePath(ctx, outer, S * e.o, OUTER, false);
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);
    ctx.fillRect(Math.round(e.x) - 1, Math.round(e.y) - 1, 3, 3);
    ctx.fillText('T-' + nf(age, 2), Math.round(e.x) + 6, Math.round(e.y) - 4);
  }
  ctx.restore();
}

function drawButterfly(x, y, ang, open) {
  const g = bfG, gc = g.drawingContext, side = g.width;
  const ox = side / 2, oy = side / 2 - S * 1.5;      // 胸部在离屏画布里的位置
  const kx = S * open;
  const wave = bodyStyle === 'WAVE';
  const outer = MOTH.contours[OUTER];

  // 声波参数：飞得越凶波越大，手越高波越密
  const aT = state === 'FLY' ? S * 0.16 : state === 'RETURN' ? S * 0.1 : S * 0.03;
  waveA = lerp(waveA, aT, 0.1);
  waveK = lerp(waveK, handPt ? map(handPt.y, 0, height, 4.5, 1.2) : 2, 0.1);
  wavePhase += state === 'FLY' ? 0.35 : 0.06;

  gc.save();
  gc.setTransform(PD, 0, 0, PD, 0, 0);
  gc.clearRect(0, 0, side, side);
  gc.translate(ox, oy);
  gc.rotate(ang);
  gc.lineWidth = 1;
  gc.strokeStyle = '#fff';
  gc.fillStyle = '#000';

  // 黑色剪影：挡住后面的花
  tracePath(gc, outer, kx, OUTER, wave);
  gc.fill();

  if (bodyStyle === 'SCAN') {
    // 扫描线：翅膀被横线填满，眼斑和翅脉在里面挖成黑色
    gc.save();
    tracePath(gc, outer, kx, OUTER, false);
    gc.clip();
    gc.beginPath();
    for (let yy = -S * 2; yy < S * 5; yy += 3) {
      gc.moveTo(-S * 4, Math.round(yy) + 0.5);
      gc.lineTo(S * 4, Math.round(yy) + 0.5);
    }
    gc.stroke();
    gc.strokeStyle = '#000';
    gc.lineWidth = 2;
    gc.beginPath();
    for (const m of MOTH.marks) {
      gc.moveTo(m[1] * kx, m[0] * S);
      gc.lineTo(m[2] * kx, m[0] * S);
    }
    gc.stroke();
    gc.restore();
    gc.strokeStyle = '#fff';
    gc.lineWidth = 1;
    tracePath(gc, outer, kx, OUTER, false);
    gc.stroke();
  } else {
    // 等高线（WAVE 时每条线都在振动）
    for (let ci = 0; ci < MOTH.contours.length; ci++) {
      tracePath(gc, MOTH.contours[ci], kx, ci, wave);
      gc.stroke();
    }
    gc.beginPath();
    for (const m of MOTH.marks) {
      const a = bfPt([m[1], m[0]], kx, 0, wave), b = bfPt([m[2], m[0]], kx, 0, wave);
      gc.moveTo(a[0], a[1]);
      gc.lineTo(b[0], b[1]);
    }
    gc.stroke();
  }

  // 身体 + 羽状触角
  gc.lineWidth = 3;
  gc.beginPath();
  gc.moveTo(0, -S * 0.85);
  gc.lineTo(0, S * 1.25);
  gc.stroke();
  gc.lineWidth = 1;
  gc.beginPath();
  for (const s of [-1, 1]) {
    const tipX = s * S * 0.5, tipY = -S * 1.55;
    gc.moveTo(0, -S * 0.85);
    gc.lineTo(tipX, tipY);
    for (let i = 1; i <= 5; i++) {
      const f = i / 6;
      const ax = tipX * f, ay = -S * 0.85 + (tipY + S * 0.85) * f;
      gc.moveTo(ax, ay);
      gc.lineTo(ax + s * S * 0.14, ay + S * 0.04);
    }
  }
  gc.stroke();
  gc.restore();

  // 贴到画面上：位置对齐像素网格；故障时和花一起整行错位 / 整行消失
  const ctx = drawingContext;
  const left = Math.round((x - ox) / COL) * COL;
  const top = Math.round((y - oy) / ROW) * ROW;
  if (order < 1) {
    for (let j = 0; j * ROW < side; j++) {
      const sy = top + j * ROW;
      const r = Math.floor(sy / ROW);
      if (rowKill[r] && hash(r, step) < 0.5) continue;      // 蝴蝶只丢一半的行，免得碎得认不出来
      const sh = Math.round((rowShift[r] || 0) * 0.4 / COL) * COL;
      ctx.drawImage(g.elt, 0, j * ROW * PD, side * PD, ROW * PD, left + sh, sy, side, ROW);
    }
    // 故障时从翅膀边缘拉出竖线
    const ca = Math.cos(ang), sa = Math.sin(ang);
    stroke(255);
    strokeWeight(1);
    for (let i = 0; i < outer.length; i += 3) {
      if (hash(i, step) > 0.12 * (1 - order)) continue;
      const lx = outer[i][0] * kx, ly = outer[i][1] * S;
      const sx = Math.round(x + lx * ca - ly * sa) + 0.5, sy = y + lx * sa + ly * ca;
      line(sx, sy, sx, sy + (hash(i, step + 1) * 2 - 1) * S * 4);
    }
  } else {
    ctx.drawImage(g.elt, left, top, side, side);
  }

  drawBfAnnot(x, y, open);
}

// 蝴蝶的技术标注：翼展尺寸线 + 舵机角度 + 扇动频率
function drawBfAnnot(x, y, open) {
  const half = Math.round(3.6 * S * open);
  const cx = Math.round(x), yb = Math.round(y + S * 5.0);
  stroke(255);
  strokeWeight(1);
  line(cx - half, yb + 0.5, cx + half, yb + 0.5);
  line(cx - half + 0.5, yb - 4, cx - half + 0.5, yb + 5);
  line(cx + half + 0.5, yb - 4, cx + half + 0.5, yb + 5);
  drawingContext.setLineDash([1, 3]);
  line(cx - half + 0.5, Math.round(y), cx - half + 0.5, yb - 4);
  line(cx + half + 0.5, Math.round(y), cx + half + 0.5, yb - 4);
  drawingContext.setLineDash([]);
  noStroke();
  textSize(9);
  const spanTxt = 'SPAN ' + nf(2 * half / width, 1, 3);
  fill(0);
  rect(cx - textWidth(spanTxt) / 2 - 3, yb + 6, textWidth(spanTxt) + 6, 12);   // 黑底，文字不被花挡住
  fill(255);
  textAlign(CENTER);
  text(spanTxt, cx, yb + 15);
  textAlign(LEFT);

  const servo = state === 'REST' ? 90 : Math.round(map(open, 0.12, 1, 120, 60));
  const lx = cx + half + 12, ly = Math.round(y - S * 1.4);
  const lines = [
    'ACTIAS LUNA',
    'SERVO ' + nf(servo, 3) + '°',
    'FLAP  ' + nf(flapRate, 1, 2) + ' Hz',
    'BODY  ' + bodyStyle,
  ];
  fill(0);
  rect(lx - 3, ly - 10, 84, lines.length * 11 + 4);
  fill(255);
  for (let k = 0; k < lines.length; k++) text(lines[k], lx, ly + k * 11);
}

// =====================================================
//  右侧数据流 / 文字信息 / 摄像头小窗
// =====================================================
function drawStream() {
  noStroke();
  fill(255);
  textSize(9);
  const x = width - U * 0.03 - 64;
  const top = U * 0.03 + 180 + 40;
  const lineH = 11;
  const n = Math.floor((height - top - 40) / lineH);
  for (let k = 0; k < n; k++) {
    const r = k + streamOffset;
    let s = '';
    for (let j = 0; j < 4; j++) s += Math.floor(hash(r, j) * 65536).toString(16).padStart(4, '0');
    if (hash(r, 9) < 0.15) s = s.replace(/[0-9a-f]/g, c => (parseInt(c, 16) % 2 ? '1' : '0'));
    text(s, x, top + k * lineH);
  }
}

function drawHUD() {
  noStroke();
  fill(255);
  textSize(10);
  const x = U * 0.03 + 30;
  let y = U * 0.05;
  const lines = [
    'ACTIAS_01  /  EXPRESSIVE MECHANICS',
    'STATE    ' + state,
    'MODEL    ' + modelStatus,
    'HAND     ' + (handPt ? 'DETECTED' : '--------'),
    'SPEED    ' + nf(handSpeed, 2, 1),
    'ORDER    ' + nf(order, 1, 2),
    'BPM      ' + BPM + '   STEP ' + nf(step % 64, 2),
    'POINTS   ' + FLOWER_PTS.length + '   FPS ' + nf(Math.round(frameRate()), 2),
    'GLOW     ' + (glowOn ? nf(GLOW, 1, 2) : 'OFF') + '   [G] [ ]',
    'BODY     ' + (styleMode === 'AUTO' ? 'AUTO / ' : '') + bodyStyle + '   [B]',
    'SERIAL   ' + (!HAS_SERIAL ? 'N/A  请用 Chrome 打开' : port.opened() ? 'TX ' + lastSent : 'OFFLINE  [C]'),
  ];
  for (const l of lines) { text(l, x, y); y += 13; }
}

function drawCam() {
  const w = camG.width, h = camG.height;
  const x0 = width - w - U * 0.03, y0 = U * 0.03;
  // 黑白胶片感：灰度 + 适中的对比度，再叠一层跳动的颗粒
  const cg = camG.drawingContext;
  cg.filter = 'grayscale(1) brightness(' + CAM_BRIGHT + ') contrast(' + CAM_CONTRAST + ')';
  const vel = video && video.elt;
  if (vel && vel.readyState >= 2 && vel.videoWidth > 0) {
    camG.image(video, 0, 0, w, h);
  } else {
    camG.background(0);                       // 摄像头还没画面（或被拒绝）：先显示黑底，别让整个画面出错
  }
  cg.filter = 'none';
  if (GRAIN > 0 && grainTiles.length) {
    cg.save();
    cg.globalCompositeOperation = 'overlay';
    cg.globalAlpha = GRAIN;
    cg.drawImage(grainTiles[frameCount % grainTiles.length], 0, 0, w, h);
    cg.restore();
  }
  image(camG, x0, y0);
  if (hands.length > 0) {
    const sx = w / video.width, sy = h / video.height;
    // 先换算成小框里的坐标（需要时左右翻转）
    const kp = hands[0].keypoints.map(k => ({
      x: CAM_SKEL_FLIP ? w - k.x * sx : k.x * sx,
      y: k.y * sy,
    }));
    stroke(0);
    strokeWeight(3);
    for (const [a, b] of HAND_LINKS) line(x0 + kp[a].x, y0 + kp[a].y, x0 + kp[b].x, y0 + kp[b].y);
    stroke(255);
    strokeWeight(1);
    for (const [a, b] of HAND_LINKS) line(x0 + kp[a].x, y0 + kp[a].y, x0 + kp[b].x, y0 + kp[b].y);
    noStroke();
    for (const k of kp) {
      fill(0);
      rect(x0 + k.x - 3, y0 + k.y - 3, 6, 6);
      fill(255);
      rect(x0 + k.x - 2, y0 + k.y - 2, 4, 4);
    }
  }
  noFill();
  stroke(255);
  strokeWeight(1);
  rect(x0 + 0.5, y0 + 0.5, w, h);
  noStroke();
  fill(255);
  textSize(9);
  text('INPUT / HANDPOSE / 21 KEYPOINTS', x0, y0 + h + 14);
  textAlign(RIGHT);
  text(hands.length > 0 ? 'HAND 01' : 'NO HAND', x0 + w, y0 + h + 14);
  textAlign(LEFT);
}

function drawStartHint() {
  if (Math.floor(millis() / 500) % 2 === 0) return;
  noStroke();
  fill(255);
  textSize(10);
  textAlign(CENTER);
  text('[ CLICK TO ENABLE AUDIO ]', width / 2, U * 0.06);
  textAlign(LEFT);
}

function keyPressed() {
  if (key === 'f' || key === 'F') fullscreen(!fullscreen());
  if (key === 'v' || key === 'V') showCam = !showCam;
  if (key === 'e' || key === 'E') showEcho = !showEcho;
  if (key === 'x' || key === 'X') FLIP_X = !FLIP_X;
  if (key === 'g' || key === 'G') glowOn = !glowOn;
  if (key === ']') GLOW = Math.min(2.5, GLOW + 0.25);
  if (key === '[') GLOW = Math.max(0, GLOW - 0.25);
  if (key === 'b' || key === 'B') {
    styleMode = BODY_MODES[(BODY_MODES.indexOf(styleMode) + 1) % BODY_MODES.length];
    if (styleMode === 'AUTO') pickBodyStyle();
    else bodyStyle = styleMode;
  }
  if (key === 'm' || key === 'M') { muted = !muted; if (master) master.gain.value = muted ? 0 : 1; }
  if ((key === 'c' || key === 'C') && HAS_SERIAL) {
    if (port.opened()) port.close();
    else port.open(BAUD);
    lastSent = '';
  }
}
