const atlasSize = 96, atlasSeed = 173, atlasDefault = 'cellular';
const atlasFamilies = {
  perlin: ['Perlin','Gradient lattice',[2,3,4],'A soft gradient field with broad, connected forms.'],
  simplex: ['Simplex','Gradient simplex',[2,3,4],'Smooth gradients on a simplex lattice, with a circular embedding for 2D tiles.'],
  gaussian: ['Gaussian','Normal distribution',[2,3,4],'Independent values concentrated around a mean. Native output keeps the signed distribution.'],
  white: ['White','Uniform distribution',[2,3,4],'Independent uniform values. Useful when a material needs scatter with no spatial structure.'],
  blue: ['Blue','Void-and-cluster ranks',[2],'Ordered ranks keep sparse thresholded samples spread across a repeating tile.'],
  worley: ['Worley','Nearest distance',[2,3],'Each point measures its distance to the closest site. Low values pick out site centers.'],
  voronoi: ['Voronoi','Nearest-site regions',[2,3],'Each site owns a solid patch. Its value stays stable across wrapped boundaries.'],
  cellular: ['Cellular','Distance gap',[2,3],'The gap between the two nearest sites. Dark seams trace where the distances meet.'],
  fractal: ['Fractal','Layered gradients',[2,3,4],'Fine octaves sit on top of broader ones, with editable gain and spacing.'],
  ridged: ['Ridged','Folded octaves',[2,3,4],'Inverted gradient magnitudes create crests at multiple scales.'],
  anisotropic: ['Anisotropic','Stretched gradients',[2],'Stretch the gradient field along a chosen axis.'],
  directional: ['Directional','Flowing bands',[2],'Long bands follow the chosen angle. Wander bends them across their length.']
};
const atlasRamps = {
  mineral:{ colorSpace:'srgb',interpolation:'linear',stops:[
    {at:0,value:'#091111'}, {at:.23,value:'#133537'}, {at:.46,value:'#218278'},
    {at:.68,value:'#8cc29e'}, {at:.85,value:'#f0c478'}, {at:1,value:'#ffedba'}
  ] },
  grayscale:{colorSpace:'srgb',stops:[{at:0,value:'#000000'},{at:1,value:'#ffffff'}]}
};

function atlasOptions(family) {
  const familyDefaults = { blue:{rankSize:[32,32]}, anisotropic:{angle:26}, directional:{angle:26} };
  return {seed:atlasSeed,...familyDefaults[family]};
}

function atlasGraph(families = Object.keys(atlasFamilies), artifacts = false) {
  const link = (node,port='value') => ({node,port}), op = (op,inputs) => ({op,inputs});
  const graph = {format:'ink-studio/graph-project',version:1,inputs:{
    ramp:{type:'record',default:atlasRamps.mineral}
  },nodes:{},outputs:{},exports:{}};
  for (const family of families) {
    graph.inputs[family+'Options'] = {type:'record',default:atlasOptions(family)};
    graph.nodes[family] = op('image.noise',{family,width:atlasSize,height:atlasSize,options:{input:family+'Options'}});
    graph.nodes[family+'Paint'] = op('image.gradientMap',{source:link(family),ramp:{input:'ramp'},options:{precision:'unorm8'}});
    graph.nodes[family+'Plate'] = op('image.toDisplay',{source:link(family+'Paint')});
    graph.outputs[family] = link(family+'Plate');
    graph.outputs[family+'Info'] = link(family,'info');
    graph.outputs[family+'Scalar'] = link(family);
    if (artifacts) graph.exports[family] = {output:family,format:'png'};
  }
  if (artifacts) graph.exports.settings = {output:atlasDefault+'Info',format:'json'};
  return graph;
}

if (typeof module !== 'undefined') module.exports = { atlasFamilies,atlasSeed,atlasGraph };
