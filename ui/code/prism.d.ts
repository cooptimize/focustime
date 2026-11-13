// RB-1: the little of Prism's core API ui/code/highlight.ts uses (no @types package: the one new dependency is prismjs).
declare module "prismjs/components/prism-core" {
  type Grammar = Record<string, unknown>;
  type TokenStream = string | Token | (string | Token)[];
  class Token {
    type: string;
    content: TokenStream;
    alias?: string | string[];
  }
  const Prism: { languages: Record<string, Grammar | undefined>; tokenize(text: string, grammar: Grammar): (string | Token)[]; manual?: boolean };
  export default Prism;
  export type { Grammar, Token, TokenStream };
}
declare module "prismjs/components/prism-markup";
declare module "prismjs/components/prism-sql";
declare module "prismjs/components/prism-json";
declare module "prismjs/components/prism-yaml";
declare module "prismjs/components/prism-powershell";
declare module "prismjs/components/prism-markdown";
declare module "prismjs/components/prism-python";
declare module "prismjs/components/prism-dax";
declare module "prismjs/components/prism-powerquery";
