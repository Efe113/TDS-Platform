import { THEME_KEYS, type ThemeKey, type WalletItem } from '@tds/shared'
import type { MessageKey } from '../i18n/resources'

export const SKIN_NAME_KEYS: Record<ThemeKey, MessageKey> = {
  default: 'theme.name.default',
  ember: 'theme.name.ember',
  toxic: 'theme.name.toxic',
  aurora: 'theme.name.aurora',
  void: 'theme.name.void'
}

export interface SkinRow {
  key: ThemeKey
  /** The spend sku when the server sells this skin; null for the free default, which has no price row. */
  sku: string | null
  price: number | null
  owned: boolean
}

/**
 * The pickers list every registry skin, not only the rows the server happens to sell. The default has
 * no spend_catalog row at all (nothing to buy), so a wallet-driven list could never equip it back -
 * and a skin the database does not know yet still shows, just without a price.
 */
export function skinRows(catalog: readonly WalletItem[]): SkinRow[] {
  const byKey = new Map<string, WalletItem>()
  for (const item of catalog) {
    if (item.kind === 'theme' && item.refCode) byKey.set(item.refCode, item)
  }

  return THEME_KEYS.map((key) => {
    const item = byKey.get(key)
    return {
      key,
      sku: item?.sku ?? null,
      price: item?.price ?? null,
      owned: key === 'default' || (item?.owned ?? false)
    }
  })
}
