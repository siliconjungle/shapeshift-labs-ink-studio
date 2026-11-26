const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const Ink = require('..');
const Vector = require('../src/vector-resources.js');
const Paths = require('../src/vector-paths.js');
const P = Ink.load().KIT.procedural.vectorResources;

const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 80" width="100mm" height="80mm">' +
  '<title>Signal &amp; sail</title><desc><![CDATA[Wind < 4]]></desc>' +
  '<defs><linearGradient id="light"><stop offset="10%" stop-color="#edb775"/><stop offset="1" stop-color="#353967"/></linearGradient>' +
  '<clipPath id="crop"><rect x="10" y="20" width="100" height="80" rx="2"/></clipPath></defs>' +
  '<g id="a" transform="translate(12 24) scale(2 1.5)" style="fill-rule:evenodd;stroke-width:2;stroke-linejoin:round">' +
  '<path id="sail" d="m0 0c1 2 3 4 6 7s4 2 8 0q2 4 6 1t7 1a4 3 23 0110 -2z" fill="url(&quot;#light&quot;)" ' +
  'stroke="#ffd89b" stroke-linecap="round" stroke-dasharray="4, 2" stroke-dashoffset="1" clip-path="url(#crop)"/>' +
  '<rect x="2" y="5" width="5" height="4" ry="1"/></g><g id="b" transform="translate(22 21)"/>' +
  '<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#sail" x="2" y="3"/></svg>';
const node = (document, key) => Vector.index(document).nodes.get(key).node;
const fileGraph = assets => ({
  format:'ink-studio/graph-project',version:1,assets,
  nodes:{
    stock:{op:'svgAsset',inputs:{name:'mark'}},
    paint:{op:'vector.edit',inputs:{source:{node:'stock'},edits:[{kind:'attributes',key:'sail',attrs:{'stroke-width':'3'}}]}},
    path:{op:'vector.path',inputs:{source:{node:'paint'},key:'sail'}},
    baked:{op:'vector.fillMask',inputs:{source:{node:'paint'},key:'sail',options:{width:100,height:80,samples:2}}},
    text:{op:'vector.export',inputs:{source:{node:'paint'}}}
  },
  outputs:{document:{node:'paint'},path:{node:'path'},mask:{node:'baked'},xml:{node:'text'}},
  exports:{sail:{output:'document',format:'svg'}}
});

test('SVG path grammar accepts relative, smooth, compact arc commands and resets tangent state',()=>{
  const path = Paths.parse('m.5-.5 6 4h5v10 C12 14 13 16 18 17 s1 2 3 4 t1 1 q2 3 4 5 t3 4 A6 8 25 0114 7z l2 2');
  assert.deepEqual(path.slice(0,4),[['M',.5,-.5],['L',6.5,3.5],['L',11.5,3.5],['L',11.5,13.5]]);
  assert.deepEqual(path[5],['C',23,18,19,19,21,21]);
  assert.deepEqual(path[6],['Q',21,21,22,22]);
  assert.deepEqual(path[8],['Q',28,29,29,31]);
  assert.deepEqual(path[9],['A',6,8,25,0,1,14,7]);
  assert.deepEqual(path.at(-1),['L',2.5,1.5]);
  assert.deepEqual(Paths.parse(Paths.encode(path)),path);
  assert.deepEqual(Paths.parse('M+1e-2 -.3L.5.6'),[['M',.01,-.3],['L',.5,.6]]);
  for (const bad of ['M0 0c1 2x','M0 0,','M0 0A1 1 0 2 0 3 3','L2 3','M0 0Z1 2'])
    assert.throws(()=>Paths.parse(bad),/SVG/);
});

test('round-trips hierarchy, curves, internal references, stroke styling and viewBox',()=>{
  const imported=Vector.parse(source), output=Vector.write(imported), reopened=Vector.parse(output);
  assert.deepEqual(reopened,imported);
  assert.equal(node(imported,'sail').segments.at(-2)[0],'A');
  assert.deepEqual(Vector.describe(reopened).viewBox,[10,20,100,80]);
  assert.equal(node(reopened,'sail').attrs['stroke-dasharray'],'4, 2');
  assert.match(output,/<title[^>]*>Signal &amp; sail<\/title>/);
  assert.match(output,/<use[^>]*href="#sail"/);
});

test('edits move attached handles, maintain tangent constraints and preserve stable hierarchy keys',()=>{
  const original=Vector.parse('<svg viewBox="0 0 30 30"><g id="a"><path id="p" d="M0 0C2 0 8 4 10 10C12 12 18 12 20 12"/></g><g id="b" transform="translate(4 2)"/></svg>');
  const updated=Vector.edit(original,[
    {kind:'point',key:'p',segment:1,handle:'c2',at:[7,8],tangent:'mirrored'},
    {kind:'point',key:'p',segment:1,handle:'end',at:[11,12]},
    {kind:'attributes',key:'p',attrs:{id:'new-p',stroke:'#749cd2','stroke-linecap':'square'}},
    {kind:'attributes',key:original.root.key,attrs:{viewBox:[2,3,25,20]}},
    {kind:'move',key:'p',parent:'b',index:0}
  ]);
  assert.deepEqual(node(updated,'p').segments[1],['C',2,0,8,10,11,12]);
  assert.deepEqual(node(updated,'p').segments[2].slice(1,3),[14,14]);
  const index=Vector.index(updated);
  assert.equal(index.nodes.get('p').parent.key,'b');
  assert.equal(index.ids.get('new-p').key,'p');
  assert.deepEqual(Vector.parse(Vector.write(updated)),updated);
  assert.deepEqual(P.path(updated,'p').value.points[0],[4,2]);
  assert.deepEqual(P.path(updated,'p',{space:'local'}).value.points[0],[0,0]);
  assert.equal(Vector.index(original).nodes.get('p').parent.key,'a');
  assert.throws(()=>Vector.edit(original,[{kind:'move',key:'a',parent:'p'}]),/parent/);
  const ring=Paths.parse('M0 0 C5 0 8 5 9 9 C5 9 0 6 0 0 Z');
  const rotated=Paths.editPoint(ring,1,'c1',[4,1],{tangent:'mirrored'});
  assert.deepEqual(rotated[2].slice(3,5),[-4,-1]);
});

