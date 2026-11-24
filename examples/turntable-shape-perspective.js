// A lantern framed by an opaque workshop rack in three approved production views.
const lantern = require('./turntable-shape-lantern.js');

module.exports = function perspectiveLantern(kit) {
  const { KIT: K } = kit, recipe = lantern(kit);
  function box(id, [x, y, z], [a, b, c], color) {
    return K.sceneMeshes.create({ id, positions: [
      x - a, y - b, z - c, x + a, y - b, z - c, x + a, y + b, z - c, x - a, y + b, z - c,
      x - a, y - b, z + c, x + a, y - b, z + c, x + a, y + b, z + c, x - a, y + b, z + c
    ], indices: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 4, 7, 0, 7, 3,
      1, 2, 6, 1, 6, 5, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], materials: [{ id, color }] });
  }
  function build() {
    const world = recipe.build();
    world.cam = { ...world.cam, ortho: false };
    world.meshes = [
      box('rack-post', [1.19, 1.90, .92], [.105, 1.84, .10], 0x487377),
      box('rack-socket', [1.19, 2.52, .92], [.148, .19, .144], 0x6d9491),
      box('rack-stop', [1.19, 3.62, .92], [.16, .13, .15], 0x6e9394),
      box('rack-hem', [1.19, 1.46, 1.03], [.07, .08, .016], 0xc18c62)
    ];
    return world;
  }

  function withShape(shape) {
    const world = build(), plan = K.turntableShape.proxy(shape);
    const mesh = K.voxelSurface.toMesh(plan, {
      color: '#e5a95b', ambient: .48, shadeSteps: 4, light: [-.5, .8, .55]
    });
    world.meshes.push(K.sceneMeshes.create({ id: 'brass-handle', objectId: 'lantern-handle',
      positions: mesh.pos, indices: mesh.tri, uvs: new Float32Array(mesh.pos.length / 3 * 2),
      faceMaterials: mesh.tmat, materials: mesh.mats.map(({ rgb }, i) => ({
        id: 'cast-brass-' + i, color: rgb.reduce((value, n) => value * 256 + Math.round(n * 255), 0)
      })) }));
    return world;
  }

  return { ...recipe, id: 'turntable-shape-perspective', name: 'Workshop lantern', seed: 421, build, withShape };
};
