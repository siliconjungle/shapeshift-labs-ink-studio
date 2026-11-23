/* Read the tested Pixel Composer save schema into stock Ink graph nodes. */
const fs = require('node:fs');
const path = require('node:path');
const { inflateSync } = require('node:zlib');
const PNG = require('./png.js');
const { inspectPxc, rasterLiteral } = require('./pxc.js');

const saveVersion = 121092;
const maxNodes = 480, maxRasterPixels = 1048576, maxRetainedPixels = 8 * maxRasterPixels;
const noSurface = value => value === null || value === 0 || value === -4;
const integer = Number.isSafeInteger;
const vector = (value, size, test = Number.isFinite) =>
  Array.isArray(value) && value.length === size && value.every(test);
const bool = value => [false, true, 0, 1].includes(value);
const equal = (a, b) => Array.isArray(b) ? vector(a, b.length, (item, i) => item === b[i]) :
  typeof b === 'boolean' ? bool(a) && Boolean(a) === b : a === b;
const identifier = id => typeof id === 'string' && id.length > 0 && id.length <= 128 || integer(id) && id >= 0;
const link = node => ({ node });
const isTrack = value => Array.isArray(value?.keys);
const socket = (node, index) => node.inputs?.[index] ?? {};
const boundedSize = value => vector(value, 2, n => integer(n) && n > 0 && n <= 8192) &&
  value[0] * value[1] <= maxRasterPixels;
const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
const groupType = type => type === 'Node_Group' || type === 'Node_Canvas_Group';
const scope = row => row.group == null || row.group === -4 ? null : row.group;

class Untranslated extends Error {
  constructor(reason, detail, related) {
    super(detail);
    this.reason = reason;
    if (related !== undefined) this.dependsOn = related;
  }
}

function requireSetting(ok, detail, reason = 'unsupported-setting') {
  if (!ok) throw new Untranslated(reason, detail);
}

function keyEase(first, last, index) {
  if (!last) return 'linear';
  if (last.incoming === 2) return 'step';
  if (first.outgoing === 2) return 'step-start';
  if (first.outgoing === 0 && last.incoming === 0) return 'linear';
  requireSetting([0,1].includes(first.outgoing) && [0,1].includes(last.incoming) &&
    vector(first.right,2) && vector(last.left,2), 'Input '+index+' uses unsupported key tangents');
  let [x1,y1]=first.right, [x2,y2]=last.left;
  if (x1>1 && x2>1) {
    const shared=Math.min(x1,x2);
    x1/=shared; x2/=shared;
  }
  const clamp = (n, ceiling) => Math.max(0,Math.min(ceiling,n));
  y2-=clamp(x1-1,1);
  x1=clamp(x1,.9);
  y1+=clamp(x2-1,1);
  x2=1-clamp(x2,.9);
  requireSetting(Math.abs(y1)<=16 && Math.abs(y2)<=16, 'Input '+index+' has out-of-range key tangents');
  return [x1,y1,x2,y2];
}

function trackBounds(track) {
  const samples=track.keys.map(key=>key.value);
  for (let i=0;i+1<track.keys.length;i++) {
    const {ease,value}=track.keys[i];
    if (Array.isArray(ease)) for (const t of [ease[1],ease[3]])
      samples.push(value+(track.keys[i+1].value-value)*t);
  }
  return [Math.min(...samples), Math.max(...samples)];
}

function inputValue(slot, fallback, index, fps, test, convert = value => value) {
  requireSetting(!slot.global_use && !slot.sep_axis && !slot.animators?.length && !slot.bypass &&
    !slot.curveMode && !slot.attri?.mapped, 'Input ' + index + ' uses an expression, mapped value or separated axes');
  const values = slot.r;
  if (!Array.isArray(values)) {
    requireSetting(!slot.anim, 'Input ' + index + ' has unsupported animation data');
    const value = values && Object.hasOwn(values, 'd') ? values.d : slot.def_val ?? fallback;
    requireSetting(test(value), 'Input ' + index + ' has an unsupported value');
    return convert(value);
  }
  requireSetting(values.length > 0 && values.length <= 2048 &&
    (values.length === 1 || !slot.anim || fps && !slot.on_end && (slot.loop_range === undefined || slot.loop_range === -1)),
  'Input ' + index + ' needs a hold-ended key track on the saved frame rate');
  const keys = values.map(key => {
    requireSetting(Array.isArray(key) && vector(key[0], 2, integer) && key[0][0] === 0 &&
      key[0][1] >= 0 && key[0][1] <= 1e6 && !key[7] && test(key[1]),
    'Input ' + index + ' uses an unsupported keyframe or driver');
    return { frame: key[0][1], value: convert(key[1]), left:key[2],right:key[3],
      incoming: key[4] ?? 0, outgoing: key[5] ?? 0 };
  });
  if (!slot.anim || keys.length === 1) return keys[0].value;
  requireSetting(keys.every(({ frame }, i) => !i || frame>keys[i-1].frame), 'Input '+index+' needs ordered keys');
  return { ...(Array.isArray(keys[0].value) && { mode: 'vector' }), keys: keys.map(({ frame, value }, i) =>
    ({ time: frame / fps, value, ease:keyEase(keys[i],keys[i+1],index) })) };
}

