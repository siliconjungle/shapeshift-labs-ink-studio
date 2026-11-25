'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const { tasks, grid } = require('./tasks.cjs');
const files = require('../../cli/asset-files.js');
const PNG = require('../../cli/png.js');

function comparisonBoard(directory, runs) {
  const width = 1056, height = 1190, left = 30, top = 165, step = 251;
  const commands = [];
  const rect = (x,y,w,h,fill) => commands.push({type:'rect',rect:[x,y,w,h],fill});
  const text = (text,x,y,scale,color = '#f7e8d1') => commands.push({type:'text',text,at:[x,y],scale,color});
  const mint = '#9be1c4', dim = '#a6b8b9', amber = '#e7b77b';
  rect(0,0,width,height,'#0f1a23');
  rect(left,26,19,4,mint);
  text('INK STUDIO / MODELING BENCHMARK',61,22,2,mint);
  text('Four edits. Shared starts.',left,56,5);
  text('SAME CAMERAS AND POSES / 160 X 104 ART GRID SHOWN AT 2X',left,112,2,dim);
  text('STARTING REVISION',left,144,2,dim);
  text('REFERENCE EDIT',left+336,144,2,mint);
  text('EDIT CHECKS',704,144,2,dim);
  const captions = {
    gatehouse: ['Painted gatehouse','OPENING AND BEVEL','TIDE SIGN REGISTERED','TIDE SIGN AND ARCH','front'],
    'signal-coil': ['Signal coil','WINDING CLEARS CLAMP','BOTH SOCKETS HELD','COPPER ROUTE','left'],
    'captured-prop': ['Harbor hatch','BRASS LINTEL FILLED','THRESHOLD STAYS OPEN','REGISTERED RGB-D FIXTURE','front'],
    'rigged-sleeve': ['Faraday sleeve','GRADED ELBOW WEIGHTS','REST SHAPE AND CUFFS HELD','ELBOW BEND','bend']
  };
  const captures = [];
  for (const [i,{dir,report}] of runs.entries()) {
    const y = top+i*step, [title,first,second,sample,view] = captions[report.task];
    rect(left-1,y-1,grid.width*2+2,grid.height*2+2,'#516673');
    rect(left+335,y-1,grid.width*2+2,grid.height*2+2,'#608c80');
    text(title,704,y+15,3);
    text(first,704,y+49,2,mint);
    text(second,704,y+69,2,dim);
    rect(704,y+95,318,1,'#40545c');
    const {retainedTexels,protectedTexels} = report.paint;
    const paint = protectedTexels ? retainedTexels.toLocaleString('en-US')+' TEXELS RETAINED' : 'COPPER SWATCH RETAINED';
    text(paint,704,y+109,2,amber);
    const held = report.bindings.retained;
    text(held.toLocaleString('en-US')+(held===1?' BINDING HELD':' BINDINGS HELD'),704,y+130,2,dim);
    text(sample,left,y+218,1,dim);
    captures.push(...['before','after'].map((side,j) => ({
      x:left+j*336,y,image:PNG.read(path.join(dir,'result','review','views',view,side+'.png'))
    })));
  }
  rect(left,1160, width-left*2,1,'#40545c');
  text('SCRIPTED REFERENCE EDITS / BLIND SCORES AWAIT REVIEWER BALLOTS',left,1171,1,dim);
  const board = ink.load().KIT.procedural.drawing2d.render({width,height,commands,edges:'hard'});
  for (const {x,y,image} of captures) for (let row=0;row<image.h*2;row++) for (let col=0;col<image.w*2;col++) {
    const offset = (Math.floor(row/2)*image.w+Math.floor(col/2))*3;
    board.data.set(image.rgb.subarray(offset,offset+3),((y+row)*width+x+col)*4);
  }
  files.write(path.join(directory,'Four-Modeling-Edits.png'),PNG.encode(width,height,board.data,4));
}

