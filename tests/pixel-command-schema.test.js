'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const Commands = require('../cli/pixel-commands.js');
const Destinations = require('../cli/pixel-edit-destinations.js');

const published = require('../docs/reference/pixel-command-schema.json');
const root = path.resolve(__dirname,'..');
const normalize = value=>JSON.parse(JSON.stringify(value));
const lookup = (schema,pointer)=>pointer.slice(2).split('/').reduce((value,name)=>value[name],schema);

test('the published reference matches the CLI and SDK and covers every command and edit destination',t=>{
  const sdk = ink.pixelCommandSchema(), { commands,editDestinations,channels } = sdk['x-ink'];
  assert.deepEqual(published,sdk);
  const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art','schema',...args],{cwd:root});
  assert.deepEqual(JSON.parse(cli()),sdk);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'ink-command-schema-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const file = path.join(temp,'schema.json');
  assert.equal(cli('--out',file).length,0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),sdk);

  const {members,requiredFields} = Commands.contract();
  const { declared,builtin } = Destinations.contract();
  assert.deepEqual(Object.keys(commands),Object.keys(members));
  assert.deepEqual(new Set(Object.keys(editDestinations)),new Set([...Object.keys(declared),...Object.keys(builtin)]));
  for (const [name,info] of Object.entries(commands)) {
    assert.deepEqual(info.required,requiredFields[name] ?? []);
    assert.equal(lookup(sdk,info.request).properties.action.const,name);
    assert.ok(lookup(sdk,info.result));
    assert.ok(Object.keys(info.evidence).length);
  }
  for (const [kind,row] of Object.entries(editDestinations)) {
    assert.ok(lookup(sdk,row.patch));
    assert.ok(lookup(sdk,row.operation).examples.length);
    if (declared[kind]) assert.deepEqual(lookup(sdk,row.declaration).required,['id','kind',...declared[kind]]);
    if (builtin[kind]) assert.deepEqual(row.builtin,builtin[kind]);
  }

  assert.equal(channels.surface.heat.units,'degC');
  assert.equal(channels.surface['mask:<id>'].value.maximum,1);
  assert.equal(channels.surface['shadow-band'].value.minimum,-1);
  assert.equal(lookup(sdk,channels.surface.emission.value.$ref).prefixItems[0].maximum,64);
  assert.deepEqual(channels.surface.opacity.modes,['set','clear']);
  assert.ok(channels.surface.wetness.modes.includes('add'));
  assert.equal(channels.sourceCoordinates.frameDuration.units,'ms');
});

test('every published example and its setup reproduce the documented result',()=>{
  const { commands,exampleDocument } = published['x-ink'];
  for (const [action,record] of Object.entries(commands)) for (const example of record.examples) {
    const editor = ink.createPixelEditor(exampleDocument);
    for (const setup of example.setup) editor.execute(setup);
    assert.equal(example.command.action,action);
    assert.deepEqual(normalize(editor.execute(example.command)),example.result,action);
  }
  const refs = [...JSON.stringify(published).matchAll(/"\$ref":"(#\/\$defs\/[^"]+)"/g)].map(match=>match[1]);
  for (const ref of refs) assert.ok(lookup(published,ref),ref);
  const fresh = ink.pixelCommandSchema();
  fresh['x-ink'].exampleDocument.palette.amber = '#000000';
  assert.equal(ink.pixelCommandSchema()['x-ink'].exampleDocument.palette.amber,'#da8c44');
});
