import { describe, expect, it } from 'vitest'
import { buildMessageSearchQuery, parseMessageSearchInput } from './searchFilters'

describe('message search filters', () => {
    it('keeps plain text searches unchanged', () => {
        expect(parseMessageSearchInput('hello world')).toEqual({
            text: 'hello world',
            from: undefined,
            hasAttachment: false,
        })
    })

    it('extracts author and attachment filters', () => {
        expect(parseMessageSearchInput('from:@alice has:attachment release notes')).toEqual({
            text: 'release notes',
            from: 'alice',
            hasAttachment: true,
        })
    })

    it('ignores incomplete author filter tokens while typing', () => {
        expect(parseMessageSearchInput('from:')).toEqual({
            text: '',
            from: undefined,
            hasAttachment: false,
        })
    })

    it('builds URL query parameters for filters', () => {
        expect(buildMessageSearchQuery('from:bob has:attachments', 25)).toBe(
            'q=&limit=25&from=bob&has_attachment=true',
        )
    })
})
