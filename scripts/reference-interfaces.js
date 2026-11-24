function interfaces(studio, toolkit) {
  const { KIT, makeBuilder, makeSculpt } = toolkit;
  const builder = makeBuilder(1);
  const sculpt = makeSculpt(builder);
  const pixelDocument = {
    format: 'ink-studio/pixel-art', version: 2, width: 1, height: 1, pixelAspect: [1, 1],
    palette: { ink: '#112233' }, layers: [{ id: 'art' }],
    frames: [{ id: 'start', durationMs: 100, cels: { art: { marks: [] } } }]
  };
  const graphDocument = {
    format: 'ink-studio/graph-project', version: 1,
    nodes: { source: { op: 'add', inputs: { a: 0, b: 0 } } },
    outputs: { value: { node: 'source' } }
  };
  return [
    { name: 'toolkit.makeBuilder()', value: builder, guide: 'README.md#first-sculpted-scene' },
    { name: 'toolkit.makeSculpt()', value: sculpt, guide: 'README.md#geometry-and-materials' },
    { name: 'KIT.sculpt()', value: KIT.sculpt(makeSculpt(makeBuilder(1))), guide: 'README.md#geometry-and-materials' },
    { name: 'KIT.stage()', value: KIT.stage(builder.finish()), guide: 'README.md#animation-and-puppets' },
    { name: 'node.createPixelEditor()', value: studio.createPixelEditor(pixelDocument), guide: 'docs/pixel-art-authoring.md' },
    { name: 'node.createSceneEditor()', value: studio.createSceneEditor({ id: 'reference', solids: [] }), guide: 'docs/scene-editor.md' },
    { name: 'node.createGraphProject()', value: studio.createGraphProject(graphDocument, { kit: toolkit }), guide: 'docs/headless-authoring.md' },
    { name: 'node.createGraphHost()', value: studio.createGraphHost(), guide: 'docs/headless-authoring.md' },
    { name: 'node.createMotionalCoverageHistory()', value: studio.createMotionalCoverageHistory(), guide: 'docs/art-passes.md' },
    { name: 'node.createSurfaceHistory()', value: studio.createSurfaceHistory(), guide: 'docs/art-passes.md' }
  ].map(entry => ({ ...entry, instance: true }));
}

module.exports = { interfaces };
