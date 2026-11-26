"""Validate and exchange bounded surface graphs with the official MaterialX library."""
import json
from pathlib import Path
import sys

import MaterialX as mx

from scene_resource_mtlx import document, value, connect


SHADERS = {"open_pbr_surface", "standard_surface"}
MAX_XML = 8 * 1024 ** 2


class SignalError(Exception):
    pass


def primitive(port):
    v = port.getValue()
    if v is None:
        return None
    if isinstance(v, (str, bool, int, float)):
        return v
    if isinstance(v, mx.FilePath):
        return str(v)
    return list(v)


def binding(port):
    """Resolve graph output and interface links, retaining the selected multi-output lane."""
    output = port.getConnectedOutput()
    if output and output.getConnectedNode():
        return output.getConnectedNode(), output.getOutputString()
    return port.getConnectedNode(), port.getOutputString()


class Reader:
    def __init__(self, filename):
        self.file = Path(filename).resolve()
        self.doc = mx.createDocument()
        options = mx.XmlReadOptions()

        def reject(*_args):
            raise ValueError("Flatten MaterialX XIncludes before interchange")

        options.readXIncludeFunction = reject
        if not self.file.is_file() or not 0 < self.file.stat().st_size <= MAX_XML:
            raise ValueError("Choose a regular MaterialX document of at most 8 MiB")
        mx.readFromXmlFile(self.doc, str(self.file), mx.FileSearchPath(), options)
        self.doc.setDataLibrary(document().getDataLibrary())
        if sum(1 for _ in self.doc.traverseTree()) > 18000:
            raise ValueError("MaterialX document exceeds the node budget")
        self.visits = 0

    def port(self, port, active):
        if port.getInterfaceName():
            target = port.getInterfaceInput()
            if not target or target.getNamePath() in active:
                raise SignalError("The interface input is unbound or cyclic at " + port.getNamePath())
            return self.port(target, (*active, target.getNamePath()))
        node, output = binding(port)
        if node:
            signal = self.node(node, output, active)
            if port.getUnit():
                signal = {**signal, "unit": port.getUnit()}
            return signal
        if port.getNodeName() or port.hasNodeGraphString() or port.hasOutputString():
            raise SignalError("The connection does not resolve at " + port.getNamePath())
        return {"kind": "constant", "type": port.getType(), "value": primitive(port),
                "colorSpace": port.getActiveColorSpace(), "unit": port.getUnit(),
                "path": port.getNamePath()}

    def input(self, node, name, default, active):
        port = node.getInput(name)
        return self.port(port, active) if port else default

    def literal(self, node, name, default, active):
        result = self.input(node, name, None, active)
        if result is None:
            return default
        if result["kind"] != "constant":
            raise SignalError("Expected a uniform " + name + " on " + node.getNamePath())
        return result["value"]

    def allowed(self, node, inputs):
        extra = sorted(item.getName() for item in node.getInputs() if item.getName() not in inputs)
        if extra:
            raise SignalError("Unsupported inputs on " + node.getNamePath() + ": " + ", ".join(extra))

    def node(self, node, output, active):
        name, category = node.getNamePath(), node.getCategory()
        self.visits += 1
        if name in active or len(active) > 24 or self.visits > 12000:
            raise SignalError("Signal exceeds the graph depth, cycle or expansion budget")
        active = (*active, name)
        signal = {"type": node.getType(), "path": name, "colorSpace": node.getActiveColorSpace()}
        default_output = output in ("", "out")
        if category == "constant" and default_output:
            self.allowed(node, {"value"})
            stored = self.input(node, "value", None, active)
            if not stored or stored["kind"] != "constant":
                raise SignalError("Constant node has no uniform value at " + name)
            return stored
        if category == "image" and default_output:
            self.allowed(node, {"file", "texcoord", "uaddressmode", "vaddressmode", "filtertype",
                                "default", "layer", "framerange", "frameoffset", "frameendaction"})
            if (self.literal(node, "layer", "", active) or self.literal(node, "framerange", "", active) or
                    self.literal(node, "frameoffset", 0, active) or self.literal(node, "frameendaction", "constant", active) != "constant"):
                raise SignalError("Texture layers and animation need a baked still at " + name)
            fil = node.getInput("file")
            raw = self.literal(node, "file", None, active)
            if not isinstance(raw, str) or not raw or "<" in raw or "://" in raw:
                raise SignalError("Use a linked image filename without UDIMs, sequences or URLs at " + name)
            prefix = fil.getActiveFilePrefix()
            target = (self.file.parent / (prefix + raw)).resolve()
            uv = node.getInput("texcoord")
            uv_index = 0
            if uv:
                uv_node, uv_output = binding(uv)
                if not uv_node or uv_node.getCategory() != "texcoord" or uv_output not in ("", "out"):
                    raise SignalError("Texture coordinate transformations require baking at " + name)
                self.allowed(uv_node, {"index"})
                uv_index = self.literal(uv_node, "index", 0, active)
            return {**signal, "kind": "image", "file": str(target),
                    "sourceFile": prefix + raw, "colorSpace": fil.getActiveColorSpace(),
                    "uv": uv_index, "u": self.literal(node, "uaddressmode", "periodic", active),
                    "v": self.literal(node, "vaddressmode", "periodic", active),
                    "filter": self.literal(node, "filtertype", "linear", active)}
        if (category == "extract" and default_output) or category in {"separate2", "separate3", "separate4"}:
            self.allowed(node, {"in", "index"} if category == "extract" else {"in"})
            index = self.literal(node, "index", 0, active) if category == "extract" else {
                "outx": 0, "outy": 1, "outz": 2, "outw": 3,
                "outr": 0, "outg": 1, "outb": 2, "outa": 3
            }.get(output, -1)
            return {**signal, "kind": "extract", "type": "float", "index": index,
                    "in": self.input(node, "in", None, active)}
        if category == "multiply" and default_output:
            self.allowed(node, {"in1", "in2"})
            return {**signal, "kind": "multiply", "a": self.input(node, "in1", None, active),
                    "b": self.input(node, "in2", None, active)}
        if category == "normalmap" and default_output:
            self.allowed(node, {"in", "scale"})
            return {**signal, "kind": "normalmap", "scale": self.literal(node, "scale", 1, active),
                    "in": self.input(node, "in", None, active)}
        if category == "convert" and default_output:
            self.allowed(node, {"in"})
            return {**signal, "kind": "convert", "in": self.input(node, "in", None, active)}
        raise SignalError("Unsupported MaterialX node " + category + " at " + name)

    def material(self, label, shader, material):
        path = material.getNamePath() if material else shader.getNamePath()
        attrs = [key for key in (material.getAttributeNames() if material else [])
                 if key not in ("type", "uiname")]
        slots = [p.getName() for p in material.getInputs() if p.getName() != "surfaceshader"] if material else []
        result = {"name": label, "path": path, "category": shader.getCategory() if shader else None,
                  "unsupportedSlots": slots, "attributes": attrs}
        if not shader or shader.getCategory() not in SHADERS:
            return result
        definition = shader.getNodeDef()
        authored = {port.getName(): port for port in shader.getInputs()}
        baseline = {port.getName(): port for port in definition.getActiveInputs()} if definition else {}
        outputs = {}
        for key in dict.fromkeys([*baseline, *authored]):
            port = authored.get(key)
            default = baseline.get(key)
            try:
                if port is None or port.getValue() is None and not (
                    port.getNodeName() or port.hasNodeGraphString() or port.hasOutputString() or port.getInterfaceName()
                ):
                    sig = None if not default else {"kind": "constant", "type": default.getType(),
                        "value": primitive(default), "colorSpace": "", "unit": default.getUnit(),
                        "path": shader.getNamePath() + "/" + key}
                else:
                    sig = self.port(port, ())
                outputs[key] = {"authored": port is not None, "signal": sig}
            except SignalError as error:
                outputs[key] = {"authored": True, "error": str(error), "path": port.getNamePath()}
        return {**result, "shader": shader.getNamePath(), "definition": definition.getName() if definition else None,
                "definitionVersion": definition.getVersionString() if definition else None, "inputs": outputs}

    def read(self):
        valid, log = self.doc.validate()
        report = {"version": mx.getVersionString(), "valid": valid, "validation": log.splitlines(),
                  "materials": [], "other": []}
        if not valid:
            return report
        materials = self.doc.getMaterialNodes()
        if len(materials) > 128:
            raise ValueError("MaterialX interchange supports at most 128 materials per document")
        if materials:
            for item in materials:
                shader, _ = binding(item.getInput("surfaceshader")) if item.getInput("surfaceshader") else (None, "")
                report["materials"].append(self.material(item.getAttribute("uiname") or item.getName(), shader, item))
        else:
            for shader in self.doc.getNodes():
                if shader.getType() == "surfaceshader":
                    report["materials"].append(self.material(shader.getName(), shader, None))
        if not report["materials"]:
            report["other"].append({"path": "/", "reason": "No material or top-level surface shader was found"})
        for child in self.doc.getChildren():
            if child.getCategory() in {"look", "lookgroup", "collection", "geominfo", "variantset", "propertyset"}:
                report["other"].append({"path": child.getNamePath(),
                                        "reason": "Scene assignment or variant is outside an editable material"})
        return report


