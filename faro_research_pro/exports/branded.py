"""Branded PDF / Markdown export — logo + cover page + header / footer.

Layered on top of `faro_research.export` (MIT core), this module:
  - Adds an A4 cover page with logo + title + author + date + abstract
  - Stamps a header (logo mark + brand) and footer (page number + project URL)
    on every body page
  - Optionally takes a `BrandConfig` to override colors / project name / URL

Wire as a drop-in replacement for `markdown_to_pdf`::

    from faro_research_pro.exports.branded import branded_markdown_to_pdf
    pdf = branded_markdown_to_pdf(md, title="...", brand=BrandConfig(...))

The Pro server uses this for `GET /api/sessions/{id}/export.pdf` instead of
the OSS plain version.
"""

from __future__ import annotations

import base64
import datetime as _dt
import logging
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from faro_research.export import _markdown_to_html  # MIT helper

log = logging.getLogger(__name__)

_ASSETS = Path(__file__).resolve().parent / "assets"

# Reportlab CJK setup: STSong-Light is bundled in reportlab via Adobe's
# Asian font pack (CIDFont); registered once on first PDF render. Without
# this, Chinese characters silently fall back to Helvetica which doesn't
# have CJK glyphs → blank squares in the output.
_CJK_FONTS_REGISTERED = False


def _ensure_cjk_fonts() -> None:
    """Register Chinese fonts with reportlab. Idempotent + cheap after first call."""
    global _CJK_FONTS_REGISTERED
    if _CJK_FONTS_REGISTERED:
        return
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        # Simplified Chinese serif. Bundled.
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        # Try sans-serif (sometimes named differently across reportlab versions)
        try:
            pdfmetrics.registerFont(UnicodeCIDFont("STHeiti-Light"))
        except Exception:
            pass
        _CJK_FONTS_REGISTERED = True
    except Exception as e:
        log.warning("CJK font registration failed (%s); Chinese will not render", e)


@dataclass
class BrandConfig:
    """Customise the branded export. All fields optional → sensible defaults."""

    project_name: str = "Faro Research Pro"
    tagline: str = "AGPL · 多 agent A 股研究"
    project_url: str = "https://github.com/alonegg/faro-research-pro"
    accent_color: str = "#4a6cf7"
    accent_dark: str = "#7a3cf3"
    logo_svg_path: Path | None = None       # default: bundled logo.svg
    author: str = "Faro Research"
    confidential: bool = False              # adds CONFIDENTIAL watermark on cover

    def logo_data_uri(self) -> str:
        """Return logo as data: URI (base64 svg). Used inline in HTML."""
        path = self.logo_svg_path or (_ASSETS / "logo.svg")
        try:
            data = path.read_bytes()
        except OSError:
            return ""
        b64 = base64.b64encode(data).decode("ascii")
        return f"data:image/svg+xml;base64,{b64}"


# ────────────────────────────────────────────────────────────────────────────
# Cover page
# ────────────────────────────────────────────────────────────────────────────


def _cover_html(*, title: str, abstract: str, brand: BrandConfig) -> str:
    """Cover page — xhtml2pdf-friendly: no SVG gradients, no `%` widths,
    logo rendered as a CSS-styled DIV (rounded gradient via accent colors)."""
    today = _dt.date.today().strftime("%Y-%m-%d")
    confidential_band = (
        '<div class="confidential">CONFIDENTIAL — internal research</div>'
        if brand.confidential else ""
    )
    return f"""
    <div class="cover">
      <table class="cover-logo-tbl"><tr>
        <td class="logo-mark">F</td>
        <td class="logo-label">
          <div class="logo-name">{brand.project_name}</div>
          <div class="logo-tag">{brand.tagline}</div>
        </td>
      </tr></table>
      <h1 class="cover-title">{title}</h1>
      <table class="meta-table">
        <tr><td class="k">作者 Author</td><td class="v">{brand.author}</td></tr>
        <tr><td class="k">日期 Date</td><td class="v">{today}</td></tr>
        <tr><td class="k">来源 Source</td><td class="v">{brand.project_name}</td></tr>
      </table>
      <div class="cover-abstract">
        <div class="abstract-label">摘要 ABSTRACT</div>
        <div class="abstract-body">{abstract}</div>
      </div>
      {confidential_band}
      <table class="cover-foot-tbl"><tr>
        <td class="foot-l">{brand.tagline}</td>
        <td class="foot-r">{brand.project_url}</td>
      </tr></table>
    </div>
    <div class="page-break"></div>
    """


