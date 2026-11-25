'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {test} = require('node:test');
const {setTimeout:pause} = require('node:timers/promises');
const {pathToFileURL} = require('node:url');
const {withChrome} = require('../cli/canvas-grid-chrome.js');
const ink = require('..');
const PNG = require('../cli/png.js');

const rectangle = {x:2,y:1,width:3,height:2};
const selection = {format:'ink-studio/tileset-selection',version:1,tileset:'masonry',...rectangle};
const scene = {id:'test',style:'slate',solids:[],tilesets:{
  masonry:ink.readTilesetImage(PNG.encode(8,6,Uint8Array.from({length:192},(_,i)=>i%4===3 ? 255 : i),4)),
  wide:ink.createBlankTileset({width:600,height:1})
}};

function setup(t, document = scene) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tileset-pick-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename = path.join(dir,'scene.json');
  fs.writeFileSync(filename,JSON.stringify(document));
  const tileset = (...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'tileset',...args],{cwd:dir,encoding:'utf8',stdio:'pipe'});
  const cli = (...args)=>tileset('pick','--scene',filename,'--id','masonry',...args);
  return {dir,filename,cli,tileset};
}

test('SDK picks exact rectangular texels, handles the last pixel, and rejects invalid bounds',()=>{
  assert.deepEqual(ink.pickTilesetRectangle(scene,'masonry',rectangle),selection);
  assert.equal(ink.pickTilesetRectangle(scene,'wide',{x:599,y:0,width:1,height:1}).x,599);
  for (const bounds of [{x:-1},{x:1.5},{width:0},{width:7},{y:5},{height:Infinity}])
    assert.throws(()=>ink.pickTilesetRectangle(scene,'masonry',{...rectangle,...bounds}),/whole texels inside/);
  assert.throws(()=>ink.pickTilesetRectangle(scene,'missing',rectangle),/Unknown tileset missing/);
});

test('CLI emits the same selection and rejects partial input',t=>{
  const {dir,filename,cli} = setup(t), output = path.join(dir,'pick.json');
  const coords = ['--x','2','--y','1','--width','3','--height','2'];
  assert.deepEqual(JSON.parse(cli(...coords)),selection);
  cli(...coords,'--out',output);
  assert.deepEqual(JSON.parse(fs.readFileSync(output,'utf8')),selection);
  assert.throws(()=>cli('--x','2','--width','3'),/all four rectangle values/);
  assert.throws(()=>cli(...coords,'--out',filename),/separately from the source scene/);
});

test('offline grid picking and numeric editing download identical JSON',
  {skip:!process.env.INK_TEST_CHROME},async t=>{
    const {dir,cli} = setup(t), page = path.join(dir,'picker.html');
    cli('--out',page);
    await withChrome(dir,{},async browser=>{
      await browser.send('Emulation.setDeviceMetricsOverride',{width:900,height:760,deviceScaleFactor:1,mobile:false});
      await browser.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
      await browser.send('Page.navigate',{url:pathToFileURL(page).href});
      for (let i=0;i<100 && !await browser.evaluate("document.querySelector('.ink-grid-main')?.width === 8");i++)
        await pause(30);
      const box = await browser.evaluate("document.querySelector('.ink-grid-main').getBoundingClientRect().toJSON()");
      const at = (x,y)=>({x:box.left+(x+.5)*box.width/8,y:box.top+(y+.5)*box.height/6});
      const mouse = (type, point, buttons)=>browser.send('Input.dispatchMouseEvent',
        {type,...point,button:'left',buttons,clickCount:1});
      await mouse('mousePressed',at(4,2),1);
      await mouse('mouseMoved',at(2,1),1);
      await mouse('mouseReleased',at(2,1),0);
      const values = "Array.from(document.querySelectorAll('form input'),input=>input.valueAsNumber)";
      assert.deepEqual(await browser.evaluate(values),[2,1,3,2]);
      await browser.evaluate(`document.querySelector('#save').click(); true`);
      const downloaded = path.join(dir,'masonry-selection.json');
      for (let i=0;i<100 && !fs.existsSync(downloaded);i++) await pause(30);
      assert.deepEqual(JSON.parse(fs.readFileSync(downloaded,'utf8')),selection);
      const edit = (name,value)=>browser.evaluate(`(() => {
        const node = document.querySelector('input[name="${name}"]');
        node.value = ${JSON.stringify(value)};
        node.dispatchEvent(new Event('input'));
        return document.querySelector('#save').disabled;
      })()`);
      assert.equal(await edit('width',8),true);
      assert.equal(await edit('width',3),false);
      assert.deepEqual(await browser.evaluate(values),[2,1,3,2]);
      assert.deepEqual(await browser.evaluate(`Array.from(['x','y','width','height'],key=>
        Number(document.querySelector('.ink-grid-selection').style.getPropertyValue('--ink-selection-'+key)))`),[2,1,3,2]);
    });
  });

