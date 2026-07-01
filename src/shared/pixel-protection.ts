export const composePixelProtectedRgba = (
  sourcePixels: Uint8ClampedArray,
  modelPixels: Uint8ClampedArray,
  maskPixels: Uint8ClampedArray
): Uint8ClampedArray => {
  if (sourcePixels.length !== modelPixels.length || sourcePixels.length !== maskPixels.length) {
    throw new Error("像素保护合成要求源图、模型输出和 mask 像素长度一致。");
  }
  const result = new Uint8ClampedArray(sourcePixels.length);
  for (let index = 0; index < sourcePixels.length; index += 4) {
    const maskAlpha = maskPixels[index + 3];
    if (maskAlpha === 255) {
      result[index] = sourcePixels[index];
      result[index + 1] = sourcePixels[index + 1];
      result[index + 2] = sourcePixels[index + 2];
      result[index + 3] = sourcePixels[index + 3];
      continue;
    }
    if (maskAlpha === 0) {
      result[index] = modelPixels[index];
      result[index + 1] = modelPixels[index + 1];
      result[index + 2] = modelPixels[index + 2];
      result[index + 3] = modelPixels[index + 3];
      continue;
    }
    const keep = maskAlpha / 255;
    const edit = 1 - keep;
    result[index] = Math.round(sourcePixels[index] * keep + modelPixels[index] * edit);
    result[index + 1] = Math.round(sourcePixels[index + 1] * keep + modelPixels[index + 1] * edit);
    result[index + 2] = Math.round(sourcePixels[index + 2] * keep + modelPixels[index + 2] * edit);
    result[index + 3] = Math.round(sourcePixels[index + 3] * keep + modelPixels[index + 3] * edit);
  }
  return result;
};
