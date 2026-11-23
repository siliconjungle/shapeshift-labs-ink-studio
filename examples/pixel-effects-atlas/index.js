const design = require('./design');
const forms = require('./forms');
const habitats = require('./habitats');
const luminous = require('./luminous');
const thermal = require('./thermal');

module.exports = function atlas(kit) {
  const art = design(kit, {width:96,height:96});
  const T = thermal(art), E = luminous(art), F = forms(art), H = habitats(art);
  const flowers = habitats(design(kit, {width:192,height:192}));
  return [
    ['quill','Ember Quill','A copper feather draws itself into view, catches fire and sheds embers into its wake.',T.quill,2.05,.45,'2124299350847127697'],
    ['lotuses','Quiet Lattice','Petals unfold in traveling wakes across the pond, with staggered leaves and separate painted folds.',flowers.lotuses,3.2,.54,'2123574760038674682'],
    ['sluice','The Sluice','Rain falls through a recessed grate, hangs on moss and catches light on the waterline.',H.sewer,2.75,.29,'2115239816858136914'],
    ['underwater','Below the Glass','Large blue caustic shapes drift over a dark reef through the bright rim of a porthole.',H.underwater,2.9,.40,'2113427746294501766'],
    ['material','Soft Type','Elastic and fluid letters collide, then the same material-point solver sends four colored streams into the basin.',F.material,3.75,.08,'2106542346875584592',false],
    ['lava','Fault Heat','A rupture flashes at the center and opens molten seams between islands of crust.',T.lava,2.15,.50,'2105092801297842180'],
    ['thrust','Rose Engine','Hollow pressure fronts roll out of a recessed nozzle before the exhaust flashes white.',T.thrust,1.65,.49,'2104730473058480142'],
    ['accretion','Periapsis','The near side of the disk crosses the black silhouette as light from the far side bends over it.',F.accretion,1.8,.31,'2103643286288166921'],
    ['spark','Signal Shatter','A hooked tracer snaps into a white impact that twists the plate and splits into colored fragments.',E.spark,1.9,.68,'2102918511773323608'],
    ['tornado','Updraft','Front and back sheets of fire curl around an open, moving vortex.',E.tornado,1.35,.42,'2101831310478020776'],
    ['barrel','Copper Cooper','Light slides across beveled iron hoops, rivets and rotating end grain on a signed-field barrel.',F.barrel,3.2,.25,'2097482661455384834'],
    ['plasma','Storm Glass','Bright filaments reconnect across ruby glass and leave blue reflections where they approach the rim.',E.plasma,2,.24,'2095670712530854308'],
    ['healing','The Green Return','A ring rises out of a pool of light, projects an extruded sigil and collapses into afterglow.',E.healing,1.9,.68,'2084436719517012186'],
    ['bamboo','Wind Between Stems','Wind bends the stalks and carries every branch, collar and individual leaf with them.',H.bamboo,3,.29,'2081175189996331096'],
    ['planet','The Pelagic Globe','The sphere turns below white cloud belts with a separate rotation and a pale atmospheric rim.',F.planet,2.85,.32,'planet']
  ].map(([id,name,description,render,duration,posterPhase,reference,loop=true])=>({
    id,name,description,duration,loop,posterPhase,
    render(phase){
      const u=loop?((phase%1)+1)%1:Math.max(0,Math.min(1,phase));
      return render(u);
    },
    reference:reference==='planet'
      ?'https://pixel-composer.com/projects/Planet/'
      :'https://x.com/MakhamDev/status/'+reference
  }));
};
