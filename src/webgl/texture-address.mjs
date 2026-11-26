export const textureAddressAxisGLSL = `
int addressAxis(int n, int size, int edge) {
  if (edge == 0) return clamp(n, 0, size - 1);
  if (edge == 1) return n >= 0 && n < size ? n : -1;
  int span = edge == 3 ? size * 2 : size;
  int at = n - (n / span) * span;
  if (at < 0) at += span;
  return at < size ? at : span - 1 - at;
}
`;