const tile = {width:2,height:2};
const brushBounds = {x:2,y:2,width:4,height:4};
const brush = {format:'ink-studio/tileset-brush',version:1,tileset:'masonry',...brushBounds,
  tileWidth:2,tileHeight:2,columns:2,rows:2};

test('an ordered tile brush preserves the atlas block and excludes partial tiles',t=>{
  const {cli} = setup(t);
  const size = ['--tile-width','2','--tile-height','2'];
  const coords = ['--x','2','--y','2','--width','4','--height','4'];
  assert.deepEqual(ink.pickTilesetBlock(scene,'masonry',brushBounds,tile),brush);
  assert.deepEqual(JSON.parse(cli(...coords,...size)),brush);
  assert.throws(()=>cli(...coords,'--tile-width','3'),/both --tile-width and --tile-height/);
  assert.throws(()=>ink.pickTilesetBlock(scene,'masonry',{...brushBounds,x:1},tile),/whole tile boundaries/);
  assert.throws(()=>ink.pickTilesetBlock(scene,'masonry',{...brushBounds,x:0,width:8},{width:3,height:2}),/inside the tileset/);
  assert.throws(()=>ink.pickTilesetBlock(scene,'masonry',brushBounds,{width:9,height:2}),/fit the tileset/);
});

test('the CLI reopens a brush and previews the original texels in brush order',t=>{
  const {dir,filename} = setup(t);
  const file = path.join(dir,'brush.json'), out = path.join(dir,'preview.png');
  fs.writeFileSync(file,JSON.stringify(brush));
  execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'tileset','brush-preview',file,'--scene',filename,'--out',out]);
  const {w,h,data} = PNG.raster(out);
  assert.deepEqual([w,h],[4,4]);
  const source = Buffer.from(scene.tilesets.masonry.data,'base64'), expected = [];
  for (let row=2;row<6;row++) expected.push(...source.subarray((row*8+2)*4,(row*8+6)*4));
  assert.deepEqual([...data],expected);
  assert.deepEqual([...ink.rasterizeTilesetBrush(scene,brush).pixels],expected);
  assert.throws(()=>ink.rasterizeTilesetBrush(scene,{...brush,columns:1}),/counts do not match/);
});

