// Scene support extracted from the Inkwell Rebirth examples.
function rebirthGardenSupport({ KIT }) {
  function sculptGardenMushroom(Sx, at, v, k, { cap, stem, spot }, resolution = 1) {
    const G = KIT.grow, h = v.h * k, radius = v.cap * k;
    const top = [at[0] + v.tip * h, at[1] + h, at[2] + v.tip * 0.6 * h], yaw = v.rnd() * 6.28;
    Sx.tube([[at[0], at[1] - 0.06, at[2]], [at[0] + v.tip * h * 0.4, at[1] + h * 0.55, at[2]], top],
      0.06 * k, 0.045 * k, stem, { res: 0.04 * resolution });
    Sx.ball([top[0], top[1] - radius * 0.1, top[2]], [radius, radius * (v.dome ?? 0.6), radius], cap, { res: 0.045 * resolution });
    for (const f of G.arrange('spiral', Math.floor(v.spots), { r: radius * 0.8, dome: 0.75 })) {
      const q = G.put(f, [top[0], top[1] + radius * 0.02, top[2]], yaw, 1);
      Sx.ball([q.p[0], q.p[1] + (top[1] - q.p[1]) * 0.42 + radius * (v.dome === undefined ? 0.3 : v.dome * 0.46), q.p[2]],
        0.045 * k * (0.6 + 0.6 * f.s), spot, { res: 0.03 * resolution });
    }
    return { top: [top[0], top[1] + radius * 0.5, top[2]], cap: radius };
  }

  function sculptGardenFrog(S, [x, y, z], scale, { body, eye, throat }, { tag = 'frog', throatTag = 'throat', resolution = 1 } = {}) {
    const fp = (forward, side, up) => [x + forward * scale, y + up * scale, z + side * scale];
    const fr3 = r => (r.length ? r.map(v => v * scale) : r * scale);
    S.ball(fp(-0.02, 0, 0.09), fr3([0.15, 0.085, 0.12]), body, { res: 0.018 * resolution, tag });
    S.ball(fp(0.1, 0, 0.13), fr3([0.085, 0.06, 0.09]), body, { res: 0.016 * resolution, tag });
    for (const sg of [-1, 1]) {
      S.ball(fp(0.12, sg * 0.055, 0.19), fr3(0.035), body, { res: 0.012 * resolution, tag });
      S.ball(fp(0.13, sg * 0.062, 0.2), fr3(0.022), eye, { res: 0.01 * resolution, tag });
      S.ball(fp(-0.08, sg * 0.1, 0.06), fr3([0.08, 0.05, 0.05]), body, { res: 0.016 * resolution, tag });
      S.ball(fp(0.02, sg * 0.15, 0.025), fr3([0.07, 0.022, 0.03]), body, { res: 0.012 * resolution, tag });
      S.ball(fp(0.13, sg * 0.075, 0.03), fr3([0.03, 0.035, 0.025]), body, { res: 0.012 * resolution, tag });
    }
    S.ball(fp(0.15, 0, 0.09), fr3([0.06, 0.045, 0.06]), throat, { res: 0.012 * resolution, tag: throatTag });
  }

  return { sculptGardenMushroom, sculptGardenFrog };
}

if (typeof module !== 'undefined') module.exports = rebirthGardenSupport;
