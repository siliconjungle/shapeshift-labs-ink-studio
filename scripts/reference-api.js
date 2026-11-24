const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Script } = require('node:vm');
const { apiSources } = require('./reference-sources.js');
const { interfaces } = require('./reference-interfaces.js');

const identifier = /^[A-Za-z_$][\w$]*$/;
const memberPath = (parent, name) => identifier.test(name) ? parent + '.' + name : parent + '[' + JSON.stringify(name) + ']';

function parameterEnd(source, start) {
  // Let the JavaScript parser handle regexes, templates, and nested bindings.
  // Compiling the candidate does not run any default expression.
  for (let end = source.indexOf(')', start); end >= 0; end = source.indexOf(')', end + 1)) {
    if (!/^\s*(?:=>|\{)/.test(source.slice(end + 1))) continue;
    try {
      new Script('({ call' + source.slice(start, end + 1) + ' {} })');
      return end;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return -1;
}

function signature(fn) {
  const source = Function.prototype.toString.call(fn).trim();
  if (source.includes('[native code]')) return null;
  const isClass = /^class\b/.test(source);
  const prefix = isClass ? source.match(/(?:^|[;{}\n])\s*constructor\s*(?=\()/) : null;
  if (isClass && !prefix) return null;
  const single = !isClass && /^(?:async\s+)?([\w$]+)\s*=>/.exec(source);
  if (single) return '(' + single[1] + ')';
  const from = source.indexOf('(', prefix ? prefix.index + prefix[0].length : 0);
  const end = from < 0 ? -1 : parameterEnd(source, from);
  return end < 0 ? null : source.slice(from, end + 1);
}

function dataType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (ArrayBuffer.isView(value)) return value.constructor.name;
  return typeof value;
}

function namespace(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null || Object.prototype.toString.call(value) === '[object Module]';
}

function ownMembers(value) {
  return Object.entries(Object.getOwnPropertyDescriptors(value))
    .filter(([, descriptor]) => descriptor.enumerable)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

function inventory(surfaces, members = new Map()) {
  const groups = new Map();
  const known = new Map();
  for (const { name, value, groups: split = false, source, guide, instance } of surfaces) {
    const rows = [];
    const paths = new Set();
    groups.set(name, rows);
    for (const [key, descriptor] of ownMembers(value)) visit(memberPath(name, key), descriptor, rows);
    if (guide) for (const row of rows) row.guide = guide;
    // KIT is large. Top-level headings and the first level of procedural/world
    // namespaces keep GitHub's individual reference pages readable.
    if (split) {
      const bins = new Map();
      for (const row of rows) {
        const parts = row.id.split('.');
        const root = parts[1] ?? '';
        const family = ['procedural', 'world'].includes(root) ? root + (parts[2] ? '.' + parts[2] : '') : root;
        if (!bins.has(root)) bins.set(root, []);
        row.family = family ? name + '.' + family : name;
        bins.get(root).push(row);
      }
      groups.set(name, bins);
    }

    function visit(id, descriptor, out, ancestors = []) {
      if (paths.has(id)) throw new Error('Duplicate API reference path ' + id);
      paths.add(id);
      if (!Object.hasOwn(descriptor, 'value')) {
        out.push({ id, kind: 'accessor', read: Boolean(descriptor.get), write: Boolean(descriptor.set) });
        return;
      }
      const value = descriptor.value;
      if (typeof value === 'function') {
        const isClass = /^class\b/.test(Function.prototype.toString.call(value));
        const row = { id, kind: isClass ? 'class' : 'function', parameters: signature(value), arity: value.length,
          ...(source && { source }) };
        out.push(row);
        if (!members.has(value)) members.set(value, []);
        members.get(value).push(row);
        if (ancestors.includes(value)) return;
        const parents = [...ancestors, value];
        const staticMembers = isClass ? Object.entries(Object.getOwnPropertyDescriptors(value))
          .filter(([key]) => !['length', 'name', 'prototype'].includes(key)) : ownMembers(value);
        for (const [key, member] of staticMembers) visit(memberPath(id, key), member, out, parents);
        if (isClass) {
          for (const [key, member] of Object.entries(Object.getOwnPropertyDescriptors(value.prototype))) {
            if (key !== 'constructor') visit(memberPath(id + '.prototype', key), member, out, parents);
          }
        }
        return;
      }
      const type = dataType(value);
      if (instance || !namespace(value)) {
        const scalar = !instance && ['string', 'number', 'boolean'].includes(type) && String(value).length < 160;
        out.push({ id, kind: 'value', type, ...(scalar ? { value } : {}) });
        return;
      }
      if (id === 'KIT.procedural.graph.operations') {
        out.push({ id, kind: 'registry', target: 'graph' });
        return;
      }
      const alias = known.get(value);
      if (alias) {
        out.push({ id, kind: 'alias', target: alias });
        return;
      }
      known.set(value, id);
      out.push({ id, kind: 'namespace' });
      for (const [key, member] of ownMembers(value)) visit(memberPath(id, key), member, out, ancestors);
    }
  }
  return groups;
}

async function publicApis(root, studio, toolkit) {
  const manifest = require(path.join(root, 'package.json'));
  const externalFiles = manifest.files.filter(file => !file.includes('/') && file.endsWith('.mjs'));
  const modules = await Promise.all(externalFiles.map(file => import(pathToFileURL(path.join(root, file)).href)));
  const player = { exports: {} };
  // The playback module uses the package's own build input and export list.
  Function('module', studio.bundle({ profile: 'playback', format: 'commonjs' }))(player);
  const { KIT, ...bundle } = toolkit;
  const { EXPORTS, ...node } = studio;
  const members = new Map();
  const groups = inventory([
    { name: 'KIT', groups: true, value: KIT },
    { name: 'node', value: { EXPORTS, ...node } },
    { name: 'toolkit', value: bundle },
    ...modules.map((value, index) => ({ name: path.basename(externalFiles[index], '.mjs'), value })),
    { name: 'player', value: player.exports, source: 'src/scene-replay.js' },
    ...interfaces(studio, toolkit)
  ], members);
  await apiSources(root, studio, members);
  return groups;
}

module.exports = { publicApis, inventory, signature };
