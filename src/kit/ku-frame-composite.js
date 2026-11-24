(function (K) {
  K.cameraAtlas = CameraAtlas;
  K.renderOutputs = RenderOutputs;
  K.frameComposite = Object.freeze({
    prepare: FrameComposite.prepare,
    layers: (plan, world, time, camera, gl, sceneTime, drawLighting) => FrameComposite.layers(plan, world, time, K.poly2.text, camera,
      (spec,ctx) => K.annotations.anchor(spec,{ ...ctx,sceneTime }), gl, K.directionDrawing.extract, sceneTime, drawLighting)
  });
})(KIT);