def _abstract_from_markdown(md: str, max_chars: int = 320) -> str:
    """Heuristic abstract: first non-heading non-table prose paragraph."""
    para_buf: list[str] = []
    for line in md.splitlines():
        s = line.strip()
        if not s:
            if para_buf:
                break
            continue
        if s.startswith(("#", "|", ">", "-", "*", "_", "```")):
            if para_buf:
                break
            continue
        para_buf.append(s)
    if not para_buf:
        return "(详见报告正文)"
    text = " ".join(para_buf).strip()
    if len(text) > max_chars:
        text = text[:max_chars].rstrip() + "…"
    return text


# ────────────────────────────────────────────────────────────────────────────
# CSS — stylesheet for cover + body + page chrome
# ────────────────────────────────────────────────────────────────────────────


def _build_css(brand: BrandConfig) -> str:
    return f"""
@page {{
    size: A4;
    margin: 2.4cm 1.8cm 1.8cm 1.8cm;
    @frame header_frame {{
        -pdf-frame-content: header_content;
        left: 1.6cm; width: 18cm; top: 0.8cm; height: 1.0cm;
    }}
    @frame footer_frame {{
        -pdf-frame-content: footer_content;
        left: 1.6cm; width: 18cm; bottom: 0.8cm; height: 0.8cm;
    }}
}}
@page cover_page {{
    size: A4;
    margin: 0;
}}

/* CJK font: STSong-Light is reportlab's bundled Chinese font (registered
   in _ensure_cjk_fonts()). Listed first so Chinese chars get glyphs;
   Latin chars fall through to Helvetica. */
body {{
    font-family: 'STSong-Light', 'Helvetica', sans-serif;
    font-size: 10pt;
    line-height: 1.55;
    color: #1d1c19;
}}

/* ── header / footer chrome ───────────────────────────────────────── */
.header {{
    border-bottom: 1px solid #e1ddd4;
    padding-bottom: 4pt;
    color: #4a4843;
    font-size: 8.5pt;
    display: block;
}}
.header .brand {{ color: {brand.accent_dark}; font-weight: 700; }}
.footer {{
    border-top: 1px solid #e1ddd4;
    padding-top: 4pt;
    color: #8a857c;
    font-size: 8pt;
}}
.footer .url {{ color: {brand.accent_color}; }}

/* ── cover page ───────────────────────────────────────────────────── */
.cover {{
    -pdf-frame-page: cover_page;
    padding: 4cm 2.4cm 2.4cm 2.4cm;
}}

/* Logo: a CSS rounded square with the F mark + project name beside */
.cover-logo-tbl {{ margin-bottom: 1.4cm; }}
.cover-logo-tbl td {{ padding: 0; vertical-align: middle; }}
.cover-logo-tbl .logo-mark {{
    width: 64pt; height: 64pt;
    background-color: {brand.accent_color};
    color: #ffffff;
    font-size: 36pt; font-weight: 800;
    text-align: center;
    -pdf-keep-with-next: true;
}}
.cover-logo-tbl .logo-label {{ padding-left: 14pt; }}
.cover-logo-tbl .logo-name {{
    font-size: 18pt; font-weight: 700; color: #1d1c19;
}}
.cover-logo-tbl .logo-tag {{
    font-size: 9pt; color: {brand.accent_dark}; letter-spacing: 1pt;
    margin-top: 2pt;
}}

.cover-title {{
    font-size: 26pt; font-weight: 800; color: #0d0c0a;
    margin: 0 0 1.2cm 0; line-height: 1.2;
}}
.meta-table {{ font-size: 10pt; margin-bottom: 1.2cm; }}
.meta-table td {{ padding: 5pt 12pt 5pt 0; vertical-align: top; }}
.meta-table .k {{
    color: #8a857c; font-weight: 600; width: 100pt;
    letter-spacing: 1pt; font-size: 8.5pt;
}}
.meta-table .v {{ font-size: 10pt; color: #2a2823; }}

.cover-abstract {{
    border-left: 4px solid {brand.accent_color};
    padding: 8pt 14pt;
    background-color: #f6f7fb;
    margin-bottom: 1.4cm;
}}
.abstract-label {{
    font-size: 8.5pt; color: {brand.accent_dark};
    letter-spacing: 2pt; font-weight: 700; margin-bottom: 4pt;
}}
.abstract-body {{ font-size: 10pt; color: #2a2823; }}

.confidential {{
    background-color: #fff4e5; color: #b85b00;
    padding: 6pt 12pt; font-size: 9pt; font-weight: 700;
    text-align: center; border: 1px solid #ffd9a8;
    margin-bottom: 1cm;
}}

.cover-foot-tbl {{
    border-top: 1px solid #e1ddd4; padding-top: 8pt;
    font-size: 9pt; color: #8a857c;
}}
.cover-foot-tbl .foot-l {{ width: 360pt; }}
.cover-foot-tbl .foot-r {{ color: {brand.accent_color}; text-align: right; }}

/* ── body content (same as OSS) ────────────────────────────────────── */
h1 {{ font-size: 18pt; margin: 0 0 6pt; }}
h2 {{ font-size: 14pt; margin: 14pt 0 4pt; color: #2a2823; }}
h3 {{ font-size: 12pt; margin: 10pt 0 3pt; color: #2a2823; }}
h4 {{ font-size: 11pt; margin: 8pt 0 2pt; }}
p, li {{ font-size: 10pt; margin: 3pt 0; }}
strong {{ color: #000; font-weight: 700; }}
code {{ font-family: 'Menlo', 'Courier New', monospace; font-size: 9pt;
        background: #f3f1ec; padding: 0 3px; }}
table {{ border-collapse: collapse; margin: 6pt 0; }}
th {{ background: #f3f1ec; font-weight: 600; text-align: left; }}
th, td {{ border: 1px solid #e1ddd4; padding: 4pt 6pt; font-size: 9.5pt; }}
blockquote {{ border-left: 3px solid #e1ddd4; padding-left: 8pt; margin: 6pt 0;
              color: #4a4843; font-style: italic; }}
hr {{ border: 0; border-top: 1px solid #e1ddd4; margin: 12pt 0; }}

.page-break {{ page-break-after: always; }}
"""


