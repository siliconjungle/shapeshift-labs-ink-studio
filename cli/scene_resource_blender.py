"""Explicit Blender conversion for interchange formats outside Ink's native route."""
import sys
from pathlib import Path
import bpy


def done(value, message):
    if "FINISHED" not in value:
        raise RuntimeError(message)


source, target = [Path(name) for name in sys.argv[sys.argv.index("--") + 1:]]
bpy.ops.wm.read_factory_settings(use_empty=True)
incoming = {
    ".obj": lambda: bpy.ops.wm.obj_import(filepath=str(source)),
    ".fbx": lambda: bpy.ops.import_scene.fbx(filepath=str(source), use_anim=False),
    ".ply": lambda: bpy.ops.wm.ply_import(filepath=str(source)),
    ".stl": lambda: bpy.ops.wm.stl_import(filepath=str(source)),
    ".glb": lambda: bpy.ops.import_scene.gltf(filepath=str(source)),
}
outgoing = {
    ".obj": lambda: bpy.ops.wm.obj_export(filepath=str(target), export_materials=True, path_mode="COPY", export_triangulated_mesh=True),
    ".fbx": lambda: bpy.ops.export_scene.fbx(filepath=str(target), object_types={"EMPTY", "MESH"},
                                             path_mode="COPY", embed_textures=True, bake_anim=False),
    ".ply": lambda: bpy.ops.wm.ply_export(filepath=str(target), export_colors="NONE"),
    ".stl": lambda: bpy.ops.wm.stl_export(filepath=str(target)),
    ".glb": lambda: bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB", export_animations=False,
                                              export_yup=True, export_vertex_color="NONE", export_skins=False,
                                              export_morph=False, export_cameras=False, export_lights=False),
}
done(incoming[source.suffix.lower()](), "Blender scene import failed")
if not any(obj.type == "MESH" for obj in bpy.context.scene.objects):
    raise RuntimeError("External file has no mesh objects")
done(outgoing[target.suffix.lower()](), "Blender scene export failed")
