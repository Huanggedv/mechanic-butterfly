# 把 3D 渲染镜头往“黄昏树林实拍”的感觉推：调色 + 逆光/光束 + 光晕 + 前景虚化草叶 + 浮尘 + 镜头质感
import sys, json, subprocess, numpy as np, cv2, math

W, H = 1920, 1080
SRC = '/mnt/user-data/uploads/ACTIAS_01_-_One_Minute.mp4'
CAP = dict(x=48, y=1000, w=345, h=50)

SHOTS = {
  'S1': dict(t0=0,  dur=5, sun=(0.80, -0.06), grass=['bl', 'br'], lap=(1000, 380, 1760, 990), sky=0.13, seed=1),
  'S2': dict(t0=5,  dur=4, sun=(0.18, -0.10), grass=['bl'],       lap=(1150, 80, 1920, 900),  sky=0.0,  seed=2),
  'S3': dict(t0=9,  dur=4, sun=(0.12, -0.02), grass=['br'],       lap=(1100, 0, 1920, 1080),  sky=0.0,  seed=3),
  'S4': dict(t0=13, dur=4, sun=(-0.15, -0.25), grass=[],          lap=(1150, 0, 1920, 700),   sky=0.0,  seed=4, rays=0.35, cut=False),
  'S5': dict(t0=17, dur=5, sun=(0.22, -0.06), grass=['br'],       lap=(1380, 380, 1920, 1080), sky=0.06, seed=5, inset=(1485, 48, 380, 287)),
  'S6': dict(t0=40, dur=6, sun=(0.86, -0.06), grass=['bl'],       lap=(1700, 250, 1920, 1080), sky=0.0,  seed=6),
  'S7': dict(t0=50, dur=5, sun=(0.16, -0.06), grass=['bl'],       lap=(1250, 360, 1920, 1080), sky=0.0,  seed=7, inset=(1333, 46, 542, 312)),
  'S8': dict(t0=55, dur=5, sun=(0.80, -0.06), grass=['bl', 'br'], lap=(1000, 380, 1760, 990), sky=0.13, seed=8),
}

def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

# ---------- 调色：绿草变秋天的金黄，暖高光、偏冷的暗部、S 曲线 ----------
def grade(img):
    hsv = cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    h, s, v = hsv[..., 0], hsv[..., 1] / 255, hsv[..., 2] / 255
    w = smooth(h, 26, 34) * (1 - smooth(h, 88, 100))      # 绿色范围
    h2 = h - (h - 21) * 0.45 * w                            # 往橙黄色推
    s2 = np.clip(s * (1 + 0.10 * w), 0, 1)
    hsv2 = np.stack([h2, s2 * 255, v * 255], -1).clip(0, 255).astype(np.uint8)
    x = cv2.cvtColor(hsv2, cv2.COLOR_HSV2RGB).astype(np.float32) / 255
    x = np.power(x, 1.28)                                   # 整体压暗，黄昏
    lum = x @ np.array([0.299, 0.587, 0.114], np.float32)
    hi = smooth(lum, 0.25, 0.9)[..., None]
    warm = np.array([1.08, 0.98, 0.84], np.float32)
    cool = np.array([0.92, 0.98, 1.02], np.float32)
    x = x * (cool * (1 - hi) + warm * hi)
    x = x + np.array([0.012, 0.010, 0.004], np.float32) * (1 - hi)
    x = np.clip(x, 0, 1)
    x = 0.5 + (x - 0.5) * 1.18                              # 对比度
    return np.clip(x, 0, 1)

# ---------- 把银色电脑变成深空黑 ----------
def lowsat_mask(img, vlo, vhi, cut=True):
    hsv = cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    s, v = hsv[..., 1] / 255, hsv[..., 2] / 255
    m = (1 - smooth(s, 0.08, 0.22)) * smooth(v, vlo, vhi)
    return m * (1 - smooth(v, 0.74, 0.88)) if cut else m

def laptop_black(img, rect, debug=False, cut=True):
    x0, y0, x1, y1 = rect
    m = np.zeros((H, W), np.float32)
    m[y0:y1, x0:x1] = lowsat_mask(img[y0:y1, x0:x1], 0.24, 0.45, cut)
    m = cv2.GaussianBlur(m, (0, 0), 4)
    if debug:
        return img * 0.4 + np.stack([m, 0 * m, 0 * m], -1) * 0.6
    dark = img * 0.20 + np.array([0.030, 0.031, 0.035], np.float32)
    return img * (1 - m[..., None]) + dark * m[..., None]

