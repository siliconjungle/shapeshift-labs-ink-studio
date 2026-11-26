"""Render the source and reopened files in the same Blender studio."""
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector

root = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
for label, source in [("source", "meridian-source.glb"), ("reopened", "meridian-reopened.glb")]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(root / source))
    scene = bpy.context.scene
    world = bpy.data.worlds.new("Studio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.08, .12, .16, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = .27
    scene.world = world
    ground = bpy.data.materials.new("Indigo slate")
    ground.diffuse_color = (.038, .066, .083, 1)
    ground.use_nodes = True
    shader = ground.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = ground.diffuse_color
    shader.inputs["Roughness"].default_value = .47
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.01))
    bpy.context.object.data.materials.append(ground)

    def aim(object, at):
        object.rotation_euler = (Vector(at) - object.location).to_track_quat("-Z", "Y").to_euler()

    bpy.ops.object.camera_add(location=(3.6, -7.65, 3.0))
    camera=bpy.context.object
    camera.data.lens = 61
    aim(camera, (0, 0, 1.10))
    scene.camera = camera

    def light(name, position, color, watts, size, at):
        data = bpy.data.lights.new(name, "AREA")
        data.color, data.energy, data.shape, data.size = color, watts, "DISK", size
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = position
        aim(obj, at)

    light("Warm softbox", (-3.2, -4.0, 5.4), (1, .80, .62), 980, 3.4, (0, 0, 1))
    light("Cool edge", (1.8, 2.25, 4.2), (.53, .81, 1), 1480, 2.4, (0, 0, .95))
    light("Glass fill", (4.3, -2.2, 2.1), (.67, .93, 1), 310, 2.8, (0, 0, 1))
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 20
    scene.cycles.seed = 52
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 760, 500
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(root / (label + ".png"))
    bpy.ops.render.render(write_still=True)
