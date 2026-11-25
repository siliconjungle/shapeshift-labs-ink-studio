/* Material preset operations use the same parameter schema in Node and the browser. */
KIT.procedural.materialPresets = MaterialPresets.toolkit(KIT.procedural.materialParameters,
  KIT.procedural.data.clone, (left, right) => KIT.world.data.equal(left, right));
