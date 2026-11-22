/* Copy mutable DSP state while leaving configuration and scratch space in place. */
(function (P) {
  P.audioCheckpoint=(process,...cells)=>Object.assign(process,{
    snapshot:()=>cells.map(cell=>ArrayBuffer.isView(cell) ? cell.slice() : {...cell}),
    restore(values) {
      for (const [i,cell] of cells.entries()) {
        if (ArrayBuffer.isView(cell)) cell.set(values[i]);
        else Object.assign(cell,values[i]);
      }
    }
  });
})(KIT.procedural);
