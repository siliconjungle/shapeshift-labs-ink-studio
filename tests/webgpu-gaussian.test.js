const assert = require('node:assert/strict');
const test = require('node:test');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');

test('WebGPU keeps a multi-tile Gaussian order deterministic after offscreen culling', {
  skip: !process.env.INK_TEST_WEBGPU || typeof WebSocket !== 'function', timeout: 25000
}, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-gaussian-gpu-'));
  const browser = path.join(temp, 'profile');
  const filename = path.join(temp, 'fixture.html');
  const url = pathToFileURL(filename).href;
  const moduleURL = pathToFileURL(path.resolve(__dirname, '../webgpu.mjs')).href;
  fs.writeFileSync(filename, `<!doctype html><script type="module">
  import { createGaussianSplatRenderer, decodeGaussianPly, gaussianSplatWorld } from ${JSON.stringify(moduleURL)};
  window.run = (${fixture.toString()})({ createGaussianSplatRenderer, decodeGaussianPly, gaussianSplatWorld });
  </script>`);
  const chrome = spawn(process.env.INK_TEST_WEBGPU, ['--headless', '--no-first-run', '--disable-background-networking',
    '--allow-file-access-from-files', '--enable-unsafe-webgpu', '--remote-debugging-port=0',
    '--user-data-dir=' + browser, url], { stdio: 'ignore' });
  let socket;
  t.after(async () => {
    socket?.close();
    if (chrome.exitCode === null && chrome.signalCode === null) {
      const closing = once(chrome, 'exit');
      chrome.kill();
      await closing;
    }
    fs.rmSync(temp, { force: true, recursive: true });
  });
  const portFile = path.join(browser, 'DevToolsActivePort');
  let page;
  for (let i = 0; i < 120 && !page; i++) {
    if (fs.existsSync(portFile)) {
      const [port] = fs.readFileSync(portFile, 'utf8').split('\n');
      const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list', { signal: t.signal })).json();
      page = pages.find(row => row.url === url);
    }
    if (!page) await delay(30);
  }
  assert(page, 'Chrome did not open the WebGPU fixture');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, 'open', { signal: t.signal });
  const reply = once(socket, 'message', { signal: t.signal });
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
    expression: "(async()=>{while(!window.run) await new Promise(r=>setTimeout(r,20)); return await window.run})()",
    awaitPromise: true, returnByValue: true
  } }));
  const [event] = await reply;
  const response = JSON.parse(event.data);
  assert.equal(response.error, undefined, JSON.stringify(response.error));
  assert.equal(response.result.exceptionDetails, undefined, JSON.stringify(response.result.exceptionDetails));
  const { first, empty, edge, small, repeated, alternate, split, filtered, exact, projected, local, validation } = response.result.result.value;
  assert.equal(validation, null);
  assert.equal(first.profile.visible, 692);
  assert.equal(first.profile.sortCapacity, 1024);
  assert.equal(first.profile.culled, 3);
  assert(first.pixel[2] > 245 && first.pixel[0] < 12 && first.pixel[1] < 12, String(first.pixel));
  assert.equal(first.profile.cloudUpload.bytes, 695 * 64);
  assert.equal(first.profile.cameraUpload.bytes, 96);
  for (const value of Object.values(first.profile.gpuMs ?? {})) assert(value >= 0);
  assert.equal(empty.profile.visible, 0);
  assert.equal(empty.profile.sortCapacity, 0);
  assert.deepEqual(empty.pixel, [10, 20, 30, 255]);
  assert.equal(small.profile.visible, 1);
  assert.equal(small.profile.sortCapacity, 256);
  assert(small.pixel[0] > 245, String(small.pixel));
  assert.equal(edge.profile.visible, 1);
  assert(edge.pixel[0] > 45, String(edge.pixel));
  assert.equal(repeated.profile.visible, 692);
  assert.equal(repeated.profile.cloudUpload.bytes, 0);
  assert.deepEqual(repeated.pixel, first.pixel);
  assert.equal(alternate.profile.visible, 692);
  assert.deepEqual(alternate.pixel, first.pixel);
  assert.deepEqual(split.pixel, first.pixel);
  assert.equal(split.profile.visible, first.profile.visible);
  assert(filtered.pixel[0] > 12 && filtered.pixel[0] < 100, String(filtered.pixel));
  assert.equal(filtered.profile.gaussianFilter.footprint, 'compensated');
  assert(exact.pixel[0] > projected.pixel[0] + 8, JSON.stringify({ exact, projected }));
  assert.equal(exact.profile.visible, 1);
  assert(local.sorted.pixel[0] > local.center.pixel[0]+15, JSON.stringify(local));
  assert(local.sorted.profile.transparencyReport.sortedPixels > 50);
  assert(local.sorted.profile.transparencyReport.culledFragments > 40);
  assert(local.opaque.pixel[1] > 195 && local.opaque.pixel[0] < 40, String(local.opaque.pixel));
  assert(local.over.profile.transparencyReport.layerBudgetPixels > 20);
  assert(local.capped.profile.transparencyReport.pixelBudgetPixels > 100);
  assert(local.capped.profile.transparencyReport.tiles.some(t=>t.pixelBudgetPixels>0));
  assert(local.ray.profile.transparencyReport.sortedPixels > 20);
});

