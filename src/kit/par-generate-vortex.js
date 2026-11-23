/* Art-grid vortex contours with independent front and back layers. */
(function (K) {
  const P=K.procedural;
  const {dimensions,integer,range,vector,clock,wrap,unit,color,draw,alpha}=P.generatorSupport;
  const tau=Math.PI*2;

  function vortex({base,tip,radii=[7,16,33,58],layers=26,segments=18,tilt=.18,twist=.52,lean=15,
    breakup=.23,thickness=4,turns=2,period=2,time=0,seed=0,
    palette=['#572842','#99404b','#de6a51','#ffad68','#ffe4ac'], ...options}={}) {
    const size=dimensions(options),{width,height}=size;
    base??=[width*.5,height*.87]; tip??=[width*.5,height*.15];
    clock(time,seed);
    if(!vector(base,2)||!vector(tip,2)||!Array.isArray(radii)||!integer(radii.length,2,32)||
        !radii.every(r=>range(r,.5,1024))||!integer(layers,2,64)||!integer(segments,4,32)||
        !range(tilt,-1,1)||!range(twist,-8,8)||!range(lean,-1024,1024)||!range(breakup,0,1)||
        !range(thickness,.25,24)||!integer(turns,-16,16)||!range(period,.02,120)||
        !Array.isArray(palette)||!integer(palette.length,2,32))
      throw new RangeError('Invalid vortex profile, geometry, motion or palette');
    palette.forEach(color);
    const dx=tip[0]-base[0],dy=tip[1]-base[1],length=Math.hypot(dx,dy);
    if(!range(length,.001,2048))throw new RangeError('Vortex needs distinct bounded endpoints');
    const sideways=[-dy/length,dx/length], phase=wrap(time,period)/period*tau;
    const random=K.grow.dice(P.data.hash('vortex contours',seed)), front=[],back=[],paths=[];
    for(let row=0;row<layers;row++){
      const h=row/(layers-1),f=h*(radii.length-1),station=Math.min(radii.length-2,Math.floor(f));
      const radius=K.mix(radii[station],radii[station+1],f-station);
      const bent=lean*Math.sin(phase-h*3.7)*h*h;
      const x=K.mix(base[0],tip[0],h)+sideways[0]*bent,y=K.mix(base[1],tip[1],h)+sideways[1]*bent;
      for(let col=0;col<segments;col++){
        const slot=col/segments*tau, skip=random()<breakup, variation=random(), dangle=.76+.32*random();
        const a=phase*turns+row*twist+slot;
        if(skip)continue;
        const z=Math.sin(a),dst=z<0?back:front;
        const points=Array.from({length:7},(_,j)=>{
          const angle=a+dangle*j/6*tau/segments;
          const q=Math.cos(angle)*radius, depth=Math.sin(angle)*radius*tilt;
          const wobble=Math.sin(angle*3+h*15-phase)*thickness*.43;
          return [x+sideways[0]*q+dx/length*(depth+wobble),y+sideways[1]*q+dy/length*(depth+wobble)];
        });
        const shine=unit(.21+.58*variation+.21*z);
        const ink=palette[Math.min(palette.length-1,Math.floor(shine*palette.length))];
        const weight=thickness*(.58+.65*unit(z)+.18*variation);
        const command={type:'ribbon',points,width:points.map((_,j)=>weight*(.35+.65*Math.sin(Math.PI*(j+1)/8))),
          fill:alpha(ink,z<0?.78:1)};
        dst.push(command);
        paths.push({id:row+'/'+col,points,depth:z,heat:shine});
      }
    }
    const far=draw(size,back),near=draw(size,front);
    return {value:P.raster.stack({...size,layers:[{source:far},{source:near}]}).value,back:far,front:near,paths};
  }
  P.generator.vortex=vortex;
})(KIT);
