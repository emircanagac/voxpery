import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, MemberInfo, Server } from '../api'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import ChannelSidebar from './ChannelSidebar'

const server: Server = {
    id: 'server-1',
    name: 'Test Server',
    owner_id: 'owner-1',
    invite_code: 'test-server',
}

const voiceChannel: Channel = {
    id: 'voice-1',
    server_id: server.id,
    name: 'General',
    channel_type: 'voice',
    category: 'Voice',
    position: 0,
    my_permissions: 1 << 10,
}

const remoteMember: MemberInfo = {
    user_id: 'remote-1',
    username: 'a-very-long-remote-username',
    avatar_url: null,
    role: 'member',
    status: 'online',
    role_color: null,
}

describe('ChannelSidebar voice media presence', () => {
    beforeEach(() => {
        localStorage.clear()
        useAppStore.getState().resetSessionState()
        useAuthStore.setState({
            token: 'token',
            user: {
                id: 'local-1',
                username: 'local-user',
                email: 'local@example.test',
                email_verified: true,
                status: 'online',
            },
            loggingOut: false,
        })
        useSocketStore.setState({ send: vi.fn() })
    })

    it('shows camera and screen-share activity to a member outside the voice channel', () => {
        const voiceControls = {
            [remoteMember.user_id]: {
                muted: false,
                deafened: false,
                serverMuted: false,
                serverDeafened: false,
                screenSharing: true,
                cameraOn: true,
            },
        }
        useAppStore.setState({
            servers: [server],
            activeServerId: server.id,
            channels: [voiceChannel],
            activeChannelId: null,
            members: [remoteMember],
            membersByServerId: { [server.id]: [remoteMember] },
            voiceStates: { [remoteMember.user_id]: voiceChannel.id },
            voiceStateServerIds: { [remoteMember.user_id]: server.id },
            voiceControls,
            joinedVoiceChannelId: null,
        })

        render(
            <ChannelSidebar
                channelCategories={['Voice']}
                voiceControls={voiceControls}
            />,
        )

        expect(screen.getByText(remoteMember.username)).toBeVisible()
        expect(screen.getByLabelText(`${remoteMember.username} camera on`)).toBeVisible()
        expect(screen.getByLabelText(`${remoteMember.username} screen sharing`)).toHaveTextContent('LIVE')
        expect(useAppStore.getState().joinedVoiceChannelId).toBeNull()
    })
})
