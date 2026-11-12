import { FolderOpen, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DirectoryPicker } from '@/components/DirectoryPicker'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { kanbanApi } from '@/lib/kanban-api'

/** Directory (with picker) and repository URL (with remote detection) of a project form. */
export function ProjectLocationFields({
  directory,
  setDirectory,
  repositoryUrl,
  setRepositoryUrl,
}: {
  directory: string
  setDirectory: (v: string) => void
  repositoryUrl: string
  setRepositoryUrl: (v: string) => void
}) {
  const { t } = useTranslation()
  const [dirPickerOpen, setDirPickerOpen] = useState(false)
  const [detectingRemote, setDetectingRemote] = useState(false)

  return (
    <>
      <Field>
        <Label>{t('project.directory')}</Label>
        <div className="flex gap-1.5">
          <Input
            type="text"
            value={directory}
            onChange={e => setDirectory(e.target.value)}
            placeholder={t('project.directoryPlaceholder')}
            className="w-full"
          />
          <Button
            onClick={() => setDirPickerOpen(true)}
            variant="outline"
            size="icon"
            title={t('project.browseDirectories')}
          >
            <FolderOpen className="size-4 text-muted-foreground" />
          </Button>
        </div>
        <DirectoryPicker
          open={dirPickerOpen}
          onOpenChange={setDirPickerOpen}
          initialPath={directory || undefined}
          onSelect={setDirectory}
        />
      </Field>

      <Field>
        <Label>{t('project.repositoryUrl')}</Label>
        <div className="flex gap-1.5">
          <Input
            type="text"
            value={repositoryUrl}
            onChange={e => setRepositoryUrl(e.target.value)}
            placeholder={t('project.repositoryUrlPlaceholder')}
            className="w-full"
          />
          <Button
            onClick={async () => {
              const dir = directory.trim()
              if (!dir) return
              setDetectingRemote(true)
              try {
                const result = await kanbanApi.detectGitRemote(dir)
                setRepositoryUrl(result.url)
              } catch {
                // silently ignore — directory may not be a git repo
              } finally {
                setDetectingRemote(false)
              }
            }}
            variant="outline"
            type="button"
            disabled={!directory.trim() || detectingRemote}
            title={t('project.detectGitRemote')}
            className="shrink-0"
          >
            {detectingRemote ? <Loader2 className="size-4 animate-spin" /> : 'Auto'}
          </Button>
        </div>
      </Field>
    </>
  )
}
