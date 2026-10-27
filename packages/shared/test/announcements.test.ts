import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  NOTICE_CHIP_TONES,
  NOTICE_TONES,
  emptyNoticeDraft,
  noticeAdminToDraft,
  noticeDraftErrors,
  noticeDraftPayload,
  noticeIsVisible,
  noticeStateOf,
  parseActiveAnnouncements,
  pickNotices,
  activeAnnouncementSchema,
  type ActiveAnnouncement
} from '../src/index'

/**
 * Announcements (0052) are the shell's other voice, and the shell has one band position. These tests
 * hold the two rules that make that safe: a notice is visible only inside its window and only while the
 * caller has not closed it, and when several are live exactly one wins — the heaviest, not the newest.
 */

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(here, '../../../supabase/migrations/0052_announcements.sql'), 'utf8')

const START = Date.parse('2026-11-01T00:00:00Z')
const END = Date.parse('2026-11-04T00:00:00Z')

function notice(over: Partial<ActiveAnnouncement> = {}): ActiveAnnouncement {
  return activeAnnouncementSchema.parse({
    key: over.key ?? 'repair',
    severity: over.severity ?? 'info',
    surface: over.surface ?? 'banner',
    titleTr: over.titleTr ?? 'Bakiye onarımı',
    titleEn: over.titleEn ?? 'Balance repair',
    shortTr: over.shortTr ?? 'Bu gece bakiyeler düzeltiliyor.',
    shortEn: over.shortEn ?? 'Balances are being repaired tonight.',
    startsAt: over.startsAt ?? new Date(START).toISOString(),
    endsAt: over.endsAt ?? new Date(END).toISOString(),
    updatedAt: over.updatedAt ?? new Date(START).toISOString(),
    state: over.state ?? 'live',
    dismissed: over.dismissed ?? false,
    readAt: over.readAt ?? null,
    ackRequired: over.ackRequired ?? false,
    bodyTr: over.bodyTr ?? null,
    bodyEn: over.bodyEn ?? null,
    imagePath: over.imagePath ?? null,
    actionUrl: over.actionUrl ?? null,
    actionLabelTr: over.actionLabelTr ?? null,
    actionLabelEn: over.actionLabelEn ?? null
  })
}

describe('notice visibility', () => {
  it('counts the window the way the SQL answers it', () => {
    const row = { startsAt: new Date(START).toISOString(), endsAt: new Date(END).toISOString() }
    expect(noticeStateOf(row, START - 1)).toBe('upcoming')
    expect(noticeStateOf(row, START)).toBe('live')
    expect(noticeStateOf(row, END)).toBe('ended')
  })

  it('hides what the member closed and what has passed', () => {
    expect(noticeIsVisible(notice(), START)).toBe(true)
    expect(noticeIsVisible(notice({ dismissed: true }), START)).toBe(false)
    expect(noticeIsVisible(notice(), END + 1)).toBe(false)
  })

  it('announces two days early, like campaigns do', () => {
    const twoDays = 2 * 24 * 60 * 60 * 1000
    expect(noticeIsVisible(notice(), START - twoDays + 60_000)).toBe(true)
    expect(noticeIsVisible(notice(), START - twoDays - 60_000)).toBe(false)
  })
})

describe('the one-band rule', () => {
  it('picks the heaviest notice for the band, not the newest', () => {
    const { band } = pickNotices(
      [
        notice({ key: 'event', severity: 'info', updatedAt: new Date(END).toISOString() }),
        notice({ key: 'delay', severity: 'warn' }),
        notice({ key: 'outage', severity: 'critical', updatedAt: new Date(START - 1000).toISOString() })
      ],
      START
    )
    expect(band?.key).toBe('outage')
  })

  it('gives the modal to a modal and the band to a band', () => {
    const picked = pickNotices([notice({ key: 'note', severity: 'critical', surface: 'banner' }), notice({ key: 'story', severity: 'info', surface: 'modal' })], START)
    expect(picked.band?.key).toBe('note')
    expect(picked.modal?.key).toBe('story')
  })

  it('never stacks two of a kind, and breaks a tie by the edit', () => {
    const picked = pickNotices(
      [
        notice({ key: 'older', severity: 'warn', updatedAt: new Date(START).toISOString() }),
        notice({ key: 'newer', severity: 'warn', updatedAt: new Date(START + 5000).toISOString() })
      ],
      START + 60_000
    )
    expect(picked.band?.key).toBe('newer')
    expect(picked.modal).toBeNull()
  })

  it('drops a dismissed notice out of both slots', () => {
    const picked = pickNotices([notice({ dismissed: true }), notice({ key: 'm', surface: 'modal', dismissed: true })], START)
    expect(picked).toEqual({ band: null, modal: null })
  })
})

