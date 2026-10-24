import type { ReactNode } from 'react'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { navigate } from '../../lib/router'
import { Button, EmptyState, PageTitle } from '../../components/ui'

interface ComingSoonPageProps {
  titleKey: MessageKey
  bodyKey: MessageKey
  milestone: string
}

export function ComingSoonPage({ titleKey, bodyKey, milestone }: ComingSoonPageProps): ReactNode {
  const t = useT()

  return (
    <div>
      <PageTitle title={t(titleKey)} subtitle={t('milestone.unavailable', { milestone })} />
      <EmptyState
        title={t('milestone.unavailable', { milestone })}
        body={t(bodyKey)}
      />
      <div className="mt-4 flex gap-2">
        <Button variant="primary" onClick={() => navigate('/import')}>
          {t('import.title')}
        </Button>
        <Button onClick={() => navigate('/settings')}>{t('settings.title')}</Button>
      </div>
    </div>
  )
}
