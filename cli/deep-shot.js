const fs = require('node:fs');
const path = require('node:path');
const { readDeepEXR, encodeDeepPlate } = require('./deep-openexr.js');
const { read, loadPlan, hash } = require('./deep-shot-plan.js');
const { shotFrame, inspect } = require('./deep-shot-compose.js');
const Effects = require('./deep-shot-effects.js');
const files = require('./asset-files.js');
const { claim } = require('./graph-batch.js');
const { graphOutputs } = require('./graph-outputs.js');

function inspectDeepPlate(file, { pixel } = {}) {
  return inspect(readDeepEXR(read(path.resolve(file))),pixel);
}

function runDeepShot(file, { out, operators } = {}) {
  if (typeof out !== 'string' || !out.trim()) throw new TypeError('Deep shot needs an output directory');
  const input = path.resolve(file), root = path.resolve(out), latest = path.join(root,'latest.json');
  const plan = loadPlan(input, Effects.registry(operators)), release = claim(root, 'deep shot');
  let stage;
  try {
    stage = fs.mkdtempSync(path.join(root, '.deep-shot-'));
    const rows = [], manifests = [];
    function artifact(name, bytes) {
      fs.writeFileSync(path.join(stage,name), bytes);
      return { file:name, bytes:bytes.length, sha256:hash(bytes) };
    }
    for (const [i, frame] of plan.frames.entries()) {
      const { receipt, plate, preview } = shotFrame(plan, frame), encoded = encodeDeepPlate(plate);
      const prefix = 'frame-' + String(i).padStart(4,'0');
      const deep = artifact(prefix + '.exr', encoded.bytes), image = artifact(prefix + '.png', preview);
      rows.push({ ...receipt, deep, image });
      manifests.push({ file:deep.file, time:frame.time, ...encoded.statistics });
    }
    const report = { format:'ink-studio/deep-shot-receipt', version:1, reference:plan.reference, alignment:plan.alignment,
      working:plan.working, display:plan.display, outputColor:{space:'srgb-linear',alpha:'premultiplied'},
      allowTruncated:plan.allowTruncated, dependencies:[...plan.dependencies.values()], frames:rows };
    files.json(path.join(stage,'report.json'),report);
    files.json(path.join(stage,'deep.json'),{ format:'ink-studio/deep-openexr', version:1, frames:manifests });
    graphOutputs([...plan.dependencies.keys()]).protect(fs.statSync(latest,{throwIfNoEntry:false}));
    const revision = 'take-' + path.basename(stage).slice('.deep-shot-'.length), takes = path.join(root,'takes');
    fs.mkdirSync(takes,{recursive:true});
    fs.renameSync(stage,path.join(takes,revision));
    stage = undefined;
    const link = { format:report.format, version:1, revision,
      manifest:'takes/'+revision+'/deep.json', report:'takes/'+revision+'/report.json' };
    files.json(latest, link);
    return { ...link, frames:rows.length, firstPreview:'takes/'+revision+'/'+rows[0].image.file };
  } finally {
    if (stage) fs.rmSync(stage,{recursive:true,force:true});
    release();
  }
}

function command([action,file,...extra], opt) {
  const allowed = action === 'inspect' ? ['out','pixel'] : action === 'run' ? ['out'] : [];
  if (!['inspect','run','operators'].includes(action) || extra.length ||
      (action === 'operators' ? file !== undefined : typeof file !== 'string' || !file.trim()) ||
      Object.entries(opt).some(([key,value])=>!allowed.includes(key)||typeof value!=='string'||!value.trim()) ||
      opt.pixel !== undefined && !/^\d+,\d+$/.test(opt.pixel))
    throw new TypeError('Use deep-shot inspect <plate.exr> [--pixel x,y], deep-shot run <plan.json> --out directory, or deep-shot operators');
  let result;
  if (action === 'operators') result = { format:'ink-studio/deep-effect-operators', version:1, operators:Effects.list() };
  else if (action === 'run') result = runDeepShot(file,{out:opt.out});
  else {
    result = inspectDeepPlate(file,{pixel:opt.pixel?.split(',').map(Number)});
    if (opt.out) {
      const output=path.resolve(opt.out);
      graphOutputs([path.resolve(file)]).protect(fs.statSync(output,{throwIfNoEntry:false}));
      files.json(output,result);
    }
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

module.exports = { runDeepShot, inspectDeepPlate, listDeepEffects: Effects.list, command };
