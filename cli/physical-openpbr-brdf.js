const { dot, along, clamp, scale, cross, unit, luma, frame, direction, tau } = require('./physical-reference-math.js');
const { fresnel } = require('./physical-openpbr.js');
const { dielectric, film, layer, blend, fuzzEnergy, thinSheet, transmittedCosine } = require('./physical-openpbr-optics.js');

function ggx(n, tangent, roughness, anisotropy, view) {
  const [t, b] = tangent ? [tangent, cross(n, tangent)] : frame(n);
  const ratio = 1 - anisotropy;
  const alpha = roughness * roughness * Math.sqrt(2 / (1 + ratio * ratio));
  const ax = Math.max(.002, alpha), ay = Math.max(.002, ratio * alpha);
  const nv = Math.max(.00001, dot(n, view));
  const projected = (d, cosine) => Math.hypot(ax * dot(d, t), ay * dot(d, b), cosine);
  const gv = projected(view, nv);
  function evaluate(out, h, vh, nl) {
    const nh = dot(n, h);
    if (nl <= 0 || nh <= 0) return [0, 0];
    const slope = (dot(h, t) / ax) ** 2 + (dot(h, b) / ay) ** 2 + nh * nh;
    const d = 1 / (Math.PI * ax * ay * slope * slope);
    return [d * nl / (2 * (nl * gv + nv * projected(out, nl))), d * nh / (4 * vh)];
  }
  function half(rng) {
    const u = rng(), angle = tau * rng(), radius = Math.sqrt(u / (1 - u));
    return unit(along(along(n, t, ax * radius * Math.cos(angle)), b, ay * radius * Math.sin(angle)));
  }
  function sample(rng) {
    const h = half(rng);
    const vh = dot(view, h);
    return vh > 0 ? along(scale(view, -1), h, 2 * vh) : null;
  }
  function transportWeight(out, h) {
    const nl = Math.abs(dot(n, out)), nh = Math.max(1e-8, dot(n, h));
    return 2 * nl * Math.max(0, dot(view, h)) / (nh * (nl * gv + nv * projected(out, nl)) || 1);
  }
  return { evaluate, sample, half, transportWeight };
}

