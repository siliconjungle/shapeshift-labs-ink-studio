(function (K) {
  K.cameraAtlas = CameraAtlas;
  K.frameComposite = Object.freeze({
    prepare: FrameComposite.prepare,
    layers: (plan, world, time, camera, gl) => FrameComposite.layers(plan, world, time, K.poly2.text, camera, K.annotations.anchor, gl)
  });
})(KIT);
