/* Compile placed socket tiles and directional glyphs into a cellular rule graph. */
(function (K) {
  const { clone, freeze } = K.procedural.data;
  const sides = 'NESW', dx = [0,1,0,-1], dy = [-1,0,1,0];
  const integer = (n,min,max) => Number.isSafeInteger(n) && n>=min && n<=max;
  const idOK = value => typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(value);
  const record = value => value != null && [Object.prototype,null].includes(Object.getPrototypeOf(value));
  const fields = (value,keys) => record(value) && Object.keys(value).every(key=>keys.includes(key));
  const rotated = (side,turn) => (sides.indexOf(side)+turn)%4;
  const order = (a,b) => a.id < b.id ? -1 : Number(a.id > b.id);
  const boards = new WeakSet();
  function check(ok,message) {
    if (!ok) throw new RangeError('Rule board: '+message);
  }

  function logic({ node, state, inputs }) {
    if (node.type==='source') return state;
    const active = new Set(inputs.filter(input=>input.state!==0).map(input=>input.edge.data.toPort));
    if (node.type==='all') return Number(node.data.inputs.length>0 && node.data.inputs.every(port=>active.has(port)));
    if (node.type==='not') return Number(!active.size);
    return Number(!!active.size);
  }

  function compile({width,height,size=8,parts,cells}={},palette={}) {
    check(integer(width,1,4096) && integer(height,1,4096) && width*height<=4096 &&
      integer(size,4,32) && size%2===0 && width*height*size*size<=1048576,
    'expected a bounded grid and even tile size from 4 to 32');
    check(record(parts) && integer(Object.keys(parts).length,1,256),'expected 1–256 named part definitions');

    const w=width*size, h=height*size, count=width*height;
    const definitions=new Map();
    for (const [name,part] of Object.entries(parts)) {
      check(idOK(name) && record(part),'expected a named tile or glyph');
      const {paths,inputs='',outputs='',type,data,cel}=part, tile=paths!==undefined;
      if (tile) {
        check(fields(part,['paths','cel']) && Array.isArray(paths) && integer(paths.length,1,4) &&
          Array.from(paths).every(path=>typeof path==='string' && /^[NESW]{1,4}$/.test(path)),
        'tile '+name+' needs disjoint NESW paths');
      } else {
        check(fields(part,['inputs','outputs','type','data','cel']) && [inputs,outputs].every(ports=>
          typeof ports==='string' && /^[NESW]{0,4}$/.test(ports)) && inputs.length+outputs.length>0 &&
          (type===undefined || idOK(type)), 'glyph '+name+' needs directional inputs or outputs');
      }
      const ports=tile ? paths.join('') : inputs+outputs;
      check(new Set(ports).size===ports.length,'part '+name+' uses a socket more than once');
      let image;
      if (cel!==undefined) {
        check(cel?.width===size && cel.height===size && (cel.frames===undefined || Array.isArray(cel.frames) && cel.frames.length===1),
          'part '+name+' art must be a single cel matching the board tile size');
        const {entries,palette:swatches}=K.pixelStamps.prepare(cel), slots=entries[0].slots;
        check(PixelGridMotion.matchSockets(slots,size,ports),
          'part '+name+' art must paint exactly the center pair of pixels on each declared socket');
        image=K.pixelStamps.image({width:size,height:size,slots,alpha:entries[0].alpha,palette:swatches},palette).rgba;
      }
      definitions.set(name,tile ? {paths:paths.slice(),image} :
        {inputs,outputs,type:type ?? (inputs ? 'any' : 'source'),data:data===undefined ? undefined : clone(data),image});
    }

    function address(at) {
      check(Array.isArray(at) && at.length===2 && integer(at[0],0,width-1) && integer(at[1],0,height-1),
        'expected an in-bounds XY cell');
      return at[1]*width+at[0];
    }
    const coordinates = index => [index%width,Math.floor(index/width)];
    function place(raw) {
      if (raw===null) return null;
      const spec=typeof raw==='string' ? {part:raw} : raw;
      check(fields(spec,['part','turn','id','state','locked']) && definitions.has(spec.part),
        'each cell needs a named part or null');
      const {part,turn=0,id,state,locked}=spec;
      check(integer(turn,0,3),'cell turns must be clockwise quarter indices from zero to three');
      if (definitions.get(part).paths) {
        check(id===undefined && state===undefined && locked===undefined,'only glyphs have IDs, state or locks');
        return {part,turn};
      }
      check(idOK(id) && (state===undefined || integer(state,0,255)) &&
        (locked===undefined || typeof locked==='boolean'),'glyphs need a stable ID and optional valid state and lock');
      return {part,turn,id,...(state!==undefined && {state}),...(locked!==undefined && {locked})};
    }

    function build(rawCells) {
      check(Array.isArray(rawCells) && rawCells.length===count,'expected exactly width × height row-major cells');
      const cells=freeze(Array.from(rawCells,place)), sockets=new Array(count*4), nodes=[], sources=[], locations=new Set();
      cells.forEach((cell,index)=>{
        if (!cell) return;
        const part=definitions.get(cell.part), at=coordinates(index);
        const socket=side=>index*4+rotated(side,cell.turn);
        if (part.paths) {
          for (const path of part.paths) for (const side of path)
            sockets[socket(side)]={at,connections:[...path].filter(other=>other!==side).map(socket)};
          return;
        }
        const {id,state,locked}=cell;
        check(!locations.has(id),'duplicate glyph ID '+id);
        locations.add(id);
        nodes.push({id,type:part.type,state,locked,data:{at,part:cell.part,turn:cell.turn,
          inputs:[...part.inputs],outputs:[...part.outputs],...(part.data!==undefined && {authored:part.data})}});
        for (const side of part.inputs) sockets[socket(side)]={at,id,port:side,input:true};
        for (const side of part.outputs) {
          sockets[socket(side)]={at,id,port:side,input:false};
          sources.push(socket(side));
        }
      });
      const unmatched=[];
      sockets.forEach((socket,index)=>{
        const side=index%4, [x,y]=socket.at, nx=x+dx[side], ny=y+dy[side];
        const other=(ny*width+nx)*4+(side+2)%4;
        if (nx>=0 && nx<width && ny>=0 && ny<height && sockets[other]) socket.across=other;
        else unmatched.push({at:socket.at,side:sides[side],...(socket.id && {id:socket.id,port:socket.port})});
      });

      const edges=[];
      let work=0;
      for (const start of sources) {
        const from=sockets[start], queue=[start], previous=new Map([[start,null]]);
        for (let cursor=0;cursor<queue.length;cursor++) {
          const index=queue[cursor], target=sockets[index];
          check(++work<=1000000,'wiring analysis exceeded its work budget');
          if (target.id && index!==start) {
            if (!target.input) continue;
            const path=[];
            for (let step=index;step!==null;step=previous.get(step)) {
              check(++work<=1000000,'wiring analysis exceeded its work budget');
              path.push({at:sockets[step].at,side:sides[step%4]});
            }
            check(edges.length<8192,'too many logical connections');
            edges.push({id:from.id+':'+from.port+'>'+target.id+':'+target.port,
              from:from.id,to:target.id,type:'wire',data:{fromPort:from.port,toPort:target.port,path:path.reverse()}});
            continue;
          }
          const next=[...(target.connections ?? []),target.across];
          for (const other of next) {
            if (other===undefined || previous.has(other)) continue;
            previous.set(other,index);
            queue.push(other);
          }
        }
      }
      const graph=freeze({nodes:nodes.sort(order),edges:edges.sort(order)});

      function edit(changes) {
        check(Array.isArray(changes) && changes.length<=count,'expected a bounded edit list');
        const draft=cells.slice();
        for (const change of changes) {
          check(record(change),'expected a turn, move or set edit');
          if (change.op==='turn') {
            check(fields(change,['op','at','turns']),'invalid turn edit');
            const at=address(change.at), {turns=1}=change;
            check(draft[at] && Number.isSafeInteger(turns),'turn needs an occupied cell and integer quarter turns');
            draft[at]={...draft[at],turn:(draft[at].turn+turns%4+4)%4};
          } else if (change.op==='move') {
            check(fields(change,['op','from','to']),'invalid move edit');
            const from=address(change.from), to=address(change.to);
            check(draft[from] && !draft[to],'move needs an occupied origin and an empty destination');
            draft[to]=draft[from];
            draft[from]=null;
          } else {
            check(change.op==='set' && fields(change,['op','at','cell']),'unknown board edit');
            draft[address(change.at)]=place(change.cell);
          }
        }
        return build(draft);
      }

      function diff(next) {
        check(boards.has(next),'expected another compiled rule board');
        const before=new Map(graph.edges.map(edge=>[edge.id,edge]));
        const after=new Map(next.graph.edges.map(edge=>[edge.id,edge]));
        const added=next.graph.edges.filter(edge=>!before.has(edge.id));
        const removed=graph.edges.filter(edge=>!after.has(edge.id));
        const rerouted=next.graph.edges.flatMap(edge=>{
          const old=before.get(edge.id);
          return old && JSON.stringify(old.data.path)!==JSON.stringify(edge.data.path) ? [{before:old,after:edge}] : [];
        });
        const nodeLocations=new Map(graph.nodes.map(({id,data})=>[id,data.at]));
        const moved=next.graph.nodes.flatMap(({id,data:{at}})=>{
          const from=nodeLocations.get(id);
          return from && (from[0]!==at[0] || from[1]!==at[1]) ? [{id,from,to:at}] : [];
        });
        return freeze({added,removed,rerouted,moved});
      }

      function raster() {
        const target={rgba:new Uint8Array(w*h*4),width:w};
        cells.forEach((cell,index)=>{
          if (!cell) return;
          const {image}=definitions.get(cell.part);
          const [x,y]=coordinates(index);
          if (image) PixelGridMotion.blit(image,target,size,x*size,y*size,cell.turn);
        });
        return {w,h,rgba:target.rgba};
      }
      function create({rule=logic,states,initial,seed}={}) {
        return K.cellular.graph.create({...graph,rule,states,initial,seed});
      }

      const board=Object.freeze({width,height,size,cells,graph,unmatched:freeze(unmatched),edit,diff,raster,create});
      boards.add(board);
      return board;
    }
    return build(cells);
  }

  K.ruleBoard=Object.freeze({compile});
})(KIT);