test('scene editor changes tile dimensions transactionally without changing images or saved brushes',()=>{
  const editor = ink.createSceneEditor(scene);
  assert.throws(()=>ink.pickTilesetBlock(editor.snapshot(),'masonry',brushBounds),/Set tile dimensions/);
  assert.throws(()=>editor.setTilesetGrid(undefined,tile),/Tile size must fit tileset wide/);
  assert.equal(editor.snapshot().tilesetDefaults,undefined);
  editor.setTilesetGrid('wide',{width:4,height:1});
  assert.deepEqual(editor.setTilesetGrid(undefined,tile),{tileSize:tile,source:'default'});
  assert.deepEqual(editor.tilesetGrid('masonry'),{tileSize:tile,source:'default'});
  assert.deepEqual(ink.pickTilesetBlock(editor.snapshot(),'masonry',brushBounds),brush);
  const original = ink.rasterizeTilesetBrush(editor.snapshot(),brush);

  editor.setTilesetGrid('masonry',{width:4,height:2});
  assert.equal(editor.tilesetGrid('masonry').source,'override');
  assert.throws(()=>ink.pickTilesetBlock(editor.snapshot(),'masonry',brushBounds),/whole tile boundaries/);
  assert.deepEqual(ink.rasterizeTilesetBrush(editor.snapshot(),brush),original);
  assert.equal(editor.snapshot().tilesets.masonry.data,scene.tilesets.masonry.data);
  assert.deepEqual(editor.registerTileset('masonry',scene.tilesets.masonry).tileSize,{width:4,height:2});

  editor.undo();
  assert.deepEqual(editor.tilesetGrid('masonry'),{tileSize:tile,source:'default'});
  editor.redo();
  assert.deepEqual(editor.tilesetGrid('masonry'),{tileSize:{width:4,height:2},source:'override'});
  editor.setTilesetGrid('masonry',null);
  assert.deepEqual(editor.tilesetGrid('masonry'),{tileSize:tile,source:'default'});
  editor.setTilesetGrid(undefined,null);
  assert.deepEqual(editor.tilesetGrid('masonry'),{tileSize:null,source:'unset'});
  assert.throws(()=>ink.createSceneEditor({...scene,tilesetDefaults:{tileSize:{width:2}}}),/integer width and height/);
});

test('headless tile grids persist defaults and sheet overrides and keep one-off picks compatible',t=>{
  const {dir,filename,tileset} = setup(t,{...scene,tilesets:{masonry:scene.tilesets.masonry}});
  const output = name=>path.join(dir,name+'.json');
  const grid = (input,...args)=>JSON.parse(tileset('grid','--scene',input,...args));
  const pick = (input,id,...args)=>JSON.parse(tileset('pick','--scene',input,'--id',id,
    '--x','0','--y','0','--width','4','--height','4',...args));

  const defaults = output('defaults'), revised = output('revised'), inherited = output('inherited');
  grid(filename,'--tile-width','2','--tile-height','2','--out',defaults);
  assert.deepEqual(grid(defaults),{tileSize:tile,source:'default'});
  assert.equal(pick(defaults,'masonry','--brush').columns,2);
  assert.equal(pick(defaults,'masonry').format,'ink-studio/tileset-selection');

  tileset('create','--scene',defaults,'--id','glass','--width','4','--height','4','--out',revised,
    '--tile-width','4','--tile-height','1');
  assert.deepEqual(grid(revised,'--id','glass'),{id:'glass',tileSize:{width:4,height:1},source:'override'});
  assert.deepEqual([pick(revised,'glass','--brush').columns,pick(revised,'glass','--brush').rows],[1,4]);
  assert.equal(pick(revised,'glass','--tile-width','2','--tile-height','2').columns,2);
  grid(revised,'--id','glass','--clear','--out',inherited);
  assert.equal(grid(inherited,'--id','glass').source,'default');
  assert.equal(pick(inherited,'glass','--brush').columns,2);

  const png = path.join(dir,'border.png'), imported = output('imported');
  fs.writeFileSync(png,PNG.encode(4,1,new Uint8Array(16),4));
  tileset('import',png,'--scene',inherited,'--id','border','--out',imported,'--tile-width','4','--tile-height','1');
  assert.deepEqual(grid(imported,'--id','border'),{id:'border',tileSize:{width:4,height:1},source:'override'});
  assert.throws(()=>grid(imported,'--id','border','--clear','--out',output('invalid')),/Tile size must fit tileset border/);
  assert.equal(fs.existsSync(output('invalid')),false);
});

