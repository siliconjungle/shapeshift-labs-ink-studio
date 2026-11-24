'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

test('onion skin compares visible color and alpha and includes both sides of a silhouette change',async()=>{
  const { composeOnionSkin } = await import('../src/pixel-onion-skin.mjs');
  const current = Uint8Array.from([
    20,30,40,255, 20,30,40,255, 20,30,40,128, 12,30,40,0, 20,30,40,255
  ]);
  const before = current.slice();
  const rgba = Uint8Array.from([
    20,30,40,255, 70,30,40,255, 20,30,40,64, 99,99,99,0, 70,30,40,0
  ]);
  const ghosts = [{ rgba,tint:[255,0,0],amount:.6 }];
  assert.deepEqual([...composeOnionSkin(current,ghosts,true)],[
    0,0,0,0, 255,0,0,153, 255,0,0,38, 0,0,0,0, 255,0,0,153
  ]);
  assert.deepEqual([...composeOnionSkin(current,ghosts)],[
    255,0,0,153, 255,0,0,153, 255,0,0,38, 0,0,0,0, 0,0,0,0
  ]);
  assert.deepEqual(current,before);
});

test('overlapping ghost tints blend within the strongest opacity',async()=>{
  const { composeOnionSkin } = await import('../src/pixel-onion-skin.mjs');
  const current = new Uint8Array(4), rgba = Uint8Array.of(255,255,255,200);
  assert.deepEqual([...composeOnionSkin(current,[
    { rgba,tint:[255,0,0],amount:.6 },{ rgba,tint:[0,255,0],amount:.3 }
  ])],[170,85,0,120]);
});
