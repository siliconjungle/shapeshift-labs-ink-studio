/* Evaluate an ordered stack without mutating the editable topology cage. */
(function (K) {
  const { meshTopology: topology, procedural: { data: { clone, freeze } } } = K;
  const { validate, ...operations } = meshModifierOps;
  const domains = ['faces', 'edges', 'corners'];
  const ids = (doc, domain) => domain === 'corners' ? doc.faces.flatMap(face => face.corners.map(corner => corner.id)) :
    doc[domain].map(row => row.id);

  function modifierStack(source) {
    if (!Array.isArray(source) || source.length > 16) throw new TypeError('Use an ordered list of up to 16 mesh modifiers');
    const seen = new Set();
    for (const row of source) {
      validate(row);
      if (seen.has(row.id)) throw new RangeError('Duplicate mesh modifier ' + row.id);
      seen.add(row.id);
    }
    return freeze(clone(source));
  }

  function updateModifier(stack, id, patch) {
    const rows = modifierStack(stack);
    if (!patch || Object.getPrototypeOf(patch) !== Object.prototype ||
        Object.hasOwn(patch, 'id') || Object.hasOwn(patch, 'kind'))
      throw new TypeError('Update a mesh modifier by ID with parameter fields');
    if (!rows.some(row => row.id === id)) throw new RangeError('Unknown mesh modifier ' + id);
    return modifierStack(rows.map(row => row.id !== id ? row :
      Object.fromEntries(Object.entries({ ...row, ...clone(patch) }).filter(([, value]) => value !== null))));
  }

  function ancestry(doc) {
    let prior = Object.fromEntries(domains.map(domain => [domain, new Map(ids(doc, domain).map(id => [id, new Set([id])]))]));
    return {
      advance(next, hints) {
        const current = Object.fromEntries(domains.map(domain => [domain, new Map(ids(next, domain)
          .filter(id => prior[domain].has(id)).map(id => [id, prior[domain].get(id)]))]));
        for (const domain of domains) for (const { from, to } of hints?.[domain] ?? []) {
          const sources = prior[domain].get(from);
          if (sources) current[domain].set(to, new Set([...(current[domain].get(to) ?? []), ...sources]));
        }
        prior = current;
      },
      links() {
        return Object.fromEntries(domains.map(domain => [domain, [...prior[domain]].flatMap(([to, sources]) =>
          [...sources].flatMap(from => from === to ? [] : [{ from, to }]))]));
      }
    };
  }

  function describe(document) {
    const { vertices, edges, faces, triangles } = topology.inspect(document);
    return { revision: topology.revision(document), vertices, edges: edges.length, faces, triangles };
  }

  function evaluateModifiers(source, modifiers, { through, target } = {}) {
    const cage = topology.create(source), stack = modifierStack(modifiers);
    const stop = through === undefined ? stack.length : stack.findIndex(row => row.id === through) + 1;
    if (through !== undefined && !stop) throw new RangeError('Unknown mesh modifier stage ' + through);
    const before = describe(cage), stages = [], lineage = ancestry(cage);
    let document = cage, canApply = true, current = before, consumed = 0;
    for (const op of stack.slice(0, stop)) {
      const { id, kind } = op, input = current;
      if (op.enabled === false) stages.push({ id, kind, status: 'bypassed', input, output: input });
      else {
        try {
          let result;
          if (kind === 'subdivision') {
            const trace = ancestry(document);
            const subdivision = meshTopologySubdivision.run(document, op.levels, (next, links) => trace.advance(next, links), id);
            result = { document: topology.create({ ...subdivision, id: cage.id }), lineage: trace.links(),
              evidence: { levels: op.levels } };
          } else result = operations[kind](document, op, target);
          if (result.document !== document) lineage.advance(result.document, result.lineage);
          document = result.document;
          current = document === cage ? before : describe(document);
          stages.push({ id, kind, status: 'evaluated', input, output: current, ...(result.evidence && { evidence: result.evidence }) });
        } catch (error) {
          if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
          canApply = false;
          stages.push({ id, kind, status: 'blocked', input, message: error.message,
            ...(error.report && { evidence: error.report }) });
          break;
        }
      }
      consumed++;
    }
    const remaining = stack.slice(consumed);
    return freeze({ document, remaining, lineage: lineage.links(),
      report: { format: 'ink-studio/mesh-modifier-evaluation', version: 1, mesh: cage.id, before,
        output: current, canApply, stages, remaining: remaining.map(row => row.id) } });
  }

  K.meshTopology = Object.freeze({ ...topology, modifierStack, updateModifier, evaluateModifiers });
})(KIT);
