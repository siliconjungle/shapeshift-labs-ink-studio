/* Resolve oriented subdivision coordinates without changing authored face winding. */
const meshSubdivisionBasis = (function (K) {
  const {V} = K, names = ['u','v'];

  function rectangle(points, epsilon, message, allowCollapsed = false) {
    const [origin,right,opposite,up] = points;
    const spans = [right,up].map(point=>point.map((n,i)=>n-origin[i]));
    const axes = spans.map(span=>span.findIndex(n=>Math.abs(n)>epsilon));
    if (spans.some(span=>span.every(n=>Math.abs(n)>epsilon)) ||
        axes[0] !== -1 && axes[0] === axes[1] || !allowCollapsed && axes.includes(-1) ||
        opposite.some((n,i)=>Math.abs(n-origin[i]-spans[0][i]-spans[1][i])>epsilon))
      throw new RangeError(message);
    if (axes[0] === -1) axes[0] = axes[1] === 0 ? 1 : 0;
    if (axes[1] === -1) axes[1] = 1-axes[0];
    return axes.map((axis,i)=>({axis,start:origin[axis],end:[right,up][i][axis]}));
  }

  function uvAxes(g, face, channel) {
    const uvSet = MaterialUV.resolve(g.doc.uvBindings,channel ?? 'pigment');
    const points = face.corners.map(corner=>MaterialUV.uv(corner,uvSet));
    if (points.some(row=>!row)) throw new RangeError('The selected face does not have UV set '+uvSet);
    const mapping = rectangle(points,1e-9,'UV-oriented subdivision needs distinct rectangular UV axes');
    const axes = [0,1].map(i=>{
      const faceAxis = mapping.findIndex(row=>row.axis === i), {start,end} = mapping[faceAxis];
      return {faceAxis,direction:Math.sign(end-start)};
    });
    return {axes,evidence:{uvSet}};
  }

  function viewAxes(g, face, raw, source) {
    if (!raw) throw new TypeError('Camera-oriented subdivision needs a view with right, up and back axes');
    const {axes:[right,up,back]} = meshComponentSnap.cameraBasis(raw);
    const [a,b,c,d] = face.corners.map(corner=>g.vertices.get(corner.vertex).position);
    const native = [V.add(V.sub(b,a),V.sub(c,d)),V.add(V.sub(d,a),V.sub(c,b))];
    const projected = native.map(axis=>[V.dot(axis,right),V.dot(axis,up)]);
    const lengths = projected.map(axis=>Math.hypot(...axis));
    const [u,v] = projected;
    if (Math.abs(u[0]*v[1]-u[1]*v[0]) <= 1e-8*lengths[0]*lengths[1])
      throw new RangeError('Camera-oriented subdivision needs a face with visible width and height');
    const screen = projected.map((row,i)=>row.map(n=>n/lengths[i]));
    const direct = Math.abs(screen[0][0])+Math.abs(screen[1][1]);
    const swapped = Math.abs(screen[1][0])+Math.abs(screen[0][1]);
    const order = swapped > direct+1e-8 ? [1,0] : [0,1];
    const axes = order.map((faceAxis,i)=>({faceAxis,direction:screen[faceAxis][i]<0 ? -1 : 1}));
    return {axes,evidence:{view:{right,up,back,source},alignment:{direct,swapped}}};
  }

  function resolve(g, face, op, settings) {
    const {basis = 'face',uvSet,camera} = op;
    if (!['face','uv','camera'].includes(basis) || basis !== 'uv' && uvSet !== undefined ||
        basis !== 'camera' && camera !== undefined)
      throw new TypeError('Choose subdivision basis face, uv, or camera with settings for that basis');
    const {axes,evidence} = basis === 'uv' ? uvAxes(g,face,uvSet) :
      basis === 'camera' ? viewAxes(g,face,camera === undefined ? settings?.camera?.() : camera,
        camera === undefined ? 'scene' : 'explicit') :
      {axes:[{faceAxis:0,direction:1},{faceAxis:1,direction:1}]};
    function native(values, maxima = [1,1]) {
      const at = [];
      axes.forEach(({faceAxis,direction},i)=>{ at[faceAxis] = direction<0 ? maxima[faceAxis]-values[i] : values[i]; });
      return at;
    }
    const corner = native([0,0]);
    const origin = face.corners[[[0,1],[3,2]][corner[1]][corner[0]]].id;
    return {axes,native,report:{basis,origin,axes:axes.map(({faceAxis,direction},i)=>
      ({axis:names[i],faceAxis:names[faceAxis],direction})),...evidence}};
  }

  function gridDetail(detail, orientation) {
    const faceCounts = [detail.columns, detail.rows], [columns,rows] = orientation.axes.map(({faceAxis})=>faceCounts[faceAxis]);
    const {grid,cells} = detail;
    const before = {faceColumns:detail.columns,faceRows:detail.rows};
    const report = {...detail,columns,rows,orientation:{...orientation.report,...before}};
    if (!grid) return report;
    const points = Array.from({length:rows+1},(_,row)=>Array.from({length:columns+1},(_,column)=>{
      const [u,v] = orientation.native([column,row],faceCounts);
      return grid[v][u];
    }));
    const maxima = faceCounts.map(n=>n-1), reordered = [];
    for (let row=0;row<rows;row++) for (let column=0;column<columns;column++) {
      const [u,v] = orientation.native([column,row],maxima);
      reordered.push({...cells[v*faceCounts[0]+u],row,column});
    }
    return {...report,grid:points,cells:reordered,children:reordered.map(row=>row.face)};
  }

  return {rectangle,resolve,gridDetail};
})(KIT);
