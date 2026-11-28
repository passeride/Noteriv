export function isCadFile(path: string): boolean {
  return /\.(stl|step|stp|fcstd)$/i.test(path);
}
