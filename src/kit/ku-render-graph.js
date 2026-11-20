(function (K) {
  K.renderGraph = Object.freeze({
    create: RenderGraph.create,
    prepare: RenderGraph.prepare,
    cube: RenderGraph.cube,
    selection: RenderGraph.selection,
    history: RenderGraph.history,
    replay: RenderGraph.replay,
    feedbackMotion: RenderGraph.feedbackMotion,
    layer: (node, w, h, world, time, camera, gl) => RenderGraph.layer(node, w, h, world, time, K.poly2.text, camera, K.annotations.anchor, gl)
  });
})(KIT);