function color(value) {
  return [value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24];
}

function localImage(file, name, sourceFiles) {
  requireSetting(file && typeof name === 'string' && !/[\x00-\x1f:%$]/.test(name) &&
    /\.png$/i.test(name), 'Image needs a local relative PNG beside the PXC project', 'unsupported-asset');
  const parts = name.replaceAll('\\', '/').split('/');
  requireSetting(parts.every(part => part && part !== '..'), 'Image path leaves the PXC project directory', 'unsupported-asset');
  try {
    const root = path.dirname(fs.realpathSync(file));
    const target = fs.realpathSync(path.resolve(root, ...parts));
    const relative = path.relative(root, target);
    requireSetting(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative),
      'Image path leaves the PXC project directory', 'unsupported-asset');
    const stat = fs.statSync(target);
    requireSetting(stat.isFile() && stat.size <= 16 * 1024 * 1024,
      'Image is not a bounded local PNG file', 'unsupported-asset');
    const bytes = fs.readFileSync(target);
    const { w, h } = PNG.layout(bytes);
    requireSetting(boundedSize([w, h]), 'Image exceeds the translation raster budget', 'unsupported-asset');
    const { data, max } = PNG.raster(bytes);
    sourceFiles.add(target);
    return { width: w, height: h, data: max === 255 ? data : Uint8Array.from(data, n => Math.round(n * 255 / max)) };
  } catch (error) {
    if (error instanceof Untranslated) throw error;
    throw new Untranslated('unsupported-asset', 'Could not read the referenced local PNG: ' + name);
  }
}

