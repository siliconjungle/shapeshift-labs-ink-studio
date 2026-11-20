const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const PNG = require('../cli/png.js');
const { KIT: K, SplatEffects } = require('..').load();

const fixture = require('../examples/palette-dither-fit.json');
const { fitDither } = K.palette;
const reviewFixture = {
  target:'#808080',size:[64,32],
  policy:{ palette:['#202020','#6f6f6f','#909090','#e0e0e0','#46607a','#3c5074'],
    dither:{pattern:'bayer',pairs:[
      {colors:['#6f6f6f','#909090']},
      {colors:['#202020','#e0e0e0']},
      {colors:['#46607a','#3c5074']}
    ]} }
};

test('fits every authorized pair, including pairs that omit the closest solid swatch', () => {
  const { report, indexed } = fitDither(fixture);
  assert.equal(report.solid.color, '#1c5c62');
  assert.deepEqual(report.fit.colors, ['#172940', '#486182']);
  assert.equal(report.fit.share, .5);
  assert.equal(report.fit.average, '#364b68');
  assert(report.fit.error < report.solid.error / 10);
  const raster = indexed();
  assert.equal(raster.slots.filter(slot => slot === 1).length, report.fit.secondPixels);
  assert.deepEqual(new Set(raster.slots), new Set([0, 1]));
  const reversed = fixture.policy.dither.pairs.slice().reverse().map(pair => ({ ...pair, colors: pair.colors.slice().reverse() }));
  const reordered = fitDither({ ...fixture, policy: { ...fixture.policy, dither: { pairs: reversed } } });
  assert.deepEqual(reordered.report, report);
  assert.deepEqual(reordered.indexed(), raster);
});

test('finds only coverages that the actual native crop can draw, with ties favoring a solid', () => {
  const definition = {
    target: '#bcbcbc', size: [4, 4],
    policy: { palette: ['#000000', '#ffffff'], dither: { pairs: [{ colors: ['#000000', '#ffffff'] }] } }
  };
  const standard = fitDither(definition);
  assert.equal(standard.report.fit.average, '#bcbcbc');
  assert.equal(standard.report.fit.secondPixels, 8);
  assert.equal(standard.report.fit.share, .5);
  const partial = fitDither({ ...definition, target: '#9c9c9c', size: [3, 3] });
  assert.equal(partial.report.fit.secondPixels, 3);
  assert.equal(partial.report.fit.share, 1 / 3);
  assert.equal(partial.indexed().slots.filter(slot => slot === 1).length, 3);
  const tiny = fitDither({ ...definition, size: [1, 1] });
  assert.deepEqual(tiny.report.fit.colors, [tiny.report.solid.color]);
  assert.equal(tiny.report.fit.error, tiny.report.solid.error);
  const checker = fitDither({ ...definition, size: [3, 3],
    policy: { ...definition.policy, dither: { ...definition.policy.dither, pattern: 'checker' } } });
  assert.deepEqual(checker.indexed().slots, [1, 0, 1, 0, 1, 0, 1, 0, 1]);
  assert.equal(checker.report.fit.share, 5 / 9);
});

test('scene roles and lightness gates limit mixes while reserved matches remain exact', () => {
  const context = { palette: [0x000000, 0xffffff, 0xff0000], roles: { gray: [0, 1], accent: [2] } };
  const colors = ['gray.shadow', 'gray.highlight'];
  const policy = { reserved: ['accent'], dither: { pairs: [{ colors, lightness: [.78, .82] }] } };
  const solve = (target, dither = policy.dither) => fitDither({ target, policy: { ...policy, dither } }, context).report;
  assert.deepEqual(solve('#bcbcbc').fit.colors, ['#000000', '#ffffff']);
  assert.equal(solve('#bcbcbc', { pairs: [{ colors, lightness: [.6, .7] }] }).fit.colors.length, 1);
  assert.equal(solve('#bcbcbc', { pairs: [] }).fit.colors.length, 1);
  assert.equal(solve('#bcbcbc', { ...policy.dither, pattern: 'none' }).fit.colors.length, 1);
  assert.deepEqual(solve('#ff0000').fit.colors, ['#ff0000']);
  assert.deepEqual(solve('#ffffff').fit.colors, ['#ffffff']);
  assert.throws(() => solve('#bcbcbc', {}), /explicit dither.pairs/);
  assert.throws(() => solve('#bcbcbc', { pairs: [{ colors: ['gray.shadow', 'accent'] }] }), /unreserved/);
});

test('seeded blue noise is reproducible with coverage measured from the exported tile', () => {
  const definition = { ...fixture, size: [10, 8], policy: { ...fixture.policy,
    dither: { ...fixture.policy.dither, pattern: 'blue-noise', seed: 3 } } };
  const a = fitDither(definition), b = fitDither(definition);
  assert.equal(a.report.pattern, 'blue-noise');
  assert.deepEqual(a.report, b.report);
  assert.deepEqual(a.indexed(), b.indexed());
  assert.equal(a.indexed().slots.filter(slot => slot === 1).length, a.report.fit.secondPixels);
  assert.notDeepEqual(a.indexed().slots, fitDither({ ...fixture, size: definition.size }).indexed().slots);
});

