const { primaries, isHDR } = require('./color-management.js');
const C = require('./texture-common.js');
const EXR = require('./texture-exr.js');
const PNG = require('./texture-png.js');

function exr(image, {working,workingChromaticities,whiteNits}) {
  if (!workingChromaticities)
    throw new TypeError('Declare working chromaticities before exporting this OCIO space to OpenEXR');
  const {width,height,channels,data,alpha}=image;
  const lanes=['R','G','B',...(channels===4?['A']:[])];
  const planes=Object.fromEntries(lanes.map((name,c)=>[name,Float32Array.from({length:width*height},(_,i)=>data[i*channels+c])]));
  return EXR.write({width,height,planes,alpha},{profile:{ocioColorSpace:working,
    ...(workingChromaticities&&{chromaticities:workingChromaticities}),...(whiteNits!==undefined&&{whiteLuminance:whiteNits})}});
}

function displayTags(encoding,hdr={}) {
  if (!C.fields(hdr,['mastering','lightLevels']) || Object.keys(hdr).length&&!isHDR(encoding))
    throw new TypeError('Static HDR mastering tags need a PQ or HLG view');
  if (encoding==='srgb') return {srgb:0};
  const code=({'display-p3':[12,13],'rec2100-pq':[9,16],'rec2100-hlg':[9,18]})[encoding];
  if (!code) throw new TypeError('Unknown OCIO delivery encoding');
  const [primaries,transfer]=code;
  const profile={cicp:{primaries,transfer,matrix:0,fullRange:true},...hdr};
  C.profile(profile);
  return profile;
}

function display(image,encoding,hdr) {
  return PNG.write(image,displayTags(encoding,hdr));
}

function proof(image) {
  return PNG.write(image,{srgb:0});
}

function inkLinearTags(whiteNits) {
  return {working:'Linear Rec.709 (sRGB)',workingChromaticities:primaries['srgb-linear'],whiteNits};
}

module.exports={exr,display,displayTags,proof,inkLinearTags};
