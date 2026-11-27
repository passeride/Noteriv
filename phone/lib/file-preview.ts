const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'avif', 'heic', 'heif', 'ico', 'tif', 'tiff']);
const AUDIO = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'aif', 'aiff', 'amr', 'm4b']);
const VIDEO = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'mpeg', 'mpg', '3gp', 'm2ts', 'mts']);
const CAD = new Set(['stl', 'step', 'stp', 'fcstd']);
const TEXT = new Set(['md', 'markdown', 'txt', 'text', 'log', 'canvas', 'drawing', 'base', 'json', 'csv', 'tsv',
  'yaml', 'yml', 'toml', 'ini', 'conf', 'xml', 'html', 'htm', 'css', 'js', 'jsx', 'mjs', 'cjs',
  'ts', 'tsx', 'py', 'rs', 'c', 'h', 'cpp', 'java', 'kt', 'sh', 'sql', 'scad', 'gcode', 'nc']);

export type FilePreviewKind = 'image' | 'pdf' | 'audio' | 'video' | 'cad' | 'external';

export function filePreviewKind(path: string): FilePreviewKind | null {
  const name = path.split('/').at(-1) ?? '';
  const extension = /\.([^.]+)$/.exec(name)?.[1].toLowerCase();
  if (!extension || TEXT.has(extension)) return null;
  if (IMAGES.has(extension)) return 'image';
  if (extension === 'pdf') return 'pdf';
  if (AUDIO.has(extension)) return 'audio';
  if (VIDEO.has(extension)) return 'video';
  if (CAD.has(extension)) return 'cad';
  return 'external';
}