test('the CLI exports native-size comparisons and matching indexed material tiles', t => {
  const temp = mkdtempSync(join(tmpdir(), 'ink-dither-fit-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = join(temp, 'fixture.json'), preview = join(temp, 'compare.png'), pngTile = join(temp, 'tile.png');
  const definition = { ...fixture, size: [7, 5] };
  writeFileSync(source, JSON.stringify(definition));
  const cli = (...args) => execFileSync(process.execPath, [join(__dirname, '../cli/ink-studio.js'), 'palette', 'fit', source, ...args],
    { encoding: 'utf8' });
  cli('--out', preview);
  cli('--tile', '--out', pngTile);
  const result = JSON.parse(cli('--format', 'data')), fit = fitDither(definition);
  assert.deepEqual(result, { ...fit.report, raster: fit.indexed() });
  for (const [file, expected] of [[preview, fit.preview()], [pngTile, fit.indexed()]]) {
    const bytes = readFileSync(file), pixels = PNG.raster(bytes);
    assert.equal(bytes[25], 3);
    assert.deepEqual([pixels.w, pixels.h], [expected.width, expected.height]);
    for (const [i, slot] of expected.slots.entries()) {
      const rgb = slot === null ? [0, 0, 0, 0] : [
        ...[1, 3, 5].map(start => parseInt(expected.palette[slot].slice(start, start + 2), 16)), 255
      ];
      assert.deepEqual([...pixels.data.subarray(i * 4, i * 4 + 4)], rgb);
    }
  }
  const { raster } = result;
  const resolve = value => value === undefined ? [1, 1, 1] : K.procedural.materials.perceptual.parse(value);
  const layer = SplatEffects.layer({ type: 'projected', pattern: 'indexed', raster,
    projection: { across: [0, 1, 0] } }, undefined, resolve);
  assert.deepEqual([...layer.sample({ position: [.5 / raster.width, raster.size[1] - .5 / raster.width, 0] }).slice(0, 3)],
    K.procedural.materials.perceptual.parse(raster.palette[raster.slots[0]]));
});

test('review compares every attainable pair with the same solid and separates gain from texture', () => {
  const result=K.palette.reviewDither(reviewFixture);
  const [strong,subtle,cool]=result.report.pairs;
  assert.equal(result.report.solid.color,'#909090');
  assert.equal(strong.mix.share,.25);
  assert(strong.gain>0);
  assert.deepEqual(strong.flags,['high-texture']);
  assert.deepEqual(subtle.flags,[]);
  assert.equal(subtle.useful,true);
  assert.deepEqual(cool.flags,['no-improvement']);
  for (const pair of result.report.pairs) {
    assert.equal(pair.gain,result.report.solid.error-pair.mix.error);
    const tile=result.indexed(pair.index);
    assert.equal(tile.slots.filter(slot=>slot===1).length,pair.mix.secondPixels);
    const transitions=tile.slots.reduce((sum,slot,p)=>{
      const x=p%tile.width, right=x+1<tile.width && slot!==tile.slots[p+1];
      const down=p+tile.width<tile.slots.length && slot!==tile.slots[p+tile.width];
      return sum+Number(right)+Number(down);
    },0);
    assert.equal(pair.texture.edges.different,transitions);
  }
  const stricter=K.palette.reviewDither({...reviewFixture,review:{minGain:.1,textureLimit:.1}});
  assert.deepEqual(stricter.report.pairs[subtle.index].flags,['small-improvement','high-texture']);
});

test('a requested share snaps to the crop and the review reports why pairs are unavailable', () => {
  const input = {
    target:'#bcbcbc',size:[3,3],review:{share:.5},
    policy:{palette:['#000000','#ffffff','#404040'],dither:{pattern:'checker',pairs:[
      {colors:['#000000','#ffffff']},{colors:['#000000','#404040'],lightness:[0,.4]}
    ]}}
  };
  const result=K.palette.reviewDither(input), [pair,excluded]=result.report.pairs;
  assert.equal(pair.mix.share,5/9);
  assert.deepEqual(result.indexed(pair.index).slots,[1,0,1,0,1,0,1,0,1]);
  assert.equal(excluded.status,'outside-lightness');
  assert.throws(()=>result.preview(excluded.index),/reviewed dither pair/);
  const tiny=K.palette.reviewDither({...input,size:[1,1]});
  assert.equal(tiny.report.pairs[0].status,'no-mixed-coverage');
  const protectedTarget=K.palette.reviewDither({...input,target:'#bcbcbc',
    policy:{...input.policy,reserved:['#bcbcbc']}});
  assert.equal(protectedTarget.report.pairs[0].status,'reserved-target');
  assert.throws(()=>K.palette.reviewDither({...input,review:{share:1}}),/strictly between/);
});

test('dither review CLI exports each native comparison with target, solid, average and pattern', t => {
  const temp=mkdtempSync(join(tmpdir(),'ink-dither-review-'));
  t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const source=join(temp,'review.json'), output=join(temp,'out');
  writeFileSync(source,JSON.stringify(reviewFixture));
  const cli=join(__dirname,'../cli/ink-studio.js');
  execFileSync(process.execPath,[cli,'palette','dither-review',source,'--out',output]);
  const saved=JSON.parse(readFileSync(join(output,'review.json'))), expected=K.palette.reviewDither(reviewFixture);
  assert.deepEqual(saved.pairs,expected.report.pairs);
  assert.equal(saved.previews.length,3);
  for (const {index,file} of saved.previews) {
    const raster=expected.preview(index), bytes=readFileSync(join(output,file)), pixels=PNG.raster(bytes);
    assert.equal(bytes[25],3);
    assert.deepEqual([pixels.w,pixels.h],[4*reviewFixture.size[0]+6,reviewFixture.size[1]]);
    for (const [i,slot] of raster.slots.entries()) {
      const rgb=slot===null ? [0,0,0,0] :
        [...Buffer.from(raster.palette[slot].slice(1),'hex'),255];
      assert.deepEqual([...pixels.data.subarray(i*4,i*4+4)],rgb);
    }
  }
});
