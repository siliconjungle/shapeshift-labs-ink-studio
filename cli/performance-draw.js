const { AsyncLocalStorage } = require('node:async_hooks');

const scope = new AsyncLocalStorage();

async function measure(render) {
  const trace = { passes: [], omitted: 0 };
  const result = await scope.run(trace, render);
  return { result, trace };
}

function pass(row) {
  const trace = scope.getStore();
  if (!trace) return;
  if (trace.passes.length < 64) trace.passes.push(row);
  else trace.omitted++;
}

module.exports = { measure, pass, active: () => Boolean(scope.getStore()) };
