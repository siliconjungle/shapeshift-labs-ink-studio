(function (K) {
  K.frameComposite = Object.freeze({
    prepare: FrameComposite.prepare,
    layers: (plan, world, time, camera) => FrameComposite.layers(plan, world, time, K.poly2.text, camera, K.annotations.anchor)
  });
})(KIT);
