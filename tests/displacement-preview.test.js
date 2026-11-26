const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const Ink = require('..');

const ref = node => ({ node, port: 'value' });
const uniform = (value, descriptor) => ({ op: 'image.uniform', inputs: { width: 4, height: 3, value, descriptor } });
const graph = {
  format: 'ink-studio/graph-project', version: 1, nodes: {
    raw: uniform(.625, { intent: 'data', layout: 'r', precision: 'float32' }),
    height: { op: 'image.toHeight', inputs: { source: ref('raw'), scale: 2, offset: -1.5, units: 'mm' } },
    normal: uniform([.24, -.6, .76], { intent: 'normal', normalSpace: 'tangent', normalOrientation: 'directx' }),
    pigment: uniform([.25, .60, .8, .75], { intent: 'color', layout: 'rgba', alpha: 'straight' }),
    maps: { op: 'data.record', inputs: { height: ref('height'), normal: ref('normal'), baseColor: ref('pigment') } },
    material: { op: 'material.pack', inputs: { maps: ref('maps') } }
  },
  outputs: { height: ref('height'), material: ref('material'), color: ref('pigment') },
  outputUsages: {
    'signed-height': { usage: 'height', label: 'Signed height', order: 0, source: { output: 'height' },
      format: { format: 'json' }, export: false }
  }
};
const plan = {
  format: 'ink-studio/displacement-preview', version: 1, label: 'Displacement fixture',
  source: { output: 'material' },
  cameras: [{ id: 'near', label: 'Near', distance: 4.2, yaw: 45 }],
  settings: { scale: .4, bias: -.5, tessellation: [21, 17], reference: [64, 48], seam: 'fade', repeats: [2, 1] }
};

test('displacement preview packs signed graph height, alpha and the authored tangent convention', async () => {
  const project = Ink.createGraphProject(graph);
  const report = await Ink.createDisplacementPreview(project, plan);
  assert.equal(report.maps.height.min, -.25);
  assert.equal(report.maps.height.max, -.25);
  assert.equal(report.maps.height.units, 'mm');
  const binary = Buffer.from(report.maps.height.data, 'base64');
  assert.equal(binary.length, 4 * 3 * 4);
  assert.equal(binary.readFloatLE(0), -.25);
  assert.equal(binary.readFloatLE(binary.length - 4), -.25);
  assert.equal(Buffer.from(report.maps.baseColor.data, 'base64')[3], 191);
  assert.equal(report.settings.tangent, 'directx');
  const rawNormal = Buffer.from(report.maps.normal.data, 'base64');
  assert(rawNormal[1] < 128, 'the raw DirectX green survives packaging without an implicit flip');
  assert.deepEqual(report.settings.tessellation, [21, 17]);
  assert.deepEqual(report.settings.repeats, [2, 1]);
  assert.equal(report.settings.seam, 'fade');
  const { source, ...settings } = plan;
  const single = await Ink.createDisplacementPreview(project, { ...settings, maps: { height: { map: 'signed-height' } } });
  assert.deepEqual(single.maps.height, report.maps.height);
  assert.equal(single.settings.tangent, 'opengl');
  await assert.rejects(Ink.createDisplacementPreview(project, { ...plan, source: { output: 'color' } }), /typed graph image/);
  await assert.rejects(Ink.createDisplacementPreview(project, { ...plan, settings: { tessellation: [161, 1] } }),
    /tessellation/);
  await assert.rejects(Ink.createDisplacementPreview(project, { ...plan, settings: { scale: 100, bias: 100 } }),
    /40-unit/);
});

test('graph displacement-preview publishes a portable review and protects the plan file', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-displacement-preview-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const source = path.join(folder, 'project.json'), planFile = path.join(folder, 'plan.json'), output = path.join(folder, 'review');
  fs.writeFileSync(source, JSON.stringify(graph));
  fs.writeFileSync(planFile, JSON.stringify(plan));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  const report = JSON.parse(execFileSync(process.execPath, [cli, 'graph', 'displacement-preview', source, planFile,
    '--out', output, '--json'], { encoding: 'utf8' }));
  assert.equal(report.file, path.join(output, 'index.html'));
  assert.deepEqual(report.modes, ['flat', 'parallax', 'relief']);
  assert(!Object.hasOwn(report.maps.height, 'data'));
  for (const file of ['index.html', 'data.js', 'shaders.js', 'renderer.js', 'camera-lens.js', 'textured-surface.js', 'live.js'])
    assert(fs.statSync(path.join(output, file)).size > 50, file);
  const collision = path.join(folder, 'preview.json');
  fs.writeFileSync(collision, JSON.stringify(plan));
  assert.throws(() => execFileSync(process.execPath, [cli, 'graph', 'displacement-preview', source, collision,
    '--out', folder], { stdio: 'pipe' }), /keeps the graph and plan intact/);
  assert.deepEqual(JSON.parse(fs.readFileSync(collision, 'utf8')), plan);
});

