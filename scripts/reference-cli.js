const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const route = /^\s+([a-z][a-z0-9-]*(?:\|[a-z0-9-]+)*)(?=\s|$)/;
const sortText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function flagReferences(source) {
  const pattern = /\bopt(?:\??\.([A-Za-z][\w-]*)|(?:\?\.)?\[(['"])([\w-]+)\2\])|\b(?:num|list|onOffOption|jsonOption)\(\s*'([\w-]+)'/g;
  return [...new Set([...source.matchAll(pattern)].map(match => match[1] ?? match[3] ?? match[4]))].sort();
}

function documentsAction(usages, group, action) {
  const prefix = group.split(' ');
  return usages.some(usage => {
    const parts = usage.split(/\s+/);
    if (!prefix.every((p, i) => p === parts[i])) return false;
    const token = parts[prefix.length] ?? '';
    if (token.startsWith('<') && !token.includes('|')) return false;
    return token.replace(/^[<\[]|[>\]]$/g, '').split('|').includes(action);
  });
}

function runtimeSubcommands(cliDirectory, commands) {
  const grouped = [];
  const source = file => fs.readFileSync(path.join(cliDirectory, file), 'utf8');
  const named = (file, start, end) => {
    const content = source(file);
    const first = content.indexOf(start);
    const last = end ? content.indexOf(end, first + start.length) : content.length;
    if (first < 0 || last < 0) throw new Error('Cannot inspect the CLI dispatcher in ' + file + ' for ' + start);
    return content.slice(first, last);
  };
  const modeBranches = (file, start, end) =>
    [...named(file, start, end).matchAll(/\bmode\s*===\s*['"]([a-z][\w-]*)['"]/g)].map(match => match[1]);

  function add(group, file, actions) {
    const usages = commands.get(group.split(' ')[0]);
    for (const [action, declaredFlags] of Object.entries(actions)) {
      const matches = usages.filter(usage => documentsAction([usage], group, action));
      if (!matches.length) throw new Error('Public CLI subcommand missing from help: ' + group + ' ' + action);
      grouped.push({ name: group + ' ' + action, source: 'cli/' + file, usages: matches, ...(declaredFlags && { flags: declaredFlags }) });
    }
  }

  // Use the option allowlists from CLI families that expose them. The remaining
  // guards below read dispatch branches and action arrays from the handlers.
  for (const [group, file] of [['graph', 'graph-cli.js'], ['patch', 'patch-cli.js'], ['effect-recipe', 'effect-recipes.js']]) {
    if (commands.has(group)) add(group, file, require(path.join(cliDirectory, file)).commandOptions);
  }
  if (commands.has('project')) {
    const file = 'agent-project.js';
    add('project author', file, require(path.join(cliDirectory, file)).commandOptions);
  }
  const withoutFlags = actions => Object.fromEntries(actions.map(action => [action, null]));
  if (commands.has('pixel-art')) {
    const file = 'pixel-art.js';
    const { actions, sessionActions, paletteActions, stackActions } = require(path.join(cliDirectory, file));
    add('pixel-art', file, withoutFlags([...actions, 'session', 'palette', 'stack', 'directions', 'tilemap', 'slices', 'export']));
    add('pixel-art session', file, withoutFlags(sessionActions));
    add('pixel-art palette', file, withoutFlags(paletteActions));
    add('pixel-art stack', file, withoutFlags(stackActions));
    add('pixel-art directions', 'pixel-directional-views.js', withoutFlags(['open','review','export']));
    add('pixel-art slices', file, withoutFlags(['inspect','export']));
    add('pixel-art tilemap', file, withoutFlags(['inspect','draw','neighbors']));
  }
  for (const [group, file, start, end] of [
    ['music', 'music-composer.js', 'function musicCommand('],
    ['story', 'story-document.js', 'function storyCommand('],
    ['scene', 'world.js', 'function scene([', 'function execute(']
  ]) {
    if (commands.has(group)) add(group, file, withoutFlags(modeBranches(file, start, end)));
  }
  if (commands.has('sim')) {
    const file = 'world.js';
    const cases = [...named(file, 'function runSimulation([', 'function scene([')
      .matchAll(/^ {6}case\s+['"]([a-z][\w-]*)['"]/gm)].map(match => match[1]);
    add('sim', file, withoutFlags(cases));
  }
  return grouped.sort((a, b) => sortText(a.name, b.name));
}

function commandReference(root) {
  const main = path.join(root, 'cli', 'ink-studio.js');
  const help = JSON.parse(execFileSync(process.execPath, [main, 'help', '--json'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, INK_STUDIO_PORTABLE_SHOT: '1' }
  }));
  const commands = new Map(help.commands.map(name => [name, []]));
  for (const line of help.lines) {
    const match = route.exec(line);
    if (!match) continue;
    const names = match[1].split('|');
    for (const name of names) if (commands.has(name)) commands.get(name).push(line.trim());
    // Recover typos in top-level help while allowing indented continuation lines.
    if (/^ {2}\S/.test(line) && names.some(name => !commands.has(name))) {
      throw new Error('CLI help names a command without a handler: ' + line.trim());
    }
  }
  const missing = [...commands].filter(([, usages]) => !usages.length).map(([name]) => name);
  if (missing.length) throw new Error('Public CLI commands missing from help: ' + missing.join(', '));

  const flags = new Map();
  const documented = new Set([...help.lines.join('\n').matchAll(/--([\w-]+)/g)].map(match => match[1]));
  for (const file of fs.readdirSync(path.dirname(main)).filter(name => name.endsWith('.js')).sort()) {
    const source = fs.readFileSync(path.join(path.dirname(main), file), 'utf8');
    for (const flag of flagReferences(source)) {
      if (!flags.has(flag)) flags.set(flag, []);
      flags.get(flag).push('cli/' + file);
    }
  }
  const additionalFlags = [...flags].filter(([name]) => !documented.has(name)).sort(([a], [b]) => sortText(a, b));
  return { ...help, commands, additionalFlags, subcommands: runtimeSubcommands(path.dirname(main), commands) };
}

module.exports = { commandReference, flagReferences, documentsAction };
