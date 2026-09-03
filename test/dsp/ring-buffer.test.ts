import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../../src/core/dsp/ring-buffer';

describe('RingBuffer', () => {
  it('pushes and shifts samples in FIFO order', () => {
    const rb = new RingBuffer(16);
    rb.push(new Float32Array([1, 2, 3]));
    rb.push(new Float32Array([4, 5]));

    expect(rb.available).toBe(5);
    expect(Array.from(rb.shift(3))).toEqual([1, 2, 3]);
    expect(rb.available).toBe(2);
    expect(Array.from(rb.shift(2))).toEqual([4, 5]);
    expect(rb.available).toBe(0);
  });

  it('wraps around the underlying array correctly', () => {
    const rb = new RingBuffer(4);
    rb.push(new Float32Array([1, 2, 3]));
    rb.shift(2); // consume 2, freeing space at the front
    rb.push(new Float32Array([4, 5])); // wraps past the end of the buffer

    expect(Array.from(rb.shift(3))).toEqual([3, 4, 5]);
  });

  it('peek does not consume data', () => {
    const rb = new RingBuffer(8);
    rb.push(new Float32Array([10, 20, 30]));

    expect(Array.from(rb.peek(2))).toEqual([10, 20]);
    expect(rb.available).toBe(3); // unchanged by peek

    expect(Array.from(rb.shift(2))).toEqual([10, 20]);
    expect(rb.available).toBe(1);
  });

  it('throws on overflow', () => {
    const rb = new RingBuffer(2);
    expect(() => rb.push(new Float32Array([1, 2, 3]))).toThrow(RangeError);
  });

  it('throws on underflow', () => {
    const rb = new RingBuffer(4);
    rb.push(new Float32Array([1]));
    expect(() => rb.shift(2)).toThrow(RangeError);
  });

  it('reports freeSpace accurately after churn', () => {
    const rb = new RingBuffer(10);
    rb.push(new Float32Array(6));
    rb.shift(4);
    rb.push(new Float32Array(4));

    expect(rb.available).toBe(6);
    expect(rb.freeSpace).toBe(4);
  });
});
