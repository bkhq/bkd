import { Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useSetVirtualEngines } from '@/hooks/use-kanban'
import { envVarsToText, textToEnvVars } from '@/lib/env-vars'
import type { VirtualEngine } from '@/types/kanban'

/** `engineId` null = add a virtual engine. */
export interface VirtualEngineTarget {
  engineId: string | null
}

interface VirtualEngineProps {
  target: VirtualEngineTarget | null
  engines: VirtualEngine[]
  onClose: () => void
}

/** Add, edit or remove one virtual engine; saves the whole list. */
export function VirtualEngineDialog({ target, ...rest }: VirtualEngineProps) {
  return (
    <Dialog open={!!target} onOpenChange={next => !next && rest.onClose()}>
      <DialogContent className="sm:max-w-md">
        {target ? <VirtualEngineForm key={target.engineId ?? ''} target={target} {...rest} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function VirtualEngineForm({ target, engines, onClose }: VirtualEngineProps & { target: VirtualEngineTarget }) {
  const { t } = useTranslation()
  const save = useSetVirtualEngines()
  const existing = target.engineId ? engines.find(e => e.id === target.engineId) : undefined

  const [id, setId] = useState(existing?.id ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '')
  const [authToken, setAuthToken] = useState(existing?.authToken ?? '')
  const [model, setModel] = useState(existing?.model ?? '')
  const [envText, setEnvText] = useState(() => envVarsToText(existing?.envVars ?? {}))

  const others = engines.filter(e => e.id !== target.engineId)
  const persist = (next: VirtualEngine[]) => save.mutate(next, { onSuccess: onClose })

  const handleSave = () => {
    persist([
      ...others,
      {
        id: id.trim(),
        name: name.trim(),
        baseEngine: existing?.baseEngine ?? 'claude-code',
        baseUrl: baseUrl.trim() || undefined,
        authToken: authToken.trim() || undefined,
        model: model.trim() || undefined,
        envVars: textToEnvVars(envText),
      },
    ])
  }

  const idChanged = !!existing && id.trim() !== existing.id
  const canSave = !save.isPending && !!id.trim() && !!name.trim()

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {existing ? t('settings.virtualEngineEdit.editTitle') : t('settings.virtualEngineEdit.addTitle')}
        </DialogTitle>
        <DialogDescription>{t('settings.virtualEnginesHint')}</DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">{t('settings.virtualEngineEdit.id')}</Label>
            <Input
              value={id}
              onChange={e => setId(e.target.value)}
              placeholder={t('settings.virtualEngineIdPlaceholder')}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('settings.virtualEngineEdit.name')}</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('settings.virtualEngineNamePlaceholder')}
              className="h-8 text-xs"
            />
          </div>
        </div>
        {idChanged
          ? <p className="text-[11px] text-amber-600 dark:text-amber-400">{t('settings.virtualEngineEdit.idChangeWarning')}</p>
          : null}
        <div className="space-y-1">
          <Label className="text-xs">Base URL</Label>
          <Input
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder={t('settings.virtualEngineBaseUrlPlaceholder')}
            className="h-8 text-xs font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Token</Label>
          <Input
            type="password"
            value={authToken}
            onChange={e => setAuthToken(e.target.value)}
            placeholder={t('settings.virtualEngineTokenPlaceholder')}
            className="h-8 text-xs font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('settings.virtualEngineEdit.model')}</Label>
          <Input
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder={t('settings.virtualEngineModelPlaceholder')}
            className="h-8 text-xs font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('settings.virtualEngineEdit.envVars')}</Label>
          <Textarea
            className="font-mono text-xs"
            rows={3}
            value={envText}
            onChange={e => setEnvText(e.target.value)}
            placeholder={t('settings.virtualEngineEnvPlaceholder')}
          />
        </div>

        {save.error
          ? <p className="text-[11px] text-destructive">{save.error.message}</p>
          : null}
      </div>

      <DialogFooter className="sm:justify-between">
        <div>
          {existing
            ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={save.isPending}
                  onClick={() => persist(others)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-3" />
                  {t('settings.virtualEngineEdit.delete')}
                </Button>
              )
            : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" size="sm" disabled={!canSave} onClick={handleSave}>
            {save.isPending ? <Loader2 className="size-3 animate-spin" /> : null}
            {t('common.save')}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
