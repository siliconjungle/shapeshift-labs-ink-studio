"""Translate static scene resources through the OpenUSD schema APIs."""
import hashlib
import json
import math
import re
from pathlib import Path

from pxr import Ar, Gf, Sdf, Tf, Usd, UsdGeom, UsdShade, UsdUtils, Vt

from scene_resource_images import save_texture, texture_asset

T = Sdf.ValueTypeNames
IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
PORTS = {
    "base": ("diffuseColor", T.Color3f), "normal": ("normal", T.Normal3f),
    "emissive": ("emissiveColor", T.Color3f), "roughness": ("roughness", T.Float),
    "metallic": ("metallic", T.Float), "ao": ("occlusion", T.Float), "opacity": ("opacity", T.Float),
}
UV = re.compile(r"^st([0-9]*)$")


def asset_bytes(name):
    reader = Ar.GetResolver().OpenAsset(Ar.ResolvedPath(name))
    if reader is None:
        raise ValueError("Unresolved texture " + name)
    size = reader.GetSize()
    if not 0 < size <= 32 * 1024 ** 2:
        raise ValueError("USD texture exceeds its byte budget")
    return bytes(reader.GetBuffer())


def triples(values, width):
    return [values[i:i + width] for i in range(0, len(values), width)]


def label(prim):
    return prim.GetDisplayName() or prim.GetName()


def uv_name(index):
    return "st" + (str(index) if index else "")


def make_id(name, prefix, index):
    return prefix + str(index) + "_" + Tf.MakeValidIdentifier(name)


def vector_scale(channel, value):
    values = [1, 1, 1, 1]
    if channel == "rgb":
        values[:3] = value
    else:
        values["rgba".index(channel)] = value
    return tuple(values)


def write_material(stage, path, source, root):
    material = UsdShade.Material.Define(stage, path)
    prim = material.GetPrim()
    prim.SetDisplayName(source["name"])
    prim.SetCustomDataByKey("inkAlphaMode", source["alphaMode"])
    prim.SetCustomDataByKey("inkAlphaCutoff", source["cutoff"])
    prim.SetCustomDataByKey("inkOpacityFactor", source["color"][3])
    prim.SetCustomDataByKey("inkDoubleSided", source.get("doubleSided", False))
    shader = UsdShade.Shader.Define(stage, path.AppendChild("Preview"))
    shader.CreateIdAttr("UsdPreviewSurface")
    shader.CreateOutput("surface", T.Token)
    material.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), "surface")
    values = {"base": tuple(source["color"][:3]), "opacity": source["color"][3],
              "emissive": tuple(source["emission"]), "roughness": source["roughness"],
              "metallic": source["metallic"], "ao": 1.0}
    if source["alphaMode"] == "OPAQUE":
        values["opacity"] = 1.0
    if source["alphaMode"] == "MASK":
        shader.CreateInput("opacityThreshold", T.Float).Set(source["cutoff"])
    for key, value in values.items():
        port, kind = PORTS[key]
        shader.CreateInput(port, kind).Set(value)
    readers = {}
    for key, row in source["maps"].items():
        if key == "opacity" and source["alphaMode"] == "OPAQUE":
            continue
        port, kind = PORTS[key]
        uv = row["uv"]
        if uv not in readers:
            reader = UsdShade.Shader.Define(stage, path.AppendChild("UV" + str(uv)))
            reader.CreateIdAttr("UsdPrimvarReader_float2")
            reader.CreateInput("varname", T.String).Set(uv_name(uv))
            readers[uv] = reader.CreateOutput("result", T.Float2)
        tex = UsdShade.Shader.Define(stage, path.AppendChild("Image_" + key))
        tex.CreateIdAttr("UsdUVTexture")
        tex.CreateInput("file", T.Asset).Set(Sdf.AssetPath(texture_asset(row["file"], root)))
        tex.CreateInput("sourceColorSpace", T.Token).Set("sRGB" if key in ("base", "emissive") else "raw")
        tex.CreateInput("st", T.Float2).ConnectToSource(readers[uv])
        for axis in ("S", "T"):
            tex.CreateInput("wrap" + axis, T.Token).Set(row["wrap" + axis])
        channel = row["channel"]
        if key == "normal":
            tex.CreateInput("scale", T.Float4).Set((2, 2, 2, 1))
            tex.CreateInput("bias", T.Float4).Set((-1, -1, -1, 0))
        else:
            tex.CreateInput("scale", T.Float4).Set(vector_scale(channel, values[key]))
        output = tex.CreateOutput(channel, T.Float3 if channel == "rgb" else T.Float)
        shader.CreateInput(port, kind).ConnectToSource(output)
    return material


