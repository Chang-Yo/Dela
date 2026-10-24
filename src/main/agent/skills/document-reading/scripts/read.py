"""Extract local documents with MarkItDown and materialize visual fallbacks."""

import argparse
import base64
import json
import mimetypes
from pathlib import Path
import re
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True, help="Task-local artifact directory")
    parser.add_argument("--pages", help="PDF pages to render, e.g. 1,3 (one-based)")
    args = parser.parse_args()
    source = args.input.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    from markitdown import MarkItDown

    text = MarkItDown(enable_plugins=False).convert_local(str(source), keep_data_uris=True).markdown
    images = []

    def save_image(match):
        alt, mime, encoded = match.groups()
        extension = mimetypes.guess_extension(mime) or ".bin"
        path = output / f"image-{len(images) + 1}{extension}"
        path.write_bytes(base64.b64decode(encoded, validate=True))
        images.append({"path": str(path), "alt": alt})
        return f"![{alt}]({path.name})"

    text = re.sub(r"!\[([^\]]*)\]\(data:([^;]+);base64,([A-Za-z0-9+/=]+)\)", save_image, text)
    warnings = []
    status = "extracted" if text.strip() else "needs_visual_read"
    pdf = None
    # Use the parser's content detection, not an extension table, for PDF fallback.
    with source.open("rb") as stream:
        is_pdf = stream.read(5) == b"%PDF-"
    if is_pdf and (args.pages or not text.strip()):
        import pypdfium2

        pdf = pypdfium2.PdfDocument(source)
        try:
            pages = sorted(set(int(p) for p in args.pages.split(","))) if args.pages else list(range(1, len(pdf) + 1))
            if any(p < 1 or p > len(pdf) for p in pages):
                raise ValueError(f"Pages must be between 1 and {len(pdf)}")
            # At most six per call; keep the remainder explicit instead of silently truncating.
            remaining = pages[6:]
            for number in pages[:6]:
                page = pdf[number - 1]
                bitmap = page.render(scale=2)
                try:
                    path = output / f"page-{number}.png"
                    bitmap.to_pil().save(path)
                    images.append({"path": str(path), "page": number})
                finally:
                    bitmap.close()
                    page.close()
            if remaining:
                warnings.append({"code": "remaining_pages", "pages": remaining})
        finally:
            pdf.close()
    elif args.pages:
        raise ValueError("--pages requires a PDF document")
    if images:
        warnings.append({"code": "visual_content_unread", "message": "Images are available, but have not been interpreted."})
    if not text.strip():
        warnings.append({"code": "no_text", "message": "No text extracted; use page images when available."})
    body = output / "content.md"
    body.write_text(text, encoding="utf-8")
    print(json.dumps({"status": status, "content": str(body), "characters": len(text), "images": images, "warnings": warnings}, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "error", "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
