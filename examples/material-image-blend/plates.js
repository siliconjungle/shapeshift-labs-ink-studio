/* Three native-pixel source plates for the Breakwater blend demo. */
function breakwaterPlates() {
  const width = 160, height = 96;
  const make = channels => ({ width, height, channels, data: new Uint8Array(width * height * channels) });
  const background = make(4), foreground = make(4), mask = make(1);
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
    const grain = (Math.imul(x + 19, 5063) ^ Math.imul(y + 7, 8387)) & 31;
    const sky = y < 46;
    const island = Math.floor(46 - Math.max(0, 13 - Math.abs(x - 34) * .29) - 2 * Math.sin(x * .16));
    const cape = Math.floor(86 - Math.max(0, 23 - (x - 116) * .34) + Math.sin(x * .31) * 2);
    const ridge = x > 103 && y >= cape;
    const beach = ridge && y < cape + 2;
    const seaLine = !sky && ((Math.floor(x / 3) + y * 7) % (y < 65 ? 23 : 29) < (y < 65 ? 3 : 5));
    let base = sky ? y < 15 ? [28, 61, 71] : y < 33 ? [36, 78, 87] : [51, 101, 105] :
      y < 54 ? [47, 97, 99] : y < 72 ? [27, 74, 82] : [18, 57, 68];
    if (sky && y > 17 && (Math.floor(x / 4) + y * 3) % 27 < 8 && y % 5 === 0) base = [60, 107, 104];
    if (y >= island && y < 46) base = y === island ? [68, 101, 103] : [30, 62, 70];
    if (seaLine) base = y % 3 === 0 ? [78, 127, 122] : [53, 104, 108];
    if (ridge) base = beach ? [101, 131, 112] : y - cape < 5 ? [53, 84, 76] : [28, 49, 53];
    if (ridge && grain < 2 && y > cape + 2) base = [56, 80, 75];

    const tower = y >= 35 && y < 76 && Math.abs(x - 123) < 4 + Math.floor((y - 35) / 19);
    if (tower) {
      if (x < 121) base = [127, 151, 128];
      else if (x < 125) base = [90, 123, 110];
      else base = [59, 88, 84];
      if (y % 8 === 0) base = [63, 93, 87];
      if (x === 123 && y > 44 && y < 49) base = [20, 53, 61];
    }
    if (y >= 28 && y < 37 && Math.abs(x - 123) < 7)
      base = y === 28 || y >= 35 || Math.abs(x - 123) > 4 ? [30, 51, 54] : [99, 118, 94];
    if (y >= 23 && y < 29 && Math.abs(x - 123) < y - 20) base = [47, 70, 67];
    if (x === 123 && y >= 19 && y < 24) base = [57, 81, 73];
    background.data.set([...base, y < 45 && !tower ? 213 : 255], i * 4);

    const distance = 122 - x, axis = 33 + distance * .235;
    const offset = Math.abs(y - axis);
    let light = [205, 131, 58, 0];
    if (distance >= 0 && offset < 2.1 + distance * .16) {
      const band = offset / (2.1 + distance * .16);
      light = band < .36 ? [255, 216, 131, 192] : band < .74 ? [251, 175, 84, 133] : [224, 138, 68, 64];
      if ((grain < 4 && band > .35) || (y % 6 === 0 && x < 68)) light[3] = Math.round(light[3] * .68);
    }
    if (Math.abs(x - 123) <= 4 && y > 28 && y < 35) light = [255, 226, 141, 255];
    if (y > 47 && y % 3 === 1 && Math.abs(x - (96 - (y - 47) * 1.44)) < (y - 43) * .4 && grain < 19)
      light = [242, 184, 92, 105];
    foreground.data.set(light, i * 4);
    mask.data[i] = x < 22 ? 0 : x < 39 || (y > 48 && y % 5 === 0) ? 128 : 255;
  }
  return { background, foreground, mask };
}

if (typeof module !== 'undefined') module.exports = breakwaterPlates;
