# Bundled report fonts

These are **substitutes**, not the fonts named in the report font menu. Reports
are written in the Word families a clinic knows (Arial, Calibri, Cambria,
Times New Roman…), which ship with Windows/Office and cannot be redistributed.
`src/lib/report-fonts.ts` declares every one of those families with
`src: local("<the real font>"), url(<a file from this folder>)`, so:

- on a Windows clinic PC the genuine font matches and nothing here is downloaded;
- everywhere else (Linux, most Macs, and the PDF/print output) these open faces
  render instead.

Six of them are *metric-compatible* — identical advance widths to the font they
stand in for, so line and page breaks land in the same places:

| Substitute | Stands in for | License |
| --- | --- | --- |
| Arimo | Arial | Apache-2.0 |
| Tinos | Times New Roman | Apache-2.0 |
| Cousine | Courier New, Consolas, Lucida Console | Apache-2.0 |
| Carlito | Calibri | SIL OFL 1.1 |
| Caladea | Cambria, Rockwell | SIL OFL 1.1 |
| Gelasio | Georgia, Bookman Old Style | SIL OFL 1.1 |

The rest match by character rather than metrics:

| Substitute | Stands in for | License |
| --- | --- | --- |
| Open Sans | Segoe UI, Candara, Corbel, Tahoma, Verdana, Trebuchet MS, Century Gothic, Lucida Sans Unicode | SIL OFL 1.1 |
| EB Garamond | Garamond, Perpetua, Constantia, Book Antiqua, Palatino Linotype | SIL OFL 1.1 |
| Comic Neue | Comic Sans MS, Segoe Print, Segoe Script | SIL OFL 1.1 |
| Archivo Narrow | Arial Narrow | SIL OFL 1.1 |
| Anton | Impact | SIL OFL 1.1 |

Files are the Latin `.woff2` subsets from the [Fontsource](https://fontsource.org)
packages of the same names (`@fontsource/<name>@5`), regular/bold/italic/bold-italic
for each family except Anton, which ships a single weight.

To refresh or add one:

```sh
curl -o public/fonts/<name>-400-normal.woff2 \
  https://cdn.jsdelivr.net/npm/@fontsource/<name>@5/files/<name>-latin-400-normal.woff2
```

then map it in `FONTS` in `src/lib/report-fonts.ts`.
