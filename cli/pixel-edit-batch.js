'use strict';

const { isDeepStrictEqual:equal } = require('node:util');
const { isRevision,canonicalDigest } = require('./pixel-edit-revisions.js');
const { conflict,conflicts } = require('./pixel-edit-preview.js');

const format = 'ink-studio/pixel-edit-batch';
const reviewFormat = 'ink-studio/pixel-batch-revalidation';
const rejectionFormat = 'ink-studio/pixel-batch-rejection';
const maxSteps = 256;
const record = value=>!!value && Object.getPrototypeOf(value) === Object.prototype;
const fields = (value,names)=>record(value) && Object.keys(value).every(key=>names.includes(key));
const label = value=>typeof value === 'string' && !!value.trim();
const json = value=>JSON.parse(JSON.stringify(value));

function steps(value) {
  if (!Array.isArray(value) || !value.length || value.length > maxSteps)
    throw new RangeError('A pixel edit batch needs 1–'+maxSteps+' ordered steps');
  return Array.from(value);
}

function plan(value) {
  if (!fields(value,['revision','label','commands']) || !isRevision(value.revision) ||
      (value.label !== undefined && !label(value.label)))
    throw new TypeError('A pixel edit batch needs a base document revision and ordered commands');
  return { ...value,label:value.label ?? 'Pixel edit batch',commands:steps(value.commands) };
}

function seal(label,inputs,outputs,steps,revalidatedFrom) {
  const body = json({format,version:1,label,inputs,outputs,steps,
    ...(revalidatedFrom !== undefined && {revalidatedFrom})});
  return { ...body,revision:canonicalDigest(body) };
}

function anchor(value) {
  return fields(value,['documentRevision','legacyRevision','renderRevision','scene']) &&
    isRevision(value.documentRevision) && (value.legacyRevision === null || isRevision(value.legacyRevision)) &&
    isRevision(value.renderRevision) && (value.scene === null ||
      fields(value.scene,['ref','revision']) && label(value.scene.ref) && isRevision(value.scene.revision));
}

function read(value,readStep) {
  if (!fields(value,['format','version','label','inputs','outputs','steps','revision','revalidatedFrom']) ||
      value.format !== format || value.version !== 1 || !label(value.label) || !isRevision(value.revision) ||
      !anchor(value.inputs) || !anchor(value.outputs) ||
      (value.revalidatedFrom !== undefined && !isRevision(value.revalidatedFrom)))
    throw new TypeError('Replay needs a version 1 pixel edit batch receipt');
  const {revision,...body} = value;
  if (canonicalDigest(body) !== revision) throw conflict('batch-integrity','The pixel batch receipt has changed',{revision});
  return { ...body,revision,steps:steps(value.steps).map(readStep) };
}

function checkInputs(expected,actual) {
  const keys = ['documentRevision','legacyRevision','scene','renderRevision'];
  const problems = keys.filter(key=>!equal(expected[key],actual[key])).map(key=>({
    code:key === 'scene' || key === 'renderRevision' ? 'stale-source' : 'stale-document',
    message:'Pixel batch input differs from the recorded '+key,
    input:key,expected:expected[key],actual:actual[key]
  }));
  if (problems.length) throw Object.assign(new RangeError(problems[0].message),{conflicts:problems});
}

function runStep(index,fn) {
  try { return fn(); }
  catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)),{batchStep:index});
  }
}

function failure(error) {
  return { ...(error?.batchStep !== undefined && {failedStep:error.batchStep}),
    conflicts:conflicts(error),...(error?.receipt && {editReceipt:error.receipt}) };
}

function rejected(action,cause,recordedRevision) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  error.receipt = { format:rejectionFormat,version:1,action,
    ...(isRevision(recordedRevision) && {recordedRevision}),...failure(error) };
  throw error;
}

const kindKeys = ['kind','destination','scene','binding','object','part','layer','cel','chart','channel','mesh','material','decal'];
function verifyTarget(previous,current) {
  const [before] = previous.affectedTargets, [after] = current.affectedTargets;
  if (!before || !after || kindKeys.some(key=>!equal(before[key],after[key])))
    throw conflict('changed-target','The current edit resolves to a different destination or target',{before,after});

  let rows;
  for (const hit of [before.anchor,...(before.kind === 'splat-attributes' ? before.splats : [])]) {
    if (!Number.isSafeInteger(hit?.requested)) continue;
    rows ??= new Map(after.splats?.map(row=>[row.requested,row]));
    const verified = after.anchor ?? rows.get(hit.requested);
    if (!hit.id || hit.id !== verified?.id)
      throw conflict('changed-target','A numeric splat reference no longer has the same stable ID',
        {row:hit.requested,expected:hit.id,actual:verified?.id ?? null});
  }
}

function evidence(previous,current) {
  const before = { targets:previous.affectedTargets,skippedHits:previous.skippedHits,shotHits:previous.shotHits };
  const after = { targets:current.affectedTargets,skippedHits:current.skippedHits,shotHits:current.shotHits };
  return equal(before,after) ? null : {before,after};
}

module.exports = { format,reviewFormat,rejectionFormat,maxSteps,plan,read,seal,steps,checkInputs,runStep,failure,rejected,verifyTarget,evidence };
