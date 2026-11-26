import json
import sys
from pathlib import Path


def main(mode, source, destination):
    if mode == "read-usd":
        from scene_resource_usd import read_scene
        return read_scene(source, destination)
    if mode == "read-materialx":
        from scene_resource_mtlx import read_materials
        return read_materials(source, destination)
    scene = json.loads(Path(source).read_text())
    if mode == "write-usd":
        from scene_resource_usd import write_scene
        write_scene(scene, destination)
    elif mode == "write-materialx":
        from scene_resource_mtlx import write_materials
        write_materials(scene["materials"], destination)
    else:
        raise ValueError("Unknown scene resource operation")
    return {"file": destination}


if __name__ == "__main__":
    try:
        print(json.dumps(main(*sys.argv[1:]), allow_nan=False))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
