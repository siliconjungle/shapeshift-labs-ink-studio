"""Portable content-addressed texture companions."""
import hashlib
from pathlib import Path


def save_texture(data, name, directory):
    # Read the payload signature independently of asset resolver naming.
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        extension = ".png"
    elif data.startswith(b"\xff\xd8"):
        extension = ".jpg"
    else:
        raise ValueError("Use a PNG or JPEG texture for " + name)
    location = Path(directory) / (hashlib.sha256(data).hexdigest() + extension)
    location.parent.mkdir(parents=True, exist_ok=True)
    if not location.exists():
        location.write_bytes(data)
    return location


def texture_asset(file, root):
    data = Path(file).read_bytes()
    return "./" + save_texture(data, file, root / "textures").relative_to(root).as_posix()
