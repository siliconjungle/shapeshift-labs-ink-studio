'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { deflateSync } = require('node:zlib');
const Motion = require('../src/pixel-motion-checks.js');
const ViewSource = require('../src/pixel-view-source.js');
const PNG = require('./png.js');
const files = require('./asset-files.js');

const record = v=>v && Object.getPrototypeOf(v) === Object.prototype;
const fields = (v,keys)=>record(v) && Object.keys(v).every(key=>keys.includes(key));
const pair = (v,test)=>Array.isArray(v) && v.length === 2 && Array.from(v).every(test);
const id = name=>typeof name === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(name);
const finite = Number.isFinite;

function plan(value,kind,w,h,defaults = []) {
  if (value === undefined) value = { version:1 };
  if (!fields(value,['version','settings','samples']) || value.version !== 1)
    throw new TypeError('Motion plans need version 1, settings and optional ordered samples');
  const options = Motion.settings(value.settings);
  if (kind === 'document' && options.alignment === 'surface')
    throw new TypeError('Surface alignment needs rendered scene views');
  const samples = value.samples ?? defaults;
  if (!Array.isArray(samples)) throw new TypeError('Motion samples need a list');
  Motion.budget(w,h,samples.length);
  const names = new Set();
  for (let index = 0; index < samples.length; index++) {
    const row = samples[index], view = kind === 'scene';
    if (!fields(row,['id','label','anchor','cut','gaps',...(view ? ['time','camera'] : ['frame','guide'])]) ||
        !id(row.id ?? row.frame) || names.has(row.id ?? row.frame) ||
        (row.label !== undefined && (typeof row.label !== 'string' || !row.label.trim())) ||
        (row.cut !== undefined && typeof row.cut !== 'boolean') ||
        (row.anchor !== undefined && !pair(row.anchor,n=>Number.isSafeInteger(n*2) && Math.abs(n)<=8192)) ||
        (row.guide !== undefined && (!id(row.guide) || row.anchor !== undefined)) ||
        (row.gaps !== undefined && (!Array.isArray(row.gaps) || row.gaps.length > 4096 ||
          !Array.from(row.gaps).every(p=>pair(p,Number.isSafeInteger) && p[0]>=0 && p[1]>=0 && p[0]<w && p[1]<h))) ||
        (!view && !id(row.frame)) ||
        (view && (!finite(row.time) || row.time < 0 || index && row.time < samples[index-1].time && !row.cut)))
      throw new TypeError('Motion samples need unique names, in-bounds gaps, and ordered scene times between cuts');
    const camera = row.camera;
    if (camera !== undefined && (!fields(camera,['yaw','pitch','dist','zoom','target','ortho']) ||
        ['yaw','pitch','dist','zoom'].some(key=>camera[key] !== undefined &&
          (!finite(camera[key]) || (key === 'dist' || key === 'zoom') && camera[key] <= 0)) ||
        (camera.target !== undefined && (!Array.isArray(camera.target) || camera.target.length !== 3 ||
          !Array.from(camera.target).every(finite))) ||
        (camera.ortho !== undefined && typeof camera.ortho !== 'boolean')))
      throw new TypeError('A motion view camera needs finite angles, a target, positive distance or zoom, or an orthographic flag');
    names.add(row.id ?? row.frame);
  }
  return { options,samples };
}

function fromRender(rendered,row,subject) {
  const { w:width,h:height,rgb,alpha,passes,camera } = rendered, size = width*height;
  const rgba = new Uint8Array(size*4);
  const owners = passes?.objectId, ownerNames = passes?.objects;
  const subjectIndex = subject === undefined ? undefined : ownerNames?.indexOf(subject);
  const tracked = !!(passes?.surfaceMotion || passes?.partMotion);
  const vectors = tracked && new Float32Array(size*2), valid = tracked && new Uint8Array(size);
  for (let p = 0; p < size; p++) {
    if (subject !== undefined && !(subjectIndex > 0 && owners?.[p] === subjectIndex)) continue;
    const out = p*4;
    rgba[out] = rgb[p*3];
    rgba[out+1] = rgb[p*3+1];
    rgba[out+2] = rgb[p*3+2];
    rgba[out+3] = alpha?.[p] ?? Math.round(255*(passes?.coverage?.[p] ?? 1));
    const motion = passes?.surfaceMotionValid?.[p] ? passes.surfaceMotion :
      passes?.partMotionValid?.[p] ? passes.partMotion : undefined;
    if (motion) {
      vectors[2*p] = motion[2*p];
      vectors[2*p+1] = motion[2*p+1];
      valid[p] = 255;
    }
  }
  const source = rendered.sourceView &&
    deflateSync(JSON.stringify(ViewSource.pack(rendered,{ color:false }))).toString('base64');
  return { ...row,width,height,rgba,owners,ownerNames,vectors,valid,camera,cameraKey:JSON.stringify(camera),source };
}

function writeReview(file,frames,report) {
  const data = JSON.stringify({ report,frames:frames.map(frame=>({
    png:PNG.encode(frame.width,frame.height,frame.rgba,4).toString('base64'),source:frame.source
  })) })
    .replaceAll('<','\\u003c');
  const template = fs.readFileSync(path.join(__dirname,'pixel-motion-review.html'),'utf8');
  const source = name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
  files.write(file,template.replace('/*CSS*/',()=>source('pixel-grid-canvas.css'))
    .replace('/*SCRIPTS*/',()=>['pixel-grid-canvas.mjs','pixel-motion-panel.mjs','pixel-inspector.mjs','pixel-view-source.js',
      'pixel-inspection.js','art-passes.js'].map(source).join('\n'))
    .replace('/*DATA*/',()=>data));
}

module.exports = { plan,fromRender,writeReview };