test('WebGL ray traces parallax at plane depth and writes displaced triangle depth', {
  skip: !process.env.INK_TEST_CHROME
}, async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-displacement-webgl-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const project = Ink.createGraphProject({ ...graph, nodes: { ...graph.nodes,
    raw: { op: 'image.declare', inputs: {
      source: { width: 4, height: 3, channels: 1, data: [0,.75,.25,1, .125,.625,.625,.875, .5,1,.5,.75] },
      descriptor: { intent: 'data', precision: 'float32' }
    } },
    pigment: { op: 'image.declare', inputs: {
      source: { width: 4, height: 3, channels: 3, data: Array.from({ length: 12 },
        (_, i) => [.08 + .22 * (i % 4), .16 + .28 * Math.floor(i / 4), .41]).flat() },
      descriptor: { intent: 'color', precision: 'float32' }
    } }
  } });
  const filename = path.join(folder, 'plan.json');
  fs.writeFileSync(filename, JSON.stringify({ ...plan, view: { width: 108, height: 84 } }));
  const { file } = await Ink.writeDisplacementPreview(project, filename, { directory: folder });
  fs.writeFileSync(file, `<!doctype html><pre id="result">pending</pre>
<script src="data.js"></script><script src="camera-lens.js"></script><script src="textured-surface.js"></script>
<script src="shaders.js"></script><script src="renderer.js"></script>
<script>
try {
  const plan = displacementPreview, camera = plan.cameras[0], renderer = DisplacementRenderer.create(plan);
  const settings = { ...plan.settings, seam:'clamp', repeats:[2,1] };
  const equal = (a,b) => a.every((n,i)=>n===b[i]);
  const comparison = DisplacementRenderer.compare(renderer,camera,settings,plan.view);
  const {flat,parallax,relief} = comparison.frames;
  const periodic = renderer.render(camera,'relief',{...settings,seam:'repeat'});
  const faded = renderer.render(camera,'relief',{...settings,seam:'fade'});
  const zero = DisplacementRenderer.compare(renderer,camera,{...settings,scale:0},plan.view);
  const proof = {
    flatCoverage:flat.rgba.some((n,i)=>i%4===3&&n),
    planeDepth:equal(flat.depth,parallax.depth),
    mappedColor:!equal(flat.rgba,parallax.rgba),
    displacedDepth:!equal(flat.depth,relief.depth),
    distinctSeams:!equal(relief.depth,periodic.depth)&&!equal(periodic.depth,faded.depth),
    flatAtZero:zero.choice==='flat'&&equal(zero.frames.flat.rgba,zero.frames.parallax.rgba),
    tessellated:relief.triangles===settings.tessellation[0]*settings.tessellation[1]*4
  };
  document.getElementById('result').textContent = encodeURIComponent(JSON.stringify(proof));
} catch (error) {
  document.getElementById('result').textContent = encodeURIComponent(JSON.stringify({error:error.message}));
}
</script>`);
  const html = execFileSync(process.env.INK_TEST_CHROME, ['--headless', '--enable-unsafe-swiftshader',
    '--no-first-run', '--disable-background-networking', '--user-data-dir=' + path.join(folder, 'profile'),
    '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] });
  const output = /<pre id="result">([^<]*)<\/pre>/.exec(html)?.[1];
  assert(output && output !== 'pending', 'WebGL fixture failed to render');
  assert.deepEqual(JSON.parse(decodeURIComponent(output)), {
    flatCoverage: true, planeDepth: true, mappedColor: true, displacedDepth: true,
    distinctSeams: true, flatAtZero: true, tessellated: true
  });
});