def warm_sky(img, frac):
    hh = int(H * frac)
    m = np.zeros((H, W), np.float32)
    m[:hh] = lowsat_mask(img[:hh], 0.30, 0.5, False) * np.linspace(1, 0.5, hh)[:, None]
    m = cv2.GaussianBlur(m, (0, 0), 6)
    sky = np.array([1.0, 0.80, 0.52], np.float32)
    return img * (1 - m[..., None]) + sky * m[..., None]

# ---------- 前景草叶（离镜头很近，强烈虚化，逆光透出金色） ----------
class Grass:
    def __init__(self, corners, seed):
        rng = np.random.default_rng(seed)
        self.blades = []
        for c in corners:
            n = 6
            for i in range(n):
                if c == 'bl': bx, by, dirx = rng.uniform(-0.05, 0.30), 1.08, rng.uniform(-0.25, 0.55)
                elif c == 'br': bx, by, dirx = rng.uniform(0.70, 1.05), 1.08, rng.uniform(-0.55, 0.25)
                else: bx, by, dirx = rng.uniform(-0.08, 0.25), rng.uniform(-0.08, 0.35), rng.uniform(0.3, 0.9)
                length = rng.uniform(0.25, 0.75)
                self.blades.append(dict(
                    bx=bx, by=by, dirx=dirx, len=length, width=rng.uniform(0.03, 0.075),
                    bend=rng.uniform(-0.35, 0.35), phase=rng.uniform(0, 6.28), sp=rng.uniform(0.6, 1.4),
                    lit=rng.uniform(0.15, 0.9), corner=c))
        self.sw, self.sh = W // 4, H // 4

    def render(self, t):
        col = np.zeros((self.sh, self.sw, 3), np.float32)
        alpha = np.zeros((self.sh, self.sw), np.float32)
        for b in self.blades:
            sway = 0.025 * math.sin(t * b['sp'] + b['phase'])
            pts = []
            for k in range(13):
                u = k / 12
                if b['corner'] == 'tl':
                    x = b['bx'] + (b['dirx']) * b['len'] * u + b['bend'] * 0.25 * u * u + sway * u
                    y = b['by'] + 0.35 * b['len'] * u
                else:
                    x = b['bx'] + b['dirx'] * b['len'] * u * 0.6 + b['bend'] * 0.3 * u * u + sway * u * u
                    y = b['by'] - b['len'] * u
                pts.append((x * self.sw, y * self.sh))
            pts = np.array(pts)
            # 叶片是由宽到窄的条带
            left, right = [], []
            for k in range(len(pts)):
                p = pts[k]; q = pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]
                nrm = np.array([-q[1], q[0]]); nrm /= (np.linalg.norm(nrm) + 1e-6)
                wd = b['width'] * self.sw * (1 - k / 13) * 0.5
                left.append(p + nrm * wd); right.append(p - nrm * wd)
            poly = np.array(left + right[::-1], np.int32)
            dark = np.array([0.045, 0.045, 0.02]); gold = np.array([1.0, 0.72, 0.30])
            c = dark * (1 - b['lit']) + gold * b['lit'] * 0.75
            m = np.zeros_like(alpha); cv2.fillPoly(m, [poly], 1.0)
            col = col * (1 - m[..., None]) + c * m[..., None]
            alpha = np.maximum(alpha, m)
        col = cv2.GaussianBlur(col, (0, 0), 4.5); alpha = cv2.GaussianBlur(alpha, (0, 0), 4.5)
        col = col / np.maximum(alpha[..., None], 1e-3)
        col = cv2.resize(col, (W, H), interpolation=cv2.INTER_LINEAR)
        alpha = cv2.resize(alpha, (W, H), interpolation=cv2.INTER_LINEAR) * 0.97
        return col, alpha

