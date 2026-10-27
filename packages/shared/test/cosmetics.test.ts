import { describe, expect, it } from 'vitest'
import { FRAME_SKINS, frameSkin, VIP_TITLE_REF, titleEffect, type FrameLayerKey } from '../src/domain/cosmetics'

const LAYER_ORDER: FrameLayerKey[] = ['halo', 'core', 'spin', 'spark', 'mark']

describe('frame registry', () => {
  it('keeps one entry per frame key', () => {
    const keys = FRAME_SKINS.map((frame) => frame.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('gives every frame its own animated treatment', () => {
    // 0.3.5: there is no static frame any more. The shelf copy promises five surfaces, and a flat
    // glowing circle would be caught out by the first person to read it.
    for (const frame of FRAME_SKINS) {
      expect(frameSkin(frame.key)?.effect, `${frame.key} effect`).toBe(frame.effect)
    }
    expect(frameSkin('rainbow')?.effect).toBe('rainbow')
    expect(frameSkin('ember')?.effect).toBe('heat')
    expect(frameSkin('aurora')?.effect).toBe('aurora')
    expect(frameSkin('void')?.effect).toBe('void')
    expect(frameSkin('toxic')?.effect).toBe('toxic')
    expect(frameSkin('gold')?.effect).toBe('gold')
  })

  /**
   * The five-layer rule is the product: `halo` lights the page, `core` is the body, `spin` is the
   * travelling light, `spark` is the particulate, `mark` is the signature. Order is paint order, and
   * the shelf lists the names in it, so a frame that skips one is a frame that lies about its price.
   */
  it('builds every frame from exactly five named surfaces', () => {
    for (const frame of FRAME_SKINS) {
      expect(frame.layers.map((layer) => layer.key), `${frame.key} layers`).toEqual(LAYER_ORDER)
      for (const layer of frame.layers) {
        expect(layer.labelTr.trim().length, `${frame.key}.${layer.key} tr`).toBeGreaterThan(2)
        expect(layer.labelEn.trim().length, `${frame.key}.${layer.key} en`).toBeGreaterThan(2)
      }
    }
  })

  it('tempo-stamps the frames so no two turn at the same rate', () => {
    const turns = FRAME_SKINS.map((frame) => frame.turnSeconds)
    expect(new Set(turns).size).toBe(turns.length)
    for (const frame of FRAME_SKINS) {
      expect(frame.turnSeconds, `${frame.key} turn`).toBeGreaterThan(0)
    }
  })

  it('resolves unknown keys to null', () => {
    expect(frameSkin('neon')).toBeNull()
    expect(frameSkin(null)).toBeNull()
  })
})

describe('title effects', () => {
  it('marks the VIP title for the rainbow treatment', () => {
    expect(titleEffect(VIP_TITLE_REF)).toBe('vip-rainbow')
  })

  it('leaves ordinary and missing titles plain', () => {
    expect(titleEffect('founder')).toBeNull()
    expect(titleEffect(null)).toBeNull()
    expect(titleEffect(undefined)).toBeNull()
  })
})
