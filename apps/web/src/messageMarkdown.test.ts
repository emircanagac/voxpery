import { describe, expect, it } from 'vitest'
import { parseMessageMarkdown } from './messageMarkdown'

describe('parseMessageMarkdown', () => {
  it('parses bold, italic, strikethrough and inline code', () => {
    expect(parseMessageMarkdown('a **bold** b *it* c _also_ d ~~gone~~ e `x*y*z`')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', children: [{ type: 'text', text: 'bold' }] },
      { type: 'text', text: ' b ' },
      { type: 'italic', children: [{ type: 'text', text: 'it' }] },
      { type: 'text', text: ' c ' },
      { type: 'italic', children: [{ type: 'text', text: 'also' }] },
      { type: 'text', text: ' d ' },
      { type: 'strike', children: [{ type: 'text', text: 'gone' }] },
      { type: 'text', text: ' e ' },
      { type: 'code', text: 'x*y*z' },
    ])
  })

  it('nests emphasis and keeps code blocks literal', () => {
    expect(parseMessageMarkdown('**bold _and italic_**')).toEqual([
      { type: 'bold', children: [{ type: 'text', text: 'bold ' }, { type: 'italic', children: [{ type: 'text', text: 'and italic' }] }] },
    ])
    expect(parseMessageMarkdown('before\n```ts\nconst a = **b**\n```\nafter')).toEqual([
      { type: 'text', text: 'before\n' },
      { type: 'codeBlock', text: 'const a = **b**' },
      { type: 'text', text: '\nafter' },
    ])
  })

  it('leaves links, mentions, snake_case and loose markers untouched', () => {
    const plain = [
      'see https://example.com/a_b_c/*x* and @user_name_here',
      'snake_case_name stays',
      '2 * 3 * 4 and a lone ** pair',
      '<script>alert(1)</script>',
      'keeps \ue001 private-use text **as typed**',
    ]
    for (const text of plain) expect(parseMessageMarkdown(text)).toEqual([{ type: 'text', text }])
  })

  it('formats text that contains digits and hex-like letters', () => {
    expect(parseMessageMarkdown('Room 42 at 0xFF is **fixed**')).toEqual([
      { type: 'text', text: 'Room 42 at 0xFF is ' },
      { type: 'bold', children: [{ type: 'text', text: 'fixed' }] },
    ])
  })
})
