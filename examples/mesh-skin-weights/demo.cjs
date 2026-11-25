/* The switchyard kite uses the same shell, patina and arm pose in both lanes. */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('../..');
const directory = path.resolve(process.argv[2] ?? 'skin-review');
const out = name => path.join(directory,name);
const write = (name,value) => fs.writeFileSync(out(name),JSON.stringify(value,null,2)+'\n');
const { KIT:K } = ink.load();
fs.mkdirSync(directory,{recursive:true});

const vertices = [], faces = [], materials = [];
const joint = sign => sign<0 ? 'elevator.L' : 'elevator.R';
const style = {
  shadow:0x203049, tealDark:0x224a5b, lacquer:0x397883, teal:0x59aaab, light:0xa2d6c2,
  umber:0x725351, copper:0x9e6451, trim:0xd18e5d, brass:0xeeb777, bright:0xffdf9d
};
for (const [id,color] of Object.entries(style)) materials.push({id,color});

function point(id,position,weights={keel:1}) {
  vertices.push({id,position,weights});
  return id;
}
function face(id,verts,material) {
  faces.push({id,material,corners:verts.map((vertex,i)=>({id:id+'/'+i,vertex,
    uv:verts.length===4 ? [[0,1],[1,1],[1,0],[0,0]][i] : [i/(verts.length-1),i===1?0:1]}))});
}
function plate(id,xy,z,material) {
  face(id,xy.map(([x,y],i)=>point(id+'/'+i,[x,y,z])),material);
}

const sections = [
  [.63,.04,.23], [.88,.10,.27], [1.13,.18,.28], [1.42,.22,.27],
  [1.66,.19,.23], [1.95,.14,.18], [2.23,.07,.13], [2.51,.00,.07], [2.74,-.04,.018]
];
for (const side of [-1,1]) {
  const label=side<0?'port':'starboard', rows = [];
  for (const [i,[x,y,half]] of sections.entries()) {
    const influence = (side<0 ? [0,0,0,0,.82,.82,.82,.82,.82] : [0,0,0,.82,.82,.82,.82,.82,.82])[i];
    const weights = {keel:.18,damper:.82-influence,[joint(side)]:influence};
    rows.push([-.95,-.63,-.15,.47,1].map((fraction,k)=>
      point(label+'/'+i+'/'+k,[side*x,y+half*fraction,.046*k + (k===2 ? .075 : 0)],weights)));
  }
  for (let i=1;i<rows.length;i++) for (let q=1;q<rows[i].length;q++) {
    const ids=[rows[i-1][q-1],rows[i][q-1],rows[i][q],rows[i-1][q]];
    const band = [
      i%3===0 ? 'umber' : 'copper', i>6 ? 'trim' : i%2===0 ? 'lacquer' : 'teal',
      i>6 ? 'copper' : i===4 ? 'trim' : 'tealDark', i%2 ? 'brass' : 'trim'
    ][q-1];
    face(label+'-vane-'+i+'-'+q,side<0?ids.reverse():ids,band);
  }
}

plate('hull-dark',[[-.68,.54],[-.89,.28],[-.75,-.37],[-.54,-.68],[0,-.91],[.54,-.68],[.75,-.37],[.89,.28],[.68,.54]],.29,'shadow');
plate('hull',[[-.64,.49],[-.84,.27],[-.69,-.35],[-.49,-.62],[0,-.81],[.49,-.62],[.69,-.35],[.84,.27],[.64,.49]],.32,'lacquer');
plate('bronze-brow',[[-.73,.36],[-.56,.60],[.56,.60],[.73,.36],[.52,.30],[-.52,.30]],.39,'trim');
plate('finial',[[-.23,.58],[-.10,.81],[0,.92],[.10,.81],[.23,.58]],.41,'brass');
plate('panel',[[-.47,.29],[-.56,.18],[-.41,-.50],[0,-.69],[.41,-.50],[.56,.18],[.47,.29]],.38,'tealDark');
plate('glass',[[-.36,.21],[-.47,.11],[-.33,-.42],[0,-.56],[.33,-.42],[.47,.11],[.36,.21]],.42,'shadow');
plate('lightbar',[[-.30,.10],[-.20,.18],[.20,.18],[.30,.10],[.23,-.04],[-.23,-.04]],.49,'teal');
plate('glint',[[-.23,.10],[-.17,.145],[.12,.145],[.08,.10]],.50,'light');
plate('motor-badge',[[-.12,-.12],[0,-.07],[.12,-.12],[.12,-.24],[0,-.30],[-.12,-.24]],.48,'trim');
plate('badge-light',[[-.05,-.15],[.05,-.15],[.05,-.21],[-.05,-.21]],.49,'bright');
for (const side of [-1,1]) {
  const x=side*.65, tag=side<0?'port':'starboard';
  plate(tag+'-strap',[[x-.13,.31],[x+.13,.25],[x+.10,-.36],[x-.12,-.28]],.44,'copper');
  for (const [i,y] of [.19,-.13,-.26].entries())
    plate(tag+'-rivet-'+i,[[x-.038,y-.038],[x+.038,y-.038],[x+.038,y+.038],[x-.038,y+.038]],.47,i===0?'bright':'brass');
}
for (let i=0;i<3;i++) {
  const y=-.34-i*.08, x=.13-i*.025;
  plate('vent-'+i,[[-x,y],[x,y],[x,y-.023],[-x,y-.023]],.48,'teal');
}

const source = K.meshTopology.create({id:'switchyard-kite',vertices,faces,skin:{
  joints:['keel','damper','elevator.L','elevator.R'], locked:['keel'],
  mirrors:[['elevator.L','elevator.R']]
}});
const choose = ids => K.meshTopology.select(source,{domain:'vertices',ids});
const port = choose(vertices.filter(row=>row.id.startsWith('port/')).map(row=>row.id));
const rows = (...i)=>choose(port.ids.filter(id=>i.includes(Number(id.split('/')[1]))));
const request = {revision:K.meshTopology.revision(source),operations:[
  { op:'assign',joint:'elevator.L',weight:.06,selection:rows(2) },
  { op:'assign',joint:'elevator.L',weight:.26,selection:rows(3) },
  { op:'assign',joint:'elevator.L',weight:.56,selection:rows(4) },
  { op:'paint',joint:'elevator.L',weight:.78,selection:rows(4,5),
    at:[-1.81,.16,.12],radius:.4,strength:.5,falloff:'smooth' },
  { op:'mirror',selection:port },
  { op:'assign',joint:'keel',weight:0,selection:port }
]};
const identity=[1,0,0,0,1,0,0,0,1,0,0,0];
function hinge(x,y,angle) {
  const c=Math.cos(angle),s=Math.sin(angle);
  return [c,-s,0,s,c,0,0,0,1,x-c*x+s*y,y-s*x-c*y,0];
}
const view={w:208,h:132,joint:'elevator.L',camera:{
  target:[0,.26,0],dist:5.2,yaw:0,pitch:.08,ortho:true,fov:.72
},pose:{keel:identity,damper:identity,'elevator.L':hinge(-1.26,.17,-1.13),'elevator.R':hinge(1.26,.17,1.13)},materials};
write('kite.json',source);
write('paint.json',request);
write('pose.json',view);
execFileSync(process.execPath,[path.join(__dirname,'../../cli/ink-studio.js'),'mesh-topology','skin',out('kite.json'),out('paint.json'),
  '--view',out('pose.json'),'--preview',directory,'--out',out('kite-weighted.json'),'--report',out('report.json')],{stdio:'inherit'});
