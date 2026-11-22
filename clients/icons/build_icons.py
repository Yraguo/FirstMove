#!/usr/bin/env python3
"""从 source.png 生成各平台的应用图标。

原始图标是「酒红圆角方块 + 白底」的 RGB 图，圆角外面是不透明白色，
所以在深色背景、安装界面、任务栏上都会露出白角。这里按平台规范重画：
圆角外面改成透明，并按 Apple / Windows / Android 各自的留白与圆角比例裁剪。

用法：python3 clients/icons/build_icons.py
产物：
  clients/desktop/icon.png      macOS（1024，内容 824，圆角 185，符合 Apple 网格）
  clients/desktop/icon-win.png  Windows（1024，内容 944，圆角 176）
  clients/icons/app-512.png     Android 启动图标（512，圆角 112）
"""

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "source.png"
DESKTOP = HERE.parent / "desktop"


def content_box(image):
    """找出非白区域的边界，也就是原来那个圆角方块的位置。"""
    rgb = image.convert("RGB")
    width, height = rgb.size
    px = rgb.load()
    left, top, right, bottom = width, height, 0, 0
    for y in range(0, height, 2):
        for x in range(0, width, 2):
            r, g, b = px[x, y]
            if r > 245 and g > 245 and b > 245:
                continue
            left = min(left, x)
            right = max(right, x)
            top = min(top, y)
            bottom = max(bottom, y)
    return left, top, right + 1, bottom + 1


def render(source, size, content, radius, destination):
    """content 为内容边长，radius 为圆角半径，均相对 size 计算。"""
    logo = source.crop(content_box(source)).convert("RGBA")
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    box = (size - content) // 2
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (box, box, box + content - 1, box + content - 1), radius=radius, fill=255
    )
    # 圆角区域先铺一层底色，避免放大时的插值亮边露出来
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    base.paste(Image.new("RGBA", (size, size), (75, 15, 31, 255)), (0, 0), mask)
    # 放大用 BICUBIC，LANCZOS 在高对比边缘会产生白边
    filter_ = Image.LANCZOS if content < logo.width else Image.BICUBIC
    scaled = logo.resize((content, content), filter_)
    base.paste(scaled, (box, box), mask.crop((box, box, box + content, box + content)))
    base.save(destination, optimize=True)
    print(f"{destination.name}: {size}px, 内容 {content}px, 圆角 {radius}px")


def main():
    source = Image.open(SOURCE)
    # macOS：Apple 图标网格，内容占 1024 的 80.5%，圆角为内容边长的 22.5%
    render(source, 1024, 824, round(824 * 0.225), DESKTOP / "icon.png")
    # Windows：留白更少，圆角略小
    render(source, 1024, 944, round(944 * 0.187), DESKTOP / "icon-win.png")
    # Android：启动图标，圆角约 22%
    render(source, 512, 512, round(512 * 0.22), HERE / "app-512.png")


if __name__ == "__main__":
    main()
