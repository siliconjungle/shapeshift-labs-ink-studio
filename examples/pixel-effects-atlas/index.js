const design = require('./design');
const landscapes = require('./landscapes');
const effects = require('./effects');
const objects = require('./objects');

module.exports = function atlas(kit) {
  const D = design(kit), L = landscapes(D), E = effects(D), O = objects(D);
  const artSize={
    quill:[120,90], lotuses:[144,108], sluice:[128,96], underwater:[128,96], material:[144,108],
    lava:[128,96], thrust:[120,90], accretion:[144,108], spark:[144,108], tornado:[128,96],
    barrel:[128,96], plasma:[128,96], healing:[128,96], bamboo:[144,108], planet:[136,102]
  };
  return [
    ['quill','Ember Quill','A bending feather sheds sparks in a rising column of hot air.',E.quill,2.9,'2124299350847127697'],
    ['lotuses','Quiet Lattice','Golden-angle petal clusters drift on a dark pond.',L.lotuses,4.6,'2123574760038674682'],
    ['sluice','The Sluice','Wet masonry, falling droplets and flashes on the waterline.',L.sewer,3.5,'2115239816858136914'],
    ['underwater','Below the Glass','A school of fish crosses animated caustics and a layered reef.',L.underwater,6.1,'2113427746294501766'],
    ['material','Soft Type','Elastic and liquid glyphs drop on a shared material-point grid.',L.material,2.65,'2106542346875584592',false],
    ['lava','Fault Heat','A wave of heat lights the actual boundaries between fractured plates.',E.lava,3.8,'2105092801297842180'],
    ['thrust','Rose Engine','A narrow bright exhaust and a broader plume with pressure diamonds.',E.thrust,2.3,'2104730473058480142'],
    ['accretion','Periapsis','A rotating accretion band with stylized arcs around a black silhouette.',O.blackHole,4.5,'2103643286288166921'],
    ['spark','Signal Shatter','A moving discharge leaves a chromatic tail and a spray of fragments.',E.spark,2.8,'2102918511773323608'],
    ['tornado','Updraft','Layered, depth-ordered ribbons wrap an unsteady vortex.',E.tornado,3.3,'2101831310478020776'],
    ['barrel','Copper Cooper','A fully rotating signed-field barrel with beveled hoops and engraved staves.',O.barrel,4.3,'2097482661455384834'],
    ['plasma','Storm Glass','Articulated filaments reconnect across a softly lit globe.',E.plasma,3.4,'2095670712530854308'],
    ['healing','The Green Return','A glowing floor sigil sends narrow columns and motes upward.',E.healing,3.8,'2084436719517012186'],
    ['bamboo','Wind Between Stems','Bamboo stalks bend at staggered phases, with leaves driven by the same wind.',L.bamboo,4.9,'2081175189996331096'],
    ['planet','The Pelagic Globe','A lit sphere with continuous terrain, a separately rotating cloud shell and an atmospheric edge.',O.planet,5.8,'planet']
  ].map(([id,name,description,render,duration,reference,loop=true])=>({
    id,name,description,duration,loop,render(phase){
      const [width,height]=artSize[id], u=loop?((phase%1)+1)%1:Math.max(0,Math.min(1,phase));
      return D.raster.resize(render(u),{width,height,filter:'nearest'});
    }, reference:reference==='planet'
      ?'https://pixel-composer.com/projects/Planet/'
      :'https://x.com/MakhamDev/status/'+reference
  }));
};
