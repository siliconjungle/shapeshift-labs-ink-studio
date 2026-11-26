// Write metadata as meshless glTF nodes, relative to the authored rest frame.
function writeHelpers(doc, helpers, rig, graph) {
  function attach({ name, frame, metadata }, parent) {
    const local = parent ? graph.compose(graph.inverse(parent.frame), frame) : frame;
    const transforms = rig.staticTransforms(local);
    let node = parent?.node;
    for (const [index, transform] of transforms.entries()) {
      const last = index === transforms.length - 1;
      const next = doc.add('nodes', last ? { name, ...transform, extras: { inkStudio: metadata } } :
        { name: name + ' · affine', ...transform });
      if (node === undefined) doc.gltf.scenes[0].nodes.push(next);
      else (doc.gltf.nodes[node].children ||= []).push(next);
      node = next;
    }
    return { node, frame };
  }

  return helpers.map(helper => {
    const parent = helper.part === undefined ? undefined : rig.attachment(helper.part);
    const root = attach(helper, parent);
    const sockets = helper.sockets.map(socket => ({
      ...socket.metadata, node: attach(socket, root).node, position: socket.frame.position
    }));
    return { ...helper.metadata, node: root.node, position: helper.frame.position, ...(sockets.length && { sockets }) };
  });
}

module.exports = writeHelpers;
