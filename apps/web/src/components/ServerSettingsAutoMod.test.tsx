import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ServerSettingsAutoMod from './ServerSettingsAutoMod'
import { serverApi } from '../api'

vi.mock('../api', () => ({
    serverApi: {
        listAutoModRules: vi.fn(),
        channels: vi.fn(),
        listRoles: vi.fn(),
        createAutoModRule: vi.fn(),
        updateAutoModRule: vi.fn(),
        deleteAutoModRule: vi.fn(),
    },
}))

const autoModRule = {
    id: 'rule-1',
    server_id: 'server-1',
    name: 'amk blocker',
    trigger_type: 'blocked_keyword' as const,
    pattern: 'amk',
    mention_limit: null,
    enabled: true,
    exempt_role_ids: ['role-1'],
    exempt_channel_ids: ['channel-1'],
    created_by: 'user-1',
    updated_by: null,
    created_at: '2026-05-11T00:00:00.000Z',
    updated_at: '2026-05-11T00:00:00.000Z',
}

describe('ServerSettingsAutoMod', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(serverApi.listAutoModRules).mockResolvedValue([autoModRule])
        vi.mocked(serverApi.channels).mockResolvedValue([
            {
                id: 'channel-1',
                server_id: 'server-1',
                name: 'general',
                description: null,
                channel_type: 'text',
                position: 0,
            },
        ])
        vi.mocked(serverApi.listRoles).mockResolvedValue([
            {
                id: 'role-1',
                name: 'Moderator',
                color: null,
                permissions: 0,
                position: 0,
            },
        ])
        vi.mocked(serverApi.updateAutoModRule).mockResolvedValue({
            ...autoModRule,
            name: 'strong keyword blocker',
            pattern: 'spam',
            exempt_role_ids: [],
            exempt_channel_ids: [],
            updated_by: 'user-1',
        })
    })

    it('edits an existing rule instead of forcing delete and recreate', async () => {
        const user = userEvent.setup()

        render(<ServerSettingsAutoMod serverId="server-1" token="token" />)

        expect(await screen.findByText('amk blocker')).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Edit' }))
        const nameInput = screen.getByDisplayValue('amk blocker')
        const keywordInput = screen.getByDisplayValue('amk')
        await user.clear(nameInput)
        await user.type(nameInput, 'strong keyword blocker')
        await user.clear(keywordInput)
        await user.type(keywordInput, 'spam')
        const editPanel = screen.getByText('Edit rule').closest('.server-settings-automod-edit')
        expect(editPanel).not.toBeNull()
        await user.click(within(editPanel as HTMLElement).getByRole('checkbox', { name: 'Moderator' }))
        await user.click(within(editPanel as HTMLElement).getByRole('checkbox', { name: '#general' }))
        await user.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => {
            expect(serverApi.updateAutoModRule).toHaveBeenCalledWith('server-1', 'rule-1', {
                name: 'strong keyword blocker',
                trigger_type: 'blocked_keyword',
                pattern: 'spam',
                mention_limit: null,
                enabled: true,
                exempt_role_ids: [],
                exempt_channel_ids: [],
            }, 'token')
        })
    })
})
