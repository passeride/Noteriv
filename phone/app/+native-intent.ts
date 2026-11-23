// Preserve the encoded query and fragment when passing the native URL to
// Expo Router. Its custom-scheme URL parser otherwise decodes them early.
export function redirectSystemPath({ path }: { path: string }): string {
  return path.replace(/^noteriv:\/\/\/?open\/?(?=[?#]|$)/i, '/open');
}
