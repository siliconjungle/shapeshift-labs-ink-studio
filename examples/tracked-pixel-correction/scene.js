// A signal capsule passes behind a maintenance shutter.
module.exports = ({ KIT:K, makeBuilder, SpriteSurface }) => ({
  id:'signal-capsule', name:'Signal capsule', seed:19,
  build(seed) {
    const palette = [0x131c23,0x21313a,0x435951,0x293e3d,0x547d70,0x82ad96,0xc3d5a5,
      0x56373d,0x8f5350,0xca7d60,0xf3a976,0xfed69a,0x393f4d,0x677181,0xaab5ae];
    const B = makeBuilder(seed,palette), atlas = SpriteSurface.make(192);
    function plate(id,x,y,z,width,height,w,h,paint) {
      const points = [x,y+height,z, x+width,y+height,z, x,y,z, x+width,y,z];
      atlas.meshRegion({ points,restPoints:points,uvs:[0,0,1,0,0,1,1,1],triangles:[0,1,2,2,1,3] },
        atlas.reserve(w,h,paint),{ id,objectId:id });
    }
    plate('relay',-2.15,-.73,.24,1.97,1.61,44,36,(x,y) => {
      const edge = Math.min(x,43-x), rise = Math.min(y,35-y);
      if (edge+rise < 8 || y < 4 && (x < 13 || x > 30) || y > 31 && (x < 10 || x > 33)) return null;
      if (y === 20 && (x === 26 || x === 27)) return null;
      if (rise < 2 || edge < 2 || edge+rise === 8) return palette[7];
      if (y < 6) return palette[x % 7 < 4 ? 11 : 9];
      if (y >= 30) return palette[x % 5 < 2 ? 9 : 7];
      if (edge < 5 || y < 9 || y > 27) return palette[edge === 3 || y === 8 ? 10 : 8];
      if (y === 9 || y === 27 || edge === 5) return palette[2];
      if (x > 8 && x < 35 && (y === 12 || y === 25)) return palette[4];
      if (y === 20 && x > 11 && x < 32) return palette[5];
      if (y === 19 && x > 15 && x < 28) return palette[6];
      if (y === 22 && x > 15 && x < 28) return palette[4];
      if (y > 14 && y < 24 && (x === 9 || x === 34)) return palette[10];
      return palette[(x % 5 === 0 || y % 4 === 0) ? 2 : 3];
    });
    plate('shutter',.02,-1.23,.85,1.14,2.64,25,58,(x,y) => {
      if ((x === 0 || x === 24) && (y < 3 || y >= 55)) return null;
      if (x < 2 || x > 22 || y < 3 || y > 54) return palette[12];
      if (x === 2 || x === 22 || y === 3 || y === 54) return palette[14];
      if ((y < 11 || y > 45) && (x + y) % 8 < 4) return palette[9];
      if (y === 27 || y === 28) return palette[8];
      if (y === 29 || y === 30) return palette[10];
      return palette[x % 5 === 0 || y % 9 === 0 ? 13 : 12];
    });
    plate('gantry',-3.8,-1.42,-.6,7.6,.22,160,5,(x,y) =>
      palette[y === 0 ? (x % 11 < 3 ? 9 : 4) : (x % 13 === 0 ? 5 : 2)]);
    const surface = atlas.finish(), rest = surface.vertices.slice();
    const dist = 7, fov = 38*Math.PI/180;
    const unit = dist*Math.tan(fov/2)/32;
    const world = B.finish({ cam:{target:[0,0,0],dist,yaw:0,pitch:0,sway:0,ortho:true,fov},
      look:{pixelSize:1},dither:0 });
    world.spriteSurfaces = surface;
    K.stage(world).add({ pre(_dt,t) {
      const x = t <= 1 ? 12*t : t <= 2 ? 12+13*(t-1) : t <= 3 ? 25+23*(t-2) : 48+120*(t-3);
      const y = t > 2 && t <= 3 ? 3*(t-2) : 0;
      for (let i = 0; i < 6*5; i += 5) {
        surface.vertices[i] = rest[i]+x*unit;
        surface.vertices[i+1] = rest[i+1]+y*unit;
      }
      SpriteSurface.markGeometryDirty(surface);
    } });
    return world;
  }
});
