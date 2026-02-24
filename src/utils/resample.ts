/**
 * PCM resampler — linear interpolation.
 *
 * Designed for TTS output resampling (24kHz → 16kHz) before Opus encoding.
 * Linear interpolation is adequate for speech; the subsequent Opus encode
 * applies its own bandwidth limiting.
 */

/**
 * Resample int16 LE PCM from srcRate to dstRate.
 * Returns the original buffer unchanged if rates match.
 */
export function resamplePcm(
  input: Buffer,
  srcRate: number,
  dstRate: number,
): Buffer {
  if (srcRate === dstRate) return input;

  const inSamples = input.length / 2;
  const outSamples = Math.floor(inSamples * dstRate / srcRate);
  const output = Buffer.alloc(outSamples * 2);
  const ratio = srcRate / dstRate;

  for (let i = 0; i < outSamples; i++) {
    const srcPos = i * ratio;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;

    const idx0 = Math.min(srcIdx, inSamples - 1);
    const idx1 = Math.min(srcIdx + 1, inSamples - 1);

    const s0 = input.readInt16LE(idx0 * 2);
    const s1 = input.readInt16LE(idx1 * 2);
    const sample = Math.round(s0 + (s1 - s0) * frac);

    output.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }

  return output;
}
