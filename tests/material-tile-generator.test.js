const test = require('node:test');
const assert = require('node:assert/strict');
const Ink = require('..');
const { graphImages } = Ink.load().KIT.procedural;
const bake = (w,h,c,r,options={},source) => graphImages.tileGenerator(w,h,c,r,source,options);
const samples = (result,plane) => result[plane].raster.data;
const color = (image,p) => Array.from(samples(image,'value').slice(p*4,p*4+4));
const planes = ['value','coverage','tileId','course'];

function compareWindow(base,other,startX,startY) {
  const {width,height}=other.value.raster, baseWidth=base.value.raster.width;
  for (const plane of planes) {
    const a=samples(base,plane),b=samples(other,plane), channels=base[plane].raster.channels;
    for (let y=0;y<height;y++) {
      const start=((startY+y)*baseWidth+startX)*channels, offset=y*width*channels;
      assert.deepEqual(a.subarray(start,start+width*channels),b.subarray(offset,offset+width*channels),plane+' row '+y);
    }
  }
}

test('odd running bond closes at a constant course increment and every wrapped copy is bit identical', () => {
  const options={pattern:'brick',seed:243,aspect:1.5,gutter:[.11,.12],rotation:2,
    palette:['#9a5340','#cd8d65','#d2a275'],jitter:{position:[.08,.018],size:[.17,.08],rotation:3,color:.16},
    samples:2};
  const stamp={type:'rectangle',size:[1,1],radius:.09};
  const period=bake(60,40,4,5,options,stamp);
  const repeat=bake(120,80,4,5,{...options,crop:[-1,0,1,2]},stamp);
  assert.deepEqual(period.layout.rowOffset,{requested:.5,effective:.6,phases:[0,.6,.2,.8,.4]});
  assert.equal(period.layout.placements.length,20);
  assert.deepEqual(period.layout,repeat.layout);
  for (let y=0;y<80;y+=40) for (let x=0;x<120;x+=60) compareWindow(repeat,period,x,y);
  for (let p=0;p<2400;p++) {
    const id=samples(period,'tileId')[p], course=samples(period,'course')[p];
    assert.equal(course,id?Math.ceil(id/4):0);
  }
});

test('crops preserve base placement, labels and sampling without advertising a partial repeat', () => {
  const options={pattern:'brick',seed:8,palette:['#66315d','#e0662c'],columnOffset:.4,rotation:-8,samples:4};
  const base=bake(64,48,4,6,options);
  const crop=bake(24,18,4,6,{...options,crop:[.25,.125,.625,.5]});
  compareWindow(base,crop,16,6);
  assert.deepEqual(base.layout,crop.layout);
  assert.deepEqual(crop.value.descriptor.tiling,{u:'clamp',v:'clamp'});
  const strip=bake(64,24,4,6,{...options,crop:[.25,.25,1.25,.75]});
  assert.deepEqual(strip.coverage.descriptor.tiling,{u:'wrap',v:'clamp'});
  const big=bake(128,96,4,6,options);
  assert.deepEqual(big.layout,base.layout);
});

test('grid, column stagger and checker have unique layouts, with deliberate open and periodic edge rules', () => {
  const grid=bake(24,24,4,4);
  const column=bake(24,24,4,4,{pattern:'column-stagger'});
  const checker=bake(24,24,4,4,{pattern:'checker'});
  assert.deepEqual(grid.layout.columnOffset.phases,[0,0,0,0]);
  assert.deepEqual(column.layout.columnOffset.phases,[0,.5,0,.5]);
  assert.notDeepEqual(samples(grid,'tileId'),samples(column,'tileId'));
  assert.deepEqual(checker.layout.placements.map(n=>n.id),[1,3,6,8,9,11,14,16]);
  assert.throws(()=>bake(24,24,3,4,{pattern:'checker'}),/even count/);
  const open=bake(30,16,3,3,{pattern:'checker',wrap:[false,false],crop:[-1,0,1,1]});
  assert.deepEqual(open.value.descriptor.tiling,{u:'clamp',v:'clamp'});
  for(let y=0;y<16;y++) for(let x=0;x<15;x++) assert.equal(samples(open,'tileId')[y*30+x],0);
  const actual=bake(24,24,4,5,{pattern:'brick',wrap:[true,false]});
  assert.equal(actual.layout.rowOffset.effective,.5);
  const opposite=bake(24,24,4,5,{pattern:'brick',rowOffset:-.5});
  assert.equal(opposite.layout.rowOffset.effective,-.6);
});

