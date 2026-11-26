"""Regenerate the original Night Marks TrueType fallback with FontTools."""
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen


def make_glyph(draw=None):
    pen = TTGlyphPen(None)
    if draw:
        draw(pen)
    return pen.glyph()


def crescent(pen):
    pen.moveTo((470, 710))
    pen.qCurveTo((70, 665), (58, 369), (143, 144), (366, 102))
    pen.qCurveTo((505, 70), (617, 203))
    pen.qCurveTo((373, 160), (258, 324))
    pen.qCurveTo((186, 552), (470, 710))
    pen.closePath()


def compass(pen):
    outline = [
        (345, 754), (390, 456), (614, 586), (451, 393), (665, 362),
        (451, 331), (614, 138), (390, 268), (345, -30), (300, 268),
        (76, 138), (239, 331), (25, 362), (239, 393), (76, 586), (300, 456),
    ]
    pen.moveTo(outline[0])
    for point in outline[1:]:
        pen.lineTo(point)
    pen.closePath()


glyphs = {".notdef": make_glyph(), "space": make_glyph(), "crescent": make_glyph(crescent), "compass": make_glyph(compass)}
font = FontBuilder(1000, isTTF=True)
font.setupGlyphOrder(list(glyphs))
font.setupCharacterMap({32: "space", 0x263E: "crescent", 0x2736: "compass"})
font.setupGlyf(glyphs)
font.setupHorizontalMetrics({name: (700 if name != "space" else 260, glyph.xMin if glyph.numberOfContours else 0)
                             for name, glyph in glyphs.items()})
font.setupHorizontalHeader(ascent=830, descent=-170)
font.setupNameTable({"familyName": "Night Marks", "styleName": "Regular", "uniqueFontIdentifier": "InkStudio-NightMarks",
                     "fullName": "Night Marks Regular", "psName": "NightMarks-Regular", "version": "Version 1.0"})
font.setupOS2(sTypoAscender=830, sTypoDescender=-170, usWinAscent=830, usWinDescent=170)
font.setupPost()
font.font.recalcTimestamp = False
font.font["head"].created = font.font["head"].modified = 3800000000
font.save(Path(__file__).with_name("NightMarks.ttf"))