test('tile brush dimensions remain pinned across scene revisions while raster pixels stay exact',()=>{
  const editor = ink.createSceneEditor(scene);
  for (const density of [0,-1,Infinity,'16',NaN]) {
    assert.throws(()=>editor.setTilesetTexelsPerUnit(density),/finite positive number/);
  }
  assert.throws(()=>ink.sizeTilesetBrush(scene,brush),/Set tileset texels per unit/);
  assert.equal(editor.setTilesetTexelsPerUnit(4),4);
  const picked = ink.pickTilesetBlock(editor.snapshot(),'masonry',brushBounds,tile);
  assert.deepEqual(picked,{...brush,texelsPerUnit:4,brushScale:1});
  const sized = ink.sizeTilesetBrush(editor.snapshot(),picked,{brushScale:2.5});
  assert.deepEqual(sized.worldSize,{width:2.5,height:2.5});
  assert.deepEqual(sized.tileWorldSize,{width:1.25,height:1.25});
  assert.equal(picked.brushScale,1);

  editor.setTilesetTexelsPerUnit(8);
  assert.deepEqual(ink.sizeTilesetBrush(editor.snapshot(),sized.brush),sized);
  assert.deepEqual(ink.sizeTilesetBrush(editor.snapshot(),brush).worldSize,{width:.5,height:.5});
  assert.deepEqual(ink.rasterizeTilesetBrush(editor.snapshot(),sized.brush),ink.rasterizeTilesetBrush(scene,brush));
  editor.undo();
  assert.equal(editor.snapshot().tilesetDefaults.texelsPerUnit,4);
  assert.throws(()=>ink.sizeTilesetBrush(scene,{...brush,texelsPerUnit:4}),/Saved brush scale/);
  assert.throws(()=>ink.sizeTilesetBrush(scene,{...picked,texelsPerUnit:1},{brushScale:Number.MAX_VALUE}),/World width/);
  assert.throws(()=>ink.createSceneEditor({...scene,tilesetDefaults:{texelsPerUnit:0}}),/Texels per unit/);
});

test('headless brush picks share project texel density and can save independent world sizes',t=>{
  const {dir,filename,tileset} = setup(t,{...scene,tilesets:{masonry:scene.tilesets.masonry},
    tilesetDefaults:{tileSize:tile}});
  fs.writeFileSync(path.join(dir,'ink-studio.config.js'),'module.exports = {texelsPerUnit: 4};');
  const file = name=>path.join(dir,name+'.json');
  const scale = (input,...args)=>JSON.parse(tileset('world-scale','--scene',input,...args));
  const pick = (input,...args)=>tileset('pick','--scene',input,'--id','masonry','--brush',
    '--x','0','--y','0','--width','4','--height','2',...args);
  const measure = (input,asset,...args)=>JSON.parse(tileset('brush-size',asset,'--scene',input,...args));

  assert.deepEqual(scale(filename),{texelsPerUnit:4,source:'project'});
  const sibling = file('sibling'), small = file('small'), large = file('large');
  fs.copyFileSync(filename,sibling);
  pick(sibling,'--brush-scale','.5','--out',small);
  const first = measure(filename,small);
  const second = measure(filename,small,'--brush-scale','2','--out',large);
  assert.equal(first.brush.texelsPerUnit,4);
  assert.deepEqual(first.worldSize,{width:.5,height:.25});
  assert.deepEqual(second.worldSize,{width:2,height:1});
  assert.deepEqual(JSON.parse(fs.readFileSync(large,'utf8')),second.brush);
  assert.deepEqual(ink.rasterizeTilesetBrush(scene,first.brush),ink.rasterizeTilesetBrush(scene,second.brush));

  const portable = file('portable'), changed = file('changed'), inherited = file('inherited');
  assert.equal(scale(filename,'--texels-per-unit','8','--out',portable).source,'scene');
  assert.equal(JSON.parse(pick(portable)).texelsPerUnit,8);
  assert.deepEqual(measure(portable,small),first);
  assert.throws(()=>pick(portable,'--brush-scale','0'),/Brush scale/);
  tileset('grid','--scene',portable,'--tile-width','4','--tile-height','2','--out',changed);
  assert.deepEqual(scale(changed),{texelsPerUnit:8,source:'scene'});
  assert.equal(JSON.parse(pick(changed)).tileWidth,4);
  assert.equal(scale(changed,'--clear','--out',inherited).source,'project');
  assert.equal(JSON.parse(pick(inherited)).texelsPerUnit,4);
});

