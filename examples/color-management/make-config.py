"""Serialize the OpenColorIO ACES demo config and an original ICC fixture."""
import ctypes as C
import ctypes.util
import os
from pathlib import Path
import sys

import PyOpenColorIO as ocio

root = Path(sys.argv[1])
config = ocio.Config.CreateFromBuiltinConfig("cg-config-v4.0.0_aces-v2.0_ocio-v2.5")
(root / "aces.ocio").write_text(config.serialize())

cms = C.CDLL(os.environ.get("INK_LCMS_LIBRARY") or ctypes.util.find_library("lcms2") or "liblcms2.so.2")


class XY(C.Structure):
    _fields_ = [("x", C.c_double), ("y", C.c_double), ("Y", C.c_double)]


class Primaries(C.Structure):
    _fields_ = [("red", XY), ("green", XY), ("blue", XY)]


def bind(name, result, *args):
    function = getattr(cms, name)
    function.argtypes, function.restype = args, result
    return function


pointer, word = C.c_void_p, C.c_uint32
curve = bind("cmsBuildGamma", pointer, pointer, C.c_double)(None, 2.2)
if not curve:
    raise RuntimeError("Could not construct ICC tone curve")
try:
    profile = bind("cmsCreateRGBProfile", pointer, C.POINTER(XY), C.POINTER(Primaries), C.POINTER(pointer))(
        XY(.3127, .329, 1), Primaries(XY(.68, .32, 1), XY(.265, .69, 1), XY(.15, .06, 1)),
        (pointer * 3)(curve, curve, curve))
finally:
    bind("cmsFreeToneCurve", None, pointer)(curve)
if not profile:
    raise RuntimeError("Could not construct ICC fixture")
try:
    save = bind("cmsSaveProfileToMem", C.c_int, pointer, pointer, C.POINTER(word))
    size = word()
    if not save(profile, None, C.byref(size)):
        raise RuntimeError("Could not size ICC fixture")
    buffer = C.create_string_buffer(size.value)
    if not save(profile, buffer, C.byref(size)):
        raise RuntimeError("Could not serialize ICC fixture")
    (root / "paint-profile.icc").write_bytes(buffer.raw[:size.value])
finally:
    bind("cmsCloseProfile", C.c_int, pointer)(profile)
