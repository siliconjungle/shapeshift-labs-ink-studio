const fs = require('node:fs');
const path = require('node:path');
const R = require('./render.js');
const PNG = require('./png.js');
const { pose } = require('./diarama-pose.js');
const { name } = require('../src/target-selectors.js');
const Guard = require('../src/protected-lod.js');

const format = 'ink-studio/protected-lod-review';
const kinds = ['opening', 'letter', 'contour-break'];
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const list = (value, max) => Array.isArray(value) && value.length > 0 && value.length <= max;
const RGB = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(n => integer(n, 0, 255));
const colorDistance = (a,b) => Math.max(...a.map((value,i) => Math.abs(value-b[i])));
function need(ok, message) {
  if (!ok) throw new RangeError('Protected LOD review: ' + message);
}

function prepare(plan) {
  need(record(plan) && plan.format === format && plan.version === 1, 'expected a version 1 plan');
  const { width, height, features, poses } = plan;
  need(integer(width, 1, 512) && integer(height, 1, 512), 'use a native grid of up to 512 × 512');
  need(list(features, 128) && list(poses, 64), 'provide up to 128 named features and 64 poses');
  const byId = new Map();
  for (const feature of features) {
    need(record(feature) && name(feature.id) && name(feature.object) && (feature.part === null || name(feature.part)) &&
      kinds.includes(feature.kind) && !byId.has(feature.id) &&
      list(feature.transitions, Guard.transitions.length) && new Set(feature.transitions).size === feature.transitions.length &&
      Array.from(feature.transitions).every(value => Guard.transitions.includes(value)), 'invalid or duplicate feature');
    byId.set(feature.id, feature);
  }
  const samples = [], marked = new Set(), poseIds = new Set();
  let previousTime = 0;
  for (const shot of poses) {
    need(record(shot) && name(shot.id) && !poseIds.has(shot.id) && Number.isFinite(shot.time) &&
      shot.time >= previousTime && shot.time <= 600 && record(shot.camera) && list(shot.views, 64),
    'use unique poses in time order with a camera and up to 64 distances');
    const {yaw,pitch,target,ortho,fov} = shot.camera;
    need(Number.isFinite(yaw) && Number.isFinite(pitch) && Array.isArray(target) && target.length === 3 &&
      Array.from(target).every(Number.isFinite) && (ortho === undefined || typeof ortho === 'boolean') &&
      (fov === undefined || fov > 0 && fov < Math.PI), 'camera needs target, yaw, pitch and optional ortho and fov');
    previousTime = shot.time;
    poseIds.add(shot.id);
    let previousDistance = 0;
    for (const view of shot.views) {
      need(record(view) && Number.isFinite(view.distance) && view.distance > previousDistance &&
        record(view.probes) && Object.keys(view.probes).length > 0, 'use strictly increasing distances with named witnesses');
      for (const [id, probes] of Object.entries(view.probes)) {
        const feature = byId.get(id);
        need(feature && list(probes, 128), 'unknown feature or missing witnesses: ' + id);
        const cells = new Set();
        for (const probe of probes) {
          const {at, expect, rgb, tolerance = 0} = probe ?? {};
          need(record(probe) && Array.isArray(at) && at.length === 2 &&
            integer(at[0], 0, width-1) && integer(at[1], 0, height-1) && !cells.has(at.join('/')) &&
            ['ink', 'clear'].includes(expect) && (rgb === undefined || RGB(rgb)) &&
            integer(tolerance, 0, 255) && (probe.tolerance === undefined || rgb !== undefined),
          'invalid or duplicate witness for ' + id);
          cells.add(at.join('/'));
        }
        need(probes.some(p => p.expect === 'ink') &&
          (feature.kind === 'letter' ? probes.some(p => p.expect === 'ink' && p.rgb) : probes.some(p => p.expect === 'clear')),
        'witnesses must mark ink and its opening, break, or letter color for ' + id);
        marked.add(id);
      }
      samples.push({ pose:shot.id, time:shot.time, camera:{yaw,pitch,target,ortho,fov,dist:view.distance}, probes:view.probes });
      previousDistance = view.distance;
    }
  }
  need(marked.size === features.length && samples.length <= 64 && samples.length * width * height <= 2_000_000,
    'each feature needs witnesses, with up to 64 views and two million art pixels per lane');
  return { width, height, features, samples };
}

function witnesses(image, feature, probes) {
  const { passes, rgb, w } = image;
  return probes.map(({at, expect, rgb:expectedColor, tolerance = 0}) => {
    const i = at[1]*w+at[0];
    const object = passes.objects[passes.objectId[i]] ?? null;
    const part = passes.parts[passes.partId[i]]?.part ?? null;
    const coverage = passes.surfaceCoverage[i];
    const own = object === feature.object && part === feature.part && coverage > .5;
    const color = [...rgb.subarray(i*3,i*3+3)];
    const pass = own === (expect === 'ink') && (!expectedColor || colorDistance(color, expectedColor) <= tolerance);
    return { at, expect, ...(expectedColor && { expectedColor, tolerance }), object, part, coverage, color, pass };
  });
}

