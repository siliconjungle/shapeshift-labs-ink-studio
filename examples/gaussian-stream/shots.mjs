export const background = [6, 15, 26];
export const limits = {
  budgetBytes: 1850 * 1024,
  maxSplats: 28_000,
  layers: { shoal: { maxSplats: 11_500, splatsPerPixel: .65 } },
  projectedError: { targetPx: 4, hysteresis: .2 },
  guardPixels: 16,
  startsPerFrame: 10,
  concurrency: 6
};
export const passCamera = amount => ({
  target: [2.4 - 2.3 * amount, -.16, -1.5 + 11.3 * amount],
  dist: 40 - 25.7 * amount,
  yaw: -.12 + .07 * amount,
  pitch: -.08 + .035 * amount,
  fov: .65 - .21 * amount
});
