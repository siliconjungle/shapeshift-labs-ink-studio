/* Move a normal-mapped sluice screen across the existing traced gatehouse. */
const gatehouse=require('./sdf-gatehouse.js');

module.exports=ink=>{
  const base=gatehouse(ink), {KIT:K,SpriteSurface}=ink;
  return {
    ...base,id:'opaque-surface-gate',name:'The tidal gate',build(seed, options) {
      const world=base.build(seed, options), atlas=SpriteSurface.make(64);
      const rest=[-.53,1.60,.96, .53,1.60,.96, -.53,.47,.96, .53,.47,.96];
      const left=.42, mesh={points:rest.map((n,i)=>i%3===0?n+left:n),restPoints:rest,
        uvs:[0,0,1,0,0,1,1,1],triangles:[0,1,2,2,1,3]};
      const region=atlas.reserve(48,48,(u,v)=>{
        const border=u<3||u>=45||v<3||v>=45, rib=u%8<2||v%8<2;
        if (!border&&!rib&&v<32) return;
        if (border) return u===1||v===1 ? 0xf6c580 : 0xa95f45;
        if (v<32) return (u+v)%8<3 ? 0xe39055 : 0xa75a40;
        const stripe=(u+v*2)%20;
        return stripe<5 ? 0xe9b474 : stripe<8 ? 0xb07656 : 0x452f39;
      },{normal(u,v){
        return v>=32 ? [(u+v*2)%20<8?.61:-.25,v%4<2?.18:-.18,1] : [u%8===0?-.45:.46,.1,1];
      }});
      atlas.meshRegion(mesh,region,{id:'sluice-screen',objectId:'sluice-screen',materialId:'brushed-copper'});
      const screen=atlas.finish(), saved=screen.vertices.slice();
      world.spriteSurfaces=screen;
      const stage=K.stage(world);
      stage.add({pre(_dt,t) {
        const phase=.9*t, slide=Math.sin(phase)*.81, tilt=.18*Math.sin(phase);
        for(let i=0;i<saved.length;i+=5){
          const x=saved[i]-left;
          screen.vertices[i]=left+x*Math.cos(tilt)+slide;
          screen.vertices[i+2]=saved[i+2]+x*Math.sin(tilt);
        }
        SpriteSurface.markGeometryDirty(screen);
        world.cam.yaw=.23+.115*Math.sin(t*.57);
      }});
      return world;
    }
  };
};
