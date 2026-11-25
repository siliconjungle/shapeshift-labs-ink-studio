const workshopWidth = 96, workshopHeight = 48, workshopFamily = 'ridged';
const workshopFamilies = ['perlin','simplex','gaussian','white','blue','worley','voronoi','cellular',
  'fractal','ridged','anisotropic','directional'];
const workshopStack = family => family === 'fractal' || family === 'ridged';
const workshopMotion = family => !['gaussian','white','blue'].includes(family);
const workshopControls = { scale:1.25, u:.125, v:-.125, expansion:true, disorder:.125, speed:.5, first:0, last:2, gain:.6, lacunarity:2.15 };
const workshopRamp = {colorSpace:'srgb',stops:[
  {at:0,value:'#141530'},{at:.26,value:'#272652'},{at:.42,value:'#57458a'},{at:.56,value:'#9564b2'},
  {at:.68,value:'#e48d91'},{at:.79,value:'#f4b477'},{at:.91,value:'#fae2a2'},{at:1,value:'#fff3ce'}
]};

function workshopRecipe(family, controls) {
  const reference = {seed:83};
  if (workshopStack(family)) reference.carrier = 'simplex';
  if (family === 'blue') reference.rankSize = [24,24];
  if (family === 'anisotropic' || family === 'directional') reference.angle = 28;
  const live = {...reference,scale:controls.scale,tileOffset:[controls.u,controls.v],
    nonSquareExpansion:controls.expansion};
  if (workshopMotion(family)) Object.assign(live,{disorder:controls.disorder,animationSpeed:controls.speed});
  if (workshopStack(family)) Object.assign(live,{octaveRange:[controls.first,controls.last],
    gain:controls.gain,lacunarity:controls.lacunarity});
  return {reference,live};
}

function workshopGraph(artifacts = false) {
  const link = (node,port='value') => ({node,port});
  const input = input => ({input});
  const op = (op,inputs) => ({op,inputs});
  const defaults = workshopRecipe(workshopFamily,workshopControls);
  const graph = {format:'ink-studio/graph-project',version:1,inputs:{
    family:{type:'string',default:workshopFamily},
    referenceOptions:{type:'record',default:defaults.reference},liveOptions:{type:'record',default:defaults.live},
    ramp:{type:'record',default:workshopRamp}
  },nodes:{clock:op('anim.clock',{options:{range:[0,8]}})},outputs:{},exports:{}};
  for (const name of ['reference','live']) {
    const field = name+'Map', grade = name+'Grade';
    graph.nodes[field] = op('image.noise',{family:input('family'),width:workshopWidth,height:workshopHeight,
      options:input(name+'Options'),...(name === 'live' && {time:link('clock')})});
    graph.nodes[grade] = op('image.gradientMap',{source:link(field),ramp:input('ramp'),options:{precision:'unorm8'}});
    graph.nodes[name] = op('image.toDisplay',{source:link(grade)});
    graph.outputs[name] = link(name);
    graph.outputs[name+'Info'] = link(field,'info');
    graph.outputs[name+'Scalar'] = link(field);
    if (artifacts) graph.exports[name] = {output:name,format:'png'};
  }
  if (artifacts) graph.exports.settings = {output:'liveInfo',format:'json'};
  return graph;
}

if (typeof module !== 'undefined') module.exports = { workshopGraph };
