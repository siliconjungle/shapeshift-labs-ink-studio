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

  function ancestry(doc, tracked = domains) {
    let prior = Object.fromEntries(tracked.map(domain => [domain, new Map(ids(doc, domain).map(id => [id, new Set([id])]))]));
    return {
      advance(next, hints) {
        const current = Object.fromEntries(tracked.map(domain => [domain, new Map(ids(next, domain)
          .filter(id => prior[domain].has(id)).map(id => [id, prior[domain].get(id)]))]));
        for (const domain of tracked) for (const { from, to } of hints?.[domain] ?? []) {
          const sources = prior[domain].get(from);
          if (sources) current[domain].set(to, new Set([...(current[domain].get(to) ?? []), ...sources]));
        }
        prior = current;
      },
      links() {
        return Object.fromEntries(tracked.map(domain => [domain, [...prior[domain]].flatMap(([to, sources]) =>
          [...sources].flatMap(from => from === to ? [] : [{ from, to }]))]));
      }
    };
  }

  function describe(document) {
    const { vertices, edges, faces, triangles } = topology.inspect(document);
    return { revision: topology.revision(document), vertices, edges: edges.length, faces, triangles };
  }

  function evaluateModifiers(source, modifiers, { through, target, diagnostics = false } = {}) {
    const cage = topology.create(source), stack = modifierStack(modifiers);
    const stop = through === undefined ? stack.length : stack.findIndex(row => row.id === through) + 1;
    if (through !== undefined && !stop) throw new RangeError('Unknown mesh modifier stage ' + through);
    const before = describe(cage), stages = [], lineage = ancestry(cage);
    const watchLineage=diagnostics ? ancestry(cage,['vertices',...domains]) : null;
    const captures = [], inspected = new WeakMap();
    const probe = value => {
      if (!inspected.has(value)) inspected.set(value,K.procedural.modelingDiagnostics.inspect(value));
      return inspected.get(value);
    };
    function record(stage, prior, links, start) {
      if (diagnostics) {
        const elapsedMs = performance.now() - start;
        stage.diagnostics = K.procedural.modelingDiagnostics.compare(probe(prior),probe(document),{lineage:links});
        stage.elapsedMs = elapsedMs;
        captures.push({id:stage.id,before:prior,after:document,lineage:links??{}});
      }
      stages.push(stage);
    }
    let document = cage, canApply = true, current = before, consumed = 0;
    for (const op of stack.slice(0, stop)) {
      const { id, kind } = op, input = current, prior = document;
      const start = diagnostics ? performance.now() : 0;
      if (op.enabled === false) record({ id, kind, status: 'bypassed', input, output: input },prior,undefined,start);
      else {
        let result;
        try {
          if (kind === 'subdivision') {
            const trace = ancestry(document);
            const subdivision = meshTopologySubdivision.run(document, op.levels, (next, links) => trace.advance(next, links), id);
            result = { document: topology.create({ ...subdivision, id: cage.id }), lineage: trace.links(),
              evidence: { levels: op.levels } };
          } else result = operations[kind](document, op, target, diagnostics);
          if (result.document !== document) {
            lineage.advance(result.document, result.lineage);
            watchLineage?.advance(result.document,result.diagnosticLineage??result.lineage);
          }
          document = result.document;
          current = document === cage ? before : describe(document);
        } catch (error) {
          if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
          canApply = false;
          record({ id, kind, status: 'blocked', input, message: error.message,
            ...(error.report && { evidence: error.report }) },prior,undefined,start);
          break;
        }
        record({ id, kind, status: 'evaluated', input, output: current, ...(result.evidence && { evidence: result.evidence }) },
          prior,result.diagnosticLineage??result.lineage,start);
      }
      consumed++;
    }
    const remaining = stack.slice(consumed);
    return freeze({ document, remaining, lineage: lineage.links(), ...(diagnostics && {captures,diagnosticLineage:watchLineage.links()}),
      report: { format: 'ink-studio/mesh-modifier-evaluation', version: 1, mesh: cage.id, before,
        output: current, canApply, stages, remaining: remaining.map(row => row.id) } });
  }

  K.meshTopology = Object.freeze({ ...topology, modifierStack, updateModifier, evaluateModifiers });
})(KIT);
