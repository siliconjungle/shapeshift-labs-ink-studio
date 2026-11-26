"""Ink's binary bridge to the OpenColorIO and Little CMS CPU processors."""
import base64
import ctypes as C
import ctypes.util
import json
import os
import struct
import sys


def response(metadata, data=b""):
    header = json.dumps(metadata, allow_nan=False).encode()
    sys.stdout.buffer.write(struct.pack("<I", len(header)) + header)
    sys.stdout.buffer.write(data)


def lc_profile_to_linear(icc, pixels, intent):
    import numpy as np

    library = os.environ.get("INK_LCMS_LIBRARY") or ctypes.util.find_library("lcms2")
    if not library:
        raise RuntimeError("Install Little CMS 2 or set INK_LCMS_LIBRARY to convert embedded ICC profiles")
    cms = C.CDLL(library)

    class XY(C.Structure):
        _fields_ = [("x", C.c_double), ("y", C.c_double), ("Y", C.c_double)]

    class Primaries(C.Structure):
        _fields_ = [("red", XY), ("green", XY), ("blue", XY)]

    def bind(name, result, *args):
        fn = getattr(cms, name)
        fn.argtypes, fn.restype = args, result
        return fn

    ptr, word = C.c_void_p, C.c_uint32
    open_profile = bind("cmsOpenProfileFromMem", ptr, ptr, word)
    close_profile = bind("cmsCloseProfile", C.c_int, ptr)
    profile_space = bind("cmsGetColorSpace", word, ptr)
    curve = bind("cmsBuildGamma", ptr, ptr, C.c_double)
    free_curve = bind("cmsFreeToneCurve", None, ptr)
    create_profile = bind("cmsCreateRGBProfile", ptr, C.POINTER(XY), C.POINTER(Primaries), C.POINTER(ptr))
    create = bind("cmsCreateTransform", ptr, ptr, word, ptr, word, word, word)
    execute = bind("cmsDoTransform", None, ptr, ptr, ptr, word)
    release = bind("cmsDeleteTransform", None, ptr)

    encoded = C.create_string_buffer(base64.b64decode(icc, validate=True))
    source = open_profile(encoded, len(encoded) - 1)
    if not source:
        raise ValueError("Little CMS could not open the embedded ICC profile")
    try:
        signature = profile_space(source)
        if signature == 0x47524159:
            source_lanes, space = 1, 3
            pixels = np.ascontiguousarray(pixels[:, :1])
        elif signature == 0x52474220:
            source_lanes, space = 3, 4
        else:
            raise ValueError("Ink requires an RGB or grayscale ICC profile")
        gamma = curve(None, 1.0)
        if not gamma:
            raise RuntimeError("Little CMS could not build linear tone curves")
        try:
            target = create_profile(XY(.3127, .3290, 1),
                                    Primaries(XY(.64, .33, 1), XY(.30, .60, 1), XY(.15, .06, 1)),
                                    (ptr * 3)(gamma, gamma, gamma))
        finally:
            free_curve(gamma)
        if not target:
            raise RuntimeError("Little CMS could not build its linear Rec.709 profile")
        try:
            mode = lambda encoding, channels: (1 << 22) | (encoding << 16) | (channels << 3) | 4
            handle = create(source, mode(space, source_lanes), target, mode(4, 3), intent, 0x0100)
            if not handle:
                raise ValueError("Little CMS could not convert the embedded ICC profile")
            try:
                destination = np.empty((len(pixels), 3), dtype=np.float32)
                execute(handle, pixels.ctypes.data, destination.ctypes.data, len(pixels))
                return destination
            finally:
                release(handle)
        finally:
            close_profile(target)
    finally:
        close_profile(source)