def write(source, output):
    data = json.loads(Path(source).read_text())
    doc = document()
    doc.setColorSpace("lin_rec709")
    name = mx.createValidName(data["id"])
    shader = doc.addNode("open_pbr_surface", name + "_surface", "surfaceshader")
    definition = doc.getMatchingNodeDefs("open_pbr_surface")
    if not definition:
        raise ValueError("OpenPBR Surface requires the MaterialX 1.39 standard library")
    chosen = shader.getNodeDef()
    if chosen and chosen.getVersionString():
        shader.setVersionString(chosen.getVersionString())
    material = doc.addNode("surfacematerial", name, "material")
    material.setAttribute("uiname", data["label"])
    connect(material, "surfaceshader", shader)
    graph = doc.addNodeGraph("NG_" + name) if data["maps"] else None
    for key, item in data["uniforms"].items():
        if key not in data["maps"]:
            value(shader, key, item["type"], str(item["value"]).lower() if item["type"] == "boolean" else item["value"])
    for key, row in data["maps"].items():
        typ = row["type"]
        image = graph.addNode("image", "tex_" + key, typ)
        fil = image.addInput("file", "filename")
        fil.setValueString(row["file"])
        if typ == "color3":
            fil.setColorSpace("lin_rec709")
        value(image, "uaddressmode", "string", row["u"])
        value(image, "vaddressmode", "string", row["v"])
        value(image, "filtertype", "string", row["filter"])
        node = image
        if row["normal"]:
            node = graph.addNode("normalmap", "tangent_" + key, "vector3")
            node.setNodeDefString("ND_normalmap_float")
            connect(node, "in", image)
        port = graph.addOutput("out_" + key, typ)
        port.setConnectedNode(node)
        shader.addInput(key, typ).setConnectedOutput(port)
    valid, log = doc.validate()
    if not valid:
        return {"version": mx.getVersionString(), "valid": False, "validation": log.splitlines()}
    mx.writeToXmlFile(doc, output)
    return Reader(output).read()


if __name__ == "__main__":
    try:
        result = Reader(sys.argv[2]).read() if sys.argv[1] == "read" else write(sys.argv[2], sys.argv[3])
        print(json.dumps(result, allow_nan=False))
    except (ValueError, RuntimeError, OSError, TypeError) as error:
        sys.exit(str(error))
