import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { Banner, Button } from '../../components/ui'
import { Chip } from '../../components/ui/system'
import { StateError } from '../../components/ui/states'
import { SkeletonCard } from '../../motion/primitives/Shimmer'
import { POLICY_VERSION } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import { navigate } from '../../lib/router'
import { supabase } from '../../lib/supabase'
import { whenSessionReady } from '../../lib/session'
import { selectSignedIn, useAuth } from '../../store/auth-store'

const KINDS = ['tos', 'privacy'] as const

interface ConsentState {
  tos: boolean
  privacy: boolean
}

async function readConsent(): Promise<ConsentState> {
  await whenSessionReady()
  const client = supabase
  if (!client) return { tos: false, privacy: false }
  const results = await Promise.all(
    KINDS.map(async (kind) => {
      const { data, error } = await client.rpc('has_consented', { p_kind: kind, p_policy_version: POLICY_VERSION })
      if (error) throw new Error(error.message)
      return data === true
    })
  )
  return { tos: Boolean(results[0]), privacy: Boolean(results[1]) }
}

function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Network/CSP failures surface as bare TypeErrors, which tell the user nothing. */
function describeErrorKey(error: unknown): 'common.errorNetwork' | 'auth.errorUnknown' {
  const message = rawMessage(error)
  if (error instanceof TypeError || /failed to fetch|networkerror/i.test(message)) return 'common.errorNetwork'
  return 'auth.errorUnknown'
}

/**
 * The last screen before the app opens, so it gets the whole column and a proper skeleton instead of a
 * banner at the top of an otherwise empty page. Two policy links are on screen, not hidden behind one
 * "read" button: the user is being asked to accept two documents.
 */
export function ConsentGate({ children }: { children: ReactNode }): ReactNode {
  const t = useT()
  const signedIn = useAuth(selectSignedIn)
  const queryClient = useQueryClient()

  const consentQuery = useQuery({
    queryKey: ['consent', POLICY_VERSION],
    queryFn: readConsent,
    enabled: signedIn && supabase !== null,
    retry: false
  })

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('supabase missing')
      for (const kind of KINDS) {
        const { error } = await supabase.rpc('accept_consent', {
          p_kind: kind,
          p_policy_version: POLICY_VERSION,
          p_client_version: 'desktop-dev'
        })
        // 409/23505 means the row already exists: the user accepted on another machine, or a double
        // click raced this call. That is success, not an error to show.
        if (error && error.code !== '23505' && !/duplicate|conflict|already/i.test(error.message)) {
          throw new Error(error.message)
        }
      }
      return true
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['consent', POLICY_VERSION] })
    }
  })

  if (!signedIn) return children

  if (consentQuery.isLoading) {
    return (
      <div className="flex min-h-[58vh] items-center justify-center">
        <SkeletonCard lines={4} className="w-full max-w-xl" />
      </div>
    )
  }

  if (consentQuery.isError) {
    return (
      <div className="flex min-h-[58vh] items-center justify-center">
        <div className="w-full max-w-xl">
          <StateError
            detail={t(describeErrorKey(consentQuery.error))}
            hint={t('consent.loadHint')}
            onRetry={() => void consentQuery.refetch()}
            busy={consentQuery.isFetching}
          />
        </div>
      </div>
    )
  }

  const consent = consentQuery.data
  if (consent?.tos && consent.privacy) return children

  return (
    <div className="flex min-h-[58vh] items-center justify-center">
      <div className="hud-panel relative w-full max-w-xl overflow-hidden px-5 py-5 sm:px-6">
        <span aria-hidden className="hud-scan" />
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-brand/35 bg-brand/12 text-brand">
            <ShieldCheck size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[17px] font-semibold tracking-tight text-ink">{t('consent.title')}</h2>
              <Chip tone="neutral">{t('consent.version', { version: POLICY_VERSION })}</Chip>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-mute">{t('consent.body')}</p>

            <div className="mt-3 space-y-1.5">
              <p className="hud-label">{t('consent.documents')}</p>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => navigate('/legal/terms')}>
                  {t('legal.tabTerms')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => navigate('/legal/privacy')}>
                  {t('legal.tabPrivacy')}
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                busy={acceptMutation.isPending}
                disabled={acceptMutation.isPending}
                onClick={() => acceptMutation.mutate()}
              >
                {t('consent.accept')}
              </Button>
              <span className="text-[11px] leading-snug text-mute">{t('consent.note')}</span>
            </div>

            {acceptMutation.isError ? (
              <div className="mt-3">
                <Banner tone="danger" title={t('common.errorTitle')}>
                  <span title={rawMessage(acceptMutation.error)}>{t(describeErrorKey(acceptMutation.error))}</span>
                </Banner>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
