// Reproducible scene for the hybrid-depth-review command.
module.exports = function mirrorStation({ KIT, makeBuilder }, variant = 'combined') {
  const mesh = KIT.sceneMeshes;
  const colors = [0x122032, 0x24394c, 0x355468, 0x628c9a, 0x9ce0d5, 0xffdc94,
    0xf48c56, 0xbd5365, 0x533c68, 0x88d99a, 0x37a6a0, 0xeccbdf];
  const positions = (x0, y0, x1, y1, z) => [x0,y1,z, x1,y1,z, x0,y0,z, x1,y0,z];
  const indices = [0,1,2,2,1,3];
  function panels(id, faces) {
    const points = [], uvs = [], triangles = [], faceMaterials = [];
    for (const [quad, color] of faces) {
      const index = points.length / 3;
      points.push(...quad);
      uvs.push(0,0,1,0,0,1,1,1);
      triangles.push(...indices.map(i => i + index));
      faceMaterials.push(color, color);
    }
    return mesh.create({ id, positions: points, uvs, indices: triangles, faceMaterials,
      materials: colors.map((color, i) => ({ id: 'station-' + i, color })) });
  }
  function facade(id, x, y, z, floor) {
    const faces = [];
    const rect = (x0,y0,x1,y1,depth,ink) => faces.push([positions(x+x0,y+y0,x+x1,y+y1,z+depth),ink]);
    for (const side of [-1, 1]) {
      const column = side * 1.43;
      rect(column-.19,-1.18,column+.19,1.17,0,2);
      rect(column-.13,-1.18,column+.13,1.17,.02,1);
      rect(column-.045,-.93,column+.045,.93,.035,3);
      for (const level of [-.88, -.43, .02, .47, .92])
        rect(column-.15,level,column+.15,level+.055,.045,4);
    }
    rect(-1.63,1.02,1.63,1.26,0,2);
    rect(-1.46,1.07,1.46,1.18,.03,3);
    rect(-1.57,-1.18,1.57,-1.02,0,2);
    rect(-.23,1.12,.23,1.29,.05,6);
    for (let i = -3; i <= 3; i++)
      rect(i*.33-.09,1.09,i*.33+.09,1.15,.055,5);
    if (floor) faces.push([[-3,.01,.7, 3,.01,.7, -3,.01,-1.2, 3,.01,-1.2],1]);
    return panels(id, faces);
  }

  const scene = makeBuilder(7, colors);
  const glassFlags = { gl: true, nd: true };
  if (variant !== 'no-effects') {
    for (let i = 0; i < 29; i++) {
      const x = -.93 + i * .072, y = 1.35 + Math.sin(i*.18)*.24 - i*.012;
      scene.disc(x,y,.68-i*.032,[0,0,1],.105,.017,scene.P[5],.36,{ nd:true, em:true });
      scene.disc(x+.06,y-.16,.86-i*.056,[0,0,1],.13,.016,scene.P[7],.22,{ nd:true });
    }
  }
  if (variant !== 'no-glass') {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 7; x++) {
      scene.disc(.52+x*.135,.82+y*.155,.18+x*.034,[0,0,1],.087,.012,
        scene.P[x===y ? 4 : 10],.18,glassFlags);
    }
  }
  // The red source splat is wholly behind its invisible proxy. The gold
  // rim is in front and therefore remains visible with the proxy enabled.
  scene.disc(-1.98,1.23,-.57,[0,0,1],.36,.018,scene.P[6],1,{ rg:0 });
  scene.disc(-2.18,1.27,-.08,[0,0,1],.145,.012,scene.P[5],1,{ rg:0 });
  const shutter = mesh.depthProxy({ id: 'source-shutter',
    positions: positions(-2.66,.55,-1.33,1.91,-.31), indices });
  const flooded = KIT.procedural.waterBodies;
  const pool = flooded.create({ id:'station-pool', bounds:{ min:[-4,-4],max:[4,4.2] },
    resolution:[16,16], sample:()=>({ bed:-.72, surface:0 }),
    optics:{ tint:[.08,.2,.26], extinction:[.4,.24,.18], surfaceColor:[.91,.98,1], surface:1,
      refraction:0, foam:0, caustics:0, reflection:{ plane:'station-mirror', distortion:0 } } });
  const fog = KIT.atmosphere.box;
  // A layer in front of the doorway provides a separate aperture-fog control.
  const sourceMist = fog({ min:[-2.9,.10,-.25], max:[2.8,1.21,1.9], density:.34, color:'#6498ad' });
  const strip = panels('plaza-tiles', Array.from({length:24}, (_,i) => {
    const x = (i % 12)*.62 - 3.72, z = i<12 ? -1.28 : -.98;
    return [[x,.015,z, x+.59,.015,z, x,.015,z+.25, x+.59,.015,z+.25], i%3 ? 2 : 3];
  }));
  const look = { coverageAware:true, splatCoverage:'continuous', pixelSize:1 };
  const world = scene.finish({ meshes:[facade('source-frame',0,1.38,-.37,true),strip],
    radius:5, cam:{ target:[0,.98,-.28], dist:8.2, pitch:.25, yaw:0, fov:.74 },
    refract:6, look, atmosphere:[sourceMist], water:flooded.scene([pool]),
    reflections:[KIT.reflection.plane({ id:'station-mirror' })],
    splatDepthProxies:variant === 'no-proxy' ? false : { meshes:[shutter], tolerance:.02 } });

  const remote = makeBuilder(8, [0x203244,...colors.slice(1)]);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    if (variant === 'no-glass') continue;
    remote.disc(-.65+x*.126,.78+y*.148,-.81-x*.022,[0,0,1],.091,.01,
      remote.P[x+y===6 ? 11 : 8],.19,glassFlags);
  }
  for (let i = 0; i < 14; i++) {
    if (variant === 'no-effects') continue;
    remote.disc(.20+i*.043,.95+Math.sin(i*.25)*.19,-1.12+i*.014,[0,0,1],.10,.015,
      remote.P[4],.27,{ nd:true, em:true });
  }
  remote.disc(.57,1.72,-1.67,[0,0,1],.36,.025,remote.P[6],1,{ rg:0 });
  const rearShutter = mesh.depthProxy({ id:'remote-shutter',
    positions:positions(-.19,1.00,1.23,2.47,-1.21), indices });
  const terminal = panels('remote-terminal', [
    [positions(-1.2,.22,1.2,2.5,-2.7),8],
    [positions(-.77,.54,.78,2.17,-2.5),1],
    [positions(-.66,.64,.67,2.06,-2.45),2],
    ...Array.from({length:11}, (_,i) => {
      const x = -.54 + i*.102, h = .16 + ((i*13)%8)*.12;
      return [positions(x,.79,x+.051,.79+h,-2.40), i%3 ? 9 : 5];
    }),
    [positions(-.49,1.89,.51,1.94,-2.39),4]
  ]);
  const destination = remote.finish({ radius:5, refract:6, look,
    meshes:[terminal,facade('remote-frame',0,1.38,-1.8,false)],
    atmosphere:[fog({ min:[-1.4,.16,-2.4],max:[1.4,1.30,-.42],density:.32,color:'#967eac' })],
    splatDepthProxies:variant === 'no-proxy' ? false : { meshes:[rearShutter], tolerance:.02 } });
  const opening = KIT.world.portals.doorway({
    from:{ origin:[0,1.38,-.30],normal:[0,0,1] },
    to:{ origin:[0,1.38,-.30],normal:[0,0,-1] },
    halfWidth:1.24, halfHeight:1.01
  });
  const portal = { source:world, opening, destination };
  const view = { width:168, height:112, scale:1, dither:0, edges:false, outline:false, damp:false,
    time:0, reflections:variant !== 'no-reflection', atmosphere:variant !== 'no-fog',
    reflectionScale:1 };
  return { world, portal, view };
};
