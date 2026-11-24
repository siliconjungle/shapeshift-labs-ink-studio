/* Native indexed shape coverage shared by the document tools and stamp editor. */
(function (K) {
  const drawing = K.procedural.drawing2d, { segment,staircase,insideEllipse } = PixelPaintTools;
  const integer = (n,lo,hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const schema = new Map([
    ['line',['from','to','width']], ['curve',['points','width']],
    ['rect',['rect','fill','width']], ['ellipse',['rect','fill','width']],
    ['polygon',['points','fill','width']], ['text',['at','text','scale','tracking','leading','align','columns']],
    ['staircase',['from','axis','direction','lengths']]
  ]);

  function raster(width,height,shape,grid) {
    const allowed = schema.get(shape?.type);
    if (!allowed || Object.getPrototypeOf(shape) !== Object.prototype ||
        Object.keys(shape).some(key => key !== 'type' && !allowed.includes(key)))
      throw new TypeError('Choose a native line, curve, rectangle, ellipse, polygon, text or staircase');
    if (!integer(width,1,512) || !integer(height,1,512))
      throw new RangeError('Pixel shapes need a canvas from 1 to 512 pixels on each axis');
    const { type,width:lineWidth = 1,fill = true } = shape;
    if (!integer(lineWidth,1,32) || typeof fill !== 'boolean')
      throw new RangeError('Pixel shape width must be a whole pixel count and fill must be boolean');
    const mask = new Uint8Array(width*height);
    const point = grid?.contains ?? (value => Array.isArray(value) && value.length === 2 &&
      integer(value[0],0,width-1) && integer(value[1],0,height-1));
    const validatePoints = (points,lo,hi) => {
      if (!Array.isArray(points) || !integer(points.length,lo,hi) || !Array.from(points).every(value=>point(value)))
        throw new RangeError('Pixel shape needs a valid number of in-bounds integer points');
    };

    const write = grid ? (x,y)=>grid.pixels(x,y,p=>{ mask[p] = 1; }) : (x,y)=>{ mask[y*width+x] = 1; };
    function block(x,y,w,h) {
      if (grid) {
        for (let v = y; v < y+h; v++) for (let u = x; u < x+w; u++) write(u,v);
        return;
      }
      const left = Math.max(0,x), right = Math.min(width,x+w);
      for (let row = Math.max(0,y); row < Math.min(height,y+h); row++)
        if (right > left) mask.fill(1,row*width+left,row*width+right);
    }
    function path(points,weight) {
      if (grid) {
        const steps = points.reduce((sum,[x,y],i)=>i ?
          sum+Math.max(Math.abs(x-points[i-1][0]),Math.abs(y-points[i-1][1])) : 1,0);
        if (steps*weight*weight > 8e6) throw new RangeError('Pixel shape exceeds its native drawing budget');
      }
      const inset = Math.floor((weight-1)/2), dab = (x,y) => block(x-inset,y-inset,weight,weight);
      dab(...points[0]);
      for (let i = 1; i < points.length; i++) segment(points[i-1],points[i],dab);
    }

    if (type === 'line') {
      const points = [shape.from,shape.to];
      validatePoints(points,2,2);
      path(points,lineWidth);
    } else if (type === 'curve') {
      const { points } = shape;
      validatePoints(points,3,4);
      const [start,...controls] = points;
      const length = controls.reduce((sum,[x,y],i) => sum+Math.hypot(x-points[i][0],y-points[i][1]),0);
      const steps = Math.max(8,Math.min(64,Math.ceil(length)));
      const curve = drawing.path('M '+start.join(' ')+' '+(points.length === 3 ? 'Q ' : 'C ')+controls.flat().join(' '),{ steps });
      path(curve.points.map(([x,y]) => [Math.round(x),Math.round(y)]),lineWidth);
    } else if (type === 'rect' || type === 'ellipse') {
      const { rect } = shape;
      if (!Array.isArray(rect) || rect.length !== 4 || !point(rect.slice(0,2)) ||
          !integer(rect[2],1,grid?.wrapX ? Math.max(512,width*3) : 512) ||
          !integer(rect[3],1,grid?.wrapY ? Math.max(512,height*3) : 512))
        throw new RangeError('Pixel rectangle or ellipse needs an integer origin and positive size');
      const [x,y,w,h] = rect;
      if (type === 'rect' && fill) block(x,y,w,h);
      else for (let v = 0; v < (grid ? h : Math.min(h,height-y)); v++)
        for (let u = 0; u < (grid ? w : Math.min(w,width-x)); u++) {
          const outer = type === 'rect' || insideEllipse(u,v,w,h);
          const inset = Math.min(u,v,w-1-u,h-1-v) >= lineWidth;
          const inner = inset && (type === 'rect' || insideEllipse(u-lineWidth,v-lineWidth,w-2*lineWidth,h-2*lineWidth));
          if (outer && (fill || !inner)) write(x+u,y+v);
        }
    } else if (type === 'polygon') {
      const { points } = shape;
      validatePoints(points,3,128);
      if (fill) {
        const xs = points.map(p=>p[0]), ys = points.map(p=>p[1]);
        const left = grid ? Math.min(...xs) : 0, top = grid ? Math.min(...ys) : 0;
        const w = grid ? Math.max(...xs)-left+1 : width, h = grid ? Math.max(...ys)-top+1 : height;
        const svgPoints = points.map(([x,y]) => [x-left+.5,y-top+.5]);
        const image = drawing.render({ width:w,height:h,edges:'hard',
          commands:[{ type:'polygon',points:svgPoints,fill:'#ffffff' }] });
        for (let p = 0; p < w*h; p++)
          if (image.data[4*p+3]) write(left+p%w,top+Math.floor(p/w));
      }
      path([...points,points[0]],fill ? 1 : lineWidth);
    } else if (type === 'text') {
      if (!point(shape.at)) throw new RangeError('Bitmap text needs an in-bounds native anchor');
      const [x,y] = shape.at, { value } = drawing.text(shape.text,shape);
      const w = grid ? value.width : Math.min(value.width,width-x);
      const h = grid ? value.height : Math.min(value.height,height-y);
      for (let v = 0; v < h; v++) for (let u = 0; u < w; u++)
        if (value.data[(v*value.width+u)*4+3]) write(x+u,y+v);
    } else {
      for (const bounds of staircase(width,height,shape,grid)) block(...bounds);
    }
    return mask;
  }

  K.pixelShapes = Object.freeze({ raster });
})(KIT);
