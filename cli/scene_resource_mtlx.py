"""Read and write standard MaterialX surface networks for Ink's PBR subset."""
import math
from pathlib import Path

import MaterialX as mx

from scene_resource_images import save_texture, texture_asset

PORTS = {"base": ("base_color", "color3"), "roughness": ("specular_roughness", "float"),
         "metallic": ("metalness", "float"), "emissive": ("emission_color", "color3"),
         "normal": ("normal", "vector3"), "opacity": ("opacity", "color3")}
WRAP = {"repeat": "periodic", "clamp": "clamp", "mirror": "mirror"}


def document():
    library = mx.createDocument()
    mx.loadLibraries(mx.getDefaultDataLibraryFolders(), mx.getDefaultDataSearchPath(), library)
    doc = mx.createDocument()
    doc.setDataLibrary(library)
    return doc


def validate(doc):
    passed, log = doc.validate()
    if not passed:
        raise ValueError("MaterialX validation failed: " + log.strip())


def value(node, name, typ, v):
    node.addInput(name, typ).setValueString(", ".join(map(str, v)) if isinstance(v, (list, tuple)) else str(v))


def connect(node, name, other):
    node.addInput(name, other.getType()).setConnectedNode(other)


def image(doc, prefix, row, key, root):
    channel = row["channel"]
    typ = "color4" if channel != "rgb" else "vector3" if key == "normal" else "color3"
    uv = doc.addNode("texcoord", prefix + "_uv", "vector2")
    value(uv, "index", "integer", row["uv"])
    tex = doc.addNode("image", prefix + "_image", typ)
    file = tex.addInput("file", "filename")
    file.setValueString(texture_asset(row["file"], root))
    if key in ("base", "emissive"):
        file.setColorSpace("srgb_texture")
    connect(tex, "texcoord", uv)
    value(tex, "uaddressmode", "string", WRAP[row["wrapS"]])
    value(tex, "vaddressmode", "string", WRAP[row["wrapT"]])
    if channel != "rgb":
        split = doc.addNode("extract", prefix + "_channel", "float")
        connect(split, "in", tex)
        value(split, "index", "integer", "rgba".index(channel))
        return split
    if key == "normal":
        normal = doc.addNode("normalmap", prefix + "_tangent", "vector3")
        normal.setNodeDefString("ND_normalmap_float")
        connect(normal, "in", tex)
        return normal
    return tex


def write_materials(materials, destination):
    doc = document()
    file = Path(destination)
    for i, m in enumerate(materials):
        name = "m" + str(i) + "_" + mx.createValidName(m["name"])
        shader = doc.addNode("standard_surface", name + "_surface", "surfaceshader")
        surface = doc.addNode("surfacematerial", name, "material")
        surface.setAttribute("uiname", m["name"])
        surface.setAttribute("ink_alpha_mode", m["alphaMode"])
        surface.setAttribute("ink_alpha_cutoff", str(m["cutoff"]))
        surface.setAttribute("ink_double_sided", "true" if m["doubleSided"] else "false")
        connect(surface, "surfaceshader", shader)
        value(shader, "base", "float", 1)
        value(shader, "emission", "float", 1)
        values = {"base": m["color"][:3], "roughness": m["roughness"], "metallic": m["metallic"],
                  "emissive": m["emission"], "opacity": m["color"][3]}
        for key, row in m["maps"].items():
            if key == "ao":
                ao = image(doc, name + "_ao", row, key, file.parent)
                surface.setAttribute("ink_occlusion", ao.getName())
        for key, (port, typ) in PORTS.items():
            row = m["maps"].get(key)
            if key == "opacity" and m["alphaMode"] == "OPAQUE":
                row = None
            constant = values.get(key)
            if row:
                target = image(doc, name + "_" + key, row, key, file.parent)
                if key not in ("normal",) and constant != ([1, 1, 1] if isinstance(constant, list) else 1):
                    multiply = doc.addNode("multiply", name + "_" + key + "_factor", target.getType())
                    connect(multiply, "in1", target)
                    value(multiply, "in2", target.getType(), constant)
                    target = multiply
                if key == "opacity":
                    converted = doc.addNode("convert", name + "_opacity_rgb", "color3")
                    connect(converted, "in", target)
                    target = converted
                connect(shader, port, target)
            elif constant is not None:
                value(shader, port, typ, [constant] * 3 if key == "opacity" else constant)
    validate(doc)
    mx.writeToXmlFile(doc, str(file))


def read_value(node, name, default):
    port = node.getInput(name)
    if not port:
        return default
    if port.getConnectedNode() or port.getNodeGraphString() or port.getOutputString():
        raise ValueError("Expected a constant MaterialX input for " + name)
    current = port.getValue()
    if current is None:
        return default
    if isinstance(current, (str, bool, float, int)):
        return current
    return list(current)


