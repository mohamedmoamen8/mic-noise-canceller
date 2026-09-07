import { describe, expect, it } from 'vitest';

function describeClassification(classification: 'quiet' | 'moderate' | 'noisy'): string {
  switch (classification) {
    case 'quiet':
      return 'Quiet room — light suppression will do';
    case 'moderate':
      return 'Some background noise — moderate suppression recommended';
    case 'noisy':
      return 'Noisy environment — strong suppression recommended';
  }
}

describe('describeClassification', () => {
  it('returns the quiet string', () => {
    expect(describeClassification('quiet')).toBe('Quiet room — light suppression will do');
  });

  it('returns the moderate string', () => {
    expect(describeClassification('moderate')).toBe('Some background noise — moderate suppression recommended');
  });

  it('returns the noisy string', () => {
    expect(describeClassification('noisy')).toBe('Noisy environment — strong suppression recommended');
  });
});
