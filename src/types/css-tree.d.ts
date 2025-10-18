declare module 'css-tree' {
  export function parse(css: string, options?: any): any
  export function generate(ast: any): string
  export function walk(ast: any, walker: { enter(node: any): void }): void
}