test('size, gutters, rotation and custom signed stamps change coverage with stable IDs', () => {
  const kind={type:'rectangle',size:[1,1]};
  const options={gutter:[0,0],size:[.8,.4],rotation:0,seed:3};
  const flat=bake(48,48,2,2,options,kind);
  const diagonal=bake(48,48,2,2,{...options,rotation:45},kind);
  const smaller=bake(48,48,2,2,{...options,gutter:[.3,.2]},kind);
  const round=bake(48,48,2,2,options,{type:'disc',radius:.46});
  const count=result=>samples(result,'coverage').reduce((sum,n)=>sum+n,0);
  assert.notDeepEqual(samples(flat,'coverage'),samples(diagonal,'coverage'));
  assert(count(smaller)<count(flat));
  assert(count(round)<count(flat));
  const spot=bake(17,17,1,1,{gutter:[0,0]},{type:'spot',radius:.45});
  assert.equal(samples(spot,'coverage')[8*17+8],1);
  assert(samples(spot,'coverage').some(n=>n>0&&n<1));
  assert.equal(samples(spot,'tileId')[0],0);
});

test('palette and independent jitter replay with safe-integer seeds and stable course colors', () => {
  const board={pattern:'brick',seed:-17,palette:['#935140','#daae67'],colorMode:'course',
    jitter:{position:[.15,.03],size:[.2,.1],rotation:8}};
  const a=bake(36,24,4,4,board), again=bake(36,24,4,4,board);
  const b=bake(36,24,4,4,{...board,seed:board.seed+2**32});
  assert.deepEqual(a.layout,again.layout);
  assert.deepEqual(samples(a,'value'),samples(again,'value'));
  assert.notDeepEqual(samples(a,'tileId'),samples(b,'tileId'));
  assert.deepEqual(a.layout.rowOffset,b.layout.rowOffset);
  const bricks=a.layout.placements;
  assert.deepEqual(bricks[0].color,bricks[3].color);
  assert.notDeepEqual(bricks[0].color,bricks[4].color);
  const tone=bake(36,24,4,4,{...board,jitter:{...board.jitter,color:.35}});
  assert.deepEqual(samples(a,'tileId'),samples(tone,'tileId'));
  assert.notDeepEqual(samples(a,'value'),samples(tone,'value'));
});

test('subpixel color is averaged in linear light and periodic copies do not double their opacity', () => {
  const mixed=bake(1,1,2,1,{colorMode:'cycle',palette:['#ff0000','#0000ff'],gutter:[0,0],samples:2});
  assert.deepEqual(color(mixed,0),[188,0,188,255]);
  assert.equal(samples(mixed,'coverage')[0],1);
  assert.equal(samples(mixed,'tileId')[0],2);
  const self=bake(9,9,1,1,{gutter:[0,0],size:[2.6,2.6],color:[1,0,0,.5]});
  for (let p=0;p<81;p++) assert.deepEqual(color(self,p),[255,0,0,128]);
  const over=bake(11,7,2,1,{gutter:[0,0],size:[2,1],colorMode:'cycle',palette:[[1,0,0,.5],[0,0,1,.5]]});
  const index=3*11+5;
  assert.equal(samples(over,'tileId')[index],2);
  assert.equal(color(over,index)[3],191);
  assert(color(over,index)[2]>color(over,index)[0]);
});

test('an editable material graph shares its stamp and replays contextual and locked seeds', () => {
  const ref=(node,port='value')=>({node,port}), op=(op,inputs)=>({op,inputs});
  const settings={width:18,height:16,columns:3,rows:4,stamp:ref('shape')};
  const graph={format:'ink-studio/graph-project',version:1,inputs:{
    source:{type:'record',default:{type:'star',tips:4}}
  },nodes:{shape:op('shape.define',{definition:{input:'source'}}),
    tiles:op('image.tileGenerator',{...settings,options:{pattern:'brick',jitter:{color:.24}}}),
    locked:op('image.tileGenerator',{...settings,options:{pattern:'brick',jitter:{color:.24},seed:37}})
  },outputs:{value:ref('tiles'),layout:ref('tiles','layout'),locked:ref('locked')}};
  const material=JSON.parse(JSON.stringify(Ink.openMaterialGraph(graph,{id:'tile-fixture'})));
  const project=Ink.createGraphProject(material);
  const a=project.run({seed:2}).outputs, b=project.run({seed:3}).outputs;
  assert.notEqual(a.layout.seed,b.layout.seed);
  assert.notDeepEqual(a.value.raster.data,b.value.raster.data);
  assert.deepEqual(a.locked.raster.data,b.locked.raster.data);
  assert.deepEqual(a.value.raster.data,Ink.createGraphProject(material).run({seed:2}).outputs.value.raster.data);
  const edited=project.run({seed:2,inputs:{source:{type:'disc',radius:.4}}}).outputs;
  assert.deepEqual(a.layout,edited.layout);
  assert.notDeepEqual(edited.value.raster.data,a.value.raster.data);
});

test('invalid crops, counts, jitter and expensive bakes are rejected early', () => {
  assert.throws(()=>bake(16,16,4,4,{crop:[0,0,0,1]}),/increasing/);
  assert.throws(()=>bake(16,16,64,65),/grid needs/);
  assert.throws(()=>bake(16,16,4,4,{jitter:{position:[2,0]}}),/jitter needs/);
  assert.throws(()=>bake(16,16,4,4,{palette:[]}),/palette needs/);
  assert.throws(()=>bake(1024,1024,4,4,{samples:4},{type:'star',tips:32}),/sample budget/);
});