def dependencies(ocio, config, context):
    paths = set()

    def visit(transform):
        if isinstance(transform, ocio.GroupTransform):
            for child in transform:
                visit(child)
        elif isinstance(transform, ocio.FileTransform):
            try:
                paths.add(context.resolveFileLocation(transform.getSrc()))
            except ocio.Exception:
                # OCIO reports missing files when compiling a processor that actually uses them.
                pass

    for space in config.getColorSpaces(ocio.SEARCH_REFERENCE_SPACE_ALL, ocio.COLORSPACE_ALL):
        visit(space.getTransform(ocio.COLORSPACE_DIR_TO_REFERENCE))
        visit(space.getTransform(ocio.COLORSPACE_DIR_FROM_REFERENCE))
    for name in config.getLookNames():
        look = config.getLook(name)
        visit(look.getTransform())
        visit(look.getInverseTransform())
    for name in config.getViewTransformNames():
        view = config.getViewTransform(name)
        visit(view.getTransform(ocio.VIEWTRANSFORM_DIR_TO_REFERENCE))
        visit(view.getTransform(ocio.VIEWTRANSFORM_DIR_FROM_REFERENCE))
    for name in config.getNamedTransformNames():
        transform = config.getNamedTransform(name)
        visit(transform.getTransform(ocio.TRANSFORM_DIR_FORWARD))
        visit(transform.getTransform(ocio.TRANSFORM_DIR_INVERSE))
    return sorted(paths)


def main():
    import numpy as np
    import PyOpenColorIO as ocio

    stream = sys.stdin.buffer
    size = struct.unpack("<I", stream.read(4))[0]
    if size > 8 * 1024**2:
        raise ValueError("Color management request exceeds its header budget")
    request = json.loads(stream.read(size))
    config = ocio.Config.CreateFromFile(request["config"])
    context = config.getCurrentContext()
    for name, value in request["context"].items():
        context.setStringVar(name, value)

    def space(name):
        if config.hasRole(name):
            name = config.getRoleColorSpace(name)
        resolved = config.getColorSpace(name)
        if resolved is None or resolved.isData():
            raise ValueError("Choose a color space or role in the OCIO config: " + name)
        return resolved.getName()

    if request["action"] == "inspect":
        config.validate()
        working = space(request["working"] or ocio.ROLE_SCENE_LINEAR)
        ink = space(request["inkLinear"])
        for label in [working, ink]:
            encoding = config.getColorSpace(label).getEncoding()
            if encoding and encoding not in ("scene-linear", "linear"):
                raise ValueError("Working and Ink spaces must use scene-linear encoding: " + label)
        displays = {name: list(config.getViews(name)) for name in config.getDisplays()}
        display = request["display"] or config.getDefaultDisplay()
        view = request["view"] or config.getDefaultView(display)
        if view not in displays.get(display, []):
            raise ValueError("Invalid OCIO display/view: " + display + " / " + view)
        for value in request["sources"].values():
            space(value)
        response({"version": ocio.GetVersion(), "cacheId": config.getCacheID(context),
                  "working": working, "inkLinear": ink, "display": display, "view": view,
                  "spaces": sorted(str(s.getName()) for s in config.getColorSpaces() if not s.isData()),
                  "displays": displays, "dependencies": dependencies(ocio, config, context)})
        return

    count = request["pixels"]
    if count < 1 or count * 12 > 128 * 1024**2:
        raise ValueError("Managed pixels exceed the buffer budget")
    raw = stream.read(count * 12 + 1)
    if len(raw) != count * 12:
        raise ValueError("Color management payload has the wrong length")
    rgb = np.frombuffer(raw, dtype="<f4").astype(np.float32, copy=True).reshape((-1, 3))
    if request.get("icc"):
        rgb = lc_profile_to_linear(request["icc"], rgb, request["intent"])
    keys = []
    for stage in request["stages"]:
        src = space(stage["src"])
        if "dst" in stage:
            transform = ocio.ColorSpaceTransform(src=src, dst=space(stage["dst"]))
        else:
            transform = ocio.DisplayViewTransform(src=src, display=stage["display"], view=stage["view"])
        processor = config.getProcessor(context, transform, ocio.TRANSFORM_DIR_FORWARD)
        if stage.get("exposure", 0):
            rgb *= 2 ** stage["exposure"]
        processor.getDefaultCPUProcessor().applyRGB(rgb)
        keys.append(processor.getCacheID())
    if not np.all(np.isfinite(rgb)):
        raise ValueError("The color processor returned nonfinite samples")
    response({"processors": keys}, rgb.astype("<f4", copy=False).tobytes())


if __name__ == "__main__":
    try:
        main()
    except ModuleNotFoundError as error:
        sys.exit("Install OpenColorIO and NumPy in the chosen Python environment: " + str(error))
    except (ValueError, RuntimeError, OSError) as error:
        sys.exit(str(error))
