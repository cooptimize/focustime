// DOC-1: the build-time modules scripts/tech-docs.ts serves (techDocsPlugin in vite.config.ts).
declare module "virtual:tech-docs" {
  const docs: { pages: import("./types.ts").RenderedPage[] };
  export default docs;
}
declare module "virtual:tech-docs.css";