test('tile brush UV insets independently trim the sampling rectangle without altering the brush',()=>{
  const scaled = {...brush,texelsPerUnit:4,brushScale:1.5};
  const base = ink.tilesetBrushUV(scene,scaled);
  const bounds = [2,2,6,6];
  assert.deepEqual(base.texelBounds,bounds);
  assert.deepEqual(base.uvBounds,base.sourceUVBounds);
  for (const [axis,edge,step] of [[0,'left',1],[1,'top',1],[2,'right',-1],[3,'bottom',-1]]) {
    const expected = bounds.slice();
    expected[axis] += step*.5;
    const mapped = ink.tilesetBrushUV(scene,scaled,{[edge]:.5});
    assert.deepEqual(mapped.texelBounds,expected);
    assert.deepEqual(mapped.uvBounds,expected.map((n,i)=>n/(i%2 ? 6 : 8)));
  }
  const {brush:inset} = ink.tilesetBrushUV(scene,scaled,{top:.5,bottom:1,left:1.25,right:.25});
  const retouched = ink.tilesetBrushUV(scene,inset,{top:0});
  assert.deepEqual(retouched.brush.uvInset,{top:0,bottom:1,left:1.25,right:.25});
  assert.deepEqual(retouched.texelBounds,[3.25,2,5.75,5]);
  assert.deepEqual(ink.sizeTilesetBrush(scene,inset).worldSize,ink.sizeTilesetBrush(scene,scaled).worldSize);
  assert.deepEqual(ink.rasterizeTilesetBrush(scene,inset),ink.rasterizeTilesetBrush(scene,scaled));
  assert.equal(scaled.uvInset,undefined);
  for (const change of [{top:1,bottom:3},{left:4},{right:-1},{left:Infinity},{top:'1'},{center:1}]) {
    assert.throws(()=>ink.tilesetBrushUV(scene,scaled,change),/UV inset/);
  }
});

test('headless brush UV edits only the selected face pigment layout and invalidates its bake',t=>{
  const [left,top,right,bottom] = ink.tilesetBrushUV(scene,brush).uvBounds;
  const uvs = [[left,bottom],[right,bottom],[right,top],[left,top]];
  const vertices = [[0,0,0],[2,0,0],[2,1,0],[0,1,0],[4,0,0],[4,1,0]].map((position,i)=>({id:'v'+i,position}));
  function face(id, indices) {
    return {id,material:'paint',corners:indices.map((i,j)=>({id:id+'-c'+j,vertex:vertices[i].id,
      uv:[[0,1],[1,1],[1,0],[0,0]][j],attributes:{'uv/1':uvs[j]}}))};
  }
  const source = {...scene,topologyMeshes:{panel:{
    document:{id:'panel',vertices,uvBindings:{pigment:1},faces:[face('sign',[0,1,2,3]),face('trim',[1,4,5,2])]},
    materials:[{id:'paint',texture:{tileset:'masonry'}}],
    bakes:[{id:'old-bake',material:'paint',maps:{roughness:.45}}]
  }}};
  const {dir,filename,tileset} = setup(t,source);
  const file = name=>path.join(dir,name+'.json'), read = name=>JSON.parse(fs.readFileSync(name,'utf8'));
  fs.writeFileSync(file('brush'),JSON.stringify(brush));
  const cli = (input,asset,...args)=>JSON.parse(tileset('brush-uv',file(asset),'--scene',input,...args));
  const report = cli(filename,'brush','--inset-top','.5','--inset-bottom','1','--inset-left','1.25',
    '--inset-right','.25','--out',file('inset'));
  assert.deepEqual(report.brush,read(file('inset')));
  assert.deepEqual(report.texelBounds,[3.25,2.5,5.75,5]);
  const target = ['--object','panel','--face','sign'];
  const plan = cli(filename,'inset',...target);
  assert.equal(plan.uv.canCommit,true);
  assert.equal(plan.uv.corners.length,4);
  const committed = cli(filename,'inset',...target,'--out',file('edited'));
  assert.deepEqual(committed.uv,plan.uv);
  const before = ink.createSceneEditor(read(filename)).meshTopology('panel');
  const after = ink.createSceneEditor(read(file('edited'))).meshTopology('panel');
  assert.deepEqual(before.document.vertices,after.document.vertices);
  assert.deepEqual(before.document.faces[1],after.document.faces[1]);
  assert.deepEqual(before.document.faces[0].corners.map(row=>row.uv),after.document.faces[0].corners.map(row=>row.uv));
  assert.deepEqual(after.document.faces[0].corners.map(row=>row.attributes['uv/1']),
    [[3.25/8,5/6],[5.75/8,5/6],[5.75/8,2.5/6],[3.25/8,2.5/6]]);
  assert.deepEqual(after.bakes[0].invalidated.faces,['sign']);
  assert.deepEqual(cli(file('edited'),'inset',...target).uv.corners,[]);

  source.topologyMeshes.panel.document.faces[0].corners[0].uvPins = {1:true};
  fs.writeFileSync(file('pinned'),JSON.stringify(source));
  const rejected = cli(file('pinned'),'inset',...target);
  assert.equal(rejected.uv.canCommit,false);
  assert.equal(rejected.uv.operations[0].conflicts[0].code,'pinned-corner');
  assert.throws(()=>cli(file('pinned'),'inset',...target,'--out',file('rejected')));
  assert.equal(fs.existsSync(file('rejected')),false);
});