describe('the tone tables', () => {
  it('sends critical to the danger tone in both vocabularies', () => {
    expect(NOTICE_TONES.critical).toBe('danger')
    expect(NOTICE_CHIP_TONES.critical).toBe('danger')
    expect(NOTICE_CHIP_TONES.info).toBe('brand')
    // Banner speaks `info` where Chip speaks `brand`; the two maps exist because the scales differ.
    expect(NOTICE_TONES.info).toBe('info')
  })
})

describe('the notice draft', () => {
  const good = {
    ...emptyNoticeDraft('balance-repair'),
    titleTr: 'Bakiye onarımı',
    titleEn: 'Balance repair',
    shortTr: 'Bu gece bakiyeler düzeltiliyor, yeniden giriş gerekmez.',
    shortEn: 'Balances are repaired tonight; no re-login needed.',
    startsAt: new Date(START).toISOString(),
    endsAt: new Date(END).toISOString()
  }

  it('accepts a plain band notice', () => {
    expect(noticeDraftErrors(good, START - 1000)).toEqual([])
  })

  it('refuses a modal that has nothing to say', () => {
    expect(noticeDraftErrors({ ...good, surface: 'modal' }, START)).toContain('admin.notice.errModalEmpty')
    expect(noticeDraftErrors({ ...good, surface: 'modal', bodyTr: 'Ayrıntı' }, START)).toEqual([])
    expect(noticeDraftErrors({ ...good, surface: 'modal', imagePath: 'notices/x.webp' }, START)).toEqual([])
  })

  it('names the window mistakes and the link rules', () => {
    expect(noticeDraftErrors({ ...good, endsAt: good.startsAt }, START)).toContain('admin.notice.errOrder')
    expect(noticeDraftErrors(good, END + 1000)).toContain('admin.notice.errPast')
    expect(noticeDraftErrors({ ...good, startsAt: '' }, START)).toContain('admin.notice.errWindow')
    expect(noticeDraftErrors({ ...good, key: 'Başlık Alanı' }, START)).toContain('admin.notice.errKey')
    expect(noticeDraftErrors({ ...good, shortEn: ' ' }, START)).toContain('admin.notice.errShort')
    expect(noticeDraftErrors({ ...good, titleTr: '' }, START)).toContain('admin.notice.errTitle')
    expect(noticeDraftErrors({ ...good, actionUrl: 'ftp://x' }, START)).toContain('admin.notice.errAction')
    expect(noticeDraftErrors({ ...good, actionUrl: 'tdsapp://wallet', actionLabelTr: 'Cüzdana git', actionLabelEn: 'Open the wallet' }, START)).toEqual([])
    expect(noticeDraftErrors({ ...good, actionUrl: 'https://tds.dev' }, START)).toContain('admin.notice.errActionLabel')
  })

  it('sends nulls instead of empty strings', () => {
    const payload = noticeDraftPayload({ ...good, bodyTr: '  ', actionUrl: '', actionLabelTr: '', actionLabelEn: ' ' })
    expect(payload.p_key).toBe('balance-repair')
    expect(payload.p_body_tr).toBeNull()
    expect(payload.p_action_url).toBeNull()
    expect(payload.p_action_label_en).toBeNull()
  })

  it('reads a row back into the form', () => {
    const draft = noticeAdminToDraft({ ...notice({ severity: 'warn', ackRequired: true, bodyTr: 'metin' }), enabled: false, readCount: 3, dismissCount: 1 })
    expect(draft.severity).toBe('warn')
    expect(draft.ackRequired).toBe(true)
    expect(draft.enabled).toBe(false)
    expect(draft.bodyTr).toBe('metin')
    expect(noticeDraftErrors(draft, START)).toEqual([])
  })

  it('skips a malformed row instead of losing the shelf', () => {
    expect(parseActiveAnnouncements(null)).toEqual([])
    expect(parseActiveAnnouncements([{ key: 2 }])).toEqual([])
    expect(parseActiveAnnouncements([notice(), { key: 2 }])).toHaveLength(1)
  })
})

