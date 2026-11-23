import { createRenderer } from '../../webgl.mjs';

const width = 224, height = 128, pixelsPerUnit = 16;
const backdrop = 0x0a1520;
const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const bevel = n => clamp(n / 2);
const noise = (x, y) => ((Math.imul(x + 13, 311) ^ Math.imul(y + 37, 71)) >>> 2) & 15;
const drawHeight = (sample, strength) => (x, y) => {
  if (sample(x, y) === undefined) return;
  const at = (sx, sy) => sample(sx, sy) ?? 0;
  return [(at(x-1, y)-at(x+1, y))*strength, (at(x, y+1)-at(x, y-1))*strength, 1];
};

function makeRoom() {
  const pack = SpriteSurface.make(256, 256);
  const tile = (w, h, paint, relief, strength = 1) => ({
    w, h, region: pack.reserve(w, h, paint, relief && { normal: drawHeight(relief, strength) })
  });
  const wall = ({w,h,region}, x, y, z = 0) =>
    pack.faceRegion([(x-width/2)/pixelsPerUnit,(124-y-h)/pixelsPerUnit,z],
      [w/pixelsPerUnit,0,0],[0,h/pixelsPerUnit,0],region);

  function brickRelief(x, y) {
    if (x < 0 || x >= 32) x = (x+32)%32;
    if (y < 0 || y >= 16) y = (y+16)%16;
    const u = (x + (y >= 8 ? 8 : 0)) % 16, v = y % 8;
    return bevel(Math.min(u, 16-u, v, 8-v)) * (noise(x,y) === 0 ? .86 : 1);
  }
  const masonry = [0,1,2].map(variant => tile(32, 16, (x, y) => {
    if (!brickRelief(x, y)) return 0x102731;
    const ramp = [0x25414c,0x294854,0x2e4c58,0x32515a,0x35525b];
    return ramp[(variant+(x>15?1:0)+(y>7?1:0)+Number(noise(x,y)<2))%ramp.length];
  }, brickRelief, 1.1));
  for (let row=0; row<8; row++) for (let col=0; col<7; col++)
    wall(masonry[(row*7+col*5)%masonry.length],col*32,row*16);

  function floorRelief(x, y) {
    const u = ((x+16)%16+16)%16, v = ((y+16)%16+16)%16;
    return bevel(Math.min(u,16-u,v,16-v))*(noise(x,y)<2?.86:1);
  }
  const paving = tile(32,16,(x,y) =>
    !floorRelief(x,y)?0x10212a:noise(x,y)<2?0x344956:x<16?0x293c47:0x304550,
    floorRelief,1.2);
  for (let row=0; row<4; row++) for (let col=0; col<7; col++)
    pack.faceRegion([(col*32-width/2)/pixelsPerUnit,0,row], [2,0,0],[0,0,-1],paving.region);

  const pillarRelief = (x,y) => {
    if (x<0||x>=24||y<0||y>=112) return;
    if (y<9||y>=102) return bevel(Math.min(x,23-x,y<9?8-y:y-102))*.83+.23;
    if (x<3||x>20) return .25;
    return (Math.cos((x-4)*Math.PI/4)+1)*.24+.32;
  };
  const pillar = tile(24,112,(x,y) => {
    if (y<9||y>=102) return x===0||x===23||y===8||y===102?0x29424e:0x506269;
    if (x<3||x>20) return 0x27414c;
    return noise(x,y)===0?0x47636b:0x405b64;
  },pillarRelief,1.8);
  for (const x of [39,161]) wall(pillar,x,9,.14);

  function hatchEdge(x,y) {
    const side = Math.abs(x-30.5);
    return y<27 ? 30-Math.hypot(side,y-28) : Math.min(30-side,86-y);
  }
  const rivet = (x,y) => ((x===26||x===35)&&(y===19||y===32||y===64||y===76)) ||
    ((x===8||x===53)&&(y===34||y===57||y===75));
  const hatch = tile(62,87,(x,y) => {
    const edge = hatchEdge(x,y);
    if (edge<0) return;
    if (edge<2||edge>8&&edge<10) return 0x1c303b;
    if (edge<9) return noise(x,y)<=2?0x746452:0x655e55;
    if (rivet(x,y)) return 0xac8759;
    if (x===30||x===31||y===80) return 0x182e36;
    return y>72?0x30434a:noise(x,y)<=2?0x364f55:0x354a52;
  },(x,y) => {
    const edge = hatchEdge(x,y);
    if (edge<0) return;
    if (edge<9) return bevel(Math.min(edge,9-edge))*1.9;
    if (rivet(x,y)) return 1.58;
    if (Math.abs(x-30.5)<1||y===80) return .13;
    return .52 + (y>72?.25:0);
  },1.5);
  wall(hatch,81,27,.09);

  function vent(x,y) {
    if (x<0||x>=26||y<0||y>=40) return;
    const edge = Math.min(x,25-x,y,39-y);
    if (edge<4) return bevel(edge)*1.3;
    if (edge<6) return .15;
    return y%5===0||y%5===1?.13:.81;
  }
  const grille = tile(26,40,(x,y) => {
    const edge = Math.min(x,25-x,y,39-y);
    if (edge<4) return 0x49666e;
    if (edge<6||y%5<2) return 0x16313a;
    return noise(x,y)<2?0x39606a:0x2d4b56;
  },vent,1.8);
  for (const x of [8,190]) wall(grille,x,54,.07);

  function copperDistance(x,y) {
    const horizontal = Math.hypot(x-clamp(x,19,205),y-12);
    const left = Math.hypot(x-19,y-clamp(y,12,42));
    const right = Math.hypot(x-205,y-clamp(y,12,42));
    return Math.min(horizontal,left,right);
  }
  const copper = tile(224,48,(x,y) => {
    const d = copperDistance(x,y);
    if (d>4) return;
    if (d>3.6) return 0x3f413c;
    if ((x%26===0||x%26===1)&&x>24&&x<200||y>=38) return 0x89765a;
    return noise(x,y)<2?0x795543:0x706255;
  },(x,y) => {
    const d = copperDistance(x,y);
    return d<=4 ? Math.sqrt(16-d*d)*.62:undefined;
  },1.8);
  wall(copper,0,1,.25);

  const indicator = tile(16,7,(x,y) => {
    if (x===0||x===15||y===0||y===6) return 0x1b2e35;
    return y>=2&&y<=4&&x>=3&&x<=12&&x%4<2?0x62b8a3:0x42544b;
  });
  wall(indicator,104,42,.29);
  return makeBuilder(24,[backdrop]).finish({
    radius: 17, dither: 0, spriteSurfaces: pack.finish(),
    cam: { target: [0,3.8,0], dist: 16, ortho: true, fov: 2*Math.atan(4/16), pitch: .14, yaw: 0 }
  });
}