def read_signal(node, directory, source, deps, key):
    factor = [1, 1, 1] if key in ("base", "emissive") else 1
    if node.getCategory() == "convert" and key == "opacity":
        node = node.getConnectedNode("in")
    if node and node.getCategory() == "multiply":
        factor = read_value(node, "in2", factor)
        node = node.getConnectedNode("in1")
    if node and node.getCategory() == "normalmap" and key == "normal":
        if read_value(node, "scale", 1) != 1:
            raise ValueError("Use unit MaterialX tangent normal gain")
        node = node.getConnectedNode("in")
    channel = "rgb" if key in ("base", "normal", "emissive") else "r"
    if node and node.getCategory() == "extract":
        index = read_value(node, "index", 0)
        if index not in range(4):
            raise ValueError("Invalid MaterialX image component")
        channel = "rgba"[index]
        node = node.getConnectedNode("in")
    if not node or node.getCategory() != "image":
        raise ValueError("Unsupported MaterialX network for " + key)
    uv = node.getConnectedNode("texcoord")
    if uv and uv.getCategory() != "texcoord":
        raise ValueError("Use a MaterialX texcoord node for " + key)
    index = read_value(uv, "index", 0) if uv else 0
    raw = read_value(node, "file", "")
    image_path = (source.parent / raw).resolve()
    if not raw or not image_path.is_file() or not 0 < image_path.stat().st_size <= 32 * 1024 ** 2:
        raise ValueError("Missing or oversized MaterialX texture " + raw)
    deps.add(str(image_path))
    texture = save_texture(image_path.read_bytes(), raw, directory)
    modes = {v: k for k, v in WRAP.items()}
    u, v = read_value(node, "uaddressmode", "periodic"), read_value(node, "vaddressmode", "periodic")
    if u not in modes or v not in modes:
        raise ValueError("Unsupported MaterialX image addressing")
    return {"file": str(texture), "channel": channel, "uv": index, "wrapS": modes[u], "wrapT": modes[v]}, factor


def read_materials(filename, directory):
    file = Path(filename).resolve()
    doc = document()
    options = mx.XmlReadOptions()

    def reject_include(*args):
        raise ValueError("Flatten MaterialX XIncludes before scene interchange")

    options.readXIncludeFunction = reject_include
    mx.readFromXmlFile(doc, str(file), mx.FileSearchPath(), options)
    validate(doc)
    deps = {str(file)}
    rows = []
    for material in doc.getMaterialNodes():
        shader = material.getConnectedNode("surfaceshader")
        if not shader or shader.getCategory() != "standard_surface":
            raise ValueError("Expected a MaterialX standard_surface for " + material.getName())
        for key in ("transmission", "subsurface", "coat", "sheen", "thin_film_thickness", "specular_anisotropy"):
            if read_value(shader, key, 0):
                raise ValueError("Unsupported MaterialX " + key + " lobe")
        defaults = {"base": [.8, .8, .8], "roughness": .2, "metallic": 0, "normal": None, "emissive": [1, 1, 1], "opacity": [1, 1, 1]}
        maps = {}
        for key, (port, _) in PORTS.items():
            node = shader.getConnectedNode(port)
            if node:
                maps[key], defaults[key] = read_signal(node, directory, file, deps, key)
            else:
                defaults[key] = read_value(shader, port, defaults[key])
        ao = doc.getNode(material.getAttribute("ink_occlusion"))
        if ao:
            maps["ao"], factor = read_signal(ao, directory, file, deps, "ao")
            if factor != 1:
                raise ValueError("Unsupported MaterialX occlusion gain")
        opacity = defaults["opacity"]
        if isinstance(opacity, list):
            if not all(n == opacity[0] for n in opacity):
                raise ValueError("Scene opacity needs one grayscale value")
            opacity = opacity[0]
        base = read_value(shader, "base", 1)
        emission = read_value(shader, "emission", 0)
        rows.append({"name": material.getAttribute("uiname") or material.getName(),
                     "color": [*(base * x for x in defaults["base"]), opacity],
                     "roughness": defaults["roughness"], "metallic": defaults["metallic"], "maps": maps,
                     "emission": [emission * x for x in defaults["emissive"]],
                     "alphaMode": material.getAttribute("ink_alpha_mode") or ("BLEND" if opacity < 1 or "opacity" in maps else "OPAQUE"),
                     "cutoff": float(material.getAttribute("ink_alpha_cutoff") or .5),
                     "doubleSided": material.getAttribute("ink_double_sided") == "true"})
    if not rows:
        raise ValueError("MaterialX needs a material with a standard surface")
    return {"materials": rows, "dependencies": sorted(deps)}
