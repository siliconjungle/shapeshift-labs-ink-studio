const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const studio = require('..');
const { KIT: K } = studio.load();

const source = {
  kind: 'spatial', key: 'station',
  columns: {
    station: { type: 'string' }, sector: { type: 'string' }, t: { type: 'integer', units: 'ms' },
    reading: { type: 'number', units: '%' }, x: { type: 'number', units: 'm' }, z: { type: 'number', units: 'm' },
    velocity: { type: 'vec3', units: 'world/s' }
  },
  coordinates: { crs: 'cartesian', axes: 'xz', units: 'm', columns: ['x','z'] },
  data: [
    { station:'A', sector:'Inner', t:0, reading:32, x:-1, z:0, velocity:[0,0,0] },
    { station:'B', sector:'Outer', t:1000, reading:50, x:0, z:0, velocity:[0,0,0] },
    { station:'C', sector:'Inner', t:2000, reading:81, x:1, z:0, velocity:[.15,0,0] }
  ]
};
const dataInputs = { stations:source };
const prepared = K.dataInputs.prepare(dataInputs).get('stations');
const spec = {
  id: 'linked-stations', camera: { target:[0,0,0], yaw:0, pitch:0, dist:5 }, dataInputs,
  dataMarks: { sensors: { source:{dataset:'stations'}, channels:{
    color:'#6cdadf', size:.28, motion:{column:'velocity'}
  } } }
};
const create = options => K.linkedViews.create(prepared,{ timeColumn:'t', ...options });
const selected = rows => rows.filter(row=>row.selected).map(row=>row.ref.key);
const centerRay = { origin:[0,0,4], direction:[0,0,-1] };

test('one revision publishes filtering, selection and normalized time to all projections', () => {
  const session=create({time:0,window:{past:1.05,future:.01}}), before=session.snapshot();
  assert.deepEqual(session.timeRange,[0,2]);
  assert.deepEqual(session.table().rows.map(row=>row.ref.key),['A']);
  const observed=[];
  const stop=session.subscribe(s=>observed.push(s),{immediate:false});
  const next=session.update({time:2,filter:{path:['sector'],value:'Inner'},selection:[{dataset:'stations',key:'C',row:7}]});
  assert.equal(next.revision,1);
  assert.deepEqual(observed,[next]);
  assert(Object.isFrozen(next.selection));
  assert.deepEqual(selected(session.chart({x:'$time',y:'reading'})),['C']);
  assert.deepEqual(selected(session.map()),['C']);
  assert.deepEqual(selected(session.table().rows),['C']);
  assert.deepEqual(session.map()[0].geometry,{type:'Point',coordinates:[1,0]});
  assert.deepEqual(session.chart({x:'$time',y:'reading'})[0],{ref:next.selection[0],x:2,y:81,selected:true});
  assert.deepEqual(session.table({},before).rows.map(row=>row.ref.key),['A']);
  assert.throws(()=>session.table({},create().snapshot()),/snapshot from this linked session/);
  assert.throws(()=>session.update({ time:1, selection:[{ dataset:'stations',key:'missing' }] }),/unknown record/);
  assert.throws(()=>session.update({ time:1, filter:{all:[{op:'broken'}]} }),/Unknown condition operator/);
  assert.equal(session.snapshot(),next);
  session.update({time:0});
  assert.deepEqual(session.snapshot().selection,next.selection);
  assert.deepEqual(selected(session.table().rows),[]);
  session.update({time:2});
  assert.deepEqual(selected(session.table().rows),['C']);
  const unchanged=session.snapshot();
  assert.equal(session.update({time:2,filter:{path:['sector'],value:'Inner'}}),unchanged);
  stop();
  session.update({selection:[next.selection[0]],mode:'toggle'});
  assert.equal(observed.length,3);
  assert.deepEqual(session.snapshot().selection,[]);
});

