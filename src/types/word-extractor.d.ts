// Minimal ambient types for word-extractor (no official/@types package) — just
// enough to cover reading legacy .doc (OLE/binary) files as plain text.
declare module "word-extractor" {
  interface WordDocument {
    getBody(): string
    getFootnotes(): string
    getEndnotes(): string
    getHeaders(options?: unknown): string
  }
  class WordExtractor {
    extract(input: string | Buffer): Promise<WordDocument>
  }
  export = WordExtractor
}