# ---------- 浮尘（逆光里的小光斑） ----------
class Dust:
    def __init__(self, seed):
        rng = np.random.default_rng(seed + 100)
        n = 45
        self.p = rng.uniform(0, 1, (n, 2)); self.v = rng.normal(0, 0.006, (n, 2)) + [0.004, -0.003]
        self.r = rng.uniform(1.0, 5, n); self.b = rng.uniform(0.10, 0.35, n); self.ph = rng.uniform(0, 6.28, n)

    def render(self, t, sun):
        sw, sh = W // 2, H // 2
        lay = np.zeros((sh, sw), np.float32)
        for i in range(len(self.r)):
            x = (self.p[i, 0] + self.v[i, 0] * t + 0.01 * math.sin(t * 0.7 + self.ph[i])) % 1
            y = (self.p[i, 1] + self.v[i, 1] * t + 0.01 * math.cos(t * 0.5 + self.ph[i])) % 1
            d = math.hypot(x - sun[0], (y - sun[1]) * 0.6)
            k = max(0.0, 1 - d / 0.9)
            if k <= 0: continue
            cv2.circle(lay, (int(x * sw), int(y * sh)), int(self.r[i]), float(self.b[i] * k), -1, cv2.LINE_AA)
        lay = cv2.GaussianBlur(lay, (0, 0), 1.8)
        return cv2.resize(lay, (W, H))

