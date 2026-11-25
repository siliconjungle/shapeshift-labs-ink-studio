/* Repeat a saved multi-tile pick on the construction plane. */
(function (K) {
  const A = K.authoring, {V} = K, {freeze} = K.procedural.data;
  const directions = {right:[1,0],left:[-1,0],up:[0,1],down:[0,-1]};
  const fields = ['id','object','part','material','brush','at','count','direction','spacing',
    'overlapTiles','align','anchor','snapGrid','brushScale','texelsPerUnit'];
  const pair = value=>Array.isArray(value) && value.length === 2 && Array.from(value).every(Number.isFinite);
  const maxCells = 4096;

  function settings(scene, request, options) {
    const {id,object,part,material,brush:saved,at,count=1,direction='right',spacing='abut',
      overlapTiles=spacing === 'overlap' ? 1 : 0,align='edge',anchor,snapGrid=false,
      brushScale=saved?.brushScale,texelsPerUnit=saved?.texelsPerUnit} = request ?? {};
    if (!request || Object.getPrototypeOf(request) !== Object.prototype ||
        Object.keys(request).some(key=>!fields.includes(key)) || !pair(at) ||
        !Object.hasOwn(directions,direction) || !['abut','overlap'].includes(spacing) || !['edge','anchor'].includes(align) ||
        typeof snapGrid !== 'boolean' || anchor !== undefined && (align !== 'anchor' || !pair(anchor)) ||
        !Number.isSafeInteger(count) || count<1 || saved?.format !== 'ink-studio/tileset-brush' || saved.version !== 1)
      throw new TypeError('A brush run needs a saved tile brush, grid address, positive stamp count, and supported spacing and alignment');
    const api = A.tilesetFaces, planes = A.constructionPlane;
    const asset = A.tilesets.prepare(scene.tilesets,scene.tilesetDefaults).source(saved.tileset);
    const brush = TilesetSelection.readBrush(asset,saved);
    const {columns,rows,tileWidth,tileHeight} = brush;
    if (columns*rows*count>maxCells) throw new RangeError('A tile brush run supports up to '+maxCells+' sampled cells');
    const step = directions[direction], travel = step[0] ? columns : rows;
    if (!Number.isSafeInteger(overlapTiles) || overlapTiles<0 || overlapTiles>=travel ||
        (spacing === 'abut' ? overlapTiles !== 0 : overlapTiles === 0))
      throw new RangeError('Overlap must be at least one tile and smaller than the brush along the run, or zero for abut');
    const artSize = [columns*tileWidth,rows*tileHeight];
    const resolvedAnchor = align === 'anchor' ? anchor ?? artSize.map(n=>n/2) :
      [step[0]<0 ? artSize[0] : 0,step[1]<0 ? 0 : artSize[1]];
    if (resolvedAnchor.some((n,i)=>n<0 || n>artSize[i]))
      throw new RangeError('The anchor must lie inside the compact brush bounds');
    const first = TilesetSelection.cell(brush,{column:0,row:0});
    const selection = TilesetSelection.pick(brush.tileset,asset,first);
    const context = api.prepare(scene,{object,part,face:id,material,selection,planeAt:at,brushScale,texelsPerUnit},options);
    const {frame,size:[tileU,tileV]} = context;
    const cellAt = snapGrid ? planes.quantize(frame,at) : at;
    const point = planes.point(frame,cellAt);
    const move = ([u,v],p=point)=>V.mad(V.mad(p,frame.axes[0],u*tileU),frame.axes[1],v*tileV);
    const anchorTiles = [resolvedAnchor[0]/tileWidth,(artSize[1]-resolvedAnchor[1])/tileHeight];
    const origin = move(anchorTiles.map(n=>-n));
    const pitch = step.map(n=>n*(travel-overlapTiles));
    return {brush,asset,context,count,direction,spacing,overlapTiles,align,anchor:resolvedAnchor,
      gridAt:cellAt,point,pitch,move:at=>move(at,origin),anchorAt:at=>move(at)};
  }

  function plan(scene, request, options) {
    const run = settings(scene,request,options), {id,at,snapGrid=false} = request;
    const {asset,context,brush,move,pitch} = run, api = A.tilesetFaces;
    const {columns,rows} = brush, {object,part,material,existing,doc,frame,size:[tileU,tileV]} = context;
    const cells = new Map(), stamps = [], conflicts = [...context.conflicts];
    const paint = [];
    let uvInset;
    for (let row=0;row<rows;row++) for (let column=0;column<columns;column++) {
      const cell = TilesetSelection.cell(brush,{column,row});
      const crop = TilesetSelection.pick(brush.tileset,asset,cell);
      const mapping = TilesetSelection.uvMapping(asset,request.brush,{},cell);
      uvInset = mapping.brush.uvInset;
      const {texelBounds} = mapping;
      paint.push({row,column,...api.cropSource(asset,crop,texelBounds)});
    }
    for (let index=0;index<run.count;index++) {
      const [u,v] = pitch.map(n=>n*index), replaced = [];
      for (const tile of paint) {
        const address = [u+tile.column,v+rows-1-tile.row], key = address.join(',');
        const previous = cells.get(key);
        const face = id+'/'+index+'/'+tile.row+'/'+tile.column;
        if (previous) replaced.push({cell:address,before:previous.face,after:face});
        cells.set(key,{address,face,stamp:index,tile});
      }
      stamps.push({index,point:run.anchorAt([u,v]),origin:move([u,v]),replaced});
    }
    const placements = [], faces = [];
    for (const {address,face,stamp,tile:{row,column,pigmentUV,source}} of cells.values()) {
      const anchor = move(address);
      const bindingSource = {...source,placement:{run:id,stamp,column,row}};
      const placement = api.stamp({...context,source:bindingSource,pigmentUV},face,anchor);
      placements.push(placement);
      faces.push({id:face,cell:address,stamp,column,row,selection:source.selection,origin:anchor});
      conflicts.push(...placement.conflicts);
    }
    const row = !conflicts.length ? api.append(context,placements) : undefined;
    const report = freeze({format:'ink-studio/tileset-brush-run',version:1,id,object,mode:'stamp',...(part && {part}),
      constructionPlane:frame.plane,at:at.slice(),snapGrid,gridAt:run.gridAt.slice(),point:run.point,
      direction:run.direction,spacing:run.spacing,overlapTiles:run.overlapTiles,align:run.align,
      anchor:run.anchor.slice(),brush:{...brush,uvInset},texelsPerUnit:context.density,brushScale:context.brushScale,material,
      tileSize:[tileU,tileV],pitch:[pitch[0]*tileU,pitch[1]*tileV],stamps,faces,conflicts,canCommit:!conflicts.length,
      beforeRevision:doc ? K.meshTopology.revision(doc) : null,
      afterRevision:row ? K.meshTopology.revision(row.document) : doc ? K.meshTopology.revision(doc) : null,
      ...(row && {changes:A.meshTopologyScene.diff(existing,row)})});
    return {row,report};
  }

  A.tilesetBrushRuns = Object.freeze({plan});
})(KIT);
