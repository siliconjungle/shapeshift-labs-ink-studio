/* Picture adapters share a committed frame and its take clock. */
const PNG = require('./png.js');
const { render, resize } = require('./render.js');
const { readGraphProject } = require('./graph-project.js');

const palette = ['#70dfc6','#efaf74','#9eaaf3','#e8d87f','#e8a8c7'];
const rect = (x,y,w,h,fill) => ({type:'rect',rect:[x,y,w,h],fill});
const label = (text,x,y,color,scale=1) => ({type:'text',text,at:[Math.round(x),Math.round(y)],color,scale});
const outline = (x,y,w,h,stroke) => ({type:'rect',rect:[x,y,w,h],fill:false,stroke,width:1});

function debug(K, settings, frame, query, beats) {
  const {width,height,entities,story} = settings;
  const bounds=K.world.fields.bounds(settings.bounds ?? frame.world.visual?.bounds ?? {min:[-5,-1,-5],max:[5,5,5]});
  const {min,max}=bounds, margin=10, bottom=height-24;
  const spanX=max[0]-min[0], spanZ=max[2]-min[2];
  const scale=Math.min((width-margin*2)/Math.max(spanX,.001),(bottom-27)/Math.max(spanZ,.001));
  const left=(width-(max[0]-min[0])*scale)/2, top=23;
  const x=value=>left+(value-min[0])*scale, y=value=>top+(max[2]-value)*scale;
  const right=x(max[0]), edge=y(min[2]);
  const mapWidth=right-left, mapHeight=edge-top;
  const commands=[rect(0,0,width,height,'#101827'),rect(left,top,mapWidth,mapHeight,'#1c2c3e')];
  for (let i=1;i<8;i++) {
    commands.push(rect(left+mapWidth*i/8,top,.6,mapHeight,'#33465a'));
    commands.push(rect(left,top+mapHeight*i/8,mapWidth,.6,'#33465a'));
  }
  commands.push(outline(left,top,mapWidth,mapHeight,'#4a6577'));
  const locations=[], names=entities ?? Object.keys(frame.world.entities).slice(0,64);
  for (const [i,name] of names.entries()) {
    const point=query.target({entity:name})?.point;
    if (!point || point[0]<min[0] || point[0]>max[0] || point[2]<min[2] || point[2]>max[2]) continue;
    const cx=x(point[0]), cy=y(point[2]), color=palette[i%palette.length];
    const half=frame.world.entities[name]?.visual?.half;
    if (half) {
      const a=Math.max(left,x(point[0]-half[0])), b=Math.min(right,x(point[0]+half[0]));
      const c=Math.max(top,y(point[2]+half[2])), d=Math.min(edge,y(point[2]-half[2]));
      if (b>a&&d>c) commands.push(outline(a,c,b-a,d-c,color));
    }
    commands.push(rect(cx-2,cy-2,5,5,color));
    const text=name.slice(0,18);
    commands.push(label(text,Math.max(1,Math.min(width-6*text.length,cx+5)),Math.max(top,cy-8),color));
    locations.push({entity:name,point});
  }
  const lifecycle=query.probe('world/story-lifecycle').value ?? {};
  const selected=story ?? Object.keys(lifecycle).find(id=>lifecycle[id]);
  const state=selected && lifecycle[selected];
  const name=selected?.split('/').at(-1);
  const status=state?.status ?? 'waiting', stage=state?.flow?.current?.stage ?? state?.outcome;
  commands.push(label('TICK '+frame.tick+'   X/Z',8,8,'#c4d6e1'));
  if (name) commands.push(label((name+' / '+status+(stage?' / '+stage:'')).slice(0,Math.floor((width-16)/6)),
    8,height-21,'#70dfc6'));
  if (beats.length) commands.push(label(beats.at(-1).kind.slice(0,Math.floor((width-16)/6)),8,height-10,'#efaf74'));
  return {image:K.procedural.drawing2d.render({width,height,commands,edges:'hard'}),
    details:{locations,...(selected&&{story:selected,status,...(stage&&{stage})})}};
}
function splat(kit, settings, frame, query, take, effects) {
  const W=kit.KIT.world, {width,height,camera}=settings;
  const scene=W.visual(kit,frame,query,{take,eventEffects:effects});
  const view=camera ? {...scene,cam:{...scene.cam,...camera},cameraRig:undefined} : scene;
  const image=resize(render(view,{w:width,h:height,px:1,colored:true,t:take.start,take,
    ...(camera&&{lockCamera:true})}),width,height);
  return {image:{width,height,channels:3,data:image.rgb},details:{splats:view.count,
    ...(scene.visualConsequences&&{consequences:scene.visualConsequences.active}),
    ...(scene.eventEffects&&{effects:scene.eventEffects.active})}};
}
function puppet(kit,file,output) {
  const graph=readGraphProject(file,{kit}), plan=graph.plan();
  const requireType=kit.KIT.procedural.graphTypes.compatible;
  if (plan.inputs.performance?.type!=='record' || !Object.hasOwn(plan.outputs,output) ||
      !requireType(plan.outputs[output].type,'raster')) {
    graph.clear();
    throw new TypeError('Puppet graph needs a record input named performance and a raster output');
  }
  return {graph, async frame(take,performance,width,height) {
    const {values,report}=await graph.previewFrame({picture:{output}},{take,inputs:{performance}},{encodeArtifacts:false});
    if (!report.passed) throw new Error('Puppet graph assertions failed at frame '+take.frame);
    const image=kit.KIT.procedural.raster.rgba(values.picture);
    if (image.width!==width || image.height!==height) throw new TypeError('Puppet graph picture must match the configured size');
    return image;
  }};
}
function rgba(K,image) {
  const source=K.procedural.raster.rgba(image);
  return source;
}
function png({width,height,data}) {
  return PNG.encode(width,height,data,4);
}
module.exports={debug,splat,puppet,rgba,png};
