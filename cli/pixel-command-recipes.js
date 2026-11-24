'use strict';

const Commands = require('./pixel-commands.js');
const Batch = require('./pixel-edit-batch.js');
const Preview = require('./pixel-edit-preview.js');
const PNG = require('./png.js');
const { canonicalDigest,isRevision } = require('./pixel-edit-revisions.js');

const format = 'ink-studio/pixel-command-recipe';
const planFormat = 'ink-studio/pixel-recipe-plan';
const reviewFormat = 'ink-studio/pixel-recipe-review';
const applyFormat = 'ink-studio/pixel-recipe-application';
const maxComparisons = 8;
const record = value=>!!value && Object.getPrototypeOf(value) === Object.prototype;
const name = value=>typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const text = value=>typeof value === 'string' && !!value.trim();
const fields = (value,allowed)=>record(value) && Object.keys(value).every(key=>allowed.includes(key));
const pair = (value,test)=>Array.isArray(value) && value.length === 2 && Array.from(value).every(test);
const validators = {
  id:name,text,point:value=>pair(value,n=>Number.isSafeInteger(n) && n >= 0 && n < 512),
  offset:value=>pair(value,Number.isSafeInteger),integer:Number.isSafeInteger,number:Number.isFinite,
  boolean:value=>typeof value === 'boolean'
};

function expand(value,bindings) {
  if (Array.isArray(value)) return Array.from(value,item=>expand(item,bindings));
  if (record(value)) {
    if (Object.hasOwn(value,'$input')) {
      if (!bindings || !fields(value,['$input']) || !Object.hasOwn(bindings,value.$input))
        throw new TypeError('Unknown or malformed pixel recipe input '+value.$input);
      return structuredClone(bindings[value.$input]);
    }
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,expand(item,bindings)]));
  }
  if (value === null || ['string','boolean'].includes(typeof value) || Number.isFinite(value)) return value;
  throw new TypeError('Pixel recipe values must be JSON data');
}

function bind(declared,inputs) {
  if (!record(declared) || !record(inputs) || Object.keys(inputs).some(key=>!Object.hasOwn(declared,key)))
    throw new TypeError('Supply only the declared pixel recipe inputs');
  const output = {};
  for (const [key,rule] of Object.entries(declared)) {
    if (!name(key) || !fields(rule,['type','default']) || !Object.hasOwn(validators,rule.type))
      throw new TypeError('Invalid pixel recipe input declaration '+key);
    const validate = validators[rule.type], fallback = Object.hasOwn(rule,'default');
    if (fallback && !validate(rule.default)) throw new TypeError('Invalid default for pixel recipe input '+key);
    const value = Object.hasOwn(inputs,key) ? inputs[key] : rule.default;
    if (!validate(value)) throw new TypeError('Pixel recipe input '+key+' needs '+rule.type);
    output[key] = structuredClone(value);
  }
  return output;
}

function comparison(value) {
  if (!fields(value,['id','frame','layer','cel','binding','time']) || !name(value.id) ||
      [value.frame,value.layer,value.binding].some(id=>id !== undefined && !name(id)) ||
      (value.cel !== undefined && !text(value.cel)) ||
      (value.binding !== undefined && (value.layer !== undefined || value.cel !== undefined)) ||
      (value.layer !== undefined && value.cel !== undefined) ||
      (value.time !== undefined && (!value.binding || !Number.isFinite(value.time) || value.time < 0)))
    throw new TypeError('A recipe comparison needs an ID and a document layer, cel, or scene binding');
  return value;
}