def normal_for(points, triangle):
    a, b, c = [Gf.Vec3f(*points[i]) for i in triangle]
    n = Gf.Cross(b - a, c - a)
    return tuple(n.GetNormalized()) if n.GetLength() else (0, 0, 1)


def write_mesh(stage, path, source, materials, material_rows, mesh_id):
    mesh = UsdGeom.Mesh.Define(stage, path)
    prim = mesh.GetPrim()
    prim.SetDisplayName(source["name"])
    prim.SetCustomDataByKey("inkGeometry", mesh_id)
    mesh.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
    mesh.CreateDoubleSidedAttr(any(p["material"] is not None and material_rows[p["material"]]["doubleSided"]
                                    for p in source["parts"]))
    api = UsdShade.MaterialBindingAPI.Apply(prim)
    subsets = len(source["parts"]) > 1
    points, indices, normals = [], [], []
    sets = sorted({int(s) for p in source["parts"] for s in p["uv"]})
    charts = {i: [] for i in sets}
    supplied_normals = any("normal" in p for p in source["parts"])
    for part_index, part in enumerate(source["parts"]):
        vertices = triples(part["position"], 3)
        corners = part["indices"]
        start = len(indices) // 3
        indices.extend(len(points) + i for i in corners)
        points.extend(vertices)
        for s in sets:
            uv = part["uv"].get(str(s))
            charts[s].extend((uv[i * 2], 1 - uv[i * 2 + 1]) if uv is not None else (0, 0) for i in corners)
        if supplied_normals:
            ns = triples(part.get("normal", []), 3)
            if ns:
                normals.extend(ns[i] for i in corners)
            else:
                for tri in triples(corners, 3):
                    normals.extend([normal_for(vertices, tri)] * 3)
        material = part["material"]
        if subsets:
            subset = api.CreateMaterialBindSubset("Group_" + str(part_index), list(range(start, len(indices) // 3)))
            subset.GetPrim().SetCustomDataByKey("inkUvSets", Vt.IntArray([int(s) for s in part["uv"]]))
            subset.GetPrim().SetCustomDataByKey("inkHasNormals", "normal" in part)
            if material is not None:
                UsdShade.MaterialBindingAPI.Apply(subset.GetPrim()).Bind(materials[material])
        elif material is not None:
            api.Bind(materials[material])
    mesh.CreatePointsAttr(Vt.Vec3fArray(points))
    mesh.CreateFaceVertexIndicesAttr(Vt.IntArray(indices))
    mesh.CreateFaceVertexCountsAttr(Vt.IntArray([3] * (len(indices) // 3)))
    lo = [min(p[c] for p in points) for c in range(3)]
    hi = [max(p[c] for p in points) for c in range(3)]
    mesh.CreateExtentAttr(Vt.Vec3fArray([lo, hi]))
    if normals:
        mesh.CreateNormalsAttr(Vt.Vec3fArray(normals))
        mesh.SetNormalsInterpolation(UsdGeom.Tokens.faceVarying)
    for s, values in charts.items():
        chart = UsdGeom.PrimvarsAPI(prim).CreatePrimvar(uv_name(s), T.TexCoord2fArray, UsdGeom.Tokens.faceVarying)
        chart.Set(Vt.Vec2fArray(values))
    if subsets:
        api.SetMaterialBindSubsetsFamilyType(UsdGeom.Tokens.partition)


def write_scene(scene, destination):
    target = Path(destination)
    package = target.suffix.lower() == ".usdz"
    location = target.with_suffix(".usdc") if package else target
    stage = Usd.Stage.CreateNew(str(location))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
    UsdGeom.SetStageMetersPerUnit(stage, 1)
    root = UsdGeom.Xform.Define(stage, "/Scene").GetPrim()
    root.SetDisplayName(scene["name"])
    root.SetCustomDataByKey("inkSceneRoot", True)
    stage.SetDefaultPrim(root)
    looks = UsdGeom.Scope.Define(stage, "/Scene/Looks").GetPath()
    materials = []
    for i, row in enumerate(scene["materials"]):
        material = write_material(stage, looks.AppendChild(make_id(row["name"], "M", i)), row, target.parent)
        material.GetPrim().SetCustomDataByKey("inkMaterialIndex", i)
        materials.append(material)
    paths = []
    for i, node in enumerate(scene["nodes"]):
        parent = root.GetPath() if node["parent"] is None else paths[node["parent"]]
        at = parent.AppendChild(make_id(node["name"], "N", i))
        paths.append(at)
        xf = UsdGeom.Xform.Define(stage, at)
        xf.GetPrim().SetDisplayName(node["name"])
        xf.GetPrim().SetCustomDataByKey("inkSceneNode", True)
        xf.MakeMatrixXform().Set(Gf.Matrix4d(*node["matrix"]))
        mesh = node["mesh"]
        if mesh is not None:
            write_mesh(stage, at.AppendChild("Geometry"), scene["meshes"][mesh], materials, scene["materials"], mesh)
    stage.GetRootLayer().Save()
    if package:
        if not UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(str(location)), str(target)):
            raise ValueError("Unable to package the OpenUSD stage")


def read_map(port, key, directory, deps):
    connected = port.GetConnectedSource()
    if connected is None:
        return None, port.Get()
    api, lane, _ = connected
    shader = UsdShade.Shader(api.GetPrim())
    if shader.GetIdAttr().Get() != "UsdUVTexture" or lane not in ("rgb", "r", "g", "b", "a"):
        raise ValueError("Unsupported USD shader source for " + key)
    asset = shader.GetInput("file").Get()
    resolved = asset.resolvedPath if asset is not None else ""
    if not resolved:
        raise ValueError("Missing USD texture for " + key)
    deps.add(resolved.split("[", 1)[0])
    texture = save_texture(asset_bytes(resolved), str(asset), directory)
    connection = shader.GetInput("st").GetConnectedSource()
    index = 0
    if connection:
        lookup = UsdShade.Shader(connection[0].GetPrim())
        if lookup.GetIdAttr().Get() != "UsdPrimvarReader_float2":
            raise ValueError("Use a standard USD float2 primvar reader for " + key)
        match = UV.fullmatch(str(lookup.GetInput("varname").Get()))
        if not match:
            raise ValueError("Use st, st1, … USD UV primvars")
        index = int(match[1] or 0)
    value = shader.GetInput("scale").Get() or (1, 1, 1, 1)
    bias = shader.GetInput("bias").Get() or (0, 0, 0, 0)
    expected_space = "sRGB" if key in ("base", "emissive") else "raw"
    space = shader.GetInput("sourceColorSpace").Get() or "auto"
    if space not in (expected_space, "auto"):
        raise ValueError("Incompatible USD texture color space for " + key)
    if key == "normal":
        if list(value) != [2, 2, 2, 1] or list(bias) != [-1, -1, -1, 0]:
            raise ValueError("Expected the standard USD tangent normal scale and bias")
    elif any(bias):
        raise ValueError("USD UV texture bias is unsupported for " + key)
    wraps = {}
    for axis in ("S", "T"):
        mode = shader.GetInput("wrap" + axis).Get() or "repeat"
        wraps["wrap" + axis] = "repeat" if mode == "useMetadata" else mode
    if any(mode not in ("repeat", "clamp", "mirror") for mode in wraps.values()):
        raise ValueError("Unsupported USD texture wrapping")
    weight = list(value[:3]) if lane == "rgb" else value["rgba".index(lane)]
    return {"file": str(texture), "uv": index, "channel": str(lane), **wraps}, weight


def read_material(material, directory, deps, double_sided):
    prim = material.GetPrim()
    shader, _, _ = material.ComputeSurfaceSource()
    if not shader or shader.GetIdAttr().Get() != "UsdPreviewSurface":
        raise ValueError("Bind a UsdPreviewSurface material for " + str(prim.GetPath()))
    rejected = ("clearcoat", "displacement", "useSpecularWorkflow")
    for port in rejected:
        attr = shader.GetInput(port)
        if attr and (attr.HasConnectedSource() or attr.Get()):
            raise ValueError("Unsupported UsdPreviewSurface input " + port)
    defaults = {"base": [.18, .18, .18], "normal": None, "opacity": 1,
                "emissive": [0, 0, 0], "roughness": .5, "metallic": 0, "ao": 1}
    maps = {}
    for key, (port, _) in PORTS.items():
        signal = shader.GetInput(port)
        if not signal:
            continue
        image, value = read_map(signal, key, directory, deps)
        if image:
            maps[key] = image
        if value is not None:
            defaults[key] = value
    if defaults["ao"] != 1:
        raise ValueError("USD occlusion multiplier is outside the glTF material subset")
    threshold = shader.GetInput("opacityThreshold").Get() or 0
    alpha = prim.GetCustomDataByKey("inkAlphaMode") or ("MASK" if threshold else
             "BLEND" if "opacity" in maps or defaults["opacity"] < 1 else "OPAQUE")
    opacity = prim.GetCustomDataByKey("inkOpacityFactor") if alpha == "OPAQUE" and prim.HasCustomDataKey("inkOpacityFactor") else defaults["opacity"]
    cutoff = prim.GetCustomDataByKey("inkAlphaCutoff") if alpha != "MASK" and prim.HasCustomDataKey("inkAlphaCutoff") else threshold if alpha == "MASK" else .5
    return {"name": label(prim), "color": [*defaults["base"], opacity],
            "roughness": defaults["roughness"], "metallic": defaults["metallic"], "emission": list(defaults["emissive"]),
            "alphaMode": alpha, "cutoff": cutoff,
            "doubleSided": prim.GetCustomDataByKey("inkDoubleSided") if prim.HasCustomDataKey("inkDoubleSided") else double_sided,
            "maps": maps}


def polygon_triangles(vertices, corners):
    if len(corners) == 3:
        return [(0, 1, 2)]
    a = [Gf.Vec3d(*vertices[i]) for i in corners]
    n = Gf.Vec3d(0)
    for i, point in enumerate(a):
        n += Gf.Cross(point, a[(i + 1) % len(a)])
    axis = max(range(3), key=lambda i: abs(n[i]))
    a = [(p[(axis + 1) % 3], p[(axis + 2) % 3]) for p in a]
    direction = 1 if n[axis] > 0 else -1

    def edge(i, j, k):
        x, y = a[i]
        u, v = a[j]
        s, t = a[k]
        return direction * ((u - x) * (t - y) - (v - y) * (s - x))

    triangles = []
    left = list(range(len(a)))
    while len(left) > 3:
        for q, j in enumerate(left):
            i, k = left[q - 1], left[(q + 1) % len(left)]
            if edge(i, j, k) <= 1e-14:
                continue
            if any(min(edge(i, j, l), edge(j, k, l), edge(k, i, l)) >= -1e-14
                   for l in left if l not in (i, j, k)):
                continue
            triangles.append((i, j, k))
            left.pop(q)
            break
        else:
            raise ValueError("USD polygon is degenerate or self-intersecting")
    return triangles + [tuple(left)]


def lane(values, mode, face, point, corner, size):
    i = {"constant": 0, "uniform": face, "varying": point, "vertex": point, "faceVarying": corner}.get(mode)
    if i is None or i >= len(values) or len(values[i]) != size:
        raise ValueError("USD primvar interpolation does not match the mesh")
    value = list(values[i])
    if not all(math.isfinite(v) for v in value):
        raise ValueError("Non-finite USD primvar")
    return value


def read_mesh(mesh, material_id):
    prim = mesh.GetPrim()
    if mesh.GetSubdivisionSchemeAttr().Get() != UsdGeom.Tokens.none or mesh.GetHoleIndicesAttr().Get():
        raise ValueError("Scene resources need polygonal USD meshes without subdivision or hole faces")
    attrs = [mesh.GetPointsAttr(), mesh.GetFaceVertexCountsAttr(), mesh.GetFaceVertexIndicesAttr()]
    if any(a.GetNumTimeSamples() for a in attrs):
        raise ValueError("Animated USD mesh geometry requires an external bake")
    points, counts, indices = [a.Get() for a in attrs]
    if points is None or counts is None or indices is None or not len(counts) or sum(counts) != len(indices) or (
        len(indices) > 1_500_000 or max(counts) > 256 or min(counts) < 3 or min(indices) < 0 or max(indices) >= len(points)
    ):
        raise ValueError("Invalid USD polygon topology or scene budget")
    if any(not all(math.isfinite(n) for n in point) for point in points):
        raise ValueError("Non-finite USD vertices")
    reverse = mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded
    doubles = mesh.GetDoubleSidedAttr().Get()
    charts = {}
    api = UsdGeom.PrimvarsAPI(prim)
    for chart in api.FindPrimvarsWithInheritance():
        set_name = str(chart.GetPrimvarName())
        match = UV.fullmatch(set_name)
        if match:
            flat = chart.ComputeFlattened()
            if flat is None:
                raise ValueError("Invalid USD indexed UV primvar")
            charts[int(match[1] or 0)] = (flat, str(chart.GetInterpolation()))
        elif chart.GetTypeName() in (T.TexCoord2fArray, T.TexCoord2dArray):
            raise ValueError("Rename USD UV primvars to st, st1, … for scene interchange")
    normals_pv = api.FindPrimvarWithInheritance("normals")
    normals = normals_pv.ComputeFlattened() if normals_pv else mesh.GetNormalsAttr().Get()
    normal_mode = normals_pv.GetInterpolation() if normals_pv else mesh.GetNormalsInterpolation()

    bind = UsdShade.MaterialBindingAPI(prim)
    base = bind.ComputeBoundMaterial()[0]
    groups, covered = [], set()
    for subset in bind.GetMaterialBindSubsets():
        mine = list(subset.GetIndicesAttr().Get() or [])
        if any(f < 0 or f >= len(counts) or f in covered for f in mine) or len(set(mine)) != len(mine):
            raise ValueError("USD material subsets overlap or reference invalid faces")
        covered.update(mine)
        if mine:
            row = subset.GetPrim()
            groups.append((mine, UsdShade.MaterialBindingAPI(row).ComputeBoundMaterial()[0] or base,
                           row.GetCustomDataByKey("inkUvSets"), row.GetCustomDataByKey("inkHasNormals")))
    remainder = [i for i in range(len(counts)) if i not in covered]
    if remainder:
        groups.append((remainder, base, None, None))
    offsets, offset = [], 0
    for count in counts:
        offsets.append(offset)
        offset += count
    parts = []
    for faces, material, allowed, has_normals in groups:
        used = charts.keys() if allowed is None else [i for i in allowed if i in charts]
        part = {"position": [], "indices": [], "uv": {str(i): [] for i in used},
                "material": material_id(material, doubles) if material else None}
        if normals and has_normals is not False:
            part["normal"] = []
        unique = {}
        for f in faces:
            start = offsets[f]
            corners = list(indices[start:start + counts[f]])
            for tri in polygon_triangles(points, corners):
                for k in (tri[::-1] if reverse else tri):
                    vertex = corners[k]
                    uv = [lane(*charts[i], f, vertex, start + k, 2) for i in used]
                    n = lane(normals, normal_mode, f, vertex, start + k, 3) if "normal" in part else []
                    key = (vertex, tuple(n), tuple(tuple(q) for q in uv))
                    if key not in unique:
                        unique[key] = len(unique)
                        part["position"].extend(points[vertex])
                        if n:
                            part["normal"].extend(n)
                        for values, i in zip(uv, used):
                            part["uv"][str(i)].extend([values[0], 1 - values[1]])
                    part["indices"].append(unique[key])
        parts.append(part)
    return {"name": label(prim), "parts": parts}


def read_scene(filename, directory):
    stage = Usd.Stage.Open(filename)
    if stage is None:
        raise ValueError("Could not open the USD stage")
    _, resources, missing = UsdUtils.ComputeAllDependencies(Sdf.AssetPath(filename))
    if missing:
        raise ValueError("Unresolved USD scene dependencies: " + ", ".join(str(p) for p in missing))
    deps = {str(Path(filename).resolve())}
    deps.update(str(p).split("[", 1)[0] for p in resources)
    deps.update(layer.realPath.split("[", 1)[0] for layer in stage.GetUsedLayers() if layer.realPath)
    active = [prim for prim in stage.Traverse() if prim.IsA(UsdGeom.Mesh)]
    if not active or len(active) > 2048:
        raise ValueError("Expected 1–2048 static USD polygon meshes")
    if any(prim.IsInstance() or prim.IsA(UsdGeom.PointInstancer) for prim in stage.Traverse()):
        raise ValueError("Expand authored USD instances before static scene interchange")
    authored = [prim for prim in stage.Traverse() if prim.IsA(UsdGeom.Xform) and prim.GetCustomDataByKey("inkSceneNode")]
    included = {str(p) for mesh in active + authored for p in mesh.GetPath().GetPrefixes()}
    root = stage.GetDefaultPrim()
    skip_root = root and root.GetCustomDataByKey("inkSceneRoot") is True
    materials, ids, nodes, meshes, walk, reused = [], {}, [], [], {}, {}

    def material_id(material, double_sided):
        key = (str(material.GetPath()), double_sided if not material.GetPrim().HasCustomDataKey("inkDoubleSided") else None)
        if key not in ids:
            ids[key] = len(materials)
            materials.append(read_material(material, directory, deps, double_sided))
        return ids[key]

    if skip_root:
        tagged = [p for p in stage.Traverse() if p.IsA(UsdShade.Material) and p.HasCustomDataKey("inkMaterialIndex")]
        for prim in sorted(tagged, key=lambda p: p.GetCustomDataByKey("inkMaterialIndex")):
            material_id(UsdShade.Material(prim), False)
    unit = UsdGeom.GetStageMetersPerUnit(stage)
    axis = str(UsdGeom.GetStageUpAxis(stage))
    if not math.isfinite(unit) or not 0 < unit <= 1e6:
        raise ValueError("Invalid USD stage units")
    change = Gf.Matrix4d(unit, 0, 0, 0, 0, unit, 0, 0, 0, 0, unit, 0, 0, 0, 0, 1)
    if axis == "Z":
        change = Gf.Matrix4d(unit, 0, 0, 0, 0, 0, -unit, 0, 0, unit, 0, 0, 0, 0, 0, 1)
    for prim in stage.Traverse():
        key = str(prim.GetPath())
        if key not in included or skip_root and prim == root:
            continue
        xform = UsdGeom.Xformable(prim)
        if xform and (xform.TransformMightBeTimeVarying() or xform.GetResetXformStack()):
            raise ValueError("USD animation or reset xform stacks require an explicit external bake")
        matrix = xform.GetLocalTransformation() if xform else Gf.Matrix4d(1)
        parent = walk.get(str(prim.GetParent().GetPath()))
        mesh_id = None
        if prim.IsA(UsdGeom.Mesh):
            mesh = read_mesh(UsdGeom.Mesh(prim), material_id)
            generated = prim.GetCustomDataByKey("inkGeometry")
            dedup = (generated, hashlib.sha256(json.dumps(mesh).encode()).hexdigest()) if generated is not None else None
            mesh_id = reused.get(dedup)
            if mesh_id is None:
                mesh_id = len(meshes)
                meshes.append(mesh)
                if dedup is not None:
                    reused[dedup] = mesh_id
            if generated is not None and parent is not None and matrix == Gf.Matrix4d(1) and not prim.GetChildrenNames():
                nodes[parent]["mesh"] = mesh_id
                continue
            # GeomSubsets have no transform and are never included in the node tree.
            if generated is not None and parent is not None and matrix == Gf.Matrix4d(1) and all(c.IsA(UsdGeom.Subset) for c in prim.GetChildren()):
                nodes[parent]["mesh"] = mesh_id
                continue
        if parent is None:
            matrix = matrix * change
        walk[key] = len(nodes)
        nodes.append({"name": label(prim), "parent": parent, "matrix": [matrix[i][j] for i in range(4) for j in range(4)],
                      "mesh": mesh_id})
    return {"name": label(root) if root else Path(filename).stem, "nodes": nodes, "materials": materials, "meshes": meshes,
            "sourceSpace": {"upAxis": axis, "metersPerUnit": unit}, "dependencies": sorted(deps)}