function capture(world, sample, config, options) {
  const requests = [];
  let projection;
  const frame = R.render(world, {
    ...options, ...sample.camera, w:config.width, h:config.height, px:1, t:sample.time, cameraTime:sample.time,
    lockCamera:true, shutter:false, resetRenderHistory:true, passes:['objectId','partId','surfaceCoverage'],
    ...R.cameraCapture(options, ({eye,view,ortho}, {focal,frame}) => {
      projection = {eye, view:Array.from(view), ortho, focal, time:frame.poseTime};
    }),
    spriteReconstructionFrame:({states}) => {
      for (const row of states) {
        const amount = row.requestedSprite ?? row.sprite;
        if (amount) requests.push({ object:row.object, part:row.part ?? null, transition:'card',
          from:row.representation ?? 'geometry', to:'card', amount, distance:row.distance,
          blocked:row.reason === 'protected-feature' });
      }
    },
    strandLODFrame:rows => {
      for (const row of rows) {
        const amount = row.requestedGrouped ?? row.grouped;
        if (amount) requests.push({ object:row.object, part:row.part ?? null, transition:'strand',
          from:'individual', to:'grouped', amount, group:row.group, blocked:row.reason === 'protected-feature' });
      }
    },
    reliefLODFrame:rows => {
      for (const row of rows) {
        const tier = row.requestedTier ?? row.tier;
        if (tier === 'normal' || tier === 'painted') requests.push({ object:row.objectId, part:row.partId ?? null,
          transition:'relief-'+tier, from:'geometry', to:tier, amount:1, relief:row.id,
          blocked:row.reason === 'protected-feature' });
      }
    }
  });
  need(frame.w === config.width && frame.h === config.height, 'renderer changed the approved art grid');
  return { frame, requests, projection };
}

function run(build, plan, { directory, kit = require('..').load(), render = {} } = {}) {
  const config = prepare(plan), { features, samples } = config;
  const native = {...render, protectedLOD:false, spriteReconstruction:'geometry', curveLod:false, reliefLOD:'geometry'};
  const candidate = {...render, protectedLOD:false};
  const matches = (row, feature) => row.object === feature.object && row.part === feature.part &&
    feature.transitions.includes(row.transition);
  const firstFailures = [], seenFailures = new Set(), results = [], holds = new Map();
  const checked = new Map(features.map(feature => [feature.id, new Set()]));
  const byId = new Map(features.map(feature => [feature.id,feature]));
  const frameFile = (index, lane) => 'view-' + String(index+1).padStart(2, '0') + '-' + lane + '.png';
  if (directory) fs.mkdirSync(directory, { recursive:true });
  function save(frame, index, lane) {
    if (directory) PNG.write(path.join(directory,frameFile(index,lane)),frame.w,frame.h,frame.rgb,frame.alpha);
  }
  function hold(feature, transition) {
    const id = JSON.stringify([feature.object,feature.part,transition]);
    const rule = holds.get(id) ?? { object:feature.object, part:feature.part, transition, features:new Set() };
    rule.features.add(feature.id);
    holds.set(id,rule);
  }

  let world = build();
  for (const [index, sample] of samples.entries()) {
    pose(world,sample.time,{kit,artDirection:render.artDirection,maxSteps:36000});
    const reference = capture(world,sample,config,native);
    const trial = capture(world,sample,config,candidate);
    save(reference.frame,index,'native');
    save(trial.frame,index,'candidate');
    const {pose:poseId,time,camera} = sample;
    const checks = features.filter(feature => Object.hasOwn(sample.probes,feature.id)).map(feature => {
      const probes = sample.probes[feature.id];
      const before = witnesses(reference.frame,feature,probes);
      const after = witnesses(trial.frame,feature,probes);
      const requests = trial.requests.filter(row => matches(row,feature));
      const valid = before.every(probe => probe.pass);
      const status = !valid ? 'reference-unresolved' : !after.every(probe => probe.pass) ?
        'failed' : requests.length ? 'passed' : 'native';
      for (const request of requests) {
        checked.get(feature.id).add(request.transition);
        if (status === 'passed') continue;
        hold(feature,request.transition);
        const key = JSON.stringify([poseId,feature.id,request.transition]);
        if (seenFailures.has(key)) continue;
        seenFailures.add(key);
        firstFailures.push({ pose:poseId, time, camera, distance:camera.dist, feature:feature.id, kind:feature.kind,
          status, request, witness:(valid ? after : before).find(probe => !probe.pass) });
      }
      return { feature:feature.id, status, requests, reference:before, candidate:after };
    });
    results.push({ pose:poseId,time,camera,projection:reference.projection,checks });
  }

  const untested = features.flatMap(feature => feature.transitions
    .filter(transition => !checked.get(feature.id).has(transition)).map(transition => {
      hold(feature,transition);
      return { feature:feature.id, transition };
    }));
  const guard = { format:Guard.format, version:1,
    holds:[...holds.values()].map(row => ({ ...row, features:[...row.features] })) };
  Guard.prepare(guard);
  const unresolved = [];
  world = build();
  for (const [index, sample] of samples.entries()) {
    pose(world,sample.time,{kit,artDirection:render.artDirection,maxSteps:36000});
    const guarded = capture(world,sample,config,{...candidate,protectedLOD:guard});
    save(guarded.frame,index,'guarded');
    for (const check of results[index].checks) {
      const feature = byId.get(check.feature);
      check.guarded = witnesses(guarded.frame,feature,sample.probes[check.feature]);
      check.blocked = guarded.requests.filter(row => row.blocked && matches(row,feature));
      if (check.status === 'reference-unresolved' || check.guarded.some(probe => !probe.pass))
        unresolved.push({ pose:sample.pose, distance:sample.camera.dist, feature:check.feature,
          status:check.status === 'reference-unresolved' ? check.status : 'guarded-unresolved' });
    }
    if (directory) results[index].images = Object.fromEntries(['native','candidate','guarded']
      .map(lane => [lane,frameFile(index,lane)]));
  }
  const report = { format:'ink-studio/protected-lod-report', version:1, width:config.width,height:config.height,
    features, firstFailure:firstFailures.find(row => row.status === 'failed') ?? null, firstFailures, untested, unresolved, guard, views:results };
  if (directory) {
    fs.writeFileSync(path.join(directory,'guard.json'),JSON.stringify(guard,null,2)+'\n');
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
  }
  return report;
}

module.exports = { prepare, run };
