import { describe, expect, it } from 'vitest'
import {
  discussionErrorKey,
  discussionSchema,
  formatRating,
  isCommentBodyValid,
  isTakedownStatementValid,
  moderationQueueSchema,
  rateResultSchema,
  reportResultSchema,
  voteResultSchema,
  voteScore
} from '../src/domain/social'

const TOP = '7d9e0b1a-2f3c-4a5b-8c9d-0e1f2a3b4c5d'
const REPLY = '1a2b3c4d-5e6f-4a5b-8c9d-0e1f2a3b4c5d'
const STRATEGY = '50857675-9030-4464-a38c-e21c1ff31a42'

describe('discussion contract', () => {
  it('parses the thread list_comments returns, including the kill switches and my score', () => {
    const parsed = discussionSchema.parse({
      strategyId: STRATEGY,
      total: 2,
      ratingsEnabled: true,
      commentsEnabled: true,
      ratingAvg: 4.5,
      ratingCount: 3,
      myScore: 5,
      items: [
        {
          id: TOP,
          body: 'İki kule yetiyor.',
          deleted: false,
          createdAt: '2026-10-22T18:00:00Z',
          authorId: REPLY,
          authorHandle: 'efe',
          authorDisplayName: 'Efe',
          mine: true,
          up: 4,
          down: 1,
          myVote: 'up',
          replies: [
            {
              id: REPLY,
              body: null,
              deleted: true,
              createdAt: '2026-10-22T18:05:00Z',
              authorId: TOP,
              authorHandle: 'mod',
              authorDisplayName: null,
              mine: false,
              up: 0,
              down: 0,
              myVote: null
            }
          ]
        }
      ]
    })

    expect(parsed.items[0]?.replies[0]?.deleted).toBe(true)
    expect(parsed.items[0]?.replies[0]?.body).toBeNull()
    expect(voteScore(parsed.items[0] ?? { up: 0, down: 0 })).toBe(3)
  })

  it('does not invent flags or a rating the server did not send', () => {
    const parsed = discussionSchema.parse({ strategyId: STRATEGY, items: [] })
    expect(parsed.total).toBe(0)
    expect(parsed.ratingAvg).toBeNull()
    expect(parsed.myScore).toBeNull()
    expect(parsed.ratingsEnabled).toBe(true)
  })

  it('reads an empty discussion as zero threads rather than a failure', () => {
    const parsed = discussionSchema.parse({ strategyId: STRATEGY, total: 0, items: [] })
    expect(parsed.items).toEqual([])
  })

  it('survives the signed-out read the live database really returns (mine is null, not false)', () => {
    // Captured from public.list_comments with an anon key on 2026-10-22; the tombstone is a comment
    // the author deleted, and total excludes it.
    const parsed = discussionSchema.parse({
      items: [
        {
          id: TOP,
          up: 0,
          body: null,
          down: 0,
          mine: null,
          myVote: null,
          deleted: true,
          replies: [],
          authorId: REPLY,
          createdAt: '2026-10-22T18:04:56.431759+00:00',
          authorHandle: 'efedemirkol61f398',
          authorDisplayName: 'efetr.developer'
        }
      ],
      total: 0,
      myScore: null,
      ratingAvg: null,
      strategyId: STRATEGY,
      ratingCount: 0,
      ratingsEnabled: true,
      commentsEnabled: true
    })

    expect(parsed.items[0]?.mine).toBe(false)
    expect(parsed.items[0]?.deleted).toBe(true)
    expect(parsed.items[0]?.body).toBeNull()
  })

  it('keeps the un-rated result distinguishable from a one-star result', () => {
    expect(rateResultSchema.parse({ strategyId: STRATEGY, myScore: null, ratingAvg: null, ratingCount: 0 }).myScore).toBeNull()
    expect(rateResultSchema.parse({ strategyId: STRATEGY, myScore: 1, ratingAvg: 1, ratingCount: 1 }).myScore).toBe(1)
  })

  it('marks a duplicate report instead of pretending a second one was queued', () => {
    expect(reportResultSchema.parse({ reportId: TOP, duplicate: true }).duplicate).toBe(true)
    expect(reportResultSchema.parse({ reportId: null, duplicate: false }).reportId).toBeNull()
  })

  it('parses the moderation queue with the target label the RPC resolves', () => {
    const parsed = moderationQueueSchema.parse({
      reports: [
        {
          id: TOP,
          targetType: 'comment',
          targetId: REPLY,
          reason: 'spam',
          detail: null,
          status: 'pending',
          createdAt: '2026-10-22T18:00:00Z',
          reporter: 'efe',
          targetLabel: 'kazanma garanti 100 tl'
        }
      ],
      takedowns: [
        {
          id: REPLY,
          strategyId: STRATEGY,
          strategyName: 'Teehee',
          claimantName: 'Efe',
          claimantEmail: 'efe@example.com',
          statement: 'Bu belge bana ait, 4. bölüm kopyalanmış.',
          status: 'pending',
          createdAt: '2026-10-22T18:00:00Z'
        }
      ]
    })

    expect(parsed.reports[0]?.targetLabel).toBe('kazanma garanti 100 tl')
    expect(parsed.takedowns[0]?.claimantEmail).toBe('efe@example.com')
  })

  it('maps the server error prefixes to keys the UI can translate', () => {
    expect(discussionErrorKey('TOO_FAST: wait a moment before posting again')).toBe('social.errTooFast')
    expect(discussionErrorKey('RATINGS_DISABLED: rating is turned off right now')).toBe('social.errRatingsDisabled')
    expect(discussionErrorKey('BAD_EMAIL: a reachable email address is required')).toBe('social.errEmail')
    // Both prefixes share their first nine characters, so the order in the table is what keeps this
    // distinction alive.
    expect(discussionErrorKey('FORBIDDEN_SELF: you cannot vote on your own comment')).toBe('social.errSelfVote')
    expect(discussionErrorKey('FORBIDDEN: you can only delete your own comment')).toBe('social.errForbidden')
    expect(discussionErrorKey('42P01: relation public.comments does not exist')).toBe('social.errGeneric')
  })

  it('mirrors the 2..1000 character rule only to disable the send button', () => {
    expect(isCommentBodyValid('ab')).toBe(true)
    expect(isCommentBodyValid('  ')).toBe(false)
    expect(isCommentBodyValid('a'.repeat(1001))).toBe(false)
    expect(isCommentBodyValid('a'.repeat(1000))).toBe(true)
    expect(isTakedownStatementValid('bu belge bana ait')).toBe(false)
    expect(isTakedownStatementValid('bu belge bana ait, '.repeat(2))).toBe(true)
  })

  it('formats an average without turning a missing rating into zero stars', () => {
    expect(formatRating(null, 0, 'tr')).toBeNull()
    expect(formatRating(4, 0, 'tr')).toBeNull()
    expect(formatRating(4, 3, 'tr')).toBe('4,0 · 3')
    expect(formatRating(4.5, 12, 'en')).toBe('4.5 · 12')
  })
})

describe('vote result shape', () => {
  it('accepts a clear-vote result, where mine is null', () => {
    expect(voteResultSchema.parse({ commentId: TOP, up: 2, down: 0, mine: null }).mine).toBeNull()
    expect(voteResultSchema.parse({ commentId: TOP, up: 2, down: 0, mine: 'up' }).up).toBe(2)
  })
})
