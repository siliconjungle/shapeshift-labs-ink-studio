'use strict';

const fs = require('node:fs');
const path = require('node:path');
const FlowMap = require('../src/flow-map.js');
const files = require('./asset-files.js');
const read = file => JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
const usage = 'Use flow-map new, paint, inspect, or editor. See ink-studio help.';

function tuple(raw, length) {
  if (typeof raw !== 'string') throw new TypeError('Expected '+length+' comma-separated numbers');
  const values = raw.split(',').map(value => value.trim() ? Number(value) : NaN);
  if (values.length !== length || !values.every(Number.isFinite))
    throw new TypeError('Expected '+length+' comma-separated numbers');
  return values;
}

function example() {
  const map = FlowMap.create({ width:48,height:32 });
  const lane = (points,speed,radius) => map.stroke({ points,speed,radius,hardness:.58 });
  lane([[-3,-1.58],[-1.8,-1.42],[-.24,-1.54],[.9,-1.35],[2.2,-.95],[3,-.77]],1.24,.63);
  lane([[-3,-.75],[-1.7,-.64],[-.75,-1.11],[.1,-1.23],[1.27,-1.08],[2.05,-.63],[3,-.45]],2.05,.65);
  lane([[-3,-.04],[-2,-.02],[-1.15,-.38],[-.8,-.78],[-.36,-.94],[.82,-.88],[1.8,-.38],[3,-.11]],2.55,.5);
  lane([[-3,.52],[-1.9,.46],[-.87,.67],[-.23,1.05],[.56,1.26],[1.58,.9],[3,.32]],1.7,.65);
  lane([[-3,1.42],[-1.82,1.48],[-.9,1.43],[.25,1.62],[1.5,1.39],[3,.86]],.92,.58);
  lane([[2.6,.36],[1.9,.32],[1.32,.07],[.95,-.12],[.6,-.07],[.42,.19],[.56,.43],[1.1,.54]],.73,.34);
  return map;
}

function standalone(file, map, bundle) {
  const source = file => fs.readFileSync(path.join(__dirname,file),'utf8');
  const data = JSON.stringify(map.asset()).replaceAll('<','\\u003c');
  const script = bundle().replace(/<\/script/gi,match => '<' + String.fromCharCode(92) + match.slice(1));
  files.write(file,source('flow-map-editor.html').replace('/*MAP*/',() => data)
    .replace('/*TOOLKIT*/',() => script)
    .replace('/*PREVIEWS*/',() => source('flow-map-previews.js'))
    .replace('/*EDITOR*/',() => source('flow-map-editor.js')));
}

function command(pos, opt, bundle) {
  const [action,file,brush] = pos;
  const flags = {
    new:['size','bounds','out'], paint:['out'], inspect:['at','out'], editor:['out']
  };
  if (!Object.hasOwn(flags,action) || Object.keys(opt).some(key => !flags[action].includes(key)) ||
      pos.length !== (action === 'new' ? 1 : action === 'paint' ? 3 : action === 'editor' ? (file ? 2 : 1) : 2))
    throw new TypeError(usage);
  const { out } = opt;
  if (out !== undefined && (typeof out !== 'string' || [file,brush].filter(Boolean)
      .some(input => path.resolve(input) === path.resolve(out))))
    throw new TypeError('Write flow-map output to a separate file');
  let report;
  if (action === 'new') {
    const [width,height] = opt.size === undefined ? [] : tuple(opt.size,2);
    const bounds = opt.bounds === undefined ? undefined : tuple(opt.bounds,4);
    report = FlowMap.create({ width,height,bounds }).asset();
  } else if (action === 'editor') {
    if (!out || !/\.html$/i.test(out)) throw new TypeError('Flow map editor needs --out <editor.html>');
    standalone(path.resolve(out),file ? FlowMap.open(read(file)) : example(),bundle);
    return;
  } else {
    const map = FlowMap.open(read(file));
    if (action === 'inspect') {
      const at = tuple(opt.at,2);
      report = { format:'ink-studio/flow-map-inspection',version:1,bounds:map.bounds,
        grid:[map.width,map.height],at,sample:map.inspect(...at) };
    } else {
      const raw = read(brush), strokes = Array.isArray(raw) ? raw : [raw];
      if (strokes.length > 128) throw new RangeError('A flow-map paint command accepts up to 128 strokes');
      for (const stroke of strokes) map.stroke(stroke);
      report = map.asset();
    }
  }
  if (out) files.json(path.resolve(out),report);
  else process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

module.exports = { command };
