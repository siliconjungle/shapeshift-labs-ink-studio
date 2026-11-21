import { createLtcDecoder } from './clocks.mjs';

class InkLtcProcessor extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.decoder = createLtcDecoder({ ...processorOptions, sampleRate });
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) for (const frame of this.decoder.push(channel)) this.port.postMessage(frame);
    return true;
  }
}
registerProcessor('ink-ltc', InkLtcProcessor);