function translatePxc(bytes, { file } = {}) {
  const { project: source, report, art } = inspectPxc(bytes, { image: true, tolerateArt: true });
  const rows = source.nodes ?? [];
  if (!Array.isArray(rows) || rows.length > maxNodes) throw new RangeError('PXC translation needs at most ' + maxNodes + ' nodes');
  const timeline = source.animator ?? {};
  const fps = Number.isFinite(timeline.framerate) && timeline.framerate >= .001 && timeline.framerate <= 240 ? timeline.framerate : null;
  const frameCount = integer(timeline.frames_total) && timeline.frames_total > 0 ? timeline.frames_total : null;
  const versionOK = source.version === saveVersion;
  const registry = new Map(), states = new Map(), visiting = new Set(), sourceFiles = new Set();
  let retainedPixels = 0;
  const nodes = {}, outputs = {}, exports = {}, targetOutputs = [];
  const project = { format: 'ink-studio/graph-project', version: 1, nodes, outputs, exports };
  for (const [index, row] of rows.entries()) {
    if (!identifier(row?.id) || typeof row.type !== 'string' || registry.has(row.id))
      throw new TypeError('PXC nodes must have unique string or integer IDs and a type');
    registry.set(row.id, { row, name: 'pxc-' + (index + 1) });
  }

  function groupPath(row) {
    const parents=[];
    for (let id=scope(row);id!==null;) {
      const parent=registry.get(id)?.row;
      requireSetting(parent && groupType(parent.type) && parents.length<16 && !parents.includes(id),
        'Invalid or unsupported enclosing group','unsupported-context');
      requireSetting(parent.version===undefined || parent.version===saveVersion,'Enclosing group uses an unsupported save version',
        'unsupported-version');
      requireSetting((parent.ictx==null || parent.ictx===-4) && !parent.is_instancer &&
        (parent.instanceBase==null || parent.instanceBase===-4) && !parent.attri?.timeline_override,
      'Instanced or independently timed group needs manual conversion','unsupported-context');
      parents.push(id);
      id=scope(parent);
    }
    return parents.reverse();
  }

  function attached(group, direction, index) {
    const ids=group.attri?.['custom_'+direction+'_list'];
    const row=Array.isArray(ids) && registry.get(ids[index])?.row;
    requireSetting(row?.type==='Node_Group_'+(direction==='input' ? 'Input' : 'Output') && scope(row)===group.id,
      'Group socket '+index+' has no matching boundary node','unsupported-connection');
    return row;
  }

  function groupOutput(row,index) {
    groupPath(row);
    requireSetting(versionOK && (row.version===undefined || row.version===saveVersion) &&
      !row.is_instancer && (row.instanceBase==null || row.instanceBase===-4) &&
      (row.ictx==null || row.ictx===-4) && !row.attri?.timeline_override &&
      ![false,0].includes(row.attri?.process) && ![false,0].includes(row.render),
    'Group has an unsupported version, instance, bypass or local clock','unsupported-context');
    const boundary=attached(row,'output',index);
    return checkedSource(boundary.id,0,undefined,'Group output '+index);
  }

  function checkedSource(dep,index,kind,label) {
    const row=registry.get(dep)?.row;
    if (visiting.has(dep) && !groupType(row?.type))
      throw new Untranslated('cycle', 'The connection to '+label+' is cyclic', dep);
    const result=groupType(row?.type) ? groupOutput(row,index) : convert(dep);
    if (result.reason) throw new Untranslated('blocked', label+' depends on an untranslated node', dep);
    requireSetting(kind===undefined || result.kind===kind,label+' needs a '+kind,'unsupported-connection');
    return result;
  }

  function readConnection(row,index,kind) {
    const slot=socket(row,index), dep=slot.from_node, from=registry.get(dep)?.row;
    const port=slot.from_index ?? 0;
    requireSetting(!slot.global_use && !slot.bypass && !slot.attri?.mapped && (slot.from_tag ?? 0)===0 &&
      integer(port) && port>=0 && port<512 && (port===0 || groupType(from?.type)),
    'Input '+index+' needs a standard connection to an output');
    requireSetting(from,'Input '+index+' needs a connected '+(kind ?? 'node'),'missing-source');
    requireSetting(scope(row)===scope(from),'Input '+index+' crosses a group boundary without a port','unsupported-context');
    return checkedSource(dep,port,kind,'Input '+index);
  }

  function convert(id) {
    if (states.has(id)) return states.get(id);
    const { row, name } = registry.get(id);
    const draft = {};
    let extent, alias, numericBounds;
    const add = (op, inputs, suffix = '', type) => {
      const node = name + suffix;
      draft[node] = { op, inputs, ...(type && { type }) };
      return link(node);
    };
    const value = (index, fallback, test = () => true, map) => {
      const input = socket(row, index);
      requireSetting(input.from_node === undefined, 'Input ' + index + ' must be authored locally');
      return inputValue(input, fallback, index, fps, test, map);
    };
    const fixed = (index, expected) => value(index, expected, result => equal(result, expected));
    const staticValue = (index, fallback, test) => {
      const result = value(index, fallback, test);
      requireSetting(!isTrack(result), 'Input ' + index + ' must be static');
      return result;
    };
    const connected = (index, kind) => readConnection(row,index,kind);
    const route = result => {
      ({kind,extent,numericBounds}=result);
      alias=result.ref;
    };
    const binding = (index, kind, fallback, test, map) => socket(row, index).from_node === undefined ?
      value(index, fallback, test, map) : connected(index, kind).ref;
    const emptySurface = index => staticValue(index, -4, noSurface);
    const sourceRaster = () => {
      const result = connected(0, 'raster');
      extent = result.extent;
      return result.ref;
    };
    const dimensions = index => {
      const size = staticValue(index, undefined, value => vector(value, 2));
      const mode = socket(row, index).attri?.use_project_dimension ?? 0;
      if (mode === 0) return size;
      const base = source.attributes?.surface_dimension;
      requireSetting(mode === 1 && boundedSize(base), 'Unknown project dimension mode on input ' + index);
      return size.map((n, i) => n * base[i]);
    };
    const imageDimensions = size => {
      requireSetting(boundedSize(size), 'Output dimensions exceed the translation raster budget');
      extent = size;
      return { width: size[0], height: size[1] };
    };
    const attribute = key => row.attri?.[key] || groupPath(row).reverse()
      .map(id=>registry.get(id).row.attri?.[key]).find(Boolean) || (source.attributes?.[key] ?? 0)+1;
    const filter = () => {
      const mode = attribute('interpolate');
      requireSetting(mode === 1 || mode === 2, 'Only pixel or bilinear sampling is supported');
      return mode === 1 ? 'nearest' : 'bilinear';
    };
    const amount = (index,fallback=1) => {
      const result=binding(index,'number',fallback,unit);
      const bounds=result?.node ? connected(index,'number').numericBounds :
        isTrack(result) ? trackBounds(result) : [result,result];
      requireSetting(bounds?.every(unit),'Mix must stay in the range 0 to 1');
      return result;
    };
    const processor = (original,config,edit) => {
      const {maskIndex,mixIndex,invertIndex,channels=15,preselected=false}=config;
      fixed(invertIndex+1,0);
      const invert=Boolean(staticValue(invertIndex,false,bool));
      const ratio=amount(mixIndex);
      const matte=socket(row,maskIndex).from_node===undefined ? (emptySurface(maskIndex),null) : connected(maskIndex,'raster');
      if (matte) requireSetting(equal(matte.extent,extent),'Mask must align with the translated image');
      if (!matte && ratio===1 && (channels===15 || preselected)) return edit('');
      const mode=socket(row,maskIndex).attri?.mask_alpha_only ?? false;
      requireSetting(bool(mode),'Unknown mask channel mode');
      const options={amount:ratio,invert,maskMode:mode ? 'alpha' : 'mean',keepTransparentRGB:true,channels};
      const edited=edit('-edited');
      add('raster.mix',{source:original,edited,...(matte && {mask:matte.ref}),
        options:ratio?.node || isTrack(ratio) ? add('data.record',options,'-mix') : options});
    };
    const paletteInput = index => binding(index,'palette',source.attributes?.palette,
      values=>Array.isArray(values)&&values.length>=1&&values.length<=256&&values.every(packedColor),
      values=>values.map(color));

    visiting.add(id);
    let kind = 'raster', result;
    try {
      requireSetting(versionOK && (row.version === undefined || row.version === saveVersion),
        'Translation is tested with Pixel Composer save version ' + saveVersion, 'unsupported-version');
      groupPath(row);
      requireSetting((row.ictx == null || row.ictx === -4) &&
        !row.is_instancer && (row.instanceBase == null || row.instanceBase === -4) && !row.attri?.timeline_override,
      'Instanced and independently timed nodes need manual conversion', 'unsupported-context');
      requireSetting(![0, false].includes(row.attri?.process) && ![0, false].includes(row.render),
        'Disabled bypass behavior needs manual conversion');
      const depth = row.attri?.color_depth;
      if (!groupType(row.type) && !['Node_Group_Input','Node_Group_Output','Node_Number', 'Node_Number_Simple',
        'Node_Color', 'Node_Palette', 'Node_Counter', 'Node_Export'].includes(row.type))
        requireSetting(depth === 0 || depth === 3 || (depth === undefined || depth === 1) &&
          (source.attributes?.color_depth ?? 1) === 1, 'Only 8-bit RGBA surfaces are supported');

      requireSetting(row.inputs === undefined || Array.isArray(row.inputs) && row.inputs.length <= 512 &&
        row.inputs.every(slot => slot == null || typeof slot === 'object' && !Array.isArray(slot)),
      'Invalid saved node inputs');
      switch (row.type) {
        case 'Node_Group':
        case 'Node_Canvas_Group': {
          route(groupOutput(row,0));
          break;
        }
        case 'Node_Group_Output': {
          requireSetting(scope(row)!==null,'Group output is outside a group','unsupported-context');
          route(connected(0));
          break;
        }
        case 'Node_Group_Input': {
          const parent=registry.get(scope(row))?.row;
          const port=parent?.attri?.custom_input_list?.indexOf?.(row.id) ?? -1;
          requireSetting(port>=0 && attached(parent,'input',port)===row,'Input has no parent group port','unsupported-connection');
          const slot=socket(parent,port);
          if (slot.from_node!==undefined) {
            route(readConnection(parent,port));
            break;
          }
          const type=socket(row,2).r?.d ?? 0;
          requireSetting([0,1,3].includes(type),'Local group input needs a scalar number or color','unsupported-connection');
          requireSetting((slot.unit ?? 0)===0,'Local group input needs a unitless value');
          kind=type===3 ? 'color' : 'number';
          const input=inputValue(slot,kind==='color' ? 0xffffffff : 0,port,fps,
            type===3 ? packedColor : type===0 ? integer : Number.isFinite,kind==='color' ? color : undefined);
          requireSetting(kind!=='color' || !isTrack(input),'Animated packed group colors need manual conversion');
          if (kind==='number') numericBounds=isTrack(input) ? trackBounds(input) : [input,input];
          add('data.typed',{value:input},'',kind==='color' ? 'rgb8' : 'number');
          break;
        }
        case 'Node_Solid': {
          emptySurface(3);
          emptySurface(5);
          fixed(6, false);
          const empty = staticValue(2, false, bool);
          const paint = empty ? [0, 0, 0, 0] : binding(1, 'color', 0xffffffff, packedColor, color);
          requireSetting(!isTrack(paint), 'Animated packed colors need manual conversion');
          add('raster.canvas', { ...imageDimensions(dimensions(0)), color: paint });
          break;
        }
        case 'Node_Canvas': {
          staticValue(12,1,n=>n===1 || n===true);
          emptySurface(19);
          const background=Boolean(staticValue(10,true,bool));
          if (background) {fixed(4,0);emptySurface(8);}
          const size=imageDimensions(dimensions(0));
          const stored=row.surfaces;
          requireSetting(Array.isArray(stored)&&stored.length===1&&typeof stored[0]==='string'&&
            stored[0].length<=8*maxRasterPixels&&/^[A-Za-z0-9+/]+={0,2}$/.test(stored[0]),
          'Canvas needs one embedded RGBA8 frame','unsupported-asset');
          const expected=size.width*size.height*4;
          let data;
          try { data=inflateSync(Buffer.from(stored[0],'base64'),{maxOutputLength:expected}); }
          catch { throw new Untranslated('unsupported-asset','Canvas frame could not be decoded'); }
          requireSetting(data.length===expected,'Canvas frame size does not match its declared dimensions','unsupported-asset');
          for (let i=0;i<data.length;i+=4) if (!data[i+3]) data.fill(0,i,i+3);
          draft[name]=rasterLiteral({...size,data});
          break;
        }
        case 'Node_Composite': {
          requireSetting(row.input_fix_len===4 && row.data_length===8 && row.inputs?.length===12,
            'Composite needs one unscaled, unrotated layer');
          fixed(0,[0,0,0,0]); fixed(1,0);
          const layer=connected(4,'raster');
          extent=layer.extent;
          fixed(6,0); fixed(7,[1,1]); fixed(8,0); fixed(9,1); fixed(11,0);
          const at=staticValue(5,[.5,.5],point=>vector(point,2));
          const anchor=staticValue(10,[.5,.5],point=>vector(point,2,unit));
          const unitMode=socket(row,5).unit ?? 1;
          requireSetting((unitMode===0 || unitMode===1) && ![false,0].includes(row.attri?.layer_visible?.[0]) &&
            !(row.attri?.layer_effect?.[0]?.length),'Composite needs a visible relative layer with no style effects');
          const round=Boolean(staticValue(3,false,bool));
          const position=at.map((n,i)=>(unitMode===1 ? n*extent[i] : n)-anchor[i]*extent[i]);
          const [x,y]=round ? position.map(Math.round) : position;
          requireSetting(integer(x)&&integer(y),'Composite needs pixel-aligned placement');
          if (!x && !y) alias=layer.ref;
          else add('raster.stack',{width:extent[0],height:extent[1],
            layers:add('data.collect',{source:add('data.record',{
              layer:add('data.record',{source:layer.ref,x,y},'-layer')
            },'-named'),keys:['layer']},'-layers')});
          break;
        }
        case 'Node_Image': {
          fixed(1, [0, 0, 0, 0]);
          requireSetting(!row.attri?.cache_use, 'Embedded image caches need manual conversion', 'unsupported-asset');
          const image = localImage(file, staticValue(0, '', name => typeof name === 'string'), sourceFiles);
          imageDimensions([image.width, image.height]);
          draft[name] = rasterLiteral(image);
          break;
        }
        case 'Node_Color': {
          kind = 'color';
          const paint = binding(0, kind, 0xffffffff, packedColor, color);
          requireSetting(!isTrack(paint), 'Animated packed colors need manual conversion');
          add('data.typed', { value: paint }, '', 'rgb8');
          break;
        }
        case 'Node_Palette': {
          kind='palette';
          const colors=paletteInput(0);
          const trim=staticValue(1,[0,1],n=>vector(n,2,unit));
          requireSetting(!isTrack(colors),'Animated packed palettes need manual conversion');
          if (colors?.node) {
            requireSetting(equal(trim,[0,1]),'Linked palette trimming needs manual conversion');
            alias=colors;
          } else {
            const start=Math.floor(Math.min(...trim)*colors.length), end=Math.floor(Math.max(...trim)*colors.length);
            requireSetting(end>start,'Empty palette needs manual conversion');
            add('data.typed',{value:colors.slice(start,end)},'','array<rgb8>');
          }
          break;
        }
        case 'Node_Number':
        case 'Node_Number_Simple': {
          kind = 'number';
          if (row.type === 'Node_Number') fixed(1, false);
          requireSetting((socket(row, 0).unit ?? 0) === 0, 'Only unitless numbers are supported');
          const number = binding(0, kind, 0, Number.isFinite);
          if (number?.node) numericBounds = connected(0, kind).numericBounds;
          else {
            numericBounds = isTrack(number) ? trackBounds(number) : [number,number];
          }
          add('data.typed', { value: number }, '', kind);
          break;
        }
        case 'Node_Counter': {
          kind = 'number';
          requireSetting(fps, 'Counter needs a saved project frame rate');
          fixed(3, false);
          const mode = staticValue(2, 0, n => n === 0 || n === 1);
          requireSetting(mode === 0 || frameCount > 1, 'Progress counter needs at least two frames');
          const time = add('time', {}, '-seconds');
          const frames = add('time.toFrames', { time, fps }, '-frames');
          const speed = staticValue(1, 1, Number.isFinite) / (mode ? frameCount - 1 : 1);
          const scaled = add('multiply', { a: frames, b: speed }, '-scaled');
          add('add', { a: scaled, b: mode ? 0 : staticValue(0, 1, Number.isFinite) });
          break;
        }
        case 'Node_Invert': {
          const source = sourceRaster();
          fixed(3, true);
          const mask = staticValue(4, 15, n => integer(n) && n >= 0 && n <= 15);
          const alpha = Boolean(staticValue(7, false, bool));
          const order = ['r', 'g', 'b', 'alpha'].map((channel, i) => (i < 3 || alpha) && (mask & (1 << i)) ?
            { channel, gain: -1, bias: 255 } : channel);
          processor(source,{maskIndex:1,mixIndex:2,invertIndex:5,channels:mask,preselected:true},
            suffix=>add('color.channels',{source,options:{order}},suffix));
          break;
        }
        case 'Node_Posterize': {
          const source=sourceRaster();
          fixed(2,true);
          fixed(5,true);
          fixed(8,0);
          fixed(10,0);
          emptySurface(11);
          const palette=paletteInput(1);
          requireSetting(!isTrack(palette),'Animated packed palettes need manual conversion');
          const alpha=Boolean(staticValue(6,true,bool));
          processor(source,{maskIndex:12,mixIndex:13,invertIndex:14},
            suffix=>add('color.posterize',{source,palette,options:{alpha}},suffix));
          break;
        }
        case 'Node_Displace': {
          const source=sourceRaster(), map=connected(1,'raster');
          requireSetting(filter()==='nearest','Displacement currently supports pixel sampling');
          for (const index of [15,17,22,24]) emptySurface(index);
          fixed(6,false); fixed(10,true); fixed(11,0); fixed(16,false); fixed(21,1); fixed(29,false);
          requireSetting(!socket(row,3).attri?.curved,'Displacement strength uses a per-pixel curve');
          const channelMask=staticValue(12,15,n=>integer(n)&&n>=0&&n<=15);
          const mode=staticValue(5,0,n=>n===0 || n===1);
          const oversample=attribute('oversample'), edge={1:'transparent',3:'clamp',4:'wrap'}[oversample];
          requireSetting(edge,'Displacement edge mode needs empty, clamp, or repeat');
          const validStrength=n=>Number.isFinite(n)&&Math.abs(n)<=1024;
          const amount=binding(3,'number',1,validStrength);
          const middle=binding(4,'number',.5,unit,n=>n*255);
          if (amount?.node || isTrack(amount))
            requireSetting((amount?.node ? connected(3,'number').numericBounds : trackBounds(amount))?.every(validStrength),
              'Animated displacement strength exceeds its range');
          if (middle?.node)
            requireSetting(connected(4,'number').numericBounds?.every(unit),'Linked mid value must stay within zero and one');
          else if (isTrack(middle))
            requireSetting(trackBounds(middle).every(n=>n>=0 && n<=255),'Animated mid value must stay within zero and one');
          const center=middle?.node ? add('multiply',{a:middle,b:255},'-mid') : middle;
          let scale=[-1/255,-1/255];
          if (!mode) {
            const unitMode=Number(socket(row,2).unit ?? 0);
            requireSetting(unitMode===0 || unitMode===1,'Unsupported displacement position unit');
            scale=staticValue(2,[1,0],point=>vector(point,2,n=>Number.isFinite(n)&&Math.abs(n)<=16384))
              .map((n,i)=>-n*(unitMode===1 ? extent[i] : 1)/255);
          }
          const aligned=equal(map.extent,extent) ? map.ref : add('raster.resize',{source:map.ref,
            options:{width:extent[0],height:extent[1],filter:'nearest'}},'-resize-map');
          const channel=(which,suffix)=>add('raster.channel',{source:aligned,options:{channel:which}},suffix);
          let displacement;
          if (mode) displacement=add('raster.channels',{planes:add('data.collect',{
            source:add('data.record',{x:channel(0,'-red'),y:channel(1,'-green')},'-axes'),keys:['x','y']
          },'-maps')},'-vector');
          else {
            const alpha=add('raster.math',{a:channel('alpha','-alpha'),b:255,op:'divide'},'-normalized-alpha');
            displacement=add('raster.math',{a:channel('luma','-luma'),b:alpha,op:'multiply'},'-brightness');
          }
          const settings={units:mode ? 'normalized' : 'pixels',center,scale,amount,filter:'nearest',
            edge,continuousEdges:true};
          const dynamic=[center,amount].some(n=>n?.node || isTrack(n));
          const options=dynamic ? add('data.record',settings,'-displacement') : settings;
          processor(source,{maskIndex:8,mixIndex:9,invertIndex:13,channels:channelMask},
            suffix=>add('warp.displace',{source,map:displacement,options},suffix));
          break;
        }
        case 'Node_Scale': {
          const source = sourceRaster();
          fixed(4, true);
          const mode = staticValue(2, 0, n => n === 0 || n === 1);
          let size;
          if (mode === 1) {
            fixed(6, 0);
            requireSetting((socket(row, 3).unit ?? 0) === 0, 'Target dimensions must be in pixels');
            size = staticValue(3, sourceDimensions(), boundedSize);
          } else {
            const ratio = staticValue(1, 1, n => Number.isFinite(n) && n > 0);
            size = extent.map(n => n * ratio);
          }
          const sample = filter();
          const input = sample === 'bilinear' ? add('raster.rgba', { source }, '-rgba') : source;
          add('raster.resize', { source: input, options: { ...imageDimensions(size), filter: sample, premultiply: false } });
          break;
        }
        case 'Node_Crop': {
          const source = sourceRaster();
          fixed(2, true);
          fixed(3, 0);
          const mode = socket(row, 1).unit ?? 0;
          requireSetting(mode === 0 || mode === 1, 'Unsupported crop padding unit');
          const padding = staticValue(1, [0, 0, 0, 0], v => vector(v, 4, n => Number.isFinite(n) && n >= 0));
          const margins = padding.map((n, i) => mode ? n * extent[i % 2] : n);
          requireSetting(margins.every(integer), 'Crop padding must align to whole pixels');
          // Pixel Composer stores these margins in right, top, left, bottom order.
          const [right, top, left, bottom] = margins;
          add('raster.crop', { source, options: { x: left, y: top,
            ...imageDimensions([extent[0] - left - right, extent[1] - top - bottom]) } });
          break;
        }
        case 'Node_Flip': {
          const source = sourceRaster();
          fixed(2, true);
          fixed(3, 15);
          emptySurface(4);
          fixed(5, 1);
          const axis = staticValue(1, 1, n => integer(n) && n >= 0 && n <= 3);
          const x = axis & 1 ? [-1, 0, 1] : [1, 0, 0], y = axis & 2 ? [0, -1, 1] : [0, 1, 0];
          const field = add('warp.field', { width: extent[0], height: extent[1], matrix: [x, y] }, '-uv');
          add('warp.sample', { source, field, options: { filter: 'nearest' } });
          break;
        }
        case 'Node_Transform': {
          const raster = sourceRaster();
          const inputSize = extent;
          requireSetting(inputSize.some(n => n > 1), 'Transform skips single-pixel sources in this save version');
          const mode = staticValue(9, 0, n => n === 0 || n === 1);
          const size = imageDimensions(mode === 1 ? dimensions(1) : inputSize);
          fixed(11, true);
          fixed(5, 0);
          fixed(6, [1, 1]);
          fixed(7, 0);
          fixed(8, 0);
          fixed(10, false);
          fixed(12, false);
          fixed(14, 1);
          fixed(17, false);
          emptySurface(21);
          const anchor = staticValue(3, [.5, .5], n => vector(n, 2, unit));
          const positionUnit = socket(row, 2).unit ?? 1;
          requireSetting(positionUnit === 0 || positionUnit === 1, 'Unsupported transform position unit');
          const offset = value(2, [.5, .5], n => vector(n, 2, n => Number.isFinite(n) && Math.abs(n) <= 1e4),
            point => point.map((n, i) => anchor[i] * inputSize[i] - n * (positionUnit === 1 ? extent[i] : 1)));
          requireSetting(filter() === 'nearest', 'Transform currently supports pixel sampling');
          if (isTrack(offset)) {
            const layer = add('data.record', { source: raster, offset }, '-layer');
            const named = add('data.record', { layer }, '-named');
            const layers = add('data.collect', { source: named, keys: ['layer'] }, '-layers');
            add('proc.parallax', { layers, options: size });
          } else {
            const [w, h] = inputSize;
            const matrix = [[size.width / w, 0, offset[0] / w], [0, size.height / h, offset[1] / h]];
            const field = add('warp.field', { ...size, matrix }, '-uv');
            add('warp.sample', { source: raster, field, options: { filter: 'nearest', edge: 'transparent' } });
          }
          break;
        }
        case 'Node_Blend': {
          const background = sourceRaster();
          const front = connected(1, 'raster');
          fixed(8, true);
          fixed(2, 0);
          emptySurface(4);
          for (const index of [5, 6, 10, 11]) fixed(index, 0);
          for (const index of [9, 12, 15]) fixed(index, false);
          fixed(16, 15);
          const position = socket(row, 14);
          const coords = staticValue(14, [.5, .5], n => vector(n, 2));
          const unitMode = position.unit ?? 1;
          requireSetting(unitMode === 0 || unitMode === 1, 'Unsupported position unit');
          const [x, y] = coords.map((p, i) => (unitMode === 0 ? p : p * extent[i]) - front.extent[i] / 2);
          requireSetting(integer(x) && integer(y), 'Blend needs an integer foreground offset');
          const opacity = binding(3, 'number', 1, unit);
          if (opacity?.node)
            requireSetting(connected(3, 'number').numericBounds?.every(unit), 'Linked opacity must stay in the range 0 to 1');
          const options = opacity?.node || isTrack(opacity) ? add('data.record', { opacity, x, y }, '-blend') : { opacity, x, y };
          add('raster.blend', { background, foreground: front.ref, options });
          break;
        }
        case 'Node_Export': {
          alias = sourceRaster();
          break;
        }
        default:
          throw new Untranslated('unsupported-node', 'No native translation for ' + row.type);
      }

      if (extent && !alias) {
        const pixels = extent[0] * extent[1];
        requireSetting(retainedPixels + pixels <= maxRetainedPixels, 'This branch exceeds the total raster budget', 'budget');
        retainedPixels += pixels;
      }
      Object.assign(nodes, draft);
      result = { kind, ref: alias ?? link(name), extent, numericBounds };
    } catch (error) {
      if (!(error instanceof Untranslated)) throw error;
      result = { reason: error.reason, detail: error.message,
        ...(error.dependsOn !== undefined && { dependsOn: error.dependsOn }) };
    } finally { visiting.delete(id); }
    states.set(id, result);
    return result;

    function sourceDimensions() {
      const value = source.attributes?.surface_dimension;
      return boundedSize(value) ? value : extent;
    }
  }

  for (const id of registry.keys()) convert(id);
  function expose(name, result) {
    outputs[name] = result.ref;
    exports[name] = { output: name, format: result.kind === 'raster' ? 'png' : 'json' };
  }
  for (const [id, { row, name }] of registry) {
    const result = states.get(id);
    if (row.type !== 'Node_Export' || result.reason) continue;
    const output = targetOutputs.length === 0 ? 'image' : 'export-' + name;
    expose(output, result);
    targetOutputs.push({ id, output });
  }
  const selected = states.get(source.previewNode);
  if (selected && !selected.reason && !targetOutputs.some(({ id }) => id === source.previewNode)) {
    const output = targetOutputs.length === 0 ? 'image' : 'selected-preview';
    expose(output, selected);
    targetOutputs.push({ id: source.previewNode, output });
  }
  const translated = [], unsupported = [], blocked = [];
  for (const [id, { row }] of registry) {
    const result = states.get(id), sourceNode = { id, type: row.type, ...(typeof row.name === 'string' && { name: row.name }),
      ...(scope(row)!==null && {group:scope(row)}) };
    if (result.reason) {
      (result.reason === 'blocked' ? blocked : unsupported).push({ ...sourceNode, ...result });
    } else translated.push({ ...sourceNode, node: result.ref.node });
  }
  if (!targetOutputs.length) {
    const consumed = new Set();
    for (const [id, { row }] of registry)
      if (!states.get(id).reason && Array.isArray(row.inputs))
        for (const input of row.inputs) consumed.add(input?.from_node);
    for (const [id, { name }] of registry) {
      const result = states.get(id);
      if (!result.reason && !consumed.has(id)) expose('partial-' + name, result);
    }
  }
  if (art) {
    nodes['saved-preview'] = rasterLiteral(art.image);
    expose('saved-preview', { kind: 'raster', ref: link('saved-preview') });
  }
  return { project, sourceFiles: [...sourceFiles], report: { ...report, mode: 'translation', complete: versionOK && translated.length > 0 && unsupported.length === 0 && blocked.length === 0,
    timeline: { fps, frames: frameCount }, translated, unsupported, blocked, targets: targetOutputs,
    savedPreview: art ? { output: 'saved-preview', kind: art.kind, width: art.image.width, height: art.image.height } : null,
    ...(versionOK ? {} : { translationError: 'Expected Pixel Composer save version ' + saveVersion }) } };
}

function packedColor(value) {
  return integer(value) && value >= -0x80000000 && value <= 0xffffffff;
}

module.exports = { translatePxc };
