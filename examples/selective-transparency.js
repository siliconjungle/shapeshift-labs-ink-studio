/* Prism Lock uses opaque station trim, two crossing filters and a crowded stack. */
module.exports = ({ KIT:K, makeBuilder, SpriteSurface }) => ({
  id:'prism-lock', name:'Prism Lock', seed:34,
  build(seed) {
    const palette=[
      0x0b1522,0x142630,0x203a49,0x30505a,0x597678,0x85a3a0,
      0xf7a65b,0x7deef2,0xc08cf7,0x83a9f9,0xf6dfab,0x172b39,0x23313f
    ];
    const B=makeBuilder(seed,palette);
    const atlas=SpriteSurface.make(), normal=(x,y=0)=>K.V.norm([x,y,1]);
    function face(x,y,z,w,h,width,height,shade) {
      atlas.face([x,y,z],[w,0,0],[0,h,0],width,height,(u,v)=>palette[shade(u,v)]);
    }
    function pixelTrim(x,y,w,h) {
      if((x===2||x===w-3)&&(y===2||y===h-3))return 5;
      if(!x||!y||x===w-1||y===h-1)return y===h-1?3:2;
      if((x+2*y)%17<2)return 2;
      return 1;
    }
    for (const center of [-1.5,1.5]) {
      face(center-1.29,-1.18,-1.7,2.58,2.46,65,62,(x,y)=>{
        if(x<2||x>62||y<2||y>59)return x<2||y>59?3:12;
        if(x%10===0||y%10===0)return 2;
        return 11;
      });
      face(center-1.29,-1.20,1.2,2.58,.32,65,8,(x,y)=>{
        if(y>5)return 4;
        if(y<1)return 2;
        return x%10===3&&y>2?5:3;
      });
      face(center-1.30,1.03,1.25,2.62,.22,67,6,(x,y)=>pixelTrim(x,y,67,6));
      for(const side of [-1,1]){
        face(center+side*1.21-.07,-1.2,1.24,.14,2.45,4,61,(x,y)=>x===3||y%14===7?4:3);
        face(center+side*1.05-.045,-1.08,1.38,.09,.085,3,3,()=>10);
      }
      face(center-.31,-1.37,1.05,.62,.12,16,3,(x,y)=>x%4===1&&y===1?5:2);
    }
    // The nearer baffle hides the lower part of both crossing filters.
    face(-2.42,-.67,1.02,1.84,.19,46,5,(x,y)=>y===4?5:x%11===5?4:3);
    B.disc(-1.76,.10,.08,normal(1.15,.1),1.02,.025,B.P[6],.91);
    B.disc(-1.23,.10,0,normal(-1.0,-.1),1.02,.025,B.P[7],.91);
    B.disc(1.27,.14,.08,normal(1.1,.06),.91,.025,B.P[6],.82);
    B.disc(1.61,.12,0,normal(-.82,-.1),.91,.025,B.P[7],.82);
    B.disc(1.57,.31,-.18,normal(-.08,-.24),.74,.017,B.P[8],.65);
    return B.finish({spriteSurfaces:atlas.finish(),radius:8,cam:{target:[0,-.06,0],yaw:.012,pitch:0,
      dist:7.2,fov:.57,ortho:true},outline:{c:0,edge:0},fog:{c:0,start:1,max:0},dither:0});
  }
});
