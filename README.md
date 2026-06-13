# PaperPress

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tools](https://img.shields.io/badge/Tools-13-brightgreen.svg)](#tools)
[![Privacy](https://img.shields.io/badge/Privacy-No%20Upload-green.svg)](#privacy)
[![Client Side](https://img.shields.io/badge/Processing-100%25%20Browser-blue.svg)](#how-it-works)
[![Made by Venom X Technology](https://img.shields.io/badge/Made%20by-Venom%20X%20Technology-1f4fd8.svg)](https://venomxtechnology.com)

**Free, private PDF tools that run 100% in your browser. No uploads. No sign-up. No server.**

> Built by [Venom X Technology](https://venomxtechnology.com), Jaffna, Sri Lanka.

---

## Live Site

[paper-press-three.vercel.app](https://paper-press-three.vercel.app)

---

## Tools

| Tool | Status |
| --- | --- |
| Word to PDF | Coming Soon |
| PDF to Word | Coming Soon |
| OCR Scan to Text (English, Tamil & Sinhala) | Live |
| Images to PDF | Live |
| PDF to Images | Live |
| Merge PDF | Live |
| Split PDF | Live |
| Compress PDF | Live |
| Organize Pages | Live |
| Watermark PDF | Live |
| Page Numbers | Live |
| Edit Metadata | Live |
| Text to PDF | Live |

---

## How It Works

Every conversion runs inside your browser tab using JavaScript — no file ever leaves your device.

- **Merge / Split / Compress / Organize** — [pdf-lib](https://pdf-lib.js.org/)
- **Images ↔ PDF** — [jsPDF](https://github.com/parallax/jsPDF) + Canvas API
- **OCR** (English, Tamil, Sinhala) — [Tesseract.js](https://github.com/naptha/tesseract.js)
- **Watermark / Metadata / Page Numbers** — pdf-lib
- **Text to PDF** — jsPDF

---

## Privacy

Your files are processed entirely on your own machine. PaperPress has no backend, no database, and no analytics that touch your documents. Close the tab — everything is gone.

---

## Project Structure

```text
paperpress/
├── index.html          # Home page — tool grid
├── assets/
│   ├── style.css       # Global styles
│   └── ...
├── tools/
│   ├── merge-pdf.html
│   ├── split-pdf.html
│   ├── compress-pdf.html
│   ├── ocr-pdf.html
│   ├── jpg-to-pdf.html
│   ├── pdf-to-jpg.html
│   ├── organize-pdf.html
│   ├── watermark-pdf.html
│   ├── add-page-numbers.html
│   ├── edit-pdf-metadata.html
│   ├── text-to-pdf.html
│   ├── word-to-pdf.html    (Coming Soon)
│   └── pdf-to-word.html    (Coming Soon)
├── robots.txt
└── sitemap.xml
```

---

## License

[MIT](LICENSE) © 2024 Venom X Technology
