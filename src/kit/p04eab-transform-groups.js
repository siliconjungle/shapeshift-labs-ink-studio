/* Shared vertices and eligible coincident copies form one transform group. */
const meshTransformGroups = (doc, selection, selected, coincident, mode) => {
  const parents = new Map([...selected].map(id => [id,id]));
  function root(id) {
    while (parents.get(id) !== id) {
      parents.set(id,parents.get(parents.get(id)));
      id = parents.get(id);
    }
    return id;
  }
  function join(ids) {
    for (const id of ids) if (!parents.has(id)) parents.set(id,id);
    for (let i = 1; i < ids.length; i++) parents.set(root(ids[i]),root(ids[0]));
  }
  if (mode === 'assembly') join([...selected]);
  else if (selection.domain !== 'vertices') {
    const picked = new Set(selection.ids);
    for (const row of doc[selection.domain]) if (picked.has(row.id))
      join(selection.domain === 'edges' ? row.vertices : row.corners.map(({ vertex }) => vertex));
  }
  for (const group of coincident?.report.groups ?? []) join(group.vertices);
  const sets = new Map();
  for (const id of [...parents.keys()].sort()) {
    const leader = root(id);
    if (!sets.has(leader)) sets.set(leader,[]);
    sets.get(leader).push(id);
  }
  return [...sets.values()];
};
