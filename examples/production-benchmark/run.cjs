/* Run: node examples/production-benchmark/run.cjs output-directory [cue|scene|world|review] */
const {path,json,read,write}=require('./support.cjs');
const brief=require('./briefs.json'), pieces=['cue','scene','world'];
const [target,only]=process.argv.slice(2);
if (!target || (only && ![...pieces,'review'].includes(only)))
  throw new TypeError('Use an output directory and optionally cue, scene, world, or review');
const output=path.resolve(target);
for (const id of only==='review' ? [] : only ? [only] : pieces) {
  require('./'+id+'.cjs')(path.join(output,id));
  console.log('Rendered '+id);
}
json(path.join(output,'briefs.json'),brief);
if (!only || only==='review') {
  const report=Object.fromEntries(pieces.map(id=>[id,read(path.join(output,id,'report.json'))]));
  write(path.join(output,'index.html'),require('./review.cjs')(brief,report));
  json(path.join(output,'report.json'),{format:brief.format,version:brief.version,pieces:report});
  console.log(path.join(output,'index.html'));
}
