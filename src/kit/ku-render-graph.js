(function (K) {
  K.renderGraph = Object.freeze({
    create: RenderGraph.create,
    prepare: RenderGraph.prepare,
    cube: RenderGraph.cube,
    selection: RenderGraph.selection,
    layer: (node, w, h, world, time, camera) => RenderGraph.layer(node, w, h, world, time, K.poly2.text, camera)
  });
})(KIT);
