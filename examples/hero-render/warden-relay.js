const warden = require('../view-poses/breakwater-warden.js');

module.exports = kit => {
  const original=warden(kit);
  return {
    id:'warden-relay',name:'Warden at the Signal Relay',seed:original.seed,
    build(seed) {
      const world=original.build(seed,{controls:{relayShot:true}});
      return world;
    }
  };
};
