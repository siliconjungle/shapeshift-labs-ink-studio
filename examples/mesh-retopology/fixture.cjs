'use strict';

const size=[8,6], [columns,rows]=size;
const surfaceZ=(kind,x,y)=>kind==='sdf' ? Math.sqrt(1.5**2-x*x-y*y) :
  (kind==='scan-proxy' ? -2.2 : .38)+.21*Math.cos(x*1.76)+.105*Math.cos(y*2.8)+.07*x*y;

function authored(kind,i,j,gap=0) {
  const x=-.9+1.8*i/columns, v=j/rows;
  const arc=Math.cos(x*Math.PI/1.8), y=-.64+1.28*v+arc*(.14*v+.115*Math.sin(v*Math.PI));
  return [x,y,surfaceZ(kind,x,y)+gap];
}

function rim(kind) {
  const vertices=[], faces=[];
  for(let j=0;j<2;j++) for(let i=0;i<=columns;i++) {
    const p=authored(kind,i,0), y=p[1]-(1-j)*.26;
    vertices.push({id:'belt/'+i+'/'+j,position:[p[0],y,surfaceZ(kind,p[0],y)]});
  }
  for(let i=0;i<columns;i++) faces.push({id:'belt-face/'+i,material:i===2 || i===5 ? 'clasp' : 'belt',
    corners:[[i,0],[i+1,0],[i+1,1],[i,1]].map(([x,y],k)=>({
      id:'belt-corner/'+i+'/'+k,vertex:'belt/'+x+'/'+y,uv:[x/columns,y]
    }))});
  return {id:'shoulder-'+kind,vertices,faces};
}

function request(api,kind,doc) {
  const pointRow=(j,offset)=>Array.from({length:columns+1},(_,i)=>authored(kind,i,j,offset));
  const pointColumn=(i,offset)=>Array.from({length:rows+1},(_,j)=>authored(kind,i,j,offset));
  return {
    id:'shoulder',revision:api.revision(doc),size,material:'shell',
    surface:kind==='sdf' ? {kind,volume:{kind:'sphere',center:[0,0,0],radius:1.5}} : {kind},
    rails:{top:{points:pointRow(rows,0),sampling:'knots'}},
    rims:{bottom:Array.from({length:columns+1},(_,i)=>'belt/'+i+'/1')},
    guides:[
      {id:'pivot-arc',axis:'row',index:3,kind:'joint',sampling:'knots',points:pointRow(3,.10)},
      {id:'center-flow',axis:'column',index:4,kind:'flow',sampling:'knots',points:pointColumn(4,.10)},
      {id:'stitch-seam',axis:'column',index:2,kind:'seam',sampling:'knots',points:pointColumn(2,0)},
      {id:'upper-lip',axis:'row',index:rows,kind:'silhouette',sampling:'knots',points:pointRow(rows,0)}
    ],
    projection:{direction:[0,0,-1],maxDistance:.26,pinTolerance:.052,guideTolerance:.14,maxDeviation:.045}
  };
}

function meshProxy(api) {
  const w=31,h=29, positions=[],indices=[];
  for(let j=0;j<h;j++) for(let i=0;i<w;i++) {
    const x=-1.12+2.24*i/(w-1), y=-1.13+2.26*j/(h-1);
    positions.push(x,y,surfaceZ('mesh',x,y));
    if(i===w-1 || j===h-1) continue;
    const a=j*w+i;
    indices.push(a,a+1,a+w+1,a,a+w+1,a+w);
  }
  return api.fromIndexed({id:'dense-shoulder-mesh',positions,indices,materials:['reference']});
}

function capture() {
  const width=41,height=37,worldHeight=2.65;
  const depth=Array.from({length:width*height},(_,i)=>{
    const x=(i%width+.5-width/2)*worldHeight/height, y=(height/2-Math.floor(i/width)-.5)*worldHeight/height;
    return -surfaceZ('scan-proxy',x,y);
  });
  return {width,height,depth,camera:{type:'orthographic',height:worldHeight},maxDepthJump:.10};
}

module.exports={rim,request,meshProxy,capture,surfaceZ};
