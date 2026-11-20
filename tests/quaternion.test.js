const test=require('node:test'),assert=require('node:assert/strict'),{KIT:K}=require('..').load(),Q=K.Q,M=K.M,V=K.V;
const near=(a,b,e=1e-7)=>assert(Math.abs(a-b)<=e,`${a} != ${b}`),vec=(a,b,e=1e-7)=>a.forEach((v,i)=>near(v,b[i],e));
test('quaternion matrices, composition and vector rotation match existing matrix conventions',()=>{
 for(let i=0;i<40;i++){const axis=V.norm([Math.cos(i),Math.sin(i*.7),Math.cos(i*.3)]),angle=i*.27,q=Q.fromAxisAngle(axis,angle),matrix=M.rot(axis,angle);vec(Q.toMatrix(q),matrix);near(Q.angle(q,Q.fromMatrix(matrix)),0,5e-8);vec(Q.rotate(q,[1,2,3]),M.app(matrix,[1,2,3]));vec(Q.toMatrix(Q.mul(q,Q.inverse(q))),M.id());}
 const a=Q.fromAxisAngle([1,0,0],.7),b=Q.fromAxisAngle([0,1,0],.8);vec(Q.toMatrix(Q.mul(a,b)),M.mul(Q.toMatrix(a),Q.toMatrix(b)));vec(Q.rotate(Q.fromAxisAngle([1e-10,0,0],Math.PI/2),[0,1,0]),[0,0,1]);
});
test('SLERP handles antipodes, tiny angles, 180 degrees and the shortest rotation seam',()=>{
 const a=Q.fromAxisAngle([0,1,0],170*Math.PI/180),b=Q.fromAxisAngle([0,1,0],-170*Math.PI/180),mid=Q.slerp(a,b,.5);vec(Q.rotate(mid,[0,0,1]),[0,0,-1]);
 const q=Q.fromAxisAngle([1,2,3],1);for(const t of [0,.2,.5,1]){near(Q.angle(Q.slerp(q,q.map(v=>-v),t),q),0,5e-8);near(Math.hypot(...Q.nlerp(Q.id(),q,t)),1);}
 const end=Q.fromAxisAngle([0,0,1],Math.PI);for(let i=0;i<=10;i++)near(Q.angle(Q.id(),Q.slerp(Q.id(),end,i/10)),Math.PI*i/10);vec(Q.slerp(Q.id(),end,-1),Q.id());vec(Q.slerp(Q.id(),end,2),end);assert(Q.slerp(Q.id(),Q.fromAxisAngle([1,0,0],1e-9),.5).every(Number.isFinite));
});
test('SQUAD rotation splines preserve keys and angular velocity at interior and periodic seams',()=>{
 const keys=[0,.5,1.4,2].map(a=>Q.fromAxisAngle([0,1,0],a)),spline=Q.spline(keys),h=1e-5;for(let i=0;i<keys.length;i++)near(Q.angle(spline.sample(i/3),keys[i]),0,5e-8);
 const angle=u=>2*Math.atan2(spline.sample(u)[1],spline.sample(u)[3]);for(const u of [1/3,2/3])near((angle(u)-angle(u-h))/h,(angle(u+h)-angle(u))/h,.001);
 const ring=Q.spline([0,Math.PI/2,Math.PI,3*Math.PI/2].map(a=>Q.fromAxisAngle([0,1,0],a)),{closed:true});near(Q.angle(ring.sample(0),ring.sample(1)),0);near(Q.angle(ring.sample(-.01),ring.sample(.99)),0,5e-8);near(Q.angle(ring.sample(0),ring.sample(h))/h,Q.angle(ring.sample(-h),ring.sample(0))/h,.001);vec(ring.matrix(.2),Q.toMatrix(ring.sample(.2)));const snap=ring.snapshot();vec(Q.spline(snap.rotations,snap.options).matrix(.4),ring.matrix(.4));
});
test('quaternion channels share the existing seconds-based keyframe tracks',()=>{
 const q=Q.fromAxisAngle([0,0,1],Math.PI),track=K.anim.keyframeTrack.create({turn:'quaternion'},[{time:0,value:{turn:Q.id()},ease:'linear'},{time:2,value:{turn:q}}]);near(Q.angle(track.sample(1).turn,Q.id()),Math.PI/2);near(Math.hypot(...track.sample(.5).turn),1);vec(Q.rotate(track.sample(1).turn,[1,0,0]),[0,1,0]);
 assert.throws(()=>K.anim.keyframeTrack.create({q:'quaternion'},[{time:0,value:{q:[0,0,0,0]}}]));
});
test('invalid rotations and spline budgets fail explicitly',()=>{
 for(const q of [[0,0,0,0],[NaN,0,0,1],[0,1],Array(4)])assert.throws(()=>Q.normalize(q));assert.throws(()=>Q.fromMatrix([1,0,0,0,2,0,0,0,1]));assert.throws(()=>Q.fromAxisAngle([0,0,0],1));assert.throws(()=>Q.slerp(Q.id(),Q.id(),NaN));assert.throws(()=>Q.spline([Q.id()]));assert.throws(()=>Q.spline([Q.id(),Q.id()],{closed:true}));
});

test('SQUAD joins preserve vector angular velocity through changing rotation axes',()=>{
 const keys=[[[1,0,0],.2],[[0,1,0],1.1],[[1,1,0],1.5],[[0,0,1],.8]].map(([axis,a])=>Q.fromAxisAngle(axis,a)),spline=Q.spline(keys),h=1e-5;
 const velocity=(a,b)=>{const q=Q.mul(Q.inverse(a),b),w=q[3]<0?-1:1;return q.slice(0,3).map(v=>2*v*w/h);};for(const u of [1/3,2/3])vec(velocity(spline.sample(u-h),spline.sample(u)),velocity(spline.sample(u),spline.sample(u+h)),.002);
});

test('overflowing axis norms fail instead of producing nonunit rotations',()=>{assert.throws(()=>Q.fromAxisAngle([Number.MAX_VALUE,Number.MAX_VALUE,0],1));});