def sun_layers(img, sun, rays_strength=1.0):
    sw, sh = W // 4, H // 4
    small = cv2.resize(img, (sw, sh), interpolation=cv2.INTER_AREA)
    lum = small @ np.array([0.299, 0.587, 0.114], np.float32)
    yy, xx = np.mgrid[0:sh, 0:sw].astype(np.float32)
    sx, sy = sun[0] * sw, sun[1] * sh
    d = np.sqrt(((xx - sx) / sw) ** 2 + ((yy - sy) / sw) ** 2)
    glow = np.exp(-d * 2.0)                                  # 太阳方向的大面积暖光
    # 光束：亮的背景沿太阳方向径向模糊
    src = np.clip(lum - 0.35, 0, 1) * np.exp(-d * 1.4)
    acc = np.zeros_like(src)
    N = 18
    for i in range(N):
        s = 1 - 0.035 * i
        M = np.float32([[s, 0, sx * (1 - s)], [0, s, sy * (1 - s)]])
        acc += cv2.warpAffine(src, M, (sw, sh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    rays = acc / N
    # 光晕（亮部溢出）
    bright = np.clip(lum - 0.55, 0, 1)
    bloom = cv2.GaussianBlur(bright, (0, 0), 3) * 0.6 + cv2.GaussianBlur(bright, (0, 0), 12) * 0.9
    up = lambda a: cv2.resize(a, (W, H), interpolation=cv2.INTER_LINEAR)
    return up(glow), up(rays) * rays_strength, up(bloom)

def lens(img, t, seed):
    # 手持微晃 + 色散（三个通道不同缩放）
    rng = np.random.default_rng(seed)
    ph = rng.uniform(0, 100, 4)
    dx = 3.0 * math.sin(t * 0.9 + ph[0]) + 1.5 * math.sin(t * 2.3 + ph[1])
    dy = 2.5 * math.sin(t * 0.7 + ph[2]) + 1.2 * math.sin(t * 1.9 + ph[3])
    out = np.empty_like(img)
    for ch, s in enumerate([1.024, 1.022, 1.020]):
        M = np.float32([[s, 0, W / 2 * (1 - s) + dx], [0, s, H / 2 * (1 - s) + dy]])
        out[..., ch] = cv2.warpAffine(img[..., ch], M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    return out

yy_, xx_ = np.mgrid[0:H, 0:W].astype(np.float32)
VIG = 1 - 0.38 * smooth(np.sqrt(((xx_ - W / 2) / (W / 2)) ** 2 + ((yy_ - H / 2) / (H / 2)) ** 2) / 1.35, 0.35, 1.0)

def process(orig, clean, t, cfg, grass, dust):
    img = clean.astype(np.float32) / 255
    if cfg.get('debug'):
        return (laptop_black(img, cfg['lap'], True) * 255).astype(np.uint8)
    img = laptop_black(img, cfg['lap'], cut=cfg.get('cut', True))
    if cfg['sky'] > 0:
        img = warm_sky(img, cfg['sky'])
    img = grade(img)
    glow, rays, bloom = sun_layers(img, cfg['sun'], cfg.get('rays', 1.0))
    gold = np.array([1.0, 0.64, 0.27], np.float32)
    img = img * (0.52 + 0.85 * glow)[..., None]              # 离太阳越远越暗：黄昏的方向光
    light = glow[..., None] ** 2 * gold * 0.6 + rays[..., None] * gold * 1.9 + bloom[..., None] * np.array([1.0, 0.72, 0.42]) * 1.1
    img = 1 - (1 - img) * (1 - np.clip(light, 0, 1))        # 滤色叠加
    lum = img @ np.array([0.299, 0.587, 0.114], np.float32)
    small = cv2.resize(np.clip(lum - 0.22, 0, 1), (W // 4, H // 4), interpolation=cv2.INTER_AREA)
    wrap = cv2.resize(cv2.GaussianBlur(small, (0, 0), 2.0), (W, H)) * (1 - smooth(lum, 0.05, 0.3)) * (0.4 + glow)
    img = img + wrap[..., None] * gold * 0.9
    dl = dust.render(t, cfg['sun'])
    img = img + dl[..., None] * gold
    gc, ga = grass.render(t)
    img = img * (1 - ga[..., None]) + gc * ga[..., None]
    img = img * VIG[..., None]
    img = lens(np.clip(img, 0, 1), t, cfg['seed'])
    # 颗粒
    rng = np.random.default_rng()
    g = rng.normal(0, 1, (H // 2, W // 2)).astype(np.float32)
    g = cv2.resize(g, (W, H), interpolation=cv2.INTER_LINEAR)
    lum = img @ np.array([0.299, 0.587, 0.114], np.float32)
    img = img + (g * 0.028 * (0.6 + 0.8 * lum * (1 - lum) * 4) * 0.5)[..., None]
    img = np.clip(img, 0, 1)
    out = (img * 255).astype(np.float32)
    # 字幕：从原片把白字原样叠回（保留原来的字体和淡入淡出）
    x, y, w, h = CAP['x'], CAP['y'], CAP['w'], CAP['h']
    o = orig[y:y + h, x:x + w].astype(np.float32).mean(-1)
    c = clean[y:y + h, x:x + w].astype(np.float32).mean(-1)
    a = (np.clip((o - c - 35) / np.maximum(255 - c - 35, 20), 0, 1) * (o > 150))[..., None]
    out[y:y + h, x:x + w] = out[y:y + h, x:x + w] * (1 - a) + 250 * a
    if 'inset' in cfg:                                        # 画中画小框用原片
        x, y, w, h = cfg['inset']
        out[y + 6:y + h - 6, x + 6:x + w - 6] = orig[y + 6:y + h - 6, x + 6:x + w - 6]
    return out.clip(0, 255).astype(np.uint8)

def reader(t0, dur, vf):
    cmd = ['ffmpeg', '-v', 'error', '-ss', str(t0), '-t', str(dur), '-i', SRC, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=W * H * 3 * 2)

def run(shot, out, only=None):
    cfg = SHOTS[shot]
    grass, dust = Grass(cfg['grass'], cfg['seed']), Dust(cfg['seed'])
    delogo = 'delogo=x=%d:y=%d:w=%d:h=%d' % (CAP['x'], CAP['y'], CAP['w'], CAP['h'])
    po, pc = reader(cfg['t0'], cfg['dur'], 'null'), reader(cfg['t0'], cfg['dur'], delogo)
    enc = None
    if only is None:
        enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', '30', '-i', '-',
                                '-c:v', 'libx264', '-crf', '17', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', out], stdin=subprocess.PIPE)
    i = 0
    while True:
        a = po.stdout.read(W * H * 3); b = pc.stdout.read(W * H * 3)
        if len(a) < W * H * 3 or len(b) < W * H * 3: break
        orig = np.frombuffer(a, np.uint8).reshape(H, W, 3); clean = np.frombuffer(b, np.uint8).reshape(H, W, 3)
        x, y, w, h = CAP['x'], CAP['y'], CAP['w'], CAP['h']
        if (orig[y:y + h, x:x + w].mean(-1) > 235).sum() < 40:   # 这一帧没有字幕：直接用原片
            clean = orig
        t = i / 30
        if only is None or i in only:
            fr = process(orig, clean, t, cfg, grass, dust)
            if enc: enc.stdin.write(fr.tobytes())
            else: cv2.imwrite(f'{out}_{i:03d}.jpg', cv2.cvtColor(fr, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92])
        i += 1
    if enc:
        enc.stdin.close(); enc.wait()
    print(shot, 'frames', i)

if __name__ == '__main__':
    shot, out = sys.argv[1], sys.argv[2]
    if len(sys.argv) > 4: SHOTS[shot]['debug'] = True
    only = set(map(int, sys.argv[3].split(','))) if len(sys.argv) > 3 else None
    run(shot, out, only)