const paddedSize = {width:3,height:2,paddingX:2,paddingY:3,offsetX:1,offsetY:2};
const paddedBounds = {x:6,y:7,width:8,height:7};
const paddedBrush = {format:'ink-studio/tileset-brush',version:1,tileset:'signals',...paddedBounds,
  tileWidth:3,tileHeight:2,columns:2,rows:2,paddingX:2,paddingY:3,offsetX:1,offsetY:2,texelsPerUnit:2,brushScale:1};
const paddedPixels = Uint8Array.from({length:16*15*4},(_,i)=>i%4 === 3 ? (Math.floor(i/4)%2 ? 255 : 0) : i%251);
const paddedScene = {id:'padded',style:'slate',solids:[],
  tilesetDefaults:{tileSize:paddedSize,texelsPerUnit:2},
  tilesets:{signals:ink.readTilesetImage(PNG.encode(16,15,paddedPixels,4))}};

test('padded tile brushes skip the atlas gutters and keep the original world grid',()=>{
  assert.deepEqual(ink.pickTilesetBlock(paddedScene,'signals',paddedBounds),paddedBrush);
  const block = ink.rasterizeTilesetBrush(paddedScene,paddedBrush);
  assert.deepEqual([block.width,block.height],[6,4]);
  for (const [column,row,x,y] of [[0,0,6,7],[1,0,11,7],[0,1,6,12],[1,1,11,12]]) {
    const pick = ink.pickTilesetBlock(paddedScene,'signals',{x,y,width:3,height:2});
    assert.deepEqual([pick.columns,pick.rows],[1,1]);
    const single = ink.rasterizeTilesetBrush(paddedScene,pick);
    const cell = ink.tilesetBrushCellUV(paddedScene,paddedBrush,{column,row},{left:.25,bottom:.5});
    assert.deepEqual(cell.cell,{column,row,x,y,width:3,height:2,offset:[column*3,row*2]});
    assert.deepEqual(cell.texelBounds,[x+.25,y,x+3,y+1.5]);
    assert.deepEqual(cell.uvBounds,ink.tilesetBrushUV(paddedScene,pick,{left:.25,bottom:.5}).uvBounds);
    for (let dy=0;dy<2;dy++) {
      const at = ((row*2+dy)*block.width+column*3)*4, sourceAt = ((y+dy)*16+x)*4;
      assert.deepEqual(block.pixels.slice(at,at+12),paddedPixels.slice(sourceAt,sourceAt+12));
      assert.deepEqual(single.pixels.slice(dy*12,dy*12+12),block.pixels.slice(at,at+12));
    }
  }
  assert.deepEqual(ink.sizeTilesetBrush(paddedScene,paddedBrush).worldSize,{width:3,height:2});
  assert.deepEqual(ink.sizeTilesetBrush(paddedScene,paddedBrush).tileWorldSize,{width:1.5,height:1});
  for (const bounds of [{x:7},{y:8},{width:7},{height:6},{width:9}])
    assert.throws(()=>ink.pickTilesetBlock(paddedScene,'signals',{...paddedBounds,...bounds}),/inside the tileset|whole tile/);
  assert.throws(()=>ink.pickTilesetBlock(paddedScene,'signals',paddedBounds,{...paddedSize,paddingY:-1}),/Tile padding/);
  assert.throws(()=>ink.tilesetBrushCellUV(paddedScene,paddedBrush,{column:2,row:0}),/inside the pick/);
  assert.throws(()=>ink.rasterizeTilesetBrush(paddedScene,{...paddedBrush,rows:3}),/counts do not match/);

  const editor = ink.createSceneEditor(paddedScene);
  editor.setTilesetGrid('signals',{...paddedSize,paddingY:1});
  assert.equal(editor.tilesetGrid('signals').tileSize.paddingY,1);
  editor.setTilesetGrid('signals',{width:3,height:2});
  assert.deepEqual(editor.tilesetGrid('signals').tileSize,{width:3,height:2});
  assert.deepEqual(ink.rasterizeTilesetBrush(editor.snapshot(),paddedBrush),block);
  editor.undo();
  assert.equal(editor.tilesetGrid('signals').tileSize.paddingY,1);
});

