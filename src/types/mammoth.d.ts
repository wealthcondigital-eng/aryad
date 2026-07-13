// Minimal ambient types for mammoth (no official/@types package) — just enough
// to cover converting an uploaded .docx buffer to HTML for template import.
declare module "mammoth" {
  interface ConvertResult {
    value: string
    messages: unknown[]
  }
  interface ConvertOptions {
    styleMap?: string | string[]
  }
  export function convertToHtml(input: { buffer: Buffer }, options?: ConvertOptions): Promise<ConvertResult>
  export function extractRawText(input: { buffer: Buffer }): Promise<ConvertResult>
}
