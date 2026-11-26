/* Authored references for control nodes, shared by dependency discovery and the runtime. */
const GraphControlReferences = (() => {
  function literal(node, key, fallback) {
    const definition = Object.hasOwn(node.inputs ?? {}, key) ? node.inputs[key] : node.params?.[key];
    if (definition === undefined) return fallback;
    if (definition && typeof definition === 'object' && !Array.isArray(definition))
      return Object.hasOwn(definition, 'value') ? definition.value :
        ['input','node','keys'].some(key=>Object.hasOwn(definition,key)) ? undefined : definition;
    return definition;
  }
  function aliases(node) {
    let names;
    if (node.op === 'fn.branch') names = [literal(node,'whenTrue'),literal(node,'whenFalse')];
    else if (node.op === 'fn.sequence') {
      const steps = literal(node,'steps');
      names = Array.isArray(steps) ? steps : [];
    } else if (node.op === 'fn.loop') names = [literal(node,'while')];
    else names = [];
    return names.filter(name=>typeof name === 'string');
  }
  return Object.freeze({ literal, aliases });
})();
if(typeof module!=='undefined')module.exports=GraphControlReferences;