function prepare(value,inputs = {}) {
  if (!fields(value,['format','version','id','label','inputs','steps','comparisons']) || value.format !== format ||
      value.version !== 1 || !name(value.id) || (value.label !== undefined && !text(value.label)))
    throw new TypeError('Use a version 1 pixel command recipe with a stable ID');
  const bindings = bind(value.inputs ?? {},inputs), steps = Batch.steps(value.steps).map(step=>{
    if (!fields(step,['id','action','patch','options']) || !name(step.id) || !record(step.patch))
      throw new TypeError('Recipe steps need unique IDs and native pixel edit patches');
    const patch = expand(step.patch,bindings);
    if (!record(patch)) throw new TypeError('A recipe step must expand to a pixel edit patch');
    const command = Commands.envelope(step.action,{ patch:{id:step.id,...patch},
      ...(step.options !== undefined && { options:expand(step.options,bindings) }) });
    Commands.batchCommand(command);
    return { id:step.id,command };
  });
  if (new Set(steps.map(step=>step.id)).size !== steps.length) throw new TypeError('Recipe step IDs must be unique');
  const raw = value.comparisons ?? [];
  if (!Array.isArray(raw) || raw.length > maxComparisons)
    throw new TypeError('A pixel recipe supports up to '+maxComparisons+' comparisons');
  const comparisons = Array.from(raw,row=>comparison(expand(row,bindings)));
  if (new Set(comparisons.map(row=>row.id)).size !== comparisons.length)
    throw new TypeError('Recipe comparison IDs must be unique');
  return { recipe:{id:value.id,revision:canonicalDigest(value)},label:value.label ?? value.id,
    inputs:bindings,steps,comparisons };
}

function image(bytes,w,h) {
  return { grid:[w,h],encoding:'base64',data:bytes.toString('base64') };
}

function compare(view,before,after) {
  const a = PNG.raster(before), b = PNG.raster(after);
  const w = Math.max(a.w,b.w), h = Math.max(a.h,b.h), changed = new Uint8Array(w*h);
  let changedPixels = 0;
  for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
    const inA = x<a.w && y<a.h, inB = x<b.w && y<b.h;
    if (!inA && !inB) continue;
    const p = (y*a.w+x)*4, q = (y*b.w+x)*4;
    const alphaA = inA ? a.data[p+3] : 0, alphaB = inB ? b.data[q+3] : 0;
    if (inA !== inB || alphaA !== alphaB ||
        alphaA && (a.data[p] !== b.data[q] || a.data[p+1] !== b.data[q+1] || a.data[p+2] !== b.data[q+2])) {
      changed[y*w+x] = 255;
      changedPixels++;
    }
  }
  const payload = { view,changedPixels,before:image(before,a.w,a.h),after:image(after,b.w,b.h),
    difference:image(PNG.encodeGray(w,h,changed),w,h) };
  // Fingerprint native samples so the approval is independent of PNG compression.
  const revision = canonicalDigest({view,before:[a.w,a.h,Uint8Array.from(a.data)],
    after:[b.w,b.h,Uint8Array.from(b.data)],difference:changed});
  return { ...payload,revision };
}

function plan({recipe,inputs},batch,comparisons) {
  return { format:planFormat,version:1,recipe,inputs,batch,
    comparisons:comparisons.map(({view,revision})=>({view,revision})) };
}

function checkPlan(value,approval) {
  if (!fields(value,['format','version','recipe','inputs','batch','comparisons']) || value.format !== planFormat ||
      value.version !== 1 || !fields(value.recipe,['id','revision']) || !name(value.recipe.id) ||
      !isRevision(value.recipe.revision) || !record(value.inputs) || !record(value.batch) ||
      !Array.isArray(value.comparisons) || value.comparisons.length > maxComparisons ||
      !Array.from(value.comparisons).every(row=>fields(row,['view','revision']) && isRevision(row.revision) && comparison(row.view)) ||
      !isRevision(approval))
    throw new TypeError('Recipe application needs a reviewed plan and its approval digest');
  if (canonicalDigest(value) !== approval)
    throw Preview.conflict('recipe-approval','The approval does not match this recipe plan');
  return value;
}

module.exports = { format,planFormat,reviewFormat,applyFormat,maxComparisons,inputTypes:Object.keys(validators),
  prepare,comparison,compare,plan,checkPlan };
