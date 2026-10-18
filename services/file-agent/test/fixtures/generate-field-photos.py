"""Synthetic codec/orientation fixtures; requires Pillow and pillow-heif only to regenerate."""
from pathlib import Path
from PIL import Image, ImageDraw
from pillow_heif import register_heif_opener

register_heif_opener()
root = Path(__file__).parent / "field-photo"
root.mkdir(exist_ok=True)
image = Image.new("RGB", (640, 480), "#f4f7ff")
draw = ImageDraw.Draw(image)
for y in range(0, 480, 40):
    for x in range(0, 640, 40):
        draw.rectangle((x, y, x + 39, y + 39), fill=(40 + x % 190, 50 + y % 180, 150))
draw.rectangle((100, 180, 540, 280), fill="white")
draw.text((130, 210), "SYNTHETIC TEST - KM 123456", fill="black", font_size=23)
image.save(root / "synthetic.heic", quality=90)
image.save(root / "synthetic.avif", quality=90)
small = Image.new("RGB", (160, 100), "#3971dd")
ImageDraw.Draw(small).rectangle((0, 0, 60, 40), fill="red")
exif = Image.Exif()
exif[274] = 6
small.save(root / "orientation-6.jpg", quality=95, exif=exif)
