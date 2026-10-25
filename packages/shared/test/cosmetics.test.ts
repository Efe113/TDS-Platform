import { describe, expect, it } from 'vitest'
import { FRAME_SKINS, frameSkin, VIP_TITLE_REF, titleEffect } from '../src/domain/cosmetics'

describe('frame registry', () => {
  it('keeps one entry per frame key', () => {
    const keys = FRAME_SKINS.map((frame) => frame.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('gives every signature frame its own animated treatment', () => {
    // The market copy says "animated ring"; without an effect the client would paint a flat circle.
    expect(frameSkin('rainbow')?.effect).toBe('rainbow')
    expect(frameSkin('ember')?.effect).toBe('heat')
    expect(frameSkin('aurora')?.effect).toBe('aurora')
    expect(frameSkin('void')?.effect).toBe('void')
    expect(frameSkin('toxic')?.effect).toBe('toxic')
  })

  it('leaves the plain frame static and resolves unknown keys to null', () => {
    expect(frameSkin('gold')?.effect).toBeUndefined()
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
