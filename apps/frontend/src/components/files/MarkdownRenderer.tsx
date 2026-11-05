import { Streamdown } from 'streamdown'
import { markdownCodeComponents } from '@/components/markdown-code'

/**
 * Leading YAML frontmatter (SKILL.md, docs with metadata) as a fenced yaml
 * block: as plain Markdown its closing `---` turns the YAML into a heading.
 */
export function frontmatterAsYaml(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!match) return content
  return `\`\`\`yaml\n${match[1]}\n\`\`\`\n${content.slice(match[0].length)}`
}

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <Streamdown
      mode="static"
      controls={false}
      lineNumbers={false}
      linkSafety={{ enabled: false }}
      components={markdownCodeComponents}
      className="px-6 py-5"
    >
      {frontmatterAsYaml(content)}
    </Streamdown>
  )
}
