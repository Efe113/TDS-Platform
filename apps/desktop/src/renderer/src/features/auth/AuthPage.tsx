import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Eye, EyeOff, Info, Lock, LogOut, Mail, ShieldCheck, Sparkles, User, UserRound } from 'lucide-react'
import { POLICY_VERSION } from '@tds/shared'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { navigate } from '../../lib/router'
import { isSupabaseConfigured } from '../../lib/supabase'
import { selectSignedIn, useAuth } from '../../store/auth-store'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { Logo } from '../../components/brand/logo'
import { cn } from '../../lib/utils'
import { useMotion } from '../../motion/context'
import { container, item } from '../../motion/presets'
import { Reveal } from '../../motion/primitives/Reveal'

type Mode = 'signIn' | 'signUp'

const BULLETS: Array<{ icon: typeof Sparkles; key: MessageKey }> = [
  { icon: Sparkles, key: 'auth.bulletImport' },
  { icon: ShieldCheck, key: 'auth.bulletOffline' },
  { icon: UserRound, key: 'auth.bulletCommunity' }
]

export function AuthPage(): ReactNode {
  const t = useT()
  const { budget } = useMotion()
  const { payload, busy, errorKey, signIn, signUp, signOut, startDiscord } = useAuth()
  const signedIn = useAuth(selectSignedIn)
  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [reveal, setReveal] = useState(false)
  const [capsOn, setCapsOn] = useState(false)

  const configured = isSupabaseConfigured()

  // Cheap, honest strength: what the server will check anyway (length + variety). It never blocks the
  // submit, it tells the user why a short password is a bad idea.
  const strength = (() => {
    if (password.length === 0) return 0
    let score = password.length >= 8 ? 1 : 0
    if (password.length >= 12) score += 1
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
    if (/\d/.test(password) && /[^\w\s]/.test(password)) score += 1
    return Math.min(4, score)
  })()

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (mode === 'signIn') {
      await signIn(email.trim(), password)
      return
    }
    await signUp(email.trim(), password, displayName.trim() || undefined)
  }

  if (signedIn) {
    const provider = payload.summary.provider
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Card>
          <CardHeader className="flex-row items-center gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-brand/30 bg-base text-brand">
              <Logo size={26} />
            </span>
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{payload.summary.handle ?? payload.summary.email ?? '—'}</CardTitle>
              <CardDescription>
                {provider && provider !== 'email' ? t('auth.signedInVia', { provider }) : t('auth.signedInAs', { email: payload.summary.email ?? '—' })}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="font-mono text-[10px]">{payload.summary.provider ?? 'email'}</Badge>
              <Badge variant={payload.summary.role === 'admin' ? 'default' : 'secondary'} className="font-mono text-[10px]">
                {payload.summary.role ?? 'user'}
              </Badge>
              <Badge variant="ghost" className="font-mono text-[10px]">{`${t('legal.versionShort')} ${POLICY_VERSION}`}</Badge>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => navigate('/profile')}>
                <User />
                {t('nav.profile')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => navigate('/wallet')}>
                {t('nav.wallet')}
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => void signOut()}>
                <LogOut />
                {t('auth.signOut')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const form = (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium uppercase tracking-widest text-mute/80" htmlFor="auth-email">
          {t('auth.email')}
        </label>
        <div className="relative">
          <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <Input
            id="auth-email"
            className="pl-9"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
      </div>

      {mode === 'signUp' ? (
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium uppercase tracking-widest text-mute/80" htmlFor="auth-name">
            {t('auth.displayName')}
          </label>
          <div className="relative">
            <User size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
            <Input id="auth-name" className="pl-9" maxLength={32} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label className="text-[11px] font-medium uppercase tracking-widest text-mute/80" htmlFor="auth-password">
          {t('auth.password')}
        </label>
        <div className="relative">
          <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <Input
            id="auth-password"
            className="pl-9 pr-10"
            type={reveal ? 'text' : 'password'}
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            minLength={mode === 'signUp' ? 8 : 1}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyUp={(event) => setCapsOn(event.getModifierState?.('CapsLock') === true)}
            onKeyDown={(event) => setCapsOn(event.getModifierState?.('CapsLock') === true)}
            required
          />
          <button
            type="button"
            onClick={() => setReveal((current) => !current)}
            aria-label={reveal ? t('auth.hidePassword') : t('auth.showPassword')}
            className="no-drag absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-mute transition-colors hover:bg-panel-soft hover:text-ink"
          >
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        {mode === 'signUp' ? (
          <div className="space-y-1">
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((index) => (
                <span
                  key={index}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-colors',
                    strength > index ? (strength <= 1 ? 'bg-danger' : strength === 2 ? 'bg-warn' : 'bg-good') : 'bg-line'
                  )}
                />
              ))}
            </div>
            <p className="text-[11px] text-mute">
              {strength === 0
                ? t('auth.passwordHint')
                : t(strength <= 1 ? 'auth.strengthWeak' : strength === 2 ? 'auth.strengthOk' : 'auth.strengthStrong')}
            </p>
          </div>
        ) : null}
        {capsOn ? (
          <p className="flex items-center gap-1.5 text-[11px] text-warn">
            <Info size={11} />
            {t('auth.capsLock')}
          </p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" disabled={!configured || !email || !password || busy}>
        {busy ? <Sparkles className="animate-pulse" /> : null}
        {mode === 'signIn' ? t('auth.signIn') : t('auth.signUp')}
      </Button>

      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[10px] uppercase tracking-widest text-mute/70">{t('auth.or')}</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <Button type="button" variant="outline" className="w-full" disabled={!configured || busy} onClick={() => void startDiscord()}>
        {t('auth.discord')}
      </Button>

      <p className="text-center text-[10px] leading-relaxed text-mute">
        {t('auth.termsLead')}{' '}
        <button type="button" className="no-drag underline-offset-2 hover:text-ink hover:underline" onClick={() => navigate('/legal/terms')}>
          {t('legal.tabTerms')}
        </button>{' '}
        {t('auth.termsAnd')}{' '}
        <button type="button" className="no-drag underline-offset-2 hover:text-ink hover:underline" onClick={() => navigate('/legal/privacy')}>
          {t('legal.tabPrivacy')}
        </button>
      </p>

      {errorKey ? (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {t(errorKey)}
        </motion.p>
      ) : null}
    </form>
  )

  return (
    <div className="grid h-full min-h-[520px] gap-6 lg:grid-cols-2">
      <Reveal className="hidden lg:flex">
        <section className="relative w-full overflow-hidden rounded-2xl border border-line bg-card p-8 lg:flex lg:flex-col">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
            maskImage: 'radial-gradient(ellipse 80% 70% at 20% 10%, #000 20%, transparent 75%)'
          }}
        />
        <span aria-hidden className="pointer-events-none absolute -left-24 top-1/3 size-80 rounded-full bg-brand/20 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <span className="relative flex size-11 items-center justify-center rounded-2xl border border-brand/30 bg-base text-ink">
            <span aria-hidden className="absolute inset-0 rounded-2xl bg-gradient-to-br from-brand/30 to-transparent" />
            <Logo size={26} className="relative" />
          </span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-ink">{t('app.name')}</span>
            <Badge variant="outline" className="border-brand/50 text-[9px] font-bold tracking-widest text-brand">
              {t('app.alpha')}
            </Badge>
          </div>
        </div>

        <div className="relative mt-auto">
          <h2 className="max-w-sm text-2xl leading-tight font-semibold tracking-tight text-ink">{t('auth.headline')}</h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-mute">{t('auth.subtitle')}</p>

          <motion.ul initial="hidden" animate="visible" variants={container(budget, BULLETS.length)} className="mt-7 space-y-3">
            {BULLETS.map((bullet) => {
              const Icon = bullet.icon
              return (
                <motion.li key={bullet.key} variants={item(budget)} className="flex items-start gap-3 text-sm text-mute">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
                    <Icon size={14} />
                  </span>
                  <span className="pt-1 leading-snug">{t(bullet.key)}</span>
                </motion.li>
              )
            })}
          </motion.ul>
        </div>

        <p className="relative mt-8 text-[11px] text-mute/70">{t('auth.footnote')}</p>
        </section>
      </Reveal>

      <div className="flex items-center justify-center">
        <Card className="w-full max-w-sm">
          <CardHeader className="space-y-1.5">
            <CardTitle className="text-lg">{t('auth.title')}</CardTitle>
            <CardDescription>{t('auth.formHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!configured ? (
              <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{t('auth.notConfigured')}</p>
            ) : null}

            <Tabs value={mode} onValueChange={(value) => setMode(value === 'signUp' ? 'signUp' : 'signIn')}>
              <TabsList className="w-full">
                <TabsTrigger value="signIn" className="flex-1">
                  {t('auth.signIn')}
                </TabsTrigger>
                <TabsTrigger value="signUp" className="flex-1">
                  {t('auth.signUp')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="signIn" className="mt-4">
                {form}
              </TabsContent>
              <TabsContent value="signUp" className="mt-4">
                {form}
              </TabsContent>
            </Tabs>

            <p className="text-center text-[11px] leading-relaxed text-mute">
              {t('auth.policyLine')}{' '}
              <button type="button" className="no-drag text-brand hover:underline" onClick={() => navigate('/legal/privacy')}>
                {t('legal.tabPrivacy')}
              </button>
              {' · '}
              <button type="button" className="no-drag text-brand hover:underline" onClick={() => navigate('/legal/terms')}>
                {t('legal.tabTerms')}
              </button>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
