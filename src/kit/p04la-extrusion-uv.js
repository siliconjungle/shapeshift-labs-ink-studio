/* Carry an edge's UV gradient over a fold or stamp a separate sidewall crop. */
const meshExtrusionUV = (function (K) {
  const {V} = K;
  const modes = ['strip','per-edge','extend','brush'];
  const epsilon = 1e-9;

  function prepare(doc, rules, defaults, resolveBrush) {
    const mode = rules.uv ?? 'strip';
    const pigment = MaterialUV.resolve(doc.uvBindings,'pigment');
    const brush = mode === 'brush' ? resolveBrush?.(rules.brush,rules.material) : undefined;
    if (mode === 'brush' && !brush) throw new TypeError('Brush UVs need a retained scene with a registered tileset');
    const sets = [...new Set([0,...(rules.uvSets ?? defaults),...(brush || mode === 'extend' ? [pigment] : [])])]
      .sort((a,b)=>a-b);
    const issues = [...(brush?.issues ?? [])], faces = [];
    const triangles = new Map();
    if (mode === 'extend') {
      for (const {face,corners} of K.meshTopology.triangulate(doc).triangleSources) {
        if (!triangles.has(face)) triangles.set(face,[]);
        triangles.get(face).push(corners);
      }
    }
    return {mode,sets,pigment,brush,triangles,issues,faces};
  }

  function continuation(mapping, face, edge, a, b, at, offsets, fallback, seamAtOuter) {
    const adjacent = mapping.triangles.get(face.id).find(corners=>corners.includes(a.id) && corners.includes(b.id));
    const third = face.corners.find(corner=>adjacent.includes(corner.id) && corner.id !== a.id && corner.id !== b.id);
    const span = V.sub(at(b.vertex),at(a.vertex)), length = V.len(span), tangent = V.mul(span,1/length);
    const toThird = V.sub(at(third.vertex),at(a.vertex)), along = V.dot(toThird,tangent);
    const height = V.len(V.mad(toThird,tangent,-along));
    return mapping.sets.map(set=>{
      const [left,right,inside] = [a,b,third].map(corner=>MaterialUV.uv(corner,set));
      if (!left || !right || !inside) {
        mapping.issues.push({kind:'missing-extrusion-uv-layout',face:face.id,edge,set});
        return fallback;
      }
      const step = left.map((u,i)=>(right[i]-u)/length);
      const outward = left.map((u,i)=>(u+step[i]*along-inside[i])/height);
      const [nextA,nextB] = offsets.map((offset,i)=>{
        const parallel = V.dot(tangent,offset), across = V.len(V.mad(offset,tangent,-parallel));
        return [left,right][i].map((u,k)=>u+step[k]*parallel+outward[k]*across);
      });
      const uvs = seamAtOuter ? [nextA,nextB,right,left] : [left,right,nextB,nextA];
      if (uvs.flat().some(value=>!Number.isFinite(value) || value < -epsilon || value > 1+epsilon)) {
        mapping.issues.push({kind:'extrusion-uv-out-of-bounds',face:face.id,edge,set,uvs});
        return fallback;
      }
      return uvs.map(uv=>uv.map(value=>Math.max(0,Math.min(1,value))));
    });
  }

  function corners(mapping, {id,face,edge,a,b,outer,at,offsets,span,seamAtOuter=false}) {
    const [start,end] = span;
    const fallback = [[start,0],[end,0],[end,1],[start,1]];
    let layouts = mapping.sets.map(()=>fallback);
    if (mapping.mode === 'extend') layouts = continuation(mapping,face,edge,a,b,at,offsets,fallback,seamAtOuter);
    if (mapping.brush) layouts = mapping.sets.map(set=>set===mapping.pigment ? mapping.brush.pigmentUV : fallback);
    const vertices = [a.vertex,b.vertex,outer[1],outer[0]];
    const rows = [a,b,b,a].map((source,i)=>{
      const attributes = mapping.sets.length > 1 ? {...source.attributes,
        ...Object.fromEntries(mapping.sets.slice(1).map((set,n)=>[MaterialUV.key(set),layouts[n+1][i]]))} : source.attributes;
      return {vertex:vertices[i],uv:layouts[0][i],...(attributes && {attributes})};
    });
    if (mapping.mode === 'extend' || mapping.brush) mapping.faces.push({face:id,parent:face.id,edge,
      ...(mapping.mode === 'extend' && {seam:seamAtOuter ? 'cap' : 'source-edge'}),
      layouts:Object.fromEntries(mapping.sets.map((set,i)=>[set,layouts[i]]))});
    return rows;
  }

  function report({mode,sets,pigment,brush,faces}) {
    if (mode === 'extend' || brush) return {mode,sets,faces,...(brush &&
      {pigmentLayout:pigment,source:brush.source,material:brush.material,createsMaterial:!brush.slot})};
  }

  return {modes,prepare,corners,report};
})(KIT);