test('fill masks resolve winding, nested SVG transforms and viewport aspect mapping',()=>{
  const imported=Vector.parse('<svg viewBox="0 0 10 10"><g fill-rule="evenodd">' +
    '<path id="badge" d="M0 0H10V10H0Z M2 2H8V8H2Z"/></g></svg>');
  const view=(options)=>P.fillMask(imported,'badge',{width:16,height:10,...options}).value.raster;
  const even=view(), nonzero=view({rule:'nonzero'}), center=5*16+7;
  assert.equal(even.data[center],0);
  assert.equal(nonzero.data[center],1);
  assert.equal(nonzero.data[0],0);
  assert.equal(even.data[4],1);
  assert.equal(even.data.reduce((a,b)=>a+b),64);
  const nested=Vector.parse('<svg viewBox="0 0 24 20"><svg x="2" y="3" width="16" height="12" viewBox="0 0 8 6"><rect id="stamp" x="1" y="2" width="2" height="2"/></svg></svg>');
  assert.deepEqual(P.path(nested,'stamp').value.points[0],[4,7]);
  assert.equal(P.fillMask(nested,'stamp',{width:24,height:20,samples:4}).value.raster.data.reduce((a,b)=>a+b),16);
  const arc=Paths.flatten(Paths.parse('M0 0 A5 7 25 0 1 10 2'),undefined,{tolerance:.03})[0];
  assert.deepEqual(arc.points[0],[0,0]);assert.deepEqual(arc.points.at(-1),[10,2]);assert(arc.points.length>5);
});

test('passive SVG rejects external references, active nodes, malformed XML and circular instances',()=>{
  for (const markup of [
    '<!DOCTYPE svg><svg/>','<svg><script/></svg>','<svg onload="x"/>','<svg><image href="asset.png"/></svg>',
    '<svg><use href="other.svg#item"/></svg>','<svg><path d="M0 0" style="fill:url(https://example.com/paint)"/></svg>',
    '<svg><g id="a"><use href="#a"/></g></svg>','<svg><g></svg>',
    '<svg><g id="x"/><g id="x"/></svg>','<svg><title>&unknown;</title></svg>',
    '<svg><use href="#missing"/></svg>'
  ]) assert.throws(()=>Vector.parse(markup));
});

test('linked and edited SVG resources survive relocation, portable replay and CLI SVG export',t=>{
  const baseDir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-vector-'));
  t.after(()=>fs.rmSync(baseDir,{recursive:true,force:true}));
  const at=file=>path.join(baseDir,file);
  fs.writeFileSync(at('mark.svg'),source);
  const draft=Ink.openMaterialGraph(fileGraph({}),{id:'harbor'});
  const linked=Ink.editMaterialVector(draft,{kind:'link',id:'mark',file:'mark.svg'},{baseDir}).document;
  const before=Ink.createGraphProject(linked,{baseDir});
  assert(before.sourceFiles().includes(at('mark.svg')));
  const inspect=Ink.describeMaterialVector(linked,'mark',{baseDir});
  assert.equal(inspect.storage,'linked');
  assert(inspect.elements.some(row=>row.key==='sail'&&row.parent==='a'));
  const edited=Ink.editMaterialVector(linked,{kind:'edit',id:'mark',edits:[
    {kind:'point',key:'sail',segment:1,handle:'c1',at:[1,5]}
  ]},{baseDir}).document;
  const saved=Ink.writeMaterialGraph(at('portable/material.json'),edited,{baseDir});
  assert.equal(saved.resources.mark.definition.origin,'../mark.svg');
  assert.deepEqual(saved.graph,linked.graph);
  fs.unlinkSync(at('mark.svg'));
  const project=Ink.readGraphProject(at('portable/material.json')), run=project.run();
  assert.deepEqual(project.sourceFiles(),[at('portable/material.json')]);
  assert.equal(run.outputs.mask.descriptor.intent,'mask');
  assert.equal(node(run.outputs.document,'sail').attrs['stroke-width'],'3');
  assert.deepEqual(Vector.parse(run.artifacts[0].bytes.toString()),run.outputs.document);
  assert.equal(run.artifacts[0].bytes.toString(),run.outputs.xml);
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const get=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,'graph',...args],{encoding:'utf8'}));
  assert.equal(get('material-vector',at('portable/material.json'),'mark').storage,'embedded');
  get('run',at('portable/material.json'),'--out',at('export'));
  assert.equal(fs.readFileSync(at('export/artifacts/sail.svg'),'utf8'),run.outputs.xml);
});
