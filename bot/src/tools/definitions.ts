export const TOOL_IDS = [
  'split',
  'select',
  'reorder',
  'rotate',
  'gray',
  'bw',
  'invert',
  'clear',
  'nup',
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export interface ToolDefinition {
  id: ToolId;
  label: string;
  uploadTitle: string;
  uploadPrompt: string;
}

export const TOOL_DEFINITIONS: Record<ToolId, ToolDefinition> = {
  split: {
    id: 'split',
    label: 'Split PDF',
    uploadTitle: '✂️ Split PDF',
    uploadPrompt:
      'Send one PDF. You can extract page ranges, split every page, or split into equal groups.',
  },
  select: {
    id: 'select',
    label: 'Page Selection',
    uploadTitle: '📑 Page Selection',
    uploadPrompt: 'Send one PDF, then choose which pages to keep or remove.',
  },
  reorder: {
    id: 'reorder',
    label: 'Page Reorder',
    uploadTitle: '🔀 Page Reorder',
    uploadPrompt: 'Send one PDF, then type the new page order (for example 3,1,2,5,4).',
  },
  rotate: {
    id: 'rotate',
    label: 'Rotate PDF',
    uploadTitle: '🔄 Rotate PDF',
    uploadPrompt: 'Send one PDF, then choose an angle and which pages to rotate.',
  },
  gray: {
    id: 'gray',
    label: 'Grayscale',
    uploadTitle: '⚪ Grayscale',
    uploadPrompt: 'Send one PDF. Pages are rendered sequentially and converted to grayscale.',
  },
  bw: {
    id: 'bw',
    label: 'Black & White',
    uploadTitle: '⚫ Black & White',
    uploadPrompt: 'Send one PDF. Pages become true monochrome with a readable threshold preset.',
  },
  invert: {
    id: 'invert',
    label: 'Invert Colors',
    uploadTitle: '🌗 Invert Colors',
    uploadPrompt: 'Send one PDF. Colors and light backgrounds are inverted.',
  },
  clear: {
    id: 'clear',
    label: 'Clear Background',
    uploadTitle: '🧽 Clear Background',
    uploadPrompt: 'Send one PDF. Off-white backgrounds are cleaned without removing dark text.',
  },
  nup: {
    id: 'nup',
    label: 'N-up Layout',
    uploadTitle: '🧾 N-up Layout',
    uploadPrompt:
      'Send one PDF. Pages are placed into a 2, 4, 6, or 9-in-1 sheet while preserving aspect ratio.',
  },
};

export function isToolId(value: string): value is ToolId {
  return (TOOL_IDS as readonly string[]).includes(value);
}
