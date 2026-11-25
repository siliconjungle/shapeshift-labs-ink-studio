'use strict';

const ink = require('../..');
const PNG = require('../../cli/png.js');

function fixture() {
  const { KIT: K } = ink.load(), T = K.meshTopology;
  const vertices = [], faces = [], edges = [];
  function quad(id, x0, x1, cell) {
    const positions = [[x0,0,0],[x1,0,0],[x1,.84,0],[x0,.84,0]];
    const us = [cell/3,(cell+1)/3,(cell+1)/3,cell/3];
    const ids = positions.map((position,i) => {
      const vertex=id+'/v'+i;
      vertices.push({id:vertex,position});
      return vertex;
    });
    faces.push({id,material:'enamel',corners:ids.map((vertex,i)=>({id:id+'/c'+i,vertex,uv:[us[i],i<2 ? 1 : 0]}))});
    edges.push({id:id+'/left',vertices:[ids[0],ids[3]]},{id:id+'/right',vertices:[ids[1],ids[2]],
      ...(id==='west' && {uvSeam:true})});
  }
  quad('west',-1.26,-.42,0);
  quad('sign',-.42,.42,1);
  quad('east',.42,1.26,2);
  const document = T.create({id:'bay-panels',vertices,faces,edges});
  const guide = T.create({id:'guide',vertices:[['top',[0,.84,0]],['base',[0,0,0]],['tip',[.085,0,0]],['tail',[.085,.84,0]]]
    .map(([id,position])=>({id,position})),faces:[{id:'marker',corners:['base','tip','tail','top'].map(vertex=>({id:vertex,vertex}))}],
    edges:[{id:'datum',vertices:['top','base']}]});
  const offset = [.26,.21,.12];
  const request = {selection:T.select(document,{domain:'faces',ids:['sign']}), operation:{kind:'move',offset:[.20,.13,.12]},
    snap:{kind:'edge',object:'fixture.bar',id:'datum',anchor:{edge:'sign/right'},match:'endpoints',maxDistance:.12},coincident:true};
  const art = K.procedural.drawing2d;
  const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
  const canvas = art.render({width:72,height:24,edges:'hard',commands:[
    ...[['CUT','#805f68','#e2b9a0'],['BAY','#4d8275','#c3e2b5'],['RIM','#70684f','#f1d499']].flatMap(([label,body,light],i)=>{
      const x=i*24;
      return [rect(x,0,24,24,'#293b44'),rect(x+1,1,22,22,body),rect(x+1,1,22,2,light),
        rect(x+2,6,20,11,'#354b51'),{type:'text',text:label,at:[x+2,8],scale:1,color:light},
        rect(x+3,19,2,2,light),rect(x+19,19,2,2,light)];
    })
  ]});
  const paint = PNG.encode(72,24,canvas.data,4);
  const scene={id:'snap-bay',style:'slate',solids:[],tilesets:{bay:ink.readTilesetImage(paint)},prefabLibrary:'library.json',
    camera:{target:[.10,.46,0],dist:3,yaw:.16,pitch:.17,projection:'orthographic',sway:0},
    topologyMeshes:{panels:{document,materials:[{id:'enamel',texture:{tileset:'bay'}}]}},
    instances:{fixture:{prefab:'guide',transform:{translation:K.V.add([.42,0,0],offset)}}}};
  const library={guide:{revision:1,solids:{},topologyMeshes:{bar:{document:guide,materials:[{id:'default',color:0xf2c382}]}}}};
  return {document,guide,request,offset,scene,library,paint};
}

module.exports = { fixture };
