/* A mounted signal coil with a timed trace, built once for either renderer. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => {
  const id = 'curve-mode-signal-coil', seed = 23;
  const colors = ['#111e2a', '#182b38', '#223746', '#2d4857', '#3b5966', '#547683', '#76939a',
    '#754743', '#9c5a49', '#c17a56', '#e7a467', '#fbd28e', '#ffe8b1',
    '#24535c', '#39777b', '#54a394', '#79d1b5', '#b2ecd2', '#e1ffdc'];
  const palette = colors.map(color => Number.parseInt(color.slice(1), 16));
  const steel = { r: [1, 2, 3, 4, 5, 6] };
  const dark = { r: [0, 1, 2, 3] };
  const brass = { r: [7, 8, 9, 10, 11] };
  const jade = { r: [13, 14, 15, 16, 17] };
  const sun = [-.46, .65, 1];
  const trace = [[-2.26,-.60,.21],[-1.68,-.60,.21],[-1.44,-.80,.21],[-.65,-.80,.21],
    [-.43,-.54,.21],[-.02,-.54,.21],[.27,-.81,.21],[.89,-.81,.21],[1.13,-.64,.21],[2.26,-.64,.21]];

  function build(value, { serviceWinding } = {}) {
    const B = makeBuilder(value, palette), S = K.sculpt(makeSculpt(B)), C = K.curveSplats;
    Object.assign(S, { sun: K.V.norm(sun), sky: .15, amb: .44, sunK: .67 });
    S.box([0,-.02,-.23],[2.52,1.17,.20],steel,{res:.12,rd:.14});
    S.box([0,-.03,-.045],[2.32,1.00,.071],dark,{res:.105,rd:.11});
    S.box([0,.07,.019],[1.42,.39,.075],steel,{res:.092,rd:.16});
    S.tube(trace, .052, .052, jade, { res: .061 });
    for (const x of [-2.23,2.23]) {
      for (const y of [-.87,.80]) S.ball([x,y,.075],[.087,.087,.075],brass,{res:.050});
      S.ball([x,.25,.37],[.175,.19,.15],brass,{res:.063});
      S.ball([x,-.63,.16],[.153,.125,.125],jade,{res:.052});
    }
    if (serviceWinding) {
      S.box([0,.31,.47],[.16,.52,.058],dark,{res:.034,rd:.039});
      S.box([0,.31,.53],[.072,.47,.019],jade,{res:.025,rd:.014});
    }
    S.bake();

    const point = (u, offset) => {
      const phase = 5 * Math.PI * u + offset;
      return [4.35 * (u - .5), .27 + .34 * Math.sin(phase) + .21 * Math.sin(Math.PI * u),
        .37 + .18 * Math.cos(phase) + .17 * Math.sin(Math.PI * u)];
    };
    for (const [i, color] of ['#fbd28e', '#c17a56', '#e7a467'].entries()) {
      const points = Array.from({length: 57}, (_, j) => point(j / 56, i * 2 * Math.PI / 3));
      const stroke = { edge: 'hard', caps: 'blunt', color,
        lighting: { preset: 'metal-wire', sheen: .34, specular: .57 } };
      if (i === 1 && serviceWinding) {
        for (const spline of serviceWinding.route.splines) C.draw(B, K.curve.retained.compile(serviceWinding.route, spline.id),
          { ...stroke, object: spline.id, color: serviceWinding.pigment });
      } else C.draw(B, { kind: 'path', id: 'winding-' + (i + 1), points }, { ...stroke, width:.137 });
    }
    for (const x of [-1.80,1.80]) {
      C.draw(B, [[x,-.22,.26],[x-.11,.78,.27]], {width:.055,edge:'hard',color:'#76a29d'});
      C.draw(B, [[x,-.22,.26],[x+.18,-.22,.26]], {width:.055,edge:'hard',color:'#76a29d'});
    }
    C.draw(B, { kind: 'path', id: 'signal', points: trace.map(([x,y,z]) => [x,y,z+.075]) }, {
      width: .084, edge: 'hard', caps: 'blunt', color: '#b2ecd2',
      reveal: { end: [[0,0],[.33,0],[1.95,1]], start: [[0,0],[2.13,0],[3.78,1]],
        width: [[0,.66],[1.14,1.08],[2.72,.82],[4,.66]] }
    });

    return B.finish({ id, cam: { target:[0,-.035,0], yaw:-.23, pitch:.18, dist:6.85 },
      radius: 6, fog: { c:0, start:1, max:0 }, dither: 0, look: { pixelSize:1, edgeFilter:true },
      liveSun: { direction:sun, intensity:.61, ambient:.52, shadows:false } });
  }

  return { id, seed, name: 'Signal coil', build };
};
