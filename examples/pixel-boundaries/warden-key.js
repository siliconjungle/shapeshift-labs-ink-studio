const warden = require('../view-poses/breakwater-warden.js');

module.exports = kit => ({
  id:'warden-key',name:'Warden Under the Moving Key',seed:63,
  build(seed) {
    const world=warden(kit).build(seed,{controls:{relayShot:true,boundaryShot:true}});
    world.cam={...world.cam,dist:3.85,target:[0,1.08,.04],yaw:-.42};
    world.liveSun={...world.liveSun,ambient:.40,intensity:.79,direction:t=>kit.KIT.V.norm([
      -.81+.54*t,.54,.40+.11*t
    ])};
    return world;
  }
});
