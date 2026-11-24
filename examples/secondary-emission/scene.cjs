'use strict';

module.exports = function kilnRunoff() {
  const palette = [
    0x15212c,0x212d39,0x334251,0x4e6168,0x728b89,0x9cab94,
    0x153944,0x195361,0x2a7681,0x4e9b9e,0x8bc9bd,
    0x383544,0x4e4657,0x625665,0x837183,0xa18b8c,
    0x4d3030,0x77453b,0xab6d4d,0xd8a066,0xffcf8a,0xefe0b3
  ];
  const roles = { metal:[1,2,3], water:[6,7,8,9], accent:[19,20,21] };
  const role = colors => {
    const key = 'finish-'+colors.join('-');
    roles[key] = colors;
    return key;
  };
  const box = (id,at,half,colors,extra={}) => ({
    id, kind:'box', at, half, res:.085, round:.025, mat:{role:role(colors)}, ...extra
  });
  const pane = (id,materialId,at,half,colors) =>
    box(id,at,half,colors,{res:.071,round:.012,mat:{role:role(colors),materialId}});
  const foundation = [
    box('deck',[0,-.39,0],[4.35,.27,1.69],[0,1,2],{round:.13,res:.12}),
    pane('water','water',[-2.10,-.10,0],[1.94,.10,1.32],[6,7,8,9]),
    ...Array.from({length:4},(_,i) => pane('stone-tile-'+i,'stone',[.55+i*1.027,-.10,0],
      [.501,.10,1.32],i%2?[11,12,13,14]:[11,12,13])),
    box('beam-front',[0,-.16,1.48],[4.22,.125,.105],[1,3,4]),
    box('beam-back',[0,-.03,-1.47],[4.22,.125,.085],[1,2,3]),
    ...[-4.14,0,4.14].map((x,i)=>box('divider-'+i,[x,-.061,0],[.055,.087,1.46],[2,3,4])),
    ...Array.from({length:12},(_,i)=>box('stud-'+i,[-3.95+i*.72,-.12,1.58],[.041,.039,.028],
      i%3?[3,4,5]:[18,19,20],{res:.034}))
  ];
  const details = [
    ...Array.from({length:14},(_,i)=>box('basin-glint-'+i,[-3.86+i%7*.52,.005,(i<7?-1.04:.96)+i%3*.063],
      [.081+i%3*.025,.007,.012],i%3?[7,8,9]:[8,9,10],{res:.038})),
    ...Array.from({length:14},(_,i)=>box('stone-fleck-'+i,[.25+i%7*.58,.006,(i<7?-1.08:.96)+i%3*.058],
      [.063+i%3*.028,.008,.019],i%4?[12,13,14]:[13,14,15],{res:.038})),
    ...[-2.08,2.08].flatMap((x,i)=>[
      box('post-'+i,[x,.88,-1.41],[.14,.96,.17],[1,2,3,4],{res:.068}),
      box('post-base-'+i,[x,.092,-1.35],[.29,.115,.19],[2,3,4],{res:.061}),
      box('arm-'+i,[x,1.88,-.74],[.086,.076,.74],[16,17,18,19],{res:.058}),
      box('arm-guide-'+i,[x,1.98,-.65],[.071,.027,.52],[18,19,20],{res:.049}),
      box('nozzle-'+i,[x,1.76,-.041],[.16,.135,.16],[16,18,19],{res:.048}),
      box('nozzle-rim-'+i,[x,1.63,-.04],[.179,.046,.17],[18,20,21],{res:.045}),
      box('nozzle-mouth-'+i,[x,1.59,-.04],[.086,.025,.083],[0,1,2],{res:.041})
    ])
  ];
  const particles = [0.33,1.69,3.05].flatMap((time,i)=>[-2.08,2.08].map((x,j)=>({
    id:(j?'right':'left')+'-'+(i+1),time,point:[x,1.55,-.04],
    velocity:[[-.43, .66, -.89][i],-1.65,[.49,.13,.96][i]],gravity:7.4,
    radius:.067,life:1.5,color:'#fff1d2'
  })));
  return {
    id:'kiln-runoff',name:'Kiln Runoff',seed:52,palette,roles,
    camera:{target:[0,.43,0],dist:7.55,yaw:-.12,pitch:.76,projection:'orthographic'},
    light:{sun:[-.45,.85,.35],ambient:.53},
    finish:{radius:9,dither:0,look:{pixelSize:1},materialResponse:{
      recipe:{format:'ink-studio/material-response',version:1,materials:{
        water:{chart:{bounds:[-4.04,-1.32,-.16,1.32],reach:.125},resolution:[168,106],
          ripple:{radius:.13,speed:1.25,width:.095,threshold:.13,duration:1.02,decay:.56,color:'#a9e5d6'}},
        stone:{particles:{count:22,speed:2.62,radius:.050,duration:.64,gravity:6.9,color:'#ffcb78'}}
      }},
      particleImpacts:{
        receivers:[
          {id:'basin',material:'water',y:0,bounds:[-4.04,-1.32,-.16,1.32]},
          {id:'paving',material:'stone',y:0,bounds:[.035,-1.32,4.14,1.32]}
        ],
        particles
      }
    }},
    solids:[...foundation,...details]
  };
};
