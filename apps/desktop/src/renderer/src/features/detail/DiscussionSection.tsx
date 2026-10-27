import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  discussionErrorKey,
  formatRating,
  isCommentBodyValid,
  isTakedownStatementValid,
  voteScore,
  type ReportReason,
  type ReportTarget
} from '@tds/shared'
import { BadgeCheck, MessageSquare } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { useCatalogLanguage } from '../../lib/catalog-labels'
import { ProfileHoverCard } from '../../components/profile/profile-card'
import { clearSolution, fetchSolution, markSolution } from '../../lib/intelligence-api'
import { deleteComment, fetchDiscussion, fileReport, postComment, requestTakedown, rateStrategy, voteComment } from '../../lib/social-api'
import { selectSignedIn, useAuth } from '../../store/auth-store'
import { Badge, Banner, Button, Card, Field, INPUT_CLASS, Row } from '../../components/ui'
import { RevealItem, RevealList } from '../../motion/primitives/Reveal'
import { StateEmpty, StateError, StateLoading } from '../../components/ui/states'

const REASONS: Array<{ value: ReportReason; labelKey: MessageKey }> = [
  { value: 'spam', labelKey: 'social.reasonSpam' },
  { value: 'harassment', labelKey: 'social.reasonHarassment' },
  { value: 'not_mine', labelKey: 'social.reasonNotMine' },
  { value: 'wrong_strategy', labelKey: 'social.reasonWrongStrategy' },
  { value: 'other', labelKey: 'social.reasonOther' }
]

function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Five buttons, not a range input: clicking the current score again clears the rating, which is the
 * only way "değerlendirmemi geri al" can be reached without a second control.
 */
function StarRating({ score, busy, onPick }: { score: number | null; busy: boolean; onPick: (score: number | null) => void }): ReactNode {
  const t = useT()
  return (
    <Row className="flex-wrap">
      <span className="text-xs text-mute">{t('social.yourRating')}</span>
      {[1, 2, 3, 4, 5].map((value) => (
        <Button
          key={value}
          variant="subtle"
          disabled={busy}
          className={score !== null && value <= score ? 'text-brand' : 'text-mute'}
          onClick={() => onPick(score === value ? null : value)}
        >
          ★
        </Button>
      ))}
      {score === null ? <span className="text-xs text-mute">{t('social.notRated')}</span> : null}
    </Row>
  )
}

interface CommentActionsProps {
  canDelete: boolean
  /** The server refuses a self-vote (upvotes are a badge metric), so the control is not offered. */
  canVote: boolean
  /** The owner may pin any thread; the author may pin their own. Everyone else gets no control. */
  canMarkSolution: boolean
  isSolution: boolean
  /** Only the owner may unpin: clear_solution is owner-only on the server. */
  canClearSolution: boolean
  up: number
  down: number
  myVote: 'up' | 'down' | null
  busy: boolean
  onVote: (direction: 'up' | 'down' | null) => void
  onDelete: () => void
  onReply: () => void
  onReport: () => void
  onMarkSolution: () => void
  onClearSolution: () => void
}

function CommentActions({
  canDelete,
  canVote,
  canMarkSolution,
  isSolution,
  canClearSolution,
  up,
  down,
  myVote,
  busy,
  onVote,
  onDelete,
  onReply,
  onReport,
  onMarkSolution,
  onClearSolution
}: CommentActionsProps): ReactNode {
  const t = useT()
  const score = voteScore({ up, down })
  return (
    <Row className="flex-wrap gap-1">
      {canVote ? (
        <>
          <Button variant={myVote === 'up' ? 'primary' : 'ghost'} disabled={busy} onClick={() => onVote(myVote === 'up' ? null : 'up')}>
            {`▲ ${String(up)}`}
          </Button>
          <Button variant={myVote === 'down' ? 'primary' : 'ghost'} disabled={busy} onClick={() => onVote(myVote === 'down' ? null : 'down')}>
            {`▼ ${String(down)}`}
          </Button>
        </>
      ) : (
        <span className="text-[11px] text-mute">{t('social.votes', { count: up + down })}</span>
      )}
      {score !== 0 ? <Badge tone={score > 0 ? 'good' : 'warn'}>{t('social.score', { score })}</Badge> : null}
      <Button variant="ghost" disabled={busy} onClick={onReply}>
        {t('social.reply')}
      </Button>
      {isSolution && canClearSolution ? (
        <Button variant="ghost" disabled={busy} onClick={onClearSolution}>
          {t('social.unmarkSolution')}
        </Button>
      ) : null}
      {!isSolution && canMarkSolution ? (
        <Button variant="subtle" disabled={busy} onClick={onMarkSolution}>
          <BadgeCheck size={13} />
          {t('social.markSolution')}
        </Button>
      ) : null}
      {canDelete ? (
        <Button variant="ghost" disabled={busy} onClick={onDelete}>
          {t('social.delete')}
        </Button>
      ) : null}
      <Button variant="ghost" disabled={busy} onClick={onReport}>
        {t('social.report')}
      </Button>
    </Row>
  )
}