test('the CLI picks aligned cells from the saved padded grid and resolves their UVs',t=>{
  const vertices = [[0,0,0],[1.5,0,0],[1.5,1,0],[0,1,0]].map((position,i)=>({id:'v'+i,position}));
  const uvs = [[11/16,14/15],[14/16,14/15],[14/16,12/15],[11/16,12/15]];
  const corners = vertices.map(({id:vertex},i)=>({id:'c'+i,vertex,uv:uvs[i]}));
  const face = {id:'cell',material:'paint',corners};
  const source = {...paddedScene,tilesetDefaults:{texelsPerUnit:2},topologyMeshes:{sign:{
    document:{id:'sign',vertices,faces:[face]},materials:[{id:'paint',texture:{tileset:'signals'}}]
  }}};
  const {dir,filename,tileset} = setup(t,source);
  const file = name=>path.join(dir,name+'.json'), preview=path.join(dir,'preview.png');
  const args = ['--tile-width','3','--tile-height','2','--padding-x','2','--padding-y','3','--offset-x','1','--offset-y','2'];
  const grid = JSON.parse(tileset('grid','--scene',filename,'--id','signals',...args,'--out',file('gridded')));
  assert.deepEqual(grid.tileSize,paddedSize);
  const coords = ['--x','6','--y','7','--width','8','--height','7'];
  tileset('pick','--scene',file('gridded'),'--id','signals','--brush',...coords,'--out',file('brush'));
  assert.deepEqual(JSON.parse(fs.readFileSync(file('brush'),'utf8')),paddedBrush);
  assert.deepEqual(JSON.parse(tileset('pick','--scene',filename,'--id','signals',...args,...coords)),paddedBrush);

  tileset('brush-preview',file('brush'),'--scene',file('gridded'),'--out',preview);
  const {w,h,data} = PNG.raster(preview), expected = ink.rasterizeTilesetBrush(paddedScene,paddedBrush);
  assert.deepEqual([w,h],[expected.width,expected.height]);
  assert.deepEqual(new Uint8Array(data),expected.pixels);
  const uv = JSON.parse(tileset('brush-uv',file('brush'),'--scene',file('gridded'),'--column','1','--row','1','--inset-top','.5'));
  assert.deepEqual(uv,ink.tilesetBrushCellUV(paddedScene,paddedBrush,{column:1,row:1},{top:.5}));
  const edit = ['brush-uv',file('brush'),'--scene',file('gridded'),'--object','sign','--face','cell','--inset-top','.5'];
  assert.throws(()=>tileset(...edit),/Choose --column and --row/);
  const applied = JSON.parse(tileset(...edit,'--column','1','--row','1','--out',file('inset')));
  assert.equal(applied.uv.canCommit,true);
  const updated = JSON.parse(fs.readFileSync(file('inset'),'utf8')).topologyMeshes.sign.document;
  assert.deepEqual(updated.vertices,vertices);
  assert.deepEqual(updated.faces[0].corners.map(corner=>corner.uv),
    [[11/16,14/15],[14/16,14/15],[14/16,12.5/15],[11/16,12.5/15]]);
});