# ────────────────────────────────────────────────────────────────────────────
# Public entry point
# ────────────────────────────────────────────────────────────────────────────


def branded_markdown_to_pdf(
    md: str,
    *,
    title: str | None = None,
    brand: BrandConfig | None = None,
    abstract: str | None = None,
) -> bytes:
    """Render markdown → PDF with cover page + header + footer.

    Title is reused from the markdown's first H1 if not provided. Abstract
    is auto-extracted from the first prose paragraph if not provided.
    """
    try:
        from xhtml2pdf import pisa  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "PDF export requires xhtml2pdf. Install via "
            '`pip install "faro-research-pro[server]"` or '
            '`pip install xhtml2pdf`'
        ) from e
    _ensure_cjk_fonts()

    brand = brand or BrandConfig()
    if title is None:
        title = next(
            (line[2:].strip() for line in md.splitlines() if line.startswith("# ")),
            "Untitled report",
        )
    if abstract is None:
        # Skip the H1 line, take from after it
        post_h1 = md.split("\n", 2)
        body = post_h1[2] if len(post_h1) > 2 else md
        abstract = _abstract_from_markdown(body)

    body_html = _markdown_to_html(md)
    logo = brand.logo_data_uri()
    header_brand = (
        f'<img src="{logo}" height="14" /> '
        if logo else ""
    ) + f'<span class="brand">{brand.project_name}</span>'

    full_html = f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<title>{title}</title>
<style>{_build_css(brand)}</style>
</head><body>
<div id="header_content" class="header">
  {header_brand}<span style="float:right">{title}</span>
</div>
<div id="footer_content" class="footer">
  <span class="url">{brand.project_url}</span>
  <span style="float:right">第 <pdf:pagenumber/> 页 / 共 <pdf:pagecount/> 页</span>
</div>
{_cover_html(title=title, abstract=abstract, brand=brand)}
{body_html}
</body></html>
"""

    out = BytesIO()
    result = pisa.CreatePDF(src=full_html, dest=out, encoding="utf-8")
    if result.err:
        raise RuntimeError(f"PDF render failed: {result.err} errors")
    return out.getvalue()


def branded_markdown(md: str, *, title: str | None = None,
                     brand: BrandConfig | None = None) -> str:
    """Markdown variant: prepends a cover/title block in markdown form."""
    brand = brand or BrandConfig()
    title = title or next(
        (line[2:].strip() for line in md.splitlines() if line.startswith("# ")),
        "Untitled report",
    )
    today = _dt.date.today().strftime("%Y-%m-%d")
    cover = "\n".join([
        f"![{brand.project_name}]({brand.project_url})",
        "",
        f"# {title}",
        "",
        f"> **{brand.project_name}** · {brand.tagline}",
        f"> 作者: {brand.author} · 日期: {today}",
        "",
        "---",
        "",
    ])
    if brand.confidential:
        cover += "> ⚠️ **CONFIDENTIAL** — internal research, do not redistribute.\n\n---\n\n"
    # Drop the original H1 if present (we replaced it on cover)
    body_lines = md.splitlines()
    if body_lines and body_lines[0].startswith("# "):
        body_lines = body_lines[1:]
        if body_lines and body_lines[0].strip() == "":
            body_lines = body_lines[1:]
    return cover + "\n".join(body_lines) + (
        f"\n\n---\n\n_Generated by [{brand.project_name}]({brand.project_url})_\n"
    )
