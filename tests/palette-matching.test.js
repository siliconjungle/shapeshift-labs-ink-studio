const assert = require('node:assert/strict');
const {test} = require('node:test');
const {load,render} = require('..');
const {KIT:K,PixelLook,ColorSpace,makeBuilder,makeSculpt,RenderStages} = load();
const modes = ['rgb','perceptual','brightness','chroma','hue'];
const palette = ['#2c4445','#4f6467','#73847e','#abc1b2','#66372b','#986047','#c88c54','#f1ca81','#27232e'];
const rgb = hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
const match = (mode, color, swatches=palette)=>{
  const plan = PixelLook.preparePalette({palette:swatches,match:mode});
  return swatches[plan.index(rgb(color))];
};

test('matching modes prioritize their own feature and agree on neutral hue fallback',()=>{
  assert.equal(match('rgb','#46332e'),'#66372b');
  assert.equal(match('perceptual','#46332e'),'#2c4445');
  assert.equal(match('perceptual','#756763'),'#4f6467');
  assert.equal(match('brightness','#756763'),'#986047');
  assert.equal(match('perceptual','#58423a'),'#66372b');
  assert.equal(match('chroma','#58423a'),'#2c4445');
  assert.equal(match('perceptual','#987c68'),'#73847e');
  assert.equal(match('hue','#987c68'),'#c88c54');
  assert.equal(match('hue','#888888'),match('perceptual','#888888'));
  const colors = [[.54,-.16,.012],[.52,.155,-.017],[.56,.13,.092]].map(ColorSpace.fromOKLab);
  const input = ColorSpace.fromOKLab([.51,.16,.006]);
  assert.equal(PixelLook.preparePalette({palette:colors,match:'hue'}).index(input),1);
  assert.throws(()=>PixelLook.preparePalette({palette,match:'temperature'}),/Palette match/);
});

test('reserved exact colors win before matching and perceptual dithering uses the selected metric',()=>{
  for (const mode of modes) {
    const plan = PixelLook.preparePalette({palette,reserved:['#aa0000'],match:mode});
    assert.equal(plan.packed[plan.index(rgb('#aa0000'))],0xaa0000);
    assert.notEqual(plan.packed[plan.index(rgb('#a90000'))],0xaa0000);
  }
  const shades = ['#202020','#e0e0e0'], plan = PixelLook.preparePalette({palette:shades,match:'brightness',
    dither:{pattern:'checker',strength:1}});
  const [lo,hi] = shades.map(color=>ColorSpace.toOKLab(rgb(color))[0]);
  const input = ColorSpace.fromOKLab([lo+(hi-lo)*.42,0,0]);
  assert.equal(plan.index(input,0,0,false),0);
  assert.equal(plan.index(input,0,0),1);
  assert.equal(plan.index(input,1,0),0);
});

test('material constraints, staged policies and versioned looks use the same matcher',()=>{
  const expected = rgb('#c88c54').map(v=>Math.round(v*255));
  const definition = {palette,match:'hue'};
  const B = makeBuilder(1,[0x18222c,0x987c68]);
  const S = makeSculpt(B);
  const paint = K.surface.material({r:[1],em:true,materialId:'copper'},{paletteConstraint:definition});
  S.box([0,0,0],[.65,.65,.20],paint,{res:.075});
  S.bake();
  const look = K.authoring.looks.scene({renderStages:[
    {stage:'palette',select:{material:'copper'},palette:definition}
  ]});
  const legacy = B.finish({cam:{target:[0,0,0],yaw:0,pitch:0,dist:5,sway:0}});
  const view = {w:64,h:64,px:1,ortho:true};
  const at = frame=>[...frame.rgb.slice((32*64+32)*3,(32*64+32)*3+3)];
  assert.deepEqual(at(render(legacy,view)),expected);
  const staged = {...legacy,look};
  assert.deepEqual(at(render(staged,view)),expected);
  const rule = RenderStages.plan(staged).at(0).palette[0];
  assert.equal(RenderStages.describe(rule).match,'hue');

  const pack = {format:'ink-studio/asset-pack',version:1,revision:1,id:'warm-metal',title:'Warm metal',
    looks:[{id:'warm-metal/copper',label:'Copper',palette:definition}]};
  const catalog = K.authoring.assetPacks.create({packs:[pack]});
  assert.equal(K.authoring.looks.bind('warm-metal/copper',catalog).palette.match,'hue');
});

test('WebGL palette targets make the same matching choices in both resolves',{skip:!process.env.INK_TEST_CHROME},()=>{
  const run = require('../cli/look-webgl.js');
  const colors = ['#46332e','#756763','#58423a','#987c68'];
  const expected = colors.map(color=>modes.map(mode=>rgb(match(mode,color)).map(v=>Math.round(v*255))));
  const result = run({},({makeBuilder},color)=>{
    const b = makeBuilder(3,[0x151c26,parseInt(color.slice(1),16)]);
    b.disc(0,0,0,[0,0,1],.8,.045,b.P[1],3);
    b.describeSplats(0,b.count(),{material:'matched'});
    return b.finish({cam:{target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0},dither:0});
  },(kit,fixture,backend,{modes,palette,colors})=>{
    const draw = backend(48,48,{ortho:true,dither:0,outline:false});
    try {
      const outputs = colors.map(color=>{
        const world = fixture(kit,color);
        return modes.map(match=>{
          const paletteConstraints = {targets:[{material:'matched',palette,match}]};
          return [false,true].map(coverageAware=>{
            draw.draw(world,{coverageAware,paletteConstraints});
            return draw.sample({center:[24,24]}).center;
          });
        });
      });
      return {outputs};
    } finally { draw.close(); }
  },{modes,palette,colors});
  result.outputs.forEach((row,i)=>row.forEach(([resolved,composited],j)=>{
    const swatch = expected[i][j];
    assert.deepEqual(resolved,swatch);
    // Coverage-aware splats retain a little background contribution even at the center.
    assert(composited.every((n,k)=>Math.abs(n-swatch[k])<=3));
  }));
});
