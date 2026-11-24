function rebirthGallery(kit) {
  const entry = (file, make, from, view = {}) => ({ file, scene: make(kit), from, view });
  const commonJS = typeof module !== 'undefined';
  return [
    entry('hush-wood', commonJS ? require('./hush-wood.js') : rebirthGrove, 1.5),
    entry('afterimage-harbor', commonJS ? require('./afterimage-harbor.js') : rebirthAfterimageHarbor, 6.4),
    entry('burning-sand', commonJS ? require('./burning-sand.js') : rebirthBurningSand, 1.2,
      { target: [3, 5, 1], yaw: -.22, pitch: .16, zoom: .65 }),
    entry('frozen-angel', commonJS ? require('./frozen-angel.js') : rebirthAngel, .4,
      { target: [0, 15, -14], yaw: .15, pitch: .11, zoom: .52 }),
    entry('garden', commonJS ? require('./garden.js') : rebirthGarden, 2.7),
    entry('last-transmission', commonJS ? require('./last-transmission.js') : rebirthTransmission, 4.5)
  ];
}

if (typeof module !== 'undefined') module.exports = rebirthGallery;