async function fixture({ createGaussianSplatRenderer, decodeGaussianPly, gaussianSplatWorld }) {
  const adapter = await navigator.gpu.requestAdapter();
  const requiredFeatures = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
  const device = await adapter.requestDevice({ requiredFeatures });
  device.pushErrorScope('validation');
  const renderer = await createGaussianSplatRenderer(device);
  const fields = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2',
    'rot_0', 'rot_1', 'rot_2', 'rot_3', 'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
  const red = '1.77 -1.77 -1.77', green = '-1.77 1.77 -1.77', blue = '-1.77 -1.77 1.77';
  const row = (x, z, color, alpha = 8, scale = 0) =>
    `${x} 0 ${z} ${scale} 0 0 1 0 0 0 ${alpha} ${color}`;
  const rows = [row(0, 2, red), ...Array.from({ length: 690 }, (_, i) =>
    row(0, ((i * 109) % 690) / 230 - 1.5, green)), row(0, 2, blue),
    row(-40, 0, red), row(40, 0, red), row(0, 2, green, -16)];
  function world(rows) {
    const ply = ['ply', 'format ascii 1.0', 'element vertex ' + rows.length,
      ...fields.map(name => 'property float ' + name), 'end_header', ...rows].join('\n');
    return gaussianSplatWorld(decodeGaussianPly(ply), { size: 12 });
  }
  const dense = world(rows);
  renderer.setWorld(dense);
  const size = 65, rowBytes = 512;
  const image = device.createTexture({ size: [size, size], format: renderer.format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const readback = device.createBuffer({ size: rowBytes * size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  async function capture(target, ortho = false, x = 32, chunks, patch) {
    const frame = { profile: true, ortho, dist: 4, target, background: [10, 20, 30], ...patch };
    const profile = await (chunks ? renderer.renderChunks(image, dense, chunks, frame) : renderer.render(image, frame));
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: image }, { buffer: readback, bytesPerRow: rowBytes }, [size, size]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const pixel = Array.from(new Uint8Array(readback.getMappedRange(), 32 * rowBytes + x * 4, 4));
    readback.unmap();
    return { profile, pixel };
  }
  const cameraTarget = [0, 0, 0];
  const first = await capture(cameraTarget);
  const empty = await capture([40, 0, 0]);
  const small = await capture([6, 0, 0]);
  const alternate = await capture(cameraTarget, true);
  const repeated = await capture(cameraTarget);
  const front = renderer.uploadChunk(dense.data.slice(0, 400 * 16), { order: 5 });
  const rear = renderer.uploadChunk(dense.data.slice(400 * 16), { order: 9 });
  const split = await capture(cameraTarget, false, 32, [rear, front]);
  front.dispose();
  rear.dispose();
  // The broad red Gaussian has its center just outside this frame.
  renderer.setWorld(world([row(0, 0, red, 8, 1)]));
  const edge = await capture([-1.6, 0, 0], false, 64);
  const subpixel = world([row(0, 0, red)]);
  subpixel.data.set([.0001,0,0,255,.0001,0,.0001],4);
  renderer.setWorld(subpixel);
  const filtered = await capture(cameraTarget,false,32,null,{gaussianFilter:{footprint:'compensated'}});
  subpixel.data.set([.8,.2,0,.55,.251,.021,-.387,255,.104,-.044,.699]);
  renderer.setWorld(subpixel);
  const projected = await capture(cameraTarget,false,13,null,{dist:3.25});
  const exact = await capture(cameraTarget,false,13,null,{dist:3.25,gaussianFilter:{footprint:'compensated',projection:'ray'}});
  const cold = 255 << 16, warm = 255;
  const sheets = world([row(0,0,red),row(0,0,blue),row(0,0,green)]);
  sheets.data.set([0,0,-.03,.84,.34,0,-.31,warm,.20,0,.34],0);
  sheets.data.set([0,0,.04,.86,.34,0,.31,cold,.20,0,.34],16);
  sheets.data.set([.36,0,-.16,0,.11,0,0,0xbca078,.10,0,.015],32);
  renderer.setWorld(sheets);
  const layer = device.createTexture({ size:[size,size],format:'rgba32float',
    usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST });
  const plate = new Float32Array(size*size*4);
  for (let y=27;y<38;y++)for(let x=29;x<36;x++)
    plate.set([.08,.83,.18,1.4],(y*size+x)*4);
  device.queue.writeTexture({texture:layer},plate,{bytesPerRow:size*16},[size,size]);
  const settings = { splatOrder:'selective', opaqueSurface:layer, selectiveTransparency:{layers:2} };
  const center = await capture(cameraTarget,false,25);
  const sorted = await capture(cameraTarget,false,25,null,settings);
  const opaque = await capture(cameraTarget,false,32,null,settings);
  const capped = await capture(cameraTarget,false,25,null,{...settings,selectiveTransparency:{layers:2,maxPixels:4}});
  const ray = await capture(cameraTarget,false,25,null,{...settings,gaussianFilter:{projection:'ray'}});
  sheets.data[35]=.57;
  renderer.setWorld(sheets);
  const over = await capture(cameraTarget,false,45,null,settings);
  layer.destroy();
  const local={center,sorted,opaque,capped,ray,over};
  const error = await device.popErrorScope();
  renderer.dispose();
  readback.destroy();
  image.destroy();
  return { first, empty, edge, small, repeated, alternate, split, filtered, exact, projected, local, validation: error ? error.message : null };
}
