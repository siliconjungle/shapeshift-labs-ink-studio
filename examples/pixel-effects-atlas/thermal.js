/* Indexed flame studies. Emission evolves in plume space before rasterization. */
module.exports = function thermal(D) {
  const {generator, size, width, tau, clamp, mix, smooth, wrap, hash, noise,
    texture, band, pixel, draw, layer, line} = D;

  const lilac = [0x141022, 0x1d172b, 0x292038, 0x342945, 0x433353];
  const fire = [0x45243e, 0x752c3e, 0xa6393b, 0xd65232, 0xf2793f, 0xffa74e, 0xffd882, 0xfff3b4, 0xfffbe6];

  function quill(u) {
    const phase = u * tau;
    const appear = smooth(.07, .22, u) * (1 - smooth(.935, 1, u));
    const ignite = smooth(.25, .31, u) * (1 - smooth(.84, .985, u));
    const flash = smooth(.252, .306, u) * (1 - smooth(.32, .43, u));
    const tilt = .79 + .052 * Math.sin(phase);
    const cs = Math.cos(tilt), sn = Math.sin(tilt);
    const baseX = 23 + 2 * Math.sin(phase - 1), baseY = 83;
    const axis = p => 3.8 * Math.sin(Math.PI * p) - 4 * p;
    const span = 65;
    // Backward sampling follows a feather streamline and keeps the repeating ribs attached.
    function vane(p, across) {
      const side = across < 0 ? -1 : 1, q = clamp(p);
      const fullness = Math.sin(q * Math.PI) ** .72;
      const barb = wrap(q * 14 + Math.abs(across) * (.10 + .072 * q), 1);
      const teeth = smooth(.04, .28, barb) * smooth(.94, .60, barb);
      const edge = (.62 + (side < 0 ? 12.1 : 11.6) * fullness) * (1 - .23 * teeth * fullness);
      return {side, barb, edge, fullness};
    }
    const plate = pixel((x, y) => {
      const dx = x - 48, dy = y - 49;
      const border = Math.max(Math.abs(dx), Math.abs(dy)) + Math.min(Math.abs(dx), Math.abs(dy)) * .23;
      const stripe = wrap(x - y * .90 + 11, 29);
      return band(lilac, .31 + .36 * smooth(55, 29, border) + (stripe > 14 ? .15 : 0));
    });
    const heat = pixel((x, y) => {
      if (ignite < .01) return;
      // Parcels rise from different heights along the feather. The low-frequency
      // wake bends whole tongues while the rolled high-frequency layer cuts holes.
      const age = (73 - y) / 75;
      const advect = age * 4.35 - u * 8;
      const braid = .78 * Math.sin(advect * 2.9 + .65 * Math.sin(y * .13)) + .47 * Math.sin(advect * 6.1);
      const rose = smooth(83, 17, y);
      const center = 24 + (83 - y) * .84 - Math.max(0,34-y)*.78 + braid * (1.4 + 7.2 * rose);
      const wid = (8 + 22 * rose + flash * 12) * (ignite ** .62);
      const px = (x - center) / Math.max(1, wid);
      const sy = advect + .27 * Math.sin(px * 4 + advect * 2.2);
      const folds = texture(px * 2.25 + .35 * Math.sin(sy * 3.3), sy, 411);
      const rolls = noise(px * 2.7 - sy * 1.3, advect * 1.6, 497);
      const drafted = (1 - Math.abs(px) ** .79) * .95 + (folds - .49) * 1.09 +
        (rolls - .51) * .55 - .17 * rose + .11 * flash;
      const attached = smooth(87, 56, y) * smooth(-3, 14, y + 5 * Math.sin(x * .17));
      const turbulence = drafted * attached * (ignite ** .45);
      if (turbulence < .08) return;
      return band(fire, .045 + turbulence * .99 + .10 * flash);
    });
    const feather = pixel((x, y) => {
      if (appear < .018) return;
      const dx = x - baseX, dy = y - baseY;
      const p = (dx * cs - dy * sn) / span;
      if (p < -.11 || p > 1.065) return;
      const a = dx * sn + dy * cs - axis(p);
      if (p > .055 + appear * .96 || hash(Math.floor(x), Math.floor(y), 7) > appear + .34) return;
      const {side, barb, edge, fullness} = vane(p, a);
      const shaft = p >= -.06 && p <= 1.045 && Math.abs(a) < mix(1.55, .23, p);
      const shoulder = p >= .095 && p <= 1 && Math.abs(a) <= edge;
      const margin = Math.min(edge - Math.abs(a), span * Math.min(1 - p, p - .09));
      if (!shoulder && !shaft) {
        if (p > -.08 && p < 1.025 && (p < .10 ? Math.abs(a) < 2.4 : margin > -1.55))
          return band([0x8c5d63, 0xc79971, 0xffdc8e], .28 + ignite * .60);
        return;
      }
      if (shaft) return a < -.08 ? (ignite > .28 ? 0xffd680 : 0xcf875e) : 0x472a42;
      if (margin < .92) return side < 0 ? 0x4b2a46 : 0x302239;
      const rib = smooth(.22, .045, Math.min(barb, 1 - barb));
      const fraction = Math.abs(a) / edge;
      const bend = (1 - fraction) * .18 + fullness * .14 + (side < 0 ? .14 : .015);
      const colors = [0x582b42, 0x8b3540, 0xb44740, 0xdd6843, 0xef8e54, 0xf7b369, 0xffde89];
      return band(colors, .18 + bend + .29 * rib + .12 * ignite - .33 * (barb > .61 && barb < .76));
    });
    const tongue = pixel((x,y)=>{
      if(ignite<.40)return;
      const dx=x-baseX,dy=y-baseY;
      const p=(dx*cs-dy*sn)/span;
      if(p<.09||p>.94)return;
      const a=dx*sn+dy*cs-axis(p),{edge}=vane(p,a);
      const motion=texture(p*7-u*16,a*.12+u*3,695);
      const rim=edge-Math.abs(a);
      const crest=smooth(-3,0,rim)*smooth(2.4,.35,rim)*(motion+flash*.29);
      if(crest<.64 || (a>0 && p<.43))return;
      return band(fire,crest*.75+.17);
    });
    const sparks = [];
    for (let i = 0; i < 45; i++) {
      const p = wrap(u * (2 + i % 3) + hash(i, 2), 1), at = .19 + hash(i, 3) * .8;
      if (ignite * Math.sin(p * Math.PI) < .26 + hash(i, 4) * .46) continue;
      const x = baseX + at * span * cs + (hash(i, 6) - .38) * (7 + 34 * p);
      const y = baseY - at * span * sn - p * (18 + 39 * hash(i, 5));
      const drift = Math.sin(p * 7 + i) * 3 * p;
      sparks.push(line([[x + drift - p * 2, y + 2 * p], [x + drift, y]], band(fire, .54 + .45 * hash(i, 0))));
    }
    return layer(plate, heat, feather, tongue, draw(sparks));
  }

  const exhaust = [0x2d0a29, 0x490d33, 0x681039, 0xa71945, 0xe72555, 0xff4268, 0xff896f, 0xffd2a1, 0xfff9db, 0xfffcf0];
  const nozzle = [0x080715, 0x10091b, 0x1f0a24, 0x37102d, 0x601536, 0x852144, 0xbf3b53];

  function thrust(u) {
    const charge = smooth(.02, .35, u) * (1 - smooth(.84, .995, u));
    const slam = smooth(.34, .364, u) * (1 - smooth(.37, .505, u));
    const burn = smooth(.34, .385, u) * (1 - smooth(.75, .91, u));
    const face = 65, axis = 48;
    return pixel((x, y) => {
      const dy = y - axis, d = Math.abs(dy), q = face - x;
      const jitter = texture(x * .133 + u * 15 * charge, y * .123, 210);
      const cast = clamp(.13 + .15 * smooth(45, 3, d) + .33 * burn * smooth(55, 11, Math.abs(q)));
      if (x >= face - (d / 31) ** 2 * 4) {
        const lip = x - face + (d / 31) ** 2 * 4;
        const metal = smooth(11, 2, lip) * smooth(37, 26, d);
        const flare = smooth(18, 34, d) * smooth(48, 40, d);
        if (lip < 2.3 && d < 35) return band(nozzle, .42 + .52 * burn + .08 * jitter);
        if (d > 33 && d < 37 && x < 79) return band(nozzle, .37 + flare * .4 * burn);
        const bevel = smooth(1.7,.3,Math.abs(lip-8-d*d*.002))*smooth(36,30,d);
        const caseLight = .25*smooth(24,7,lip)*smooth(29,7,d)+.13*bevel*burn;
        const casing = smooth(2,5,lip)*smooth(24,17,lip)*smooth(17,21,d)*smooth(40,36,d);
        return band(nozzle, .11 + metal * (.24 + .30 * burn) + flare * .16 + caseLight + casing*.12 + .07 * jitter);
      }
      const chevron = wrap(x + d * 1.12 + 11, 31);
      const backdrop = band(nozzle, .12 + (chevron < 15 ? .17 : 0) + cast * .29);
      const compression = .78 * (1 - .26 * q / 96);
      let wake = 0;
      for (let j = 0; j < 4; j++) {
        const stage = wrap(u * 3.65 - j / 4 + .064 * hash(j,4), 1);
        const travel = stage ** 1.22 * 86;
        const rx = 4.0 + 13 * stage, ry = 18 + 20 * stage + j % 2 * 3;
        const shear = (Math.sin(dy * .24 - u * 27 + j) + (jitter - .44) * 4) * (1 + 4 * stage);
        const dist = Math.hypot((q - 2 - travel + shear) / rx, (dy+j%3) / ry);
        const lip = smooth(.29, .03, Math.abs(dist - 1) + .18 * (jitter - .45));
        wake = Math.max(wake, lip * (1 - stage * .73) * charge * compression * smooth(.00,.10,stage));
      }
      const breakAt = burn * 83 + slam * 51;
      const outer = 28 + q * .23 + 6 * Math.sin(q * .14 - 35 * u);
      const neck = smooth(-2, 7, outer - d + (jitter - .52) * 12);
      const moving = 2.2 * Math.sin(q * .21 - u * 111) + 1.3 * Math.sin(q * .36 - u * 230 + dy * .16);
      const skin = neck * smooth(breakAt + 12, breakAt - 13, q + 9 * (jitter - .48));
      const bright = smooth(25 + q * .07, 4, d + moving - 3.3 * Math.sin(dy * .4));
      const white = burn * skin * (.32 + .43 * bright + .24 * smooth(33, 0, q)) *
        (.85+.22*smooth(.25,.72,jitter)+.09*Math.sin(q*.27-u*170)) +
        .51 * slam * bright * smooth(91, 16, q);
      if (white < .065 && wake < .095) return backdrop;
      const crack = jitter > .699 && bright > .52 && q > 9 ? .16 : 0;
      return band(exhaust, Math.max(white + crack * skin, .07 + wake * .95));
    });
  }

  const magma = [0x842735, 0xa52d37, 0xca3b3b, 0xe84f3a, 0xfa7037, 0xff9d39, 0xffc858, 0xffec8a, 0xfff6c7, 0xfffbea];
  const stone = [0x4c2030, 0x642432, 0x7d2734, 0x972b34, 0xaf3034, 0xca3a36, 0xe94f39];
  const bed = generator.cellEdges({...size, spacing:19, jitter:.84, seed:142});
  const tiles = new Map();
  for(let i=0;i<bed.index.data.length;i++){
    const id=bed.index.data[i], d=bed.center.data[i];
    if(!tiles.has(id)||tiles.get(id).d>d)tiles.set(id,{x:i%width,y:Math.floor(i/width),d});
  }

  function lava(u) {
    const wake = smooth(.17, .35, u)*smooth(1,.84,u);
    const blast = smooth(.33, .385, u) * (1 - smooth(.75, 1, u));
    const phase = u * tau;
    const motion=new Map();
    for(const [id,{x,y}] of tiles){
      const distance=Math.hypot(x-46,(y-51)*1.22), local=u-.33-distance*.0024;
      const shove=smooth(.00,.086,local)*smooth(.56,.14,local);
      const a=Math.atan2(y-51,x-46);
      const lift=shove*(2.6+3.4*hash(id,28));
      motion.set(id,{dx:Math.round(Math.cos(a)*lift*.68),dy:Math.round(Math.sin(a)*lift*.63-lift*.55),lift});
    }
    return pixel((x, y) => {
      const dx = x - 46, dy = y - 51;
      const rim = Math.max(Math.abs(x - 48), Math.abs(y - 48)) + Math.min(Math.abs(x - 48), Math.abs(y - 48)) * .19;
      const p = texture(x * .083 + 2, y * .14, 11);
      const grit = hash(Math.floor(x), Math.floor(y), 20);
      if (rim > 52) return band(stone, .62 + .29 * smooth(52, 58, rim) + .1 * p);
      const spread = Math.hypot(dx * .95, dy * 1.56);
      const wave = Math.max(0, 77 * (u - .32) / .45);
      const bloom = blast * Math.exp(-.00106 * spread ** 2);
      const swell = blast * Math.exp(-.0055 * (spread - wave) ** 2);
      const boil = noise(x * .084 - .43 * Math.cos(phase), y * .105 + .72 * Math.sin(phase), 181);
      const heat = Math.min(1, bloom * (.69 + .38 * boil) + swell * .33);
      const xi=Math.floor(x),yi=Math.floor(y);
      let i=yi*width+xi, cell=bed.index.data[i], level=-Infinity;
      // Reverse-map neighboring plates. A plate keeps its ID and paint while its
      // shifted coverage uncovers the connected molten layer below.
      if(blast>.035&&rim<49){
        for(let oy=-6;oy<=6;oy+=6)for(let ox=-6;ox<=6;ox+=6){
          const nx=clamp(xi+ox,0,width-1),ny=clamp(yi+oy,0,size.height-1);
          const id=bed.index.data[ny*width+nx], offset=motion.get(id);
          const sx=xi-offset.dx,sy=yi-offset.dy;
          if(sx<0||sx>=width||sy<0||sy>=size.height)continue;
          const p=sy*width+sx;
          if(bed.index.data[p]===id&&offset.lift>level){
            i=p;
            cell=id;
            level=offset.lift;
          }
        }
      }else level=0;
      const seam=bed.value.data[i];
      const lift = hash(cell, 2, 66);
      const crackWidth = .53 + heat ** 2 * (1.8 + 4.0 * lift);
      const pressure = noise(x * .17 + phase * 2, y * .20, 81);
      const slant = mix(.5,noise(x * .22, y * .29 + phase * 2, 91),wake);
      if (level===-Infinity || seam < crackWidth && (wake > .29 || grit > .78)) {
        const origin=.18*smooth(.42,.39,u)*smooth(9,2,spread);
        return band(magma, .10 + wake * .16 + heat * (.69 + pressure * .28) + origin -
          .19 * smooth(crackWidth * .18, crackWidth, seam));
      }
      const lip = smooth(crackWidth + 2.5, crackWidth + .15, seam);
      const d0=bed.value.data[Math.max(0,i-width-1)],d1=bed.value.data[Math.min(bed.value.data.length-1,i+width+1)];
      const bevel=lip*(d1-d0)*.21;
      const shadow = heat * .22 * smooth(crackWidth + 3.7, crackWidth, seam);
      const lifted = .16 + .24 * lift + .14 * p + .08 * slant + heat * (.10 + .19 * lip + bevel) - shadow;
      return band(stone, lifted + (rim > 47 ? .19 : 0) + (grit > .96 ? .09 : 0));
    });
  }

  return {quill, thrust, lava};
};
