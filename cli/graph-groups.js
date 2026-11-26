/* Resolve graph group declarations and report their file dependencies. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { aliases } = require('../src/graph-control-references.js');

const own = Object.hasOwn;
const record = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const positive = value => Number.isSafeInteger(value) && value > 0;
const filename = value => typeof value === 'string' && value.trim() && !value.includes('\0');
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const groupId = value => /^[a-z][\w.-]{0,99}$/i.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const relative = (base, file) => path.relative(base, file).split(path.sep).join('/');

function groupEntries(value) {
  if (!record(value) || !Object.keys(value).every(groupId))
    throw new TypeError('Expected groups keyed by graph ID');
  return Object.entries(value);
}

function groupReference(value) {
  if (typeof value === 'string') {
    if (!filename(value)) throw new TypeError('A graph group reference needs a filename');
    return { file: value };
  }
  if (!record(value) || !own(value, 'file')) return null;
  if (Object.keys(value).some(key => !['file', 'revision', 'sha256'].includes(key)) ||
      !filename(value.file) || own(value, 'revision') && !positive(value.revision) ||
      own(value, 'sha256') && !digest(value.sha256))
    throw new TypeError('A graph group reference needs a filename and optional positive revision and SHA-256');
  return value;
}

function groupDocument(document, bytes, label) {
  if (!record(document) || document.format !== 'ink-studio/graph-group' || document.version !== 1 ||
      own(document, 'revision') && !positive(document.revision))
    throw new TypeError('Expected ink-studio/graph-group version 1 with a positive revision in ' + label);
  const { format, version, revision, inspector, ...definition } = document;
  return { definition, version, revision: revision ?? 1, ...(inspector !== undefined && {inspector}),
    versioned: revision !== undefined, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function referenceMismatches(reference, document) {
  const issues = [];
  if (reference.revision !== undefined && reference.revision !== document.revision)
    issues.push('expected revision ' + reference.revision + ', found ' + document.revision);
  if (reference.sha256 !== undefined && reference.sha256 !== document.sha256)
    issues.push('expected SHA-256 ' + reference.sha256 + ', found ' + document.sha256);
  return issues;
}

function requireGroupReference(reference, document, label) {
  const issues = referenceMismatches(reference, document);
  if (issues.length) throw new RangeError('Graph group ' + label + ': ' + issues.join(', '));
}

function loadGraphGroups(definitions, baseDir, { check = true, onFile = () => {}, files = new Map(), inspectors = {} } = {}) {
  const entries = [], active = new Set();

  function loadScope(declarations, directory, prefix, inspectors) {
    const scope = new Map();
    for (const [name, value] of groupEntries(declarations)) {
      const alias = prefix + name;
      if (entries.length >= 2000)
        throw new RangeError('Graph group declarations exceed the 2000 group budget');
      const reference = groupReference(value);
      let document, file, physical;
      if (reference) {
        file = path.resolve(directory, reference.file);
        physical = fs.realpathSync(file);
        if (active.has(physical)) throw new Error('Graph group file cycle at ' + alias + ' (' + file + ')');
        onFile(file);
        document = files.get(physical);
        if (!document) {
          const bytes = fs.readFileSync(physical);
          document = groupDocument(JSON.parse(bytes.toString('utf8')), bytes, file);
          files.set(physical, document);
        }
        if (check) requireGroupReference(reference, document, alias + ' (' + file + ')');
      }
      const definition = document ? document.definition : value;
      if (!record(definition)) throw new TypeError('Invalid graph group ' + alias);
      const { groups: local, ...spec } = definition;
      const inspector = document ? document.inspector : own(inspectors, name) ? inspectors[name] : undefined;
      const group = { name, alias, owner: scope, spec, reference, document, file, physical, inspector };
      entries.push(group);
      scope.set(name, group);
      if (physical) active.add(physical);
      group.scope = local === undefined ? scope : loadScope(local, file ? path.dirname(file) : directory, alias + '/', inspector?.groups ?? {});
      if (physical) active.delete(physical);
    }
    return scope;
  }

  const scope = loadScope(definitions, baseDir, '', inspectors);
  return { scope, entries };
}

function groupFor(scope, node) {
  return scope.get(node.group ?? node.op);
}

function groupsFor(scope,node) {
  return [...new Set([groupFor(scope,node),...aliases(node).map(name=>scope.get(name))].filter(Boolean))];
}

function groupUsage(scope, nodes) {
  const used = new Set();
  function visit(scope, nodes) {
    for (const node of Object.values(nodes ?? {})) for (const group of groupsFor(scope,node)) {
      if (used.has(group)) continue;
      used.add(group);
      visit(group.scope, group.spec.nodes);
    }
  }
  visit(scope, nodes);
  return used;
}

function groupDependencies({ scope, entries }, nodes, baseDir) {
  const used = groupUsage(scope, nodes);
  return entries.flatMap(group => {
    const { alias, document, file, reference } = group;
    if (!reference) return [];
    const { version, revision, sha256 } = document;
    const { revision: expectedRevision, sha256: expectedHash } = reference;
    const issues = referenceMismatches(reference, document);
    return [{ group: alias, file: relative(baseDir, file), version, revision, sha256, used: used.has(group),
      ...(expectedRevision !== undefined && { expectedRevision }),
      ...(expectedHash !== undefined && { expectedSha256: expectedHash }), ...(issues.length && { issues }) }];
  });
}

function findGraphGroupUsers(groupFile, { root = process.cwd() } = {}) {
  const folder = fs.realpathSync(root), target = path.resolve(groupFile), physical = fs.realpathSync(target);
  const bytes = fs.readFileSync(physical);
  const targetDocument = groupDocument(JSON.parse(bytes.toString('utf8')), bytes, target);
  const { revision, sha256 } = targetDocument, files = new Map([[physical, targetDocument]]);
  const projects = [], errors = [];
  const materialGraph = require('./material-graph.js');

  function inspect(file, project) {
    const projectName = relative(folder, file), baseDir = path.dirname(file);
    try {
      if (project.format === materialGraph.format) project = materialGraph.toGraphProject(project, { requireOutputs: false });
      const tree = loadGraphGroups(project.groups ?? {}, baseDir, { check: false, files });
      const aliases = new Set(tree.entries.filter(group => group.physical === physical).map(group => group.alias));
      if (!aliases.size) return;
      const references = groupDependencies(tree, project.nodes, baseDir).filter(row => aliases.has(row.group));
      const effect = references.some(row => row.expectedRevision !== undefined || row.expectedSha256 !== undefined)
        ? 'requires-reference-update' : references.some(row => row.used) ? 'updates' : 'declared-only';
      projects.push({ project: projectName, effect, references });
    } catch (error) { errors.push({ project: projectName, error: error.message }); }
  }

  function scan(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') scan(file);
      else if (/\.json$/i.test(entry.name)) {
        let document;
        try {
          if (!entry.isFile() && !(entry.isSymbolicLink() && fs.statSync(file).isFile())) continue;
          document = JSON.parse(fs.readFileSync(file, 'utf8'));
        }
        catch { continue; }
        if (['ink-studio/graph-project', materialGraph.format].includes(document?.format)) inspect(file, document);
      }
    }
  }
  scan(folder);
  const byProject = (a, b) => a.project < b.project ? -1 : a.project > b.project ? 1 : 0;
  projects.sort(byProject);
  errors.sort(byProject);
  return { format: 'ink-studio/graph-group-impact', version: 1, group: relative(folder, physical),
    revision, sha256, projects, errors };
}

module.exports = { groupEntries, groupReference, groupDocument, requireGroupReference, loadGraphGroups,
  groupFor, groupsFor, groupUsage, groupDependencies, findGraphGroupUsers };
