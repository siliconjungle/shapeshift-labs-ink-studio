/* Resolve atlas boundary indices to the retained quad's two authored axes. */
const meshTexelGrid = (function (K) {
  const {record} = meshCutGeometry, {buildGrid,gridLimit} = meshFaceGrid;
  const epsilon = 1e-7, axisNames = ['x','y'];
  const axisControl = value=>value === undefined || Number.isSafeInteger(value) && value>0 ||
    Array.isArray(value) && Array.from(value).every(Number.isSafeInteger) && new Set(value).size === value.length;

  function boundaries(input, start, end, size, origin, axis) {
    const [low,high] = [start,end].sort((a,b)=>a-b);
    const first = Math.max(1,Math.floor(low+.5+epsilon)+1);
    const last = Math.min(size-1,Math.ceil(high+.5-epsilon)-1);
    let cuts = [];
    if (Array.isArray(input)) {
      if (input.some(n=>n<first || n>last))
        throw new RangeError('Atlas '+axis+' boundaries must be inside the mapped texel footprint');
      cuts = input.slice();
    } else if (input !== undefined) {
      const startTick = origin + input*Math.max(1,Math.ceil((first-origin)/input));
      for (let n=startTick;n<=last;n+=input) cuts.push(n);
    }
    if (cuts.length>=gridLimit) throw new RangeError('Texel subdivision exceeds '+gridLimit+' cells on atlas '+axis);
    return cuts.map(boundary=>{
      const center = boundary-.5;
      return {boundary,center,uv:center/(size-1),fraction:(center-start)/(end-start)};
    }).sort((a,b)=>a.fraction-b.fraction);
  }

  function subdivide(g, op, settings = {}) {
    if (!record(op,['kind','face','selection','x','y','atlasSize','basis','uvSet','camera']) ||
        (op.face === undefined) === (op.selection === undefined) ||
        op.x === undefined && op.y === undefined || ![op.x,op.y].every(axisControl))
      throw new TypeError('Subdivide texels needs a quad or saved face selection and integer increments or distinct boundary lists for x or y');
    const face = meshPickedSplit.selectQuad(g,op), orientation = meshSubdivisionBasis.resolve(g,face,op,settings);
    const source = settings.texelAtlas?.(face), size = source?.size ?? op.atlasSize;
    if (!Array.isArray(size) || size.length !== 2)
      throw new TypeError('Texel subdivision needs a registered source atlas or explicit atlasSize');
    K.authoring.tilesets.dimensions(...size);
    if (source && op.atlasSize !== undefined && (!Array.isArray(op.atlasSize) ||
        op.atlasSize.length !== 2 || size.some((n,i)=>op.atlasSize[i] !== n)))
      throw new RangeError('atlasSize does not match the registered tileset');
    const uvSet = MaterialUV.resolve(g.doc.uvBindings,'pigment');
    const points = face.corners.map(corner=>MaterialUV.uv(corner,uvSet).map((n,i)=>n*(size[i]-1)));
    const axes = meshSubdivisionBasis.rectangle(points,epsilon,'Texel subdivision needs rectangular pigment UVs on the selected face',true);
    const origin = source?.origin ?? size.map((_,i)=>Math.floor(Math.min(...points.map(row=>row[i]))+epsilon));
    const cuts = axes.map(({axis,start,end})=>boundaries(op[axisNames[axis]],start,end,size[axis],origin[axis],axisNames[axis]));
    const fractions = cuts.map(rows=>[0,...rows.map(row=>row.fraction),1]);
    const report = {size:size.slice(),origin:origin.slice(),axes:axes.map(({axis},i)=>{
      const requested = op[axisNames[axis]];
      return {faceAxis:i===0 ? 'u' : 'v',atlasAxis:axisNames[axis],
        ...(requested !== undefined && {requested:Array.isArray(requested) ? requested.slice() : requested}),cuts:cuts[i]};
    })};
    function snap(corner,column,row) {
      const uv = MaterialUV.uv(corner,uvSet).slice();
      [column,row].forEach((index,i)=>{
        const cut = cuts[i][index-1];
        if (cut) uv[axes[i].axis] = cut.uv;
      });
      if (uvSet) corner.attributes = {...corner.attributes,[MaterialUV.key(uvSet)]:uv};
      else corner.uv = uv;
    }
    const result = buildGrid(g,face,...fractions,{report,snap});
    return op.basis === undefined ? result : {...result,detail:meshSubdivisionBasis.gridDetail(result.detail,orientation)};
  }

  return {subdivide};
})(KIT);