export function DiscussionSection({ strategyId, isOwner }: { strategyId: string; isOwner: boolean }): ReactNode {
  const t = useT()
  const locale = useCatalogLanguage()
  const signedIn = useAuth(selectSignedIn)
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [reportTarget, setReportTarget] = useState<{ target: ReportTarget; id: string } | null>(null)
  const [reportReason, setReportReason] = useState<ReportReason>('spam')
  const [reportDetail, setReportDetail] = useState('')
  const [takedownOpen, setTakedownOpen] = useState(false)
  const [takedownName, setTakedownName] = useState('')
  const [takedownEmail, setTakedownEmail] = useState('')
  const [takedownStatement, setTakedownStatement] = useState('')
  const [sort, setSort] = useState<'new' | 'top'>('new')

  const discussionQuery = useQuery({
    queryKey: ['discussion', strategyId],
    queryFn: () => fetchDiscussion(strategyId),
    enabled: strategyId.length > 0,
    retry: 1
  })

  // Read separately from the thread so an un-migrated database loses the pin and not the comments.
  const solutionQuery = useQuery({
    queryKey: ['solution', strategyId],
    queryFn: () => fetchSolution(strategyId),
    enabled: strategyId.length > 0,
    retry: 1
  })

  // Rating and votes change the aggregate the detail header shows too, so both keys move together.
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['discussion', strategyId] })
    void queryClient.invalidateQueries({ queryKey: ['strategy', strategyId] })
  }

  const rateMutation = useMutation({
    mutationFn: (score: number | null) => rateStrategy(strategyId, score),
    onSuccess: refresh
  })

  const draft = replyTo === null ? body : replyBody
  const setDraft = (next: string): void => (replyTo === null ? setBody(next) : setReplyBody(next))

  const postMutation = useMutation({
    mutationFn: () => postComment(strategyId, draft, replyTo),
    onSuccess: () => {
      setBody('')
      setReplyBody('')
      setReplyTo(null)
      refresh()
    }
  })

  const deleteMutation = useMutation({ mutationFn: (commentId: string) => deleteComment(commentId), onSuccess: refresh })

  const voteMutation = useMutation({
    mutationFn: (input: { commentId: string; direction: 'up' | 'down' | null }) => voteComment(input.commentId, input.direction),
    onSuccess: refresh
  })

  // One RPC per direction: the server keeps at most one pin per strategy, so marking is also moving.
  const solutionMutation = useMutation({
    mutationFn: (input: { commentId: string | null }) =>
      input.commentId === null ? clearSolution(strategyId) : markSolution(strategyId, input.commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['solution', strategyId] })
    }
  })

  const reportMutation = useMutation({
    mutationFn: (input: { target: ReportTarget; id: string; reason: ReportReason; detail: string }) =>
      fileReport(input.target, input.id, input.reason, input.detail.trim().length > 0 ? input.detail.trim() : null),
    onSuccess: () => {
      setReportTarget(null)
      setReportDetail('')
    }
  })

  const takedownMutation = useMutation({
    mutationFn: () => requestTakedown(strategyId, takedownName.trim(), takedownEmail.trim(), takedownStatement.trim()),
    onSuccess: () => {
      setTakedownOpen(false)
      setTakedownStatement('')
    }
  })

  const discussion = discussionQuery.data
  const solutionId = solutionQuery.data ?? null
  const average = discussion ? formatRating(discussion.ratingAvg, discussion.ratingCount, locale) : null
  // Only the top level is reordered: a reply has to stay under the comment it answers.
  const ordered = useMemo(() => {
    const items = [...(discussion?.items ?? [])]
    if (sort === 'top') {
      items.sort(
        (a, b) => voteScore({ up: b.up, down: b.down }) - voteScore({ up: a.up, down: a.down }) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
    }
    // The pinned answer leads whichever sort is active, and sort is stable so nothing else moves.
    const rank = (id: string): number => (id === solutionId ? 0 : 1)
    return items.sort((a, b) => rank(a.id) - rank(b.id))
  }, [discussion, sort, solutionId])
  const busy = postMutation.isPending || deleteMutation.isPending || voteMutation.isPending || solutionMutation.isPending
  const err = (error: unknown): string => t(discussionErrorKey(rawMessage(error)) as MessageKey)

  const startReply = (commentId: string): void => {
    setReplyTo(commentId)
    setReplyBody('')
  }

  const commentBody = (comment: { body: string | null; deleted: boolean }): ReactNode =>
    comment.deleted ? <p className="text-sm italic text-mute">{t('social.deleted')}</p> : <p className="whitespace-pre-wrap text-sm">{comment.body}</p>

  return (
    <Card title={t('social.discussion')} hint={discussion ? t('social.commentCount', { count: discussion.total }) : undefined}>
      <div className="space-y-4">
        {discussionQuery.isError ? (
          <StateError detail={err(discussionQuery.error)} onRetry={() => void discussionQuery.refetch()} busy={discussionQuery.isFetching} />
        ) : null}

        {discussionQuery.isPending ? <StateLoading count={2} /> : null}

        {discussion ? (
          <div className="space-y-3">
            {discussion.ratingsEnabled ? (
              <>
                <StarRating score={discussion.myScore} busy={rateMutation.isPending} onPick={(score) => rateMutation.mutate(score)} />
                {average ? <p className="text-xs text-mute">{`${t('social.average')}: ${average}`}</p> : null}
                {!signedIn ? <p className="text-xs text-mute">{t('discover.needsSignIn')}</p> : null}
                {rateMutation.isError ? <Banner tone="danger" title={t('common.errorTitle')}>{err(rateMutation.error)}</Banner> : null}
              </>
            ) : (
              <p className="text-xs text-mute">{t('social.ratingsOff')}</p>
            )}
          </div>
        ) : null}

        {discussion?.commentsEnabled ? (
          signedIn ? (
            <div className="space-y-2">
              <Field label={replyTo === null ? t('social.write') : t('social.replying')}>
                <textarea className={INPUT_CLASS} rows={3} maxLength={1000} value={draft} onChange={(event) => setDraft(event.target.value)} />
              </Field>
              <Row className="flex-wrap">
                <Button variant="primary" busy={postMutation.isPending} disabled={!isCommentBodyValid(draft)} onClick={() => postMutation.mutate()}>
                  {replyTo === null ? t('social.post') : t('social.sendReply')}
                </Button>
                {replyTo !== null ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setReplyTo(null)
                      setReplyBody('')
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                ) : null}
                <span className="text-[11px] text-mute">{t('social.bodyHint', { count: draft.trim().length })}</span>
              </Row>
              {postMutation.isError ? <Banner tone="danger" title={t('common.errorTitle')}>{err(postMutation.error)}</Banner> : null}
            </div>
          ) : (
            <p className="text-xs text-mute">{t('discover.needsSignIn')}</p>
          )
        ) : discussion ? (
          <p className="text-xs text-mute">{t('social.commentsOff')}</p>
        ) : null}

        {discussion && discussion.items.length === 0 ? (
          <StateEmpty icon={MessageSquare} title={t('social.noComments')} body={t('social.noCommentsHint')} />
        ) : null}

        {discussion ? (
          <>
          {ordered.length > 1 ? (
            <div className="inline-flex rounded-lg border border-line bg-panel-soft p-0.5">
              {(['new', 'top'] as const).map((choice) => {
                const active = sort === choice
                return (
                  <button
                    key={choice}
                    type="button"
                    data-press
                    onClick={() => setSort(choice)}
                    className={cn('relative rounded-md px-2.5 py-1 text-[11px] transition-colors', active ? 'font-medium text-ink' : 'text-mute hover:text-ink')}
                  >
                    {active ? (
                      <motion.span
                        layoutId="comment-sort"
                        transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                        className="absolute inset-0 rounded-md bg-brand/20"
                      />
                    ) : null}
                    <span className="relative">{t(choice === 'new' ? 'detail.commentSortNew' : 'detail.commentSortTop')}</span>
                  </button>
                )
              })}
            </div>
          ) : null}

          <RevealList className="space-y-2" count={Math.min(ordered.length, 8)}>
            {ordered.map((comment) => {
              const pinned = comment.id === solutionId
              return (
              <RevealItem
                key={comment.id}
                className={cn('space-y-2 rounded-lg border px-3 py-2', pinned ? 'border-good/50 bg-good/[0.06]' : 'border-line bg-panel-soft')}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-mute">
                  {/* The same profile card the profile page paints, opened from anywhere a name appears. */}
                  <ProfileHoverCard userId={comment.authorId}>
                    <span className="text-left hover:text-brand">{comment.authorDisplayName ?? comment.authorHandle}</span>
                  </ProfileHoverCard>
                  <span>{new Date(comment.createdAt).toLocaleString()}</span>
                  {comment.mine ? <Badge tone="accent">{t('social.mine')}</Badge> : null}
                  {pinned ? (
                    <Badge tone="good">
                      <BadgeCheck size={12} />
                      {t('social.solution')}
                    </Badge>
                  ) : null}
                </div>
                {pinned ? <p className="text-[11px] text-mute">{t('social.solutionNote')}</p> : null}
                {commentBody(comment)}
                <CommentActions
                  canDelete={comment.mine}
                  canVote={!comment.mine}
                  canMarkSolution={signedIn && (isOwner || comment.mine)}
                  isSolution={pinned}
                  canClearSolution={isOwner}
                  up={comment.up}
                  down={comment.down}
                  myVote={comment.myVote}
                  busy={busy}
                  onVote={(direction) => voteMutation.mutate({ commentId: comment.id, direction })}
                  onDelete={() => deleteMutation.mutate(comment.id)}
                  onReply={() => startReply(comment.id)}
                  onReport={() => setReportTarget({ target: 'comment', id: comment.id })}
                  onMarkSolution={() => solutionMutation.mutate({ commentId: comment.id })}
                  onClearSolution={() => solutionMutation.mutate({ commentId: null })}
                />
                {comment.replies.map((reply) => (
                  <div key={reply.id} className="ml-4 space-y-1 border-l border-line pl-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-mute">
                      <span>{reply.authorDisplayName ?? reply.authorHandle}</span>
                      <span>{new Date(reply.createdAt).toLocaleString()}</span>
                      {reply.mine ? <Badge tone="accent">{t('social.mine')}</Badge> : null}
                      {reply.id === solutionId ? (
                        <Badge tone="good">
                          <BadgeCheck size={12} />
                          {t('social.solution')}
                        </Badge>
                      ) : null}
                    </div>
                    {commentBody(reply)}
                    <CommentActions
                      canDelete={reply.mine}
                      canVote={!reply.mine}
                      canMarkSolution={signedIn && (isOwner || reply.mine)}
                      isSolution={reply.id === solutionId}
                      canClearSolution={isOwner}
                      up={reply.up}
                      down={reply.down}
                      myVote={reply.myVote}
                      busy={busy}
                      onVote={(direction) => voteMutation.mutate({ commentId: reply.id, direction })}
                      onDelete={() => deleteMutation.mutate(reply.id)}
                      // One level of threading is a server rule too: a reply always answers the top comment.
                      onReply={() => startReply(comment.id)}
                      onReport={() => setReportTarget({ target: 'comment', id: reply.id })}
                      onMarkSolution={() => solutionMutation.mutate({ commentId: reply.id })}
                      onClearSolution={() => solutionMutation.mutate({ commentId: null })}
                    />
                  </div>
                ))}
              </RevealItem>
              )
            })}
          </RevealList>
          {solutionMutation.isError ? (
            <Banner tone="danger" title={t('common.errorTitle')}>{err(solutionMutation.error)}</Banner>
          ) : null}
          </>
        ) : null}

        {reportTarget ? (
          <div className="space-y-2 rounded-lg border border-line bg-panel-soft px-3 py-2">
            <p className="text-sm">{t('social.reportTitle')}</p>
            <Row className="flex-wrap">
              {REASONS.map((reason) => (
                <Button key={reason.value} variant={reportReason === reason.value ? 'primary' : 'ghost'} onClick={() => setReportReason(reason.value)}>
                  {t(reason.labelKey)}
                </Button>
              ))}
            </Row>
            <textarea
              className={INPUT_CLASS}
              rows={2}
              maxLength={1000}
              placeholder={t('social.reportDetail')}
              value={reportDetail}
              onChange={(event) => setReportDetail(event.target.value)}
            />
            <Row className="flex-wrap">
              <Button
                variant="primary"
                busy={reportMutation.isPending}
                onClick={() => reportMutation.mutate({ ...reportTarget, reason: reportReason, detail: reportDetail })}
              >
                {t('social.sendReport')}
              </Button>
              <Button variant="ghost" onClick={() => setReportTarget(null)}>
                {t('common.cancel')}
              </Button>
            </Row>
            {reportMutation.isSuccess ? (
              <Banner tone="info">{reportMutation.data.duplicate ? t('social.reportDuplicate') : t('social.reportSent')}</Banner>
            ) : null}
            {reportMutation.isError ? <Banner tone="danger" title={t('common.errorTitle')}>{err(reportMutation.error)}</Banner> : null}
          </div>
        ) : (
          <Row className="flex-wrap">
            <Button variant="ghost" disabled={!signedIn} onClick={() => setReportTarget({ target: 'strategy', id: strategyId })}>
              {t('social.reportStrategy')}
            </Button>
            <Button variant="ghost" disabled={!signedIn} onClick={() => setTakedownOpen((open) => !open)}>
              {t('social.takedown')}
            </Button>
          </Row>
        )}

        {takedownOpen ? (
          <div className="space-y-2 rounded-lg border border-line bg-panel-soft px-3 py-2">
            <p className="text-sm">{t('social.takedownTitle')}</p>
            <p className="text-xs text-mute">{t('social.takedownHint')}</p>
            <Field label={t('social.claimantName')}>
              <input className={INPUT_CLASS} value={takedownName} maxLength={120} onChange={(event) => setTakedownName(event.target.value)} />
            </Field>
            <Field label={t('social.claimantEmail')}>
              <input className={INPUT_CLASS} type="email" value={takedownEmail} onChange={(event) => setTakedownEmail(event.target.value)} />
            </Field>
            <Field label={t('social.statement')} hint={t('social.statementHint')}>
              <textarea
                className={INPUT_CLASS}
                rows={4}
                maxLength={4000}
                value={takedownStatement}
                onChange={(event) => setTakedownStatement(event.target.value)}
              />
            </Field>
            <Row className="flex-wrap">
              <Button
                variant="primary"
                busy={takedownMutation.isPending}
                disabled={takedownName.trim().length < 2 || takedownEmail.trim().length === 0 || !isTakedownStatementValid(takedownStatement)}
                onClick={() => takedownMutation.mutate()}
              >
                {t('social.sendTakedown')}
              </Button>
              <Button variant="ghost" onClick={() => setTakedownOpen(false)}>
                {t('common.close')}
              </Button>
            </Row>
            {takedownMutation.isSuccess ? <Banner tone="good">{t('social.takedownSent')}</Banner> : null}
            {takedownMutation.isError ? (
              <Banner tone="danger" title={t('common.errorTitle')}>{err(takedownMutation.error)}</Banner>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  )
}
