'use strict';

const path = require('node:path');
const files = require('./asset-files.js');
const staging = require('../src/camera-staging.js');
const axes = ['origin','right','up'];
const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function coordinates(value, count, flag) {
  const parts = typeof value === 'string' ? value.split(',').map(part=>part.trim()) : [];
  const values = parts.map(Number);
  if (parts.length !== count || !parts.every(part=>number.test(part)) || !values.every(Number.isFinite))
    throw new TypeError(flag+' needs '+count+' comma-separated finite numbers');
  return values;
}

function command(file, extra, options, toolkit, openEditor) {
  const cameraFlags = ['yaw','pitch','at','camera-shot'];
  const edgeFlags = ['edge-object','edge','edge-from','edge-at','tilt','reference-up'];
  const switches = ['from-camera','detach-edge'];
  const allowed = [...axes,'grid','out','lock',...switches,...cameraFlags,...edgeFlags];
  const name = value=>typeof value === 'string' && value.trim();
  const {grid,out,'from-camera':fromCamera,'detach-edge':detach} = options;
  const lock = typeof options.lock === 'string' ? options.lock.toLowerCase() : options.lock;
  const cameraPick = fromCamera === true || lock !== undefined && lock !== 'off' ||
    cameraFlags.some(key=>options[key] !== undefined);
  const edgePick = edgeFlags.some(key=>options[key] !== undefined);
  const scalarFlags = ['grid','yaw','pitch','at','edge-at','tilt'];
  if (!name(file) || extra.length || Object.entries(options).some(([key,value])=>!allowed.includes(key) ||
        (switches.includes(key) ? value !== true : !name(value))) ||
      scalarFlags.some(key=>options[key] !== undefined && (!number.test(options[key]) || !Number.isFinite(Number(options[key])))) ||
      lock !== undefined && !['x','y','z','off'].includes(lock) ||
      cameraPick && ['right','up'].some(key=>options[key] !== undefined) ||
      edgePick && (cameraPick || detach || lock !== undefined || axes.some(key=>options[key] !== undefined)))
    throw new TypeError('Use mesh-topology plane <scene.json> with an explicit frame, --from-camera, or --edge-object ID --edge ID --tilt DEGREES');
  const input = path.resolve(file), output = out && path.resolve(out);
  if (output && (!/\.json$/i.test(output) || output === input || path.dirname(output) !== path.dirname(input)))
    throw new RangeError('Write a separate scene JSON file beside its source');
  const changes = Object.fromEntries(axes.filter(axis=>options[axis] !== undefined)
    .map(axis=>[axis,coordinates(options[axis],3,'--'+axis)]));
  if (grid !== undefined) changes.grid = Number(grid);
  if (lock === 'off' && !cameraPick) changes.lock = null;
  const editor = openEditor(input), scene = editor.snapshot(), plane = toolkit.KIT.authoring.constructionPlane;
  let before;
  try {
    before = editor.constructionPlane();
  } catch (error) {
    if (error.code !== 'construction-edge-unavailable' || !(detach || edgePick)) throw error;
    before = plane.resolve(scene.constructionPlane).plane;
  }
  if (detach) changes.edgeAnchor = null;
  if (before.edgeAnchor && !detach && axes.some(key=>options[key] !== undefined))
    throw new RangeError('Detach the edge anchor before editing the explicit frame');

  let picked;
  if (edgePick) {
    const {edge,'edge-object':object,'edge-from':from,'edge-at':at,tilt,'reference-up':up} = options;
    picked = plane.tilt(scene,{object,edge,from,
      ...(at !== undefined && {at:Number(at)}),...(tilt !== undefined && {degrees:Number(tilt)}),
      ...(up !== undefined && {referenceUp:coordinates(up,3,'--reference-up')}),...changes});
  } else if (cameraPick) {
    const {yaw,pitch,at,'camera-shot':cameraShot} = options, t = Number(at ?? 0);
    const world = editor.build({time:t});
    const view = {t,lockCamera:true,...(cameraShot && {cameraShot}),
      ...(yaw !== undefined && {yaw:Number(yaw)}),...(pitch !== undefined && {pitch:Number(pitch)})};
    const {pose} = toolkit.CameraLens.frame(world,view,1,1,{orbit:staging.prepare(world.look?.cameraStaging)?.orbit});
    picked = plane.pick({...before,...changes},pose,{lock:lock === 'off' ? null : lock});
  }
  const {plane:after,axes:basis} = picked ?? plane.resolve({...before,...changes});
  if (output) {
    editor.setConstructionPlane({...after,lock:after.lock ?? null,edgeAnchor:after.edgeAnchor ?? null});
    files.publishJson(output,editor.snapshot(),'A different scene already exists at '+output);
  }
  const camera = cameraPick && {axis:picked.axis,kept:picked.kept,pose:picked.camera};
  process.stdout.write(JSON.stringify({format:'ink-studio/construction-plane-edit',version:1,before,after,axes:basis,
    ...(camera && {camera})},null,2)+'\n');
}

module.exports = {command,coordinates};