test('a linked scene preserves pick provenance, hides filtered marks and samples time in both directions', () => {
  const session=create(), display=K.linkedViews.diorama(spec), original=display(session.snapshot());
  const pick=world=>studio.createSplatPicker(world).ray(centerRay).dominant;
  const hit=pick(original);
  assert.equal(hit.dataMark.source.key,'B');
  assert(session.pick(hit));
  assert.deepEqual(selected(session.map()),['B']);
  const marked=session.scene(original), index=Array.from(original.renderMetadata.targetIds)
    .findIndex(id=>original.renderMetadata.targets[id]?.mark===hit.dataMark.id);
  assert(index>=0);
  assert.notEqual(marked.data[index*16+7],original.data[index*16+7]);
  assert.equal(pick(marked).dataMark.source.key,'B');
  session.update({filter:{path:['sector'],value:'Inner'}});
  const filtered=session.scene(original);
  assert.equal(filtered.dataMarks.get(hit.dataMark.id).status,'hidden');
  assert.equal(filtered.dataMarks.list().marks.find(mark=>mark.id===hit.dataMark.id).status,'hidden');
  assert(original.data[index*16+3]>0);
  assert.equal(pick(filtered),null);
  assert.equal(session.pick(hit),false);
  session.update({time:2});
  const current=session.scene(display(session.snapshot()));
  const id='sensors/string/"C"';
  assert.deepEqual(current.dataMarks.get(id).channels.position,[1.3,0,0]);
  assert.deepEqual(filtered.dataMarks.list().marks.find(mark=>mark.id===id).channels.position,[1,0,0]);
  session.update({time:.5});
  assert.deepEqual(session.scene(display(session.snapshot())).dataMarks.get(id).channels.position,[1.075,0,0]);
});

test('series timestamps and spatial geometry keep their original record identity', () => {
  const series=K.dataInputs.prepare({ track:{ kind:'series',
    columns:{stamp:{type:'timestamp'},value:{type:'number',units:'1'}},time:{column:'stamp'},
    data:[{stamp:'2025-01-01T12:00:00Z',value:1},{stamp:'2025-01-01T12:00:02Z',value:2}]
  } }).get('track');
  const clock=K.linkedViews.create(series,{time:1,window:{past:1,future:1}});
  assert.deepEqual(clock.timeRange,[0,2]);
  assert.equal(clock.snapshot().active.row,0);
  assert.deepEqual(clock.chart({x:'$time',y:'value'}).map(point=>point.x),[0,2]);
  clock.update({time:2});
  assert.equal(clock.snapshot().active.row,1);

  const geo=K.dataInputs.prepare({ regions:{ kind:'spatial',format:'geojson',
    columns:{name:{type:'string'}},coordinates:{crs:'OGC:CRS84',origin:[0,0]},
    data:{type:'FeatureCollection',features:[
      {type:'Feature',id:1,properties:{name:'coast'},geometry:{type:'Polygon',
        coordinates:[[[0,0],[.01,0],[0,.01],[0,0]]]}},
      {type:'Feature',id:'1',properties:{name:'interior'},geometry:{type:'Point',coordinates:[.005,.004]}}
    ]}
  } }).get('regions');
  const views=K.linkedViews.create(geo);
  views.update({selection:[{dataset:'regions',key:'1'}]});
  assert.deepEqual(selected(views.table().rows),['1']);
  const [region,point]=views.map();
  assert.equal(region.ref.key,1);
  assert.equal(region.geometry.type,'Polygon');
  assert.deepEqual(region.geometry.coordinates[0][0],region.geometry.coordinates[0][3]);
  assert.equal(point.selected,true);
});

test('category encodings stay assigned across filters and add codes when symbols repeat', () => {
  const session=create(), encoding=session.encoding({category:'sector',label:'station',monochrome:true,
    categories:[
      {value:'Inner',pattern:'dots',symbol:'square',label:'Inner reach'},
      {value:'Outer',pattern:'dots',symbol:'square',label:'Outer reach'}
    ]});
  const [a,b,c]=session.records.map(row=>row.ref);
  assert.deepEqual(encoding.entries,[
    {value:'Inner',label:'Inner reach',pattern:'dots',symbol:'square',code:'1'},
    {value:'Outer',label:'Outer reach',pattern:'dots',symbol:'square',code:'2'}
  ]);
  assert.equal(encoding.mark(a),encoding.mark(c));
  assert.equal(encoding.name(b),'B');
  assert(Object.isFrozen(encoding.mark(a)));
  session.update({filter:{path:['sector'],value:'Outer'}});
  assert.equal(encoding.mark(session.snapshot().visible[0].ref).code,'2');
  assert.equal(encoding.mark({dataset:'missing',row:0}),undefined);
  assert.throws(()=>session.encoding({category:'sector',categories:[{value:'Inner',pattern:'unknown'}]}),/category encoding/);
});

