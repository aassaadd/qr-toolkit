"""生成扩展图标（纯标准库，无需 Pillow）：蓝色圆角底 + 白色扫描框 + 中心二维码模块。"""
import struct
import zlib
import os
import math

OUT = os.path.dirname(os.path.abspath(__file__))

BLUE_TOP = (86, 141, 255)
BLUE_BOT = (37, 92, 235)
WHITE = (255, 255, 255)
SS = 4  # 每像素超采样数


def in_round_rect(px, py, x0, y0, x1, y1, r):
    if px < x0 or px > x1 or py < y0 or py > y1:
        return False
    cx = min(max(px, x0 + r), x1 - r)
    cy = min(max(py, y0 + r), y1 - r)
    if px >= x0 + r and px <= x1 - r:
        return True
    if py >= y0 + r and py <= y1 - r:
        return True
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def shapes(size):
    """返回该尺寸下的白色图元列表：(x0,y0,x1,y1,radius)"""
    pad = max(1.0, size * 0.145)
    th = max(1.4, size * 0.088)
    arm = max(2.0, size * 0.235)
    r = th / 2.0
    S = float(size)
    inner = S - pad
    out = []

    def L(xo, yo, sx, sy):
        """拐角点 (xo, yo)，向 (sx, sy) 方向（±1）伸展出两条臂"""
        hx0, hx1 = sorted((xo, xo + sx * arm))
        hy0, hy1 = sorted((yo, yo + sy * th))
        out.append((hx0, hy0, hx1, hy1, r))
        vx0, vx1 = sorted((xo, xo + sx * th))
        vy0, vy1 = sorted((yo, yo + sy * arm))
        out.append((vx0, vy0, vx1, vy1, r))

    L(pad, pad, 1, 1)                       # 左上
    L(inner, pad, -1, 1)                    # 右上
    L(pad, inner, 1, -1)                    # 左下
    L(inner, inner, -1, -1)                 # 右下

    # 中心 3x3 模块（挖空正中一格，形似二维码定位图案）
    if size >= 40:
        q = size * 0.078
        gap = size * 0.022
        total = q * 3 + gap * 2
        x0 = (S - total) / 2.0
        y0 = x0
        kr = max(0.6, q * 0.18)
        for row in range(3):
            for col in range(3):
                if row == 1 and col == 1:
                    continue
                bx = x0 + col * (q + gap)
                by = y0 + row * (q + gap)
                out.append((bx, by, bx + q, by + q, kr))
    return out


def render(size):
    fig = shapes(size)
    rows = []
    for y in range(size):
        row = bytearray()
        row.append(0)  # PNG filter type 0
        t = y / max(1, size - 1)
        br = int(BLUE_TOP[0] + (BLUE_BOT[0] - BLUE_TOP[0]) * t)
        bg = int(BLUE_TOP[1] + (BLUE_BOT[1] - BLUE_TOP[1]) * t)
        bb = int(BLUE_TOP[2] + (BLUE_BOT[2] - BLUE_TOP[2]) * t)
        for x in range(size):
            base = 0
            white = 0
            for sy in range(SS):
                py = y + (sy + 0.5) / SS
                for sx in range(SS):
                    px = x + (sx + 0.5) / SS
                    # 圆角遮罩
                    rad = max(1.5, size * 0.225)
                    if not in_round_rect(px, py, 0.0, 0.0, float(size), float(size), rad):
                        continue
                    base += 1
                    for (x0, y0, x1, y1, r) in fig:
                        if in_round_rect(px, py, x0, y0, x1, y1, r):
                            white += 1
                            break
            total = SS * SS
            a = int(255 * base / total)
            if a == 0:
                row += bytes((0, 0, 0, 0))
                continue
            if white:
                cov = white / total
                cr = int(br + (255 - br) * cov)
                cg = int(bg + (255 - bg) * cov)
                cb = int(bb + (255 - bb) * cov)
                row += bytes((cr, cg, cb, a))
            else:
                row += bytes((br, bg, bb, a))
        rows.append(bytes(row))
    return b''.join(rows)


def write_png(path, size, raw):
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    with open(path, 'wb') as fp:
        fp.write(b'\x89PNG\r\n\x1a\n')
        fp.write(chunk(b'IHDR', ihdr))
        fp.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        fp.write(chunk(b'IEND', b''))


for size in (16, 48, 128):
    out = os.path.join(OUT, 'icon%d.png' % size)
    write_png(out, size, render(size))
    print('written', out, os.path.getsize(out), 'bytes')
