import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { IssueTemplateSelect } from '@/components/cockpit/IssueTemplateSelect'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/hooks/use-issue-templates', () => ({
  useIssueTemplates: () => ({
    data: [
      { id: 'bug-fix', name: 'Bug fix', source: 'builtin', promptPrefix: 'BUG ' },
      { id: 'refactor', name: 'Refactor', source: 'builtin', promptPrefix: 'REF ' },
      { id: 'my-tpl', name: 'My Template', source: 'user', promptPrefix: 'MINE ' },
    ],
  }),
}))

describe('issueTemplateSelect', () => {
  it('renders builtin + user options with "No template" first', () => {
    render(<IssueTemplateSelect value="" onChange={() => {}} />)
    const select = screen.getByTestId('issue-template-select') as HTMLSelectElement
    const options = Array.from(select.options).map(o => o.value)
    expect(options[0]).toBe('')
    expect(options).toContain('bug-fix')
    expect(options).toContain('refactor')
    expect(options).toContain('my-tpl')
  })

  it('marks user templates with a star', () => {
    render(<IssueTemplateSelect value="" onChange={() => {}} />)
    expect(screen.getByText(/My Template ★/)).toBeDefined()
    expect(screen.getByText(/^Bug fix$/)).toBeDefined()
  })

  it('change fires onChange with the matching template', () => {
    const onChange = vi.fn()
    render(<IssueTemplateSelect value="" onChange={onChange} />)
    const select = screen.getByTestId('issue-template-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'refactor' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toMatchObject({ id: 'refactor', name: 'Refactor' })
  })

  it('selecting "No template" fires onChange with null', () => {
    const onChange = vi.fn()
    render(<IssueTemplateSelect value="bug-fix" onChange={onChange} />)
    const select = screen.getByTestId('issue-template-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