function openPbrBrdf(hit, view, ambient = 1, optics = layer(hit.m.openPbr, ambient)) {
  const { n, ng, coatNormal, tangent, coatTangent, m: { color, openPbr: p } } = hit;
  const metal = p.base_metalness, cw = p.coat_weight, coatIor = optics.coatIor;
  const nv = Math.max(.00001, dot(n, view)), cnv = Math.max(.00001, dot(coatNormal, view));
  const metalWeight = clamp(p.specular_weight), edge = p.specular_color, cr = p.coat_roughness;
  const base = ggx(n, tangent, optics.roughness, p.specular_roughness_anisotropy, view);
  const coat = cw ? ggx(coatNormal, coatTangent, cr, p.coat_roughness_anisotropy, view) : null;
  const coatView = optics.coat(cnv), coatF0 = dielectric(1, ambient, coatIor);
  const transmission = (1 - metal) * p.transmission_weight;
  const sss = (1 - metal - transmission) * p.subsurface_weight;
  const diffuse = 1 - metal - transmission - sss;
  const thin = p.geometry_thin_walled;
  const localSss = thin || !p.subsurface_radius || !p.subsurface_radius_scale.some(Boolean);
  const paper = thin ? sss * (1 + p.subsurface_scatter_anisotropy) * .5 : 0;
  const local = localSss ? sss - paper : 0;
  const fuzzNormal = p.fuzz_weight ? unit(along(scale(n, 1 - cw), coatNormal, cw)) : n;
  const fuzzView = fuzzEnergy(p, dot(fuzzNormal, view));
  const fuzzAxis = fuzzView ? unit(along(fuzzNormal, view, (1 - p.fuzz_roughness) *
    1.65 * (1 - Math.max(0, dot(fuzzNormal, view))))) : n;
  const diffuseImportance = diffuse * luma(color) + local * luma(p.subsurface_color);
  const paperImportance = paper * luma(p.subsurface_color);
  const specularImportance = Math.max(.02, luma(optics.reflection(nv)) * (1 - metal) +
    luma(color) * metal * metalWeight);
  const coatImportance = cw * Math.max(.02, 1 - coatView.loss);
  const total = diffuseImportance + paperImportance + specularImportance + coatImportance + fuzzView;
  const pd = diffuseImportance / total, pp = paperImportance / total, pb = specularImportance / total;
  const pc = coatImportance / total, pf = fuzzView / total;
  const diffuseBasis = pd || pp ? frame(n) : null;
  const paperBasis = pp ? frame(scale(n, -1)) : null;
  const fuzzBasis = pf ? frame(fuzzAxis) : null;
  const sigma = p.base_diffuse_roughness;
  const diffuseA = 1 / (1 + (.5 - 2 / (3 * Math.PI)) * sigma);
  const darkening = cw * p.coat_darkening;
  const coatRatio = coatIor / ambient;
  const diffuseInternal = clamp(1 - (1 - (coatF0 + (1 - coatF0) / 21)) / coatRatio ** 2);
  const internal = Math.min(.995, blend(1 - coatView.loss, diffuseInternal, optics.roughness));
  const grazing = 1 / 7;
  const roughDiffuse = (out, cosine) => {
    const s = dot(view, out) - nv * cosine;
    return cosine * diffuseA * (1 + sigma * s / (s > 0 ? Math.max(nv, cosine) : 1)) / Math.PI;
  };

  function evaluate(out) {
    const nl = dot(n, out), geometric = dot(ng, out);
    if (geometric <= 0) {
      if (!pp || nl >= 0 || !geometric) return null;
      const back = -nl;
      const response = paper * roughDiffuse(along(out, n, 2 * back), back);
      const pass = optics.reflection(nv);
      return { pdf: pp * back / Math.PI, weight: p.subsurface_color.map((v, i) =>
        response * v * (1 - pass[i]) * (1 - fuzzView) *
        blend(1, Math.sqrt(p.coat_color[i]) * coatView.loss, cw)) };
    }
    const cnl = dot(coatNormal, out), fuzzCos = Math.max(0, dot(fuzzAxis, out));
    if (nl <= 0 && (!coat || cnl <= 0) && (!pf || !fuzzCos)) return null;
    const h = unit(along(view, out, 1)), vh = clamp(dot(view, h));
    if (vh <= 0) return null;
    const [baseResponse, basePdf] = base.evaluate(out, h, vh, nl);
    const [coatResponse, coatPdf] = coat ? coat.evaluate(out, h, vh, cnl) : [0, 0];
    const coatIncoming = optics.coat(cnl), coatTransmission = coatView.loss * coatIncoming.loss;
    const coatReflection = cw * coatResponse * dielectric(vh, ambient, coatIor);
    const coatExponent = .5 / Math.max(.01, coatView.cos) + .5 / Math.max(.01, coatIncoming.cos);
    const diffuseResponse = roughDiffuse(out, Math.max(0, nl));
    const dielectricReflection = optics.reflection(vh);
    const sheet = thin && transmission ? thinSheet(p, dielectricReflection,
      transmittedCosine(vh, ambient, optics.totalIor)) : null;
    const edgeProfile = (vh / grazing) * ((1 - vh) / (1 - grazing)) ** 6;
    const metalFresnel = metal ? color.map((v, i) =>
      clamp(fresnel(v, vh) - edgeProfile * (1 - edge[i]) * fresnel(v, grazing))) : null;
    const metalFilm = metalFresnel && p.thin_film_weight ?
      film(p, vh, ambient, optics.totalIor, metalFresnel) : metalFresnel;
    const conductor = metalFilm && cw && p.thin_film_weight ?
      film(p, optics.coat(vh).cos, coatIor, optics.totalIor, metalFresnel)
        .map((v,i) => blend(metalFilm[i], v, cw)) : metalFilm;
    const fuzzPass = Math.sqrt((1 - fuzzView) * (1 - fuzzEnergy(p, dot(fuzzNormal, out))));
    const fuzzPdf = fuzzCos / Math.PI, fuzzResponse = fuzzView * fuzzPdf;
    const pdf = pd * Math.max(0, nl) / Math.PI + pb * basePdf + pc * coatPdf + pf * fuzzPdf;
    const weight = color.map((v, i) => {
      const d = dielectricReflection[i];
      const reflected = (1 - metal - (sheet ? transmission : 0)) * d +
        (sheet ? transmission * sheet[i].reflection : 0);
      const specular = reflected * edge[i] + (conductor ? metal * conductor[i] * metalWeight : 0);
      const opaque = diffuse * v + local * p.subsurface_color[i];
      const substrate = baseResponse * specular + diffuseResponse * opaque * (1 - d);
      const internalLoss = 1 - darkening * (1 - (1 - internal) / (1 - v * internal));
      const tint = p.coat_color[i] ** coatExponent;
      return fuzzResponse * p.fuzz_color[i] +
        (coatReflection + substrate * blend(1, tint * coatTransmission, cw) * internalLoss) * fuzzPass;
    });
    return { pdf, weight };
  }

  function sample(rng) {
    const pick = rng();
    if (pick < pd) return direction(n, diffuseBasis, Math.sqrt(1 - rng()), tau * rng());
    if (pick < pd + pp) return direction(scale(n, -1), paperBasis, Math.sqrt(1 - rng()), tau * rng());
    if (pick < pd + pp + pb) return base.sample(rng);
    if (coat && (pick < pd + pp + pb + pc || !pf)) return coat.sample(rng);
    return pf ? direction(fuzzAxis, fuzzBasis, Math.sqrt(1 - rng()), tau * rng()) : base.sample(rng);
  }
  return { evaluate, sample };
}

module.exports = { openPbrBrdf, ggx };