test('browser controls link table, chart, map and WebGL scene picks', {skip:!process.env.INK_TEST_CHROME}, () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-linked-'));
  try {
    fs.writeFileSync(path.join(dir,'kit.js'),studio.bundle()+'\nwindow.KIT=KIT;');
    const moduleURL=pathToFileURL(path.join(__dirname,'../webgl.mjs')).href;
    const page=path.join(dir,'index.html');
    fs.writeFileSync(page,`<!doctype html><style>body{margin:0}</style><div id="host"></div><pre id="result"></pre>
<script src="./kit.js"></script>
<script type="module">
import { mountLinkedViews } from ${JSON.stringify(moduleURL)};
try {
  const spec=${JSON.stringify(spec)};
  const prepared=KIT.dataInputs.prepare(spec.dataInputs).get('stations');
  const session=KIT.linkedViews.create(prepared,{timeColumn:'t',window:{past:2,future:2}});
  const display=KIT.linkedViews.diorama(spec), times=[];
  const ui=mountLinkedViews(host,{toolkit:{KIT,PixelLook,PALETTES},session,filterBy:'sector',chart:{x:'$time',y:'reading'},
    table:{columns:['station','reading']},scene:{world:s=>{times.push(s.time);return display(s);}}});
  const root=host.shadowRoot, at=query=>root.querySelector(query), record=()=>session.snapshot().selection[0]?.key;
  const fired=[];
  function location(canvas,x,y){const b=canvas.getBoundingClientRect();return {clientX:b.left+x,clientY:b.top+y,button:0};}
  ui.render();
  at('[data-row="0"]').click();
  ui.render();
  fired.push(record());
  const scene=at('[data-view="scene"]');
  scene.onclick(location(scene,scene.clientWidth/2,scene.clientHeight/2));
  ui.render();
  fired.push(record(),at('[data-row="1"]').getAttribute('aria-pressed'));
  const map=at('[data-view="map"]');
  map.onclick(location(map,map.clientWidth-24,map.clientHeight/2));
  ui.render();
  fired.push(record());
  const chart=at('[data-view="chart"]');
  chart.setPointerCapture=()=>{};
  const topLeft=location(chart,50,18), topRight=location(chart,chart.clientWidth-12,chart.clientHeight-37);
  chart.onpointerdown(topLeft);
  chart.onpointermove(topRight);
  chart.onpointerup(topRight);
  ui.render();
  fired.push(session.snapshot().selection.map(r=>r.key).join(''));
  const filter=at('select'), slider=at('input');
  filter.value='1';filter.dispatchEvent(new Event('change'));
  slider.value='2';slider.dispatchEvent(new Event('input'));
  ui.render();
  fired.push(at('.clock output').textContent,at('tbody').innerText.trim(),times.at(-1));
  filter.value='';filter.dispatchEvent(new Event('change'));
  ui.render();
  fired.push(at('[data-row="2"]').getAttribute('aria-pressed'));
  at('.clear').click();
  ui.render();
  fired.push(session.snapshot().selection.length);
  ui.destroy();
  fired.push(root.childElementCount);
  const themed=mountLinkedViews(host,{session,panels:['table','chart'],chart:{x:'$time',y:'reading'},
    controls:{filter:false,time:false,clear:false},labels:{chart:'Readings'},
    defaultStyles:false,stylesheet:
      ':host{display:block} [hidden]{display:none} [part=panels]{display:grid} canvas{width:300px;height:150px;--ink-linked-plot-background:#f2e1d0}'});
  themed.render();
  const ctx=at('[data-view="chart"]').getContext('2d');
  fired.push(Array.from(root.querySelectorAll('[data-panel]'),node=>node.dataset.panel).join(','),
    root.querySelectorAll('style').length,at('[data-label="chart"]').textContent,at('[part=toolbar]').hidden,
    Array.from(ctx.getImageData(0,0,1,1).data).join(','));
  themed.destroy();

  const accessible=mountLinkedViews(host,{session,panels:['chart','map','table'],chart:{x:'$time',y:'reading',
    scaleLabels:{x:{min:'Opening',max:'Closing'}}},table:{columns:['station','reading'],pageSize:1,caption:'Survey readings'},
    encoding:{category:'sector',label:'station',monochrome:true,
      categories:[{value:'Inner',label:'Inner reach'},{value:'Outer',label:'Outer reach'}]}});
  const press=(node,key,shiftKey=false)=>node.dispatchEvent(new KeyboardEvent('keydown',{key,shiftKey,bubbles:true,cancelable:true}));
  const keys=()=>session.snapshot().selection.map(r=>r.key).join('');
  accessible.render();
  const graph=at('[data-view="chart"]'), plan=at('[data-view="map"]');
  graph.focus();
  press(graph,'End');press(graph,'Enter');
  accessible.render();
  const keyboardChart=[keys(),at('tbody button').dataset.row,at('tbody button').getAttribute('aria-label')];
  plan.focus();
  press(plan,'Home');press(plan,' ',true);
  accessible.render();
  const keyboardMap=keys();
  const button=at('tbody button');
  button.focus();press(button,'End');press(button,'Enter',true);
  accessible.render();
  const keyboardTable=[keys(),root.activeElement.dataset.row,root.activeElement.tabIndex];
  session.update({filter:{path:['sector'],value:'Outer'}});
  accessible.render();
  graph.focus();press(graph,' ');
  accessible.render();
  const legend=at('[part="encoding-items"]'), swatches=Array.from(legend.querySelectorAll('canvas'),swatch=>
    Array.from(swatch.getContext('2d').getImageData(0,0,23,20).data).join(','));
  fired.push({keyboardChart,keyboardMap,keyboardTable,filtered:keys(),caption:at('caption').textContent,
    list:Array.from(legend.querySelectorAll('li span'),node=>node.textContent),
    distinctSwatches:swatches[0]!==swatches[1],description:graph.getAttribute('aria-describedby'),
    timeBounds:Array.from(at('#chart-scale dd').children,node=>node.textContent),
    scope:at('th').scope,status:at('[part="record-status"]').textContent});
  accessible.destroy();
  result.textContent=JSON.stringify(fired);
} catch(error) {result.textContent=error.stack;}
</script>`);
    const output=execFileSync(process.env.INK_TEST_CHROME,['--headless','--no-first-run','--disable-background-networking',
      '--allow-file-access-from-files','--enable-unsafe-swiftshader','--use-angle=swiftshader','--window-size=1280,960',
      '--user-data-dir='+path.join(dir,'profile'),'--dump-dom',pathToFileURL(page).href],
      {encoding:'utf8',timeout:45_000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
    const result=output.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];
    const decoded=result?.replaceAll('&gt;','>').replaceAll('&lt;','<').replaceAll('&amp;','&');
    assert(decoded?.startsWith('['),decoded||'Browser did not report linked view results');
    assert.deepEqual(JSON.parse(decoded),['A','B','true','C','ABC','2 s','B\t50',2,'true',0,0,
      'table,chart',1,'Readings',true,'242,225,208,255',{
        keyboardChart:['C','2','C. Inner reach'],keyboardMap:'AC',keyboardTable:['A','2',0],filtered:'B',
        caption:'Survey readings',list:['Inner reach','Outer reach'],distinctSwatches:true,
        description:'keyboard-help chart-scale',timeBounds:['Opening 0','Closing 2'],
        scope:'col',status:'B. Outer reach. Record 1 of 1. Selected'
      }]);
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