const world = makeRoom();
const byId = id => document.getElementById(id);
const canvases = [byId('flat'), byId('mapped')];
const sweep = byId('sweep'), play = byId('play'), lamp = byId('lamp');
const live = KIT.lightEmitters;
const fill = live.disc({
  id: 'cool-fill', at: [-1,5,6], normal: [0,0,-1], size: [2,2],
  intensity: .85, color: '#a2c7dd', radius: 14, shadows: false, visible: false
});
let lampX = Number(sweep.value)/10, lampY = 3.2, playing = false, tick, start;

function render() {
  const sources = [
    fill,
    live.disc({ id:'lantern', at:[lampX,lampY,.94], normal:[0,0,-1], size:[.22,.22],
      intensity: 10, color: '#ffd19a', radius: 6, shadows: false, visible: false }),
    live.disc({ id:'visible-lantern', at:[lampX,lampY,.95], normal:[0,0,1], size:[.24,.24],
      intensity: 1.15, color: '#ffdfac', radius: 1, shadows: false, visible: true })
  ];
  for (let i=0; i<canvases.length; i++) {
    renderers[i].render(world, { width, height, raw: true, changedRows: [],
      areaLights: sources, surfaceNormals: i===1 });
  }
  lamp.textContent = lampX.toFixed(1);
}

function animate(now) {
  start ??= now;
  const phase = (now-start)/1400;
  lampX = Math.sin(phase)*5.45;
  lampY = 3.2 + Math.sin(phase*.63)*1.02;
  sweep.value = String(Math.round(lampX*10));
  render();
  tick = requestAnimationFrame(animate);
}
function setPlaying(active) {
  playing = active;
  cancelAnimationFrame(tick);
  start = undefined;
  play.textContent = active?'Pause sweep':'Play sweep';
  play.setAttribute('aria-pressed',String(active));
  if (active) tick = requestAnimationFrame(animate);
}
function aim(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  lampX = clamp((event.clientX-rect.left)/rect.width*14-7,-6.3,6.3);
  lampY = clamp(7.8-(event.clientY-rect.top)/rect.height*8,.35,7.3);
  sweep.value = String(Math.round(lampX*10));
  render();
}
const renderers = [];
try {
  for (const canvas of canvases) {
    renderers.push(createRenderer(canvas, {
      toolkit: { KIT, PixelLook, SpriteSurface }, contextAttributes: { preserveDrawingBuffer: true }
    }));
    canvas.addEventListener('pointerdown',event => {
      setPlaying(false);
      canvas.setPointerCapture(event.pointerId);
      aim(event);
    });
    canvas.addEventListener('pointermove',event => {
      if (canvas.hasPointerCapture(event.pointerId)) aim(event);
    });
  }
  sweep.addEventListener('input', () => {
    setPlaying(false);
    lampX=Number(sweep.value)/10;
    render();
  });
  play.addEventListener('click',() => setPlaying(!playing));
  render();
  document.body.dataset.ready = 'true';
} catch (error) {
  byId('status').textContent = error.message;
  throw error;
}
