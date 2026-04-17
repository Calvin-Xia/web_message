import { describe, expect, it, vi } from 'vitest';
import { CAMPUS_MAP_DATA_ERROR_MESSAGE, readCampusMapResponse } from '../src/shared/campusMapResponse.js';

describe('campus map response helper', () => {
  it('rejects non-ok responses before parsing the response body', async () => {
    const response = {
      ok: false,
      json: vi.fn(async () => {
        throw new Error('HTML parse should not happen');
      }),
    };

    await expect(readCampusMapResponse(response)).rejects.toThrow(CAMPUS_MAP_DATA_ERROR_MESSAGE);
    expect(response.json).not.toHaveBeenCalled();
  });

  it('normalizes invalid JSON and invalid payload shapes to a domain error', async () => {
    await expect(readCampusMapResponse({
      ok: true,
      json: vi.fn(async () => {
        throw new SyntaxError('Unexpected token <');
      }),
    })).rejects.toThrow(CAMPUS_MAP_DATA_ERROR_MESSAGE);

    await expect(readCampusMapResponse({
      ok: true,
      json: vi.fn(async () => ({ features: [], bbox: null })),
    })).rejects.toThrow(CAMPUS_MAP_DATA_ERROR_MESSAGE);
  });

  it('returns valid campus map payloads', async () => {
    const payload = {
      version: 1,
      bbox: [114.3, 30.49, 114.39, 30.57],
      features: [],
    };

    await expect(readCampusMapResponse({
      ok: true,
      json: vi.fn(async () => payload),
    })).resolves.toBe(payload);
  });
});