describe('the announcement server contract (0052)', () => {
  it('restricts severity, surface, window and link in the database', () => {
    expect(sql).toContain("check (severity in ('info', 'warn', 'critical'))")
    expect(sql).toContain("check (surface in ('banner', 'modal'))")
    expect(sql).toContain('constraint announcements_window_check check (ends_at > starts_at)')
    expect(sql).toContain("check (action_url is null or action_url ~ '^(https://|tdsapp://)')")
  })

  it('keeps a notice out of the money tables', () => {
    // A notice informs. If it could carry earning terms, an operator would be writing economics into prose.
    expect(sql).not.toMatch(/campaign_rules|currency_rules/)
    expect(sql).toContain('public.announcements')
    expect(sql).not.toMatch(/create table if not exists public\.events/)
    expect(sql).not.toMatch(/create table if not exists public\.campaigns/)
  })

  it('remembers the dismissal per account and cascades it away', () => {
    expect(sql).toContain('create table if not exists public.announcement_reads')
    expect(sql).toContain('announcement_key text not null references public.announcements (key) on delete cascade')
    expect(sql).toContain('user_id uuid not null references public.profiles (id) on delete cascade')
    expect(sql).toContain('primary key (announcement_key, user_id)')
    expect(sql).toContain("check (state in ('read', 'dismissed'))")
  })

  it('answers the caller their own state and orders by weight', () => {
    const reader = sql.slice(sql.indexOf('create or replace function public.active_announcements()'))
    const body = reader.slice(0, reader.indexOf('$$;\n'))
    expect(body).toContain("'dismissed', exists")
    expect(body).toContain("'ackRequired', a.ack_required")
    expect(body).toContain("'readAt'")
    expect(body).toContain("case a.severity when 'critical' then 0 when 'warn' then 1 else 2 end")
    expect(body).toContain("interval '2 days'")
  })

  it('records an anonymous click honestly instead of pretending', () => {
    const marker = sql.slice(sql.indexOf('create or replace function public.mark_announcement'))
    const body = marker.slice(0, marker.indexOf('$$;\n'))
    expect(body).toContain("return jsonb_build_object('key', p_key, 'recorded', false)")
    expect(body).toContain("raise exception 'INVALID_STATE: use read or dismissed'")
    expect(body).toContain('on conflict (announcement_key, user_id) do update')
  })

  it('makes an edited notice a different notice', () => {
    expect(sql).toContain('create or replace function app.touch_announcements()')
    expect(sql).toContain('new.updated_at := now();')
    expect(sql).toContain('create trigger announcements_touch before update on public.announcements')
    // The trigger keeps its default privileges: revoking EXECUTE here would break the first save.
    expect(sql).not.toMatch(/revoke execute on function app\.touch_announcements/)
  })

  it('refuses a modal with neither story nor picture', () => {
    const upsert = sql.slice(sql.indexOf('create or replace function public.admin_upsert_announcement'))
    const body = upsert.slice(0, upsert.indexOf('$$;\n'))
    expect(body).toContain("raise exception 'INVALID_MODAL")
    expect(body).toContain("raise exception 'INVALID_SEVERITY")
    expect(body).toContain('if not app.is_admin()')
  })

  it('lets visitors read but not write', () => {
    expect(sql).toContain("execute 'grant execute on function public.active_announcements() to anon'")
    expect(sql).toContain("'public.mark_announcement(text, text)'")
    expect(sql).toContain("revoke all on table public.%I from public, anon, authenticated")
  })

  it('proves the reader ships what the shell draws', () => {
    expect(sql).toContain("raise exception '0052 failed: the reader lost the caller''s dismissal state'")
    expect(sql).toContain("raise exception '0052 failed: the reader lost ack_required'")
    expect(sql).toContain("raise notice '0052 ok:")
  })
})
