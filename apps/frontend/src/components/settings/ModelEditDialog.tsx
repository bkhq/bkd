import { Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSetModelConfigs } from '@/hooks/use-kanban'
import { envVarsToText, textToEnvVars } from '@/lib/env-vars'
import type { EngineModel, ModelConfig } from '@/types/kanban'

/** `modelId` null = create a custom model. */
export interface ModelEditTarget {
  engineType: string
  engineName: string
  modelId: string | null
}

interface ModelEditProps {
  target: ModelEditTarget | null
  /** The engine's model list, configs applied (custom models flagged). */
  models: EngineModel[]
  configs: ModelConfig[]
  onClose: () => void
}

/**
 * Edit one model of a real engine: a detected model's display name and env
 * vars, or a custom model's id, name, base model and env vars.
 */
export function ModelEditDialog({ target, ...rest }: ModelEditProps) {
  return (
    <Dialog open={!!target} onOpenChange={next => !next && rest.onClose()}>
      <DialogContent className="sm:max-w-md">
        {target
          ? <ModelEditForm key={`${target.engineType}:${target.modelId ?? ''}`} target={target} {...rest} />
          : null}
      </DialogContent>
    </Dialog>
  )
}

function ModelEditForm({ target, models, configs, onClose }: ModelEditProps & { target: ModelEditTarget }) {
  const { t } = useTranslation()
  const save = useSetModelConfigs()
  const detected = models.filter(m => !m.custom)
  const model = target.modelId ? models.find(m => m.id === target.modelId) : undefined
  const existing = target.modelId ? configs.find(c => c.id === target.modelId) : undefined
  const isCustom = !target.modelId || !!model?.custom

  const [id, setId] = useState(target.modelId ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  const [baseModel, setBaseModel] = useState(
    existing?.baseModel ?? detected.find(m => m.isDefault)?.id ?? detected[0]?.id ?? '',
  )
  const [envText, setEnvText] = useState(() => envVarsToText(existing?.envVars ?? {}))

  const persist = (next: ModelConfig[]) => {
    save.mutate({ engineType: target.engineType, configs: next }, { onSuccess: onClose })
  }

  const others = configs.filter(c => c.id !== target.modelId)

  const handleSave = () => {
    const envVars = textToEnvVars(envText)
    const trimmedName = name.trim()
    if (isCustom) {
      persist([...others, { id: id.trim(), ...(trimmedName && { name: trimmedName }), baseModel, envVars }])
      return
    }
    const empty = !trimmedName && Object.keys(envVars).length === 0
    persist(empty ? others : [...others, { id: target.modelId!, ...(trimmedName && { name: trimmedName }), envVars }])
  }

  const idChanged = isCustom && !!target.modelId && id.trim() !== target.modelId
  const canSave = !save.isPending && (!isCustom || (!!id.trim() && !!baseModel))

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {target.modelId ? t('settings.modelEdit.editTitle') : t('settings.modelEdit.addTitle')}
        </DialogTitle>
        <DialogDescription>
          {target.engineName}
          {isCustom ? '' : ` · ${target.modelId ?? ''}`}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        {isCustom
          ? (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">{t('settings.modelEdit.id')}</Label>
                  <Input
                    value={id}
                    onChange={e => setId(e.target.value)}
                    placeholder="fable-high"
                    className="h-8 text-xs font-mono"
                  />
                  {idChanged
                    ? <p className="text-[11px] text-amber-600 dark:text-amber-400">{t('settings.modelEdit.idChangeWarning')}</p>
                    : null}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('settings.modelEdit.baseModel')}</Label>
                  <Select value={baseModel} onValueChange={value => setBaseModel(value ?? '')}>
                    <SelectTrigger className="h-8 w-full text-xs font-mono">
                      <SelectValue>{(value: string | null) => value}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {detected.map(m => (
                        <SelectItem key={m.id} value={m.id} className="text-xs font-mono">
                          {m.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )
          : null}

        <div className="space-y-1">
          <Label className="text-xs">{t('settings.modelEdit.name')}</Label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={isCustom ? id || t('settings.modelEdit.namePlaceholder') : model?.name}
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">{t('settings.modelEdit.envVars')}</Label>
          <Textarea
            className="font-mono text-xs"
            rows={4}
            value={envText}
            onChange={e => setEnvText(e.target.value)}
            placeholder={'CLAUDE_CODE_EFFORT_LEVEL=high\n# KEY=VALUE'}
          />
          <p className="text-[11px] text-muted-foreground">{t('settings.modelEdit.envHint')}</p>
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
                  {isCustom ? t('settings.modelEdit.delete') : t('settings.modelEdit.reset')}
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
