// A service doorway in one static, illuminated field. The camera changes in the review script.
module.exports = kit => ({
  id: 'stochastic-aperture',
  name: 'Aperture Works · Stochastic Fog',
  seed: 29,
  build(seed) {
    const world = require('./aperture-works.js')(kit).build(seed);
    const K = kit.KIT;
    delete world.stage;
    const field = K.procedural.density.bounded({
      bounds: { min: [-3.3, 0, -2.91], max: [3.3, 3.06, -.04] },
      sample: (x, y, z) => .32 + .14 * Math.sin(4.7*y + 2.9*z) * (.5 + .5*Math.cos(1.8*x)**2) +
        .055 * Math.sin(10.2*y + 5.4*z - 2.7*x)
    });
    world.atmosphere = [
      K.atmosphere.field({ field, density: 2.25, step: .034, color: '#709ea9', anisotropy: .12 })
    ];
    world.volumeLighting = {
      ambient: .19,
      shadow: world.volumeLighting.shadow,
      spots: [
        { at: [-1.14, 2.67, -1.78], direction: [1, -.66, .35], innerAngle: 8, outerAngle: 15,
          radius: 5.5, color: '#a1f1ff', intensity: 8 },
        { at: [1.58, 1.88, -2.28], direction: [-1, -.30, .58], innerAngle: 7, outerAngle: 13,
          radius: 4.6, color: '#ffd18a', intensity: 6.4 }
      ],
      points: [{ at: [.60, .67, -2.58], color: '#efab69', radius: 2, intensity: 1.1 }]
    };
    world.volumeQuality = { composition: 'depth', steps: 112 };
    return world;
  }
});
