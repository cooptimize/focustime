// DOC-1: the shape of a rendered technical page, shared by the build (scripts/tech-docs.ts) and the panel.
export type Heading = { anchor: string; text: string; level: number };
export type SearchEntry = { anchor: string | null; title: string; text: string };
export type RenderedPage = { id: string; file: string; title: string; html: string; headings: Heading[]; search: SearchEntry[]; checked: string | null };
