/* Material graph nodes for authored text backed by pinned TrueType faces. */
(function (P) {
  const Fonts = FontResources;
  function resolve(name, resources) {
    if (!Object.hasOwn(resources, name) || !Fonts.valid(resources[name]))
      throw new RangeError('Unknown graph font ' + name);
    return resources[name];
  }

  function render(text, faces, { width = 320, height = 128, color = '#ffffff', edges = 'smooth', ...settings } = {}) {
    const { run, glyphs, layout } = Fonts.layout(text, faces, settings);
    const anchors = {}, commands = [];
    layout.lines.forEach((line, index) => { anchors['line:' + index] = [layout.at[0], line.baseline]; });
    let vertices = 0;
    for (const [index, g] of run.glyphs.entries()) {
      const { x, y } = glyphs[index];
      anchors['glyph:' + index] = [x, y];
      const outline = Typography.outline(run.font, g.char === '\t' ? ' ' : g.char, {
        tolerance: Math.max(1e-5, .125 / g.scale)
      });
      if (outline.length) {
        vertices += outline.reduce((total, ring) => total + ring.length, 0);
        if (vertices > 262144) throw new RangeError('Text exceeds its outline budget');
        const rings = outline.map(ring => ring.map(([u, v]) => [x + u * g.scale, y - v * g.scale]));
        commands.push({ type: 'polygon', rings, fill: color });
      }
    }
    return { value: P.drawing2d.render({ width, height, commands, edges }), layout, anchors };
  }

  const operations = Object.freeze({
    'font.resolve': {
      description: 'Select a named font face from the embedded resources of a published graph.',
      inputs: { name: 'string', resources: 'record' }, outputs: { value: 'fontResource' },
      run({ name, resources }) { return { value: resolve(name, resources) }; }
    },
    'font.stack': {
      description: 'Collect named font resources in the order used for face selection.',
      inputs: { names: 'array<string>', resources: 'record' }, outputs: { value: 'array<fontResource>' },
      run({ names, resources }) {
        if (!names.length || names.length > 32 || new Set(names).size !== names.length)
          throw new RangeError('A font stack needs one to 32 distinct names');
        return { value: names.map(name => resolve(name, resources)) };
      }
    },
    'draw.fontText': {
      description: 'Lay out editable text with selected TrueType faces, ordered fallbacks and native raster coverage.',
      inputs: { text: 'string', faces: 'array<fontResource>', options: { type: 'record', default: {} } },
      outputs: { value: 'raster', layout: 'record', anchors: 'record' },
      run({ text, faces, options }) { return render(text, faces, options); }
    }
  });
  P.fontResources = Object.freeze({ create: Fonts.create, layout: Fonts.layout, render, operations });
})(KIT.procedural);
