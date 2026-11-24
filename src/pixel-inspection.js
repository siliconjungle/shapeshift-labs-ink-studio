const pixelSourceBindings = typeof PixelSourceBindings !== 'undefined' ? PixelSourceBindings : require('./pixel-source-bindings.js');

/* Describe indexed compositing and native render passes without guessing missing inputs. */
const PixelInspection = (() => {
  const hex = color => color == null ? null : '#'+color.toString(16).padStart(6,'0');

  function document(trace,palette,celId = () => null) {
    const swatch = index => index === null ? null : { index,...palette[index] };
    const output = hex(trace.color), selected = swatch(trace.slot);
    const paint = value=>({ ...value,color:hex(value.color) });
    const rows = layers=>layers.map(({ slot,color,before,after,children,...row })=>({
      ...row,cel:celId(row.id),swatch:row.kind === 'group' ? null : swatch(slot),color:hex(color),
      ...(before && { before:paint(before) }),...(after && { after:paint(after) }),
      ...(children && { children:rows(children) })
    }));
    return { composite:{ layer:trace.layer,cel:celId(trace.layer),color:output,alpha:trace.alpha },
      palette:{ swatch:selected,color:output,method:!selected ? 'transparent' :
        output === selected.color.toLowerCase() ? 'authored-index' : 'layer-blend' },layers:rows(trace.layers) };
  }

  const scalarPasses = ['coverage','surfaceCoverage','depth','foregroundCoverage','fogTransmittance','inkMask','inkShadow'];
  const vectorPasses = ['emission'];
  const channels = Object.freeze([...new Set([...scalarPasses,...vectorPasses,'objectId','materialId','partId','splatId',
    'surfaceKind','position','objectPosition','geometricNormal','shadingNormal','surfaceUV','surfaceUVValid',
    'strandId','strandDepth','strandCoverage','strandU','strandTangent','paletteOwner'])]);
  const tables = ['objects','materials','parts','strands','paletteOwners'];
  const finite = value => Number.isFinite(value) ? value : null;
  const tuple = (values,p,n) => values && Array.from(values.subarray(p*n,(p+1)*n),finite);

  function scene(frame,at,ArtPasses) {
    const p = at[1]*frame.w+at[0], passes = frame.passes ?? {};
    const surface = passes.depth && passes.surfaceKind && passes.position ? ArtPasses.pick(passes,...at) : undefined;
    const sources = pixelSourceBindings.sample(frame,at,ArtPasses,surface);
    const diagnostics = pixelSourceBindings.issues(frame,at,ArtPasses,{ surface,sources });
    const strandId = passes.strandId?.[p], owner = passes.paletteOwners?.[passes.paletteOwner?.[p]];
    const splatId = passes.splatId?.[p] || null;
    const frontStrand = strandId ? { id:strandId,strand:passes.strands?.[strandId] ?? null,
      depth:finite(passes.strandDepth?.[p]),coverage:finite(passes.strandCoverage?.[p]),
      u:finite(passes.strandU?.[p]),tangent:tuple(passes.strandTangent,p,3) } : null;
    const sample = frame.rgb && tuple(frame.rgb,p,3), alpha = frame.alpha?.[p] ?? 255;
    const scalar = Object.fromEntries(scalarPasses.filter(name=>passes[name]).map(name=>[name,finite(passes[name][p])]));
    const vector = Object.fromEntries(vectorPasses.filter(name=>passes[name]).map(name=>[name,tuple(passes[name],p,3)]));
    const pinned = report=>report?.x === at[0] && report?.y === at[1];
    const trace = pinned(frame.palettePixel) ? frame.palettePixel : undefined;
    const fragments = pinned(frame.pixelFragments) ? frame.pixelFragments : undefined;
    const strands = pinned(frame.strandPixel) ? frame.strandPixel : undefined;
    return { ...(frame.scene !== undefined && { id:frame.scene }),...(frame.time !== undefined && { time:frame.time }),
      ...(frame.sourceView && { sourceView:frame.sourceView }),
      ...(sources && { sources }),
      ...(diagnostics.length && { diagnostics }),
      ...(sample && { color:alpha ? hex(sample[0]*65536+sample[1]*256+sample[2]) : null,alpha }),
      ...(owner && { palette:{ ...owner,colors:owner.colors?.map(hex),...(owner.sharedColors && { sharedColors:owner.sharedColors.map(hex) }) } }),
      ...(trace && { paletteTrace:trace }),
      ...(surface !== undefined && { surface:surface && { ...surface,splatId } }),
      ...(passes.strandId && { frontStrand }),...(fragments && { fragments }),...(strands && { strands }),
      channels:{ ...scalar,...vector } };
  }

  return Object.freeze({ document,scene,channels,tables,hex });
})();
if (typeof module !== 'undefined') module.exports = PixelInspection;
