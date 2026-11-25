const assert = require('node:assert/strict');
const test = require('node:test');
const Ink = require('..');

const kit = Ink.load();
const Material = kit.KIT.procedural.materialChannels;
const link = (node, port = 'value') => ({ node, port });
const scalar = (data, width = data.length) => ({ width, height: data.length / width, channels: 1, data });
const rgba = { width: 1, height: 1, channels: 4, data: [36, 79, 89, 255] };
const maps = {
  baseColor: rgba, normal: { ...rgba, data: [128, 128, 255, 255] },
  height: scalar([-.03125, 2.5]), roughness: scalar([.8, .42]), metalness: scalar([.2]), ao: scalar([.5]),
  emission: { ...rgba, data: [0, 12, 8, 255] }, opacity: scalar([.3, 1]), 'mask.glaze': scalar([1, 0, .75, .25], 2)
};
const metadata = { height: { unit: 'world', texCoord: 0 }, 'mask.glaze': { texCoord: 2, brush: { name: 'Glaze' } } };

test('typed material links carry the complete packet through a group and replace only selected channels', () => {
  const authored = {
    format: 'ink-studio/graph-project', version: 1,
    groups: {
      Polish: {
        inputs: { source: 'materialChannels' },
        nodes: {
          roughness: { op: 'material.channel', inputs: { name: 'roughness', source: { input: 'source' } } },
          lower: { op: 'raster.math', inputs: { a: link('roughness'), b: .5, op: 'multiply' } },
          choose: { op: 'data.record', inputs: { roughness: link('lower') } },
          result: { op: 'material.replace', inputs: { source: { input: 'source' }, maps: link('choose') } }
        },
        outputs: { packet: link('result') }
      }
    },
    nodes: {
      pack: { op: 'material.pack', inputs: { maps, metadata } },
      polish: { op: 'Polish', inputs: { source: link('pack') } },
      cut: { op: 'material.channel', inputs: { name: 'mask.glaze', source: link('polish', 'packet') } }
    },
    outputs: { raw: link('pack'), result: link('polish', 'packet'), mask: link('cut'), maskInfo: link('cut', 'metadata') },
    exports: { packet: { output: 'result', format: 'json' } }
  };
  const graph = Ink.createGraphProject(Ink.openMaterialGraph(authored, { id: 'glaze' }), { kit });
  assert.equal(graph.sockets('polish').inputs.source.type, 'materialChannels');
  assert.equal(graph.plan().outputs.result.type, 'materialChannels');
  const { outputs: { raw, result, mask, maskInfo }, artifacts, report } = graph.run();
  assert.deepEqual(result.channels.roughness.raster.data, new Float64Array([.4, .21]));
  assert.equal(raw.channels.roughness.raster.data[0], .8);
  for (const name of Object.keys(maps).filter(name => name !== 'roughness'))
    assert.strictEqual(result.channels[name], raw.channels[name], name);
  assert.strictEqual(mask, raw.channels['mask.glaze'].raster);
  assert.deepEqual(maskInfo, metadata['mask.glaze']);
  assert.deepEqual(JSON.parse(artifacts[0].bytes).channels.height,
    { raster: maps.height, metadata: metadata.height });
  assert.equal(report.outputs.result.channels['mask.glaze'].width, 2);
  assert.equal(graph.inspect({ output: 'result' }).artifacts[0].format, 'json');
});

test('pack and replace retain map sizes and metadata and reject unrecognized or malformed channels', () => {
  const state = Material.pack(maps, metadata);
  assert(Material.valid(state));
  const polished = Material.replace(state, { height: scalar([-1, 1, 2]), 'mask.trim': scalar([1]) });
  assert.equal(polished.channels.height.raster.width, 3);
  assert.strictEqual(polished.channels.height.metadata, state.channels.height.metadata);
  assert.deepEqual(Material.replace(polished, { height: scalar([-1]) }, { height: { texCoord: 3 } }).channels.height.metadata,
    { texCoord: 3 });
  assert.throws(() => Material.pack({ normal: scalar([0]) }), /component count for normal/);
  assert.throws(() => Material.pack({ roughnes: scalar([0]) }), /component count for roughnes/);
  assert.throws(() => Material.pack({ roughness: scalar([Infinity]) }), /component count for roughness/);
  assert.throws(() => Material.pack({ 'mask.': scalar([0]) }), /component count/);
  assert.throws(() => Material.pack({ height: scalar([0]) }, { ao: {} }), /metadata must identify a supplied map/);
  assert.throws(() => Material.replace(state, { height: scalar([3]) }, { height: 3 }), /Expected metadata for material channel height/);
  assert.throws(() => Material.channel(state, 'mask.missing'), /Missing material channel/);
  assert.throws(() => Material.replace({ ...state, version: 2 }, {}), /version 1 material channel packet/);
  assert.equal(Material.pack({ normal: { width: 1, height: 1, data: new Float32Array([-.4, .3, .85]) } })
    .channels.normal.raster.data.BYTES_PER_ELEMENT, 4);
});

test('type checking distinguishes material packets from records and single rasters', () => {
  const project = (bad, type) => ({
    format: 'ink-studio/graph-project', version: 1,
    inputs: { external: { type } },
    nodes: { pack: { op: 'material.pack', inputs: { maps } }, bad },
    outputs: { value: link('bad') }
  });
  assert.throws(() => Ink.createGraphProject(project({ op: 'raster.rgba', inputs: { source: link('pack') } }, 'record'), { kit }),
    /bad\.source.*provides material channel packet, expected raster/);
  const extract = { op: 'material.channel', inputs: { source: { input: 'external' }, name: 'normal' } };
  assert.throws(() => Ink.createGraphProject(project(extract, 'record'), { kit }),
    /bad\.source.*provides record, expected material channel packet/);
  const graph = Ink.createGraphProject(project(extract, 'materialChannels'), { kit });
  assert.throws(() => graph.run({ inputs: { external: { format: Material.format, version: 2, channels: {} } } }),
    /Wrong input value.*material channel packet/);
  assert.deepEqual(graph.run({ inputs: { external: Material.pack(maps) } }).outputs.value, maps.normal);
});

test('material transport adds no raster buffers to graph memory preflight', () => {
  const graph = Ink.createGraphProject({
    format: 'ink-studio/graph-project', version: 1,
    nodes: {
      pack: { op: 'material.pack', inputs: { maps: { baseColor: rgba } } },
      add: { op: 'material.replace', inputs: { source: link('pack'), maps: { height: maps.height } } },
      extract: { op: 'material.channel', inputs: { source: link('add'), name: 'height' } }
    },
    outputs: { value: link('extract') }
  }, { kit });
  const { complete, initialBytes, peakBytes } = graph.plan(undefined, { memory: true }).memory;
  assert.equal(complete, true);
  assert.equal(peakBytes, initialBytes);
  assert.equal(initialBytes, (rgba.data.length + maps.height.data.length) * 8);
});
