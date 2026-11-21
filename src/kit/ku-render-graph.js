(function (K) {
  K.renderGraph = Object.freeze({
    create: RenderGraph.create,
    effects: RenderGraph.effects,
    resources: RenderGraph.resources,
    ownerGroups: RenderGraph.ownerGroups,
    prepare: RenderGraph.prepare,
    cube: RenderGraph.cube,
    selection: RenderGraph.selection,
    history: RenderGraph.history,
    motionRaster: RenderGraph.motionRaster,
    replay: RenderGraph.replay,
    feedbackMotion: RenderGraph.feedbackMotion,
    rowTable: RenderGraph.rowTable,
    scheduleTable: RenderGraph.scheduleTable,
    indexedSchedule: RenderGraph.indexedSchedule,
    layer: (node, w, h, world, time, camera, gl, sceneTime, inputs) =>
      RenderGraph.layer(
        node,
        w,
        h,
        world,
        time,
        K.poly2.text,
        camera,
        (spec, ctx) => K.annotations.anchor(spec, { ...ctx, sceneTime }),
        gl,
        inputs,
        K.procedural.raster
      )
  });
})(KIT);
