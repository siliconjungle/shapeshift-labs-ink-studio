/* Authored Gaussian geometry for two native-grid shots. */
const gaussianStudy = (() => {
  const bg = [8, 17, 28], colors = [0x08111c, 0x174259, 0x34758c, 0x89fcf0, 0xffbc76, 0xac96ff];
  const tau = Math.PI * 2;
  const rgb = color => (color >> 16) | (color & 0xff00) | ((color & 255) << 16);

  function shot(dist, fov, field) {
    const data = [];
    function ellipse([x,y,z], sigmas, color, alpha, axis = [1,0,0]) {
      const span = Math.hypot(...axis), [u,v,w] = axis.map(n => n/span);
      const [major,cross,depth] = sigmas.map(n => n*n);
      const a = major-cross;
      data.push(x,y,z,alpha,a*u*u+cross,a*u*v,a*u*w,rgb(color),a*v*v+cross,a*v*w,a*w*w+depth,0,0,0,0,0);
    }
    function line(n, point, width, color, alpha) {
      for (let i=0;i<=n;i++) ellipse(point(i/n),[width,width,0],color,alpha);
    }
    field(ellipse,line);
    return { count:data.length/16,data:Float32Array.from(data),gaussianCloud:true,seed:33,detail:14,radius:8,
      moving:new Int32Array(),back:new Int32Array(),bg:[...bg],pal:[...colors],dither:0,
      fog:{c:0,start:1,max:0},outline:{c:0,edge:0},cam:{target:[0,0,0],yaw:0,pitch:0,dist,fov,sway:0} };
  }

  function distant() {
    return shot(26,.55,(ellipse,line)=>{
      for(const z of [-.5,.05,.4]){
        for(let i=0;i<11;i++){
          const p=(i-5)*.126;
          line(350,t=>{
            const x=(t-.5)*12.4, phase=t*tau;
            const y=p + .85*Math.sin(phase+.55*z) + .28*Math.sin(3*phase+i*.19)*Math.sin(Math.PI*t);
            return [x,y,z+.3*Math.cos(phase+i*.19)];
          },.018+(i%3)*.0025,i<3?0xffba69:i<7?0x61ebed:0x739cf3,.53);
        }
      }
      for(const x of [-6.1,6.1]){
        for(const r of [.38,.76,1.11])line(130,t=>[x+r*Math.sin(t*tau),r*Math.cos(t*tau),.02],.025,0x75ccc8,.64);
        ellipse([x,0,0],[.14,.14,0],0xffcc86,.86);
      }
      for(const y of [-2.4,2.4]){
        line(200,t=>[(t-.5)*14,y,-.9],.032,0x34758c,.47);
        for(let n=0;n<=16;n++){
          const x=(n/16-.5)*14;
          line(7,t=>[x,y+(y<0?1:-1)*.22*t,-.88],.032,n%4?0x34758c:0x96deda,.54);
        }
      }
      for(let i=0;i<44;i++){
        const x=6.9*Math.sin(i*23.73), y=2.1*Math.sin(i*11.17);
        ellipse([x,y,-1.1],[.021,.021,0],i%5?0x55809e:0xffc87f,.68);
      }
    });
  }

  function close() {
    return shot(3.25,.72,(ellipse,line)=>{
      for(const radius of [.77,1.08,1.34]){
        line(140,t=>[radius*Math.sin(t*tau),radius*.67*Math.cos(t*tau),-.48],.012,0x5196b1,.57);
      }
      for(let i=0;i<25;i++){
        const a=i/25*tau, r=1.23;
        ellipse([r*Math.sin(a),r*.71*Math.cos(a),-.45],[.021,.019,0],i%5?0x377993:0xa6f4e9,.76);
      }
      for(let j=0;j<4;j++){
        const t=j/3;
        ellipse([.58+.31*t,.04+.40*t,-.03+.15*t],[.91-.17*t,.043+.008*t,0],
          [0x79fff0,0x8de7ff,0xd5a5ff,0xffbe85][j],.54,[.59,.29,-.76]);
        ellipse([-.63-.20*t,-.04-.34*t,-.05-.13*t],[.88-.13*t,.046+.008*t,0],
          [0xffb16f,0xf789a7,0xbb94ff,0x78b6f8][j],.54,[.57,.28,.76]);
      }
      ellipse([0,0,-.15],[.18,.18,0],0xc6fcff,.88);
      ellipse([0,0,-.13],[.058,.058,0],0xffffff,.95);
    });
  }
  return { distant, close };
})();
if (typeof module !== 'undefined') module.exports = gaussianStudy;
else globalThis[Symbol.for('ink-studio.gaussian-study')] = gaussianStudy;