async function run(directory) {
  fs.mkdirSync(path.dirname(directory),{recursive:true});
  fs.mkdirSync(directory);
  const suiteDir = path.join(directory,'suite');
  const suite = await ink.prepareModelingBenchmark(suiteDir), reference = [], baseline = [];
  const toolRevision = process.env.INK_BENCHMARK_TOOL_REVISION || 'ink-modeling-benchmark-v1';
  for (const {id} of suite.tracks) {
    for (const [workflow,collection] of [['unedited-control',baseline],['sdk-reference',reference]]) {
      const dir = path.join(directory,'runs',workflow,id);
      await ink.startModelingBenchmark(suiteDir,id,dir,{participant:'fixture-runner',kind:'script',workflow,toolRevision});
      const edit = path.join(dir,'edit.json');
      if (workflow === 'sdk-reference')
        files.json(edit,tasks[id].reference(ink,JSON.parse(fs.readFileSync(edit,'utf8'))));
      const report = await ink.finishModelingBenchmark(dir,edit,{repairsComplete:true});
      if (workflow === 'sdk-reference') {
        assert(report.checks.every(row => row.pass),id+' reference failed a task check');
        assert.equal(report.bindings.retained,report.bindings.expected);
        assert.equal(report.paint.retainedTexels,report.paint.protectedTexels);
        assert.equal(report.paint.retainedSwatches,report.paint.protectedSwatches);
      } else assert(report.checks.some(row => !row.pass),id+' unedited control unexpectedly passed');
      collection.push({dir,report});
    }
  }
  const runPaths = rows => rows.map(row => row.dir);
  const blind = await ink.buildModelingBenchmarkReview([...runPaths(baseline),...runPaths(reference)],
    path.join(directory,'blind'),{seats:4});
  const ballots = path.join(directory,'ballots');
  fs.mkdirSync(ballots);
  const scores = ink.scoreModelingBenchmarkReview(path.join(directory,'blind',blind.key),ballots,path.join(directory,'pending-scores.json'));
  const plan = {version:1,baseline:runPaths(baseline).map(dir => path.relative(directory,dir)),
    candidate:runPaths(reference).map(dir => path.relative(directory,dir))};
  files.json(path.join(directory,'comparison-plan.json'),plan);
  const summary = ink.compareModelingBenchmarks(runPaths(baseline),runPaths(reference),{scores});
  files.json(path.join(directory,'comparison.json'),summary);
  comparisonBoard(directory,reference);
  const summaryText = reference.map(({report}) => {
    const {title} = tasks[report.task], paint = report.paint.protectedTexels
      ? report.paint.retainedTexels+' / '+report.paint.protectedTexels+' texels' : '1 / 1 swatches';
    return title + '\n  Checks passed '+report.checks.filter(row => row.pass).length+'/'+report.checks.length+
      ' · '+report.bindings.retained+' bindings held · '+paint;
  });
  fs.writeFileSync(path.join(directory,'README.txt'),[
    'Ink Studio / Modeling benchmarks','','Open Four-Modeling-Edits.png for the matched overview.',
    'To review blind, share only blind/reviewers/ and assign one HTML file per reviewer.',
    'The review coordinator keeps blind/review-key.json private.','',
    'Scripted reference edits and unedited controls exercise the checks. Their clock measurements describe this demo run.',
    'No human or agent performance data or ratings are simulated. The first score report has zero ballots.','',
    ...summaryText,'',
    'The runs/ folders include source copies, submissions, reports, native captures and exact pixel differences.',
    'Use comparison-plan.json to rerun the paired comparison after scoring returned ballots.',''
  ].join('\n'));
  return {directory,reviewers:blind.reviewers};
}

if (require.main === module) run(path.resolve(process.argv[2] ?? 'modeling-benchmark-demo'))
  .then(result => console.log(JSON.stringify(result,null,2)))
  .catch(error => { console.error(error); process.exitCode=1; });

module.exports = {run};
