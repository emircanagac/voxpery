import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, MemberInfo, Server } from '../api'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import { getRemotePlaybackVolume, readRemotePlaybackVolumes, writeRemotePlaybackVolumes } from '../webrtc/remotePlaybackVolume'
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

    it('does not show remote speaking rings while the local listener is deafened', () => {
        const voiceControls = {
            'local-1': {
                muted: true,
                deafened: true,
                serverMuted: false,
                serverDeafened: false,
                screenSharing: false,
                cameraOn: false,
            },
            [remoteMember.user_id]: {
                muted: false,
                deafened: false,
                serverMuted: false,
                serverDeafened: false,
                screenSharing: false,
                cameraOn: false,
            },
        }
        useAppStore.setState({
            servers: [server],
            activeServerId: server.id,
            channels: [voiceChannel],
            members: [remoteMember],
            voiceStates: { [remoteMember.user_id]: voiceChannel.id },
            voiceStateServerIds: { [remoteMember.user_id]: server.id },
            voiceSpeakingUserIds: [remoteMember.user_id],
        })

        const { container } = render(
            <ChannelSidebar channelCategories={['Voice']} voiceControls={voiceControls} />,
        )

        expect(container.querySelector('.voice-participant-avatar.is-speaking')).toBeNull()
        expect(screen.getByText(remoteMember.username)).not.toHaveClass('is-speaking')
        expect(useAppStore.getState().voiceSpeakingUserIds).toEqual([remoteMember.user_id])
    })

    it('stores Discord-style user volume independently up to 200 percent', () => {
        useAppStore.setState({
            servers: [server],
            activeServerId: server.id,
            channels: [voiceChannel],
            members: [remoteMember],
            voiceStates: { [remoteMember.user_id]: voiceChannel.id },
            voiceStateServerIds: { [remoteMember.user_id]: server.id },
        })

        render(<ChannelSidebar channelCategories={['Voice']} />)
        // Simulate a stream mute written after the sidebar captured its initial volume state.
        writeRemotePlaybackVolumes({ 'screen:remote-1': 0 })
        fireEvent.contextMenu(screen.getByText(remoteMember.username))

        const slider = screen.getByRole('slider')
        expect(slider).toHaveAttribute('max', '200')
        fireEvent.change(slider, { target: { value: '200' } })

        const volumes = readRemotePlaybackVolumes()
        expect(getRemotePlaybackVolume(volumes, 'voice', remoteMember.user_id)).toBe(200)
        expect(getRemotePlaybackVolume(volumes, 'screen', remoteMember.user_id)).toBe(0)
    })

    it('opens a direct message from a voice participant context menu', () => {
        const onOpenDirectMessage = vi.fn()
        useAppStore.setState({
            servers: [server],
            activeServerId: server.id,
            channels: [voiceChannel],
            members: [remoteMember],
            voiceStates: { [remoteMember.user_id]: voiceChannel.id },
            voiceStateServerIds: { [remoteMember.user_id]: server.id },
        })

        render(
            <ChannelSidebar
                channelCategories={['Voice']}
                onOpenDirectMessage={onOpenDirectMessage}
            />,
        )

        fireEvent.contextMenu(screen.getByText(remoteMember.username))
        expect(screen.getByText('Member actions')).toBeInTheDocument()
        expect(screen.getByText('Your playback')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Send direct message' }))
        expect(onOpenDirectMessage).toHaveBeenCalledWith(remoteMember.user_id)
    })

    it('offers compact, permission-aware channel creation controls', () => {
        const onOpenCreateChannel = vi.fn()
        const onOpenCreateCategory = vi.fn()
        useAppStore.setState({
            servers: [server],
            activeServerId: server.id,
            channels: [voiceChannel],
            activeChannelId: null,
        })

        const { container } = render(
            <ChannelSidebar
                channelCategories={['Voice']}
                canManageChannels
                onOpenCreateChannel={onOpenCreateChannel}
                onOpenCreateCategory={onOpenCreateCategory}
            />,
        )

        expect(container.querySelector('.channel-create-actions')).toBeNull()
        expect(screen.queryByRole('button', { name: 'Create channels and categories' })).toBeNull()
        const channelList = container.querySelector('.channel-list')
        expect(channelList).not.toBeNull()
        fireEvent.contextMenu(channelList!)
        fireEvent.click(screen.getByRole('menuitem', { name: 'Create Category' }))
        expect(onOpenCreateCategory).toHaveBeenCalledTimes(1)

        fireEvent.click(screen.getByRole('button', { name: 'Create channel in Voice' }))
        expect(onOpenCreateChannel).toHaveBeenCalledWith('Voice')

        fireEvent.contextMenu(screen.getByRole('button', { name: 'Voice' }))
        fireEvent.click(screen.getByRole('button', { name: 'Create Channel' }))
        expect(onOpenCreateChannel).toHaveBeenLastCalledWith('Voice')
    })

    it('does not expose channel creation controls without manage permission', () => {
        useAppStore.setState({
            servers: [server],
            activeServerId: server.id,
            channels: [voiceChannel],
            activeChannelId: null,
        })

        render(
            <ChannelSidebar
                channelCategories={['Voice']}
                canManageChannels={false}
                onOpenCreateChannel={vi.fn()}
                onOpenCreateCategory={vi.fn()}
            />,
        )

        expect(screen.queryByRole('button', { name: 'Create channels and categories' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Create channel in Voice' })).toBeNull()
    })
})
