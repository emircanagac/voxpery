import { act, fireEvent, render, screen } from '@testing-library/react'
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

const supportVoiceChannel: Channel = {
    ...voiceChannel,
    id: 'voice-2',
    name: 'Support',
    position: 1,
}

const remoteMember: MemberInfo = {
    user_id: 'remote-1',
    username: 'a-very-long-remote-username',
    avatar_url: null,
    about_me: 'Here for voice nights.',
    role: 'member',
    status: 'online',
    role_color: null,
    account_created_at: '2025-01-03T12:00:00.000Z',
    server_joined_at: '2025-02-04T12:00:00.000Z',
    highest_role_position: 10,
}

const localMember: MemberInfo = {
    user_id: 'local-1',
    username: 'local-user',
    avatar_url: null,
    role: 'member',
    status: 'online',
    role_color: null,
    highest_role_position: 0,
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
            members: [localMember, remoteMember],
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

    it.each([
        { muted: true, deafened: false, serverMuted: false, serverDeafened: false },
        { muted: false, deafened: true, serverMuted: false, serverDeafened: false },
        { muted: false, deafened: false, serverMuted: true, serverDeafened: false },
        { muted: false, deafened: false, serverMuted: false, serverDeafened: true },
    ])('shows effective mute/deafen indicators for %j', (flags) => {
        const control = { ...flags, screenSharing: true, cameraOn: true }
        useAppStore.setState({ servers: [server], activeServerId: server.id, channels: [voiceChannel],
            members: [remoteMember], voiceStates: { [remoteMember.user_id]: voiceChannel.id },
            voiceStateServerIds: { [remoteMember.user_id]: server.id } })
        render(<ChannelSidebar voiceControls={{ [remoteMember.user_id]: control }} />)
        const byServer = flags.serverMuted || flags.serverDeafened
        expect(screen.getByRole('img', { name: `${remoteMember.username}: Muted by ${byServer ? 'server' : 'self'}` })).toBeVisible()
        if (flags.deafened || flags.serverDeafened) {
            expect(screen.getByRole('img', { name: `${remoteMember.username}: Deafened by ${flags.serverDeafened ? 'server' : 'self'}` })).toBeVisible()
        } else {
            expect(screen.queryByRole('img', { name: /Deafened by/ })).toBeNull()
        }
        expect(screen.getAllByRole('img')).toHaveLength(flags.deafened || flags.serverDeafened ? 2 : 1)
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

    it('does not show channels from a previous server after switching', () => {
        const nextServer = { ...server, id: 'server-2', name: 'Second Server' }
        useAppStore.setState({
            servers: [server, nextServer],
            activeServerId: server.id,
            channels: [voiceChannel],
        })

        render(<ChannelSidebar channelCategories={['Voice']} />)
        expect(screen.getByText(voiceChannel.name)).toBeVisible()

        act(() => {
            useAppStore.getState().setActiveServer(nextServer.id)
            useAppStore.setState({ channels: [voiceChannel] })
        })
        expect(screen.queryByText(voiceChannel.name)).toBeNull()
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

    it('portals voice actions outside the sidebar and keeps internal scroll usable', () => {
        useAppStore.setState({
            servers: [server],
            activeServerId: server.id,
            channels: [voiceChannel],
            members: [remoteMember],
            voiceStates: { [remoteMember.user_id]: voiceChannel.id },
            voiceStateServerIds: { [remoteMember.user_id]: server.id },
        })

        const { container } = render(<ChannelSidebar channelCategories={['Voice']} />)
        const sidebar = container.querySelector('.channel-sidebar') as HTMLDivElement
        fireEvent.contextMenu(screen.getByText(remoteMember.username), { clientX: 220, clientY: 80 })

        const menu = screen.getByRole('group', { name: `Voice actions for ${remoteMember.username}` })
        expect(menu.parentElement).toBe(document.body)
        expect(sidebar).not.toContainElement(menu)
        fireEvent.scroll(menu)
        expect(menu).toBeInTheDocument()
        fireEvent.scroll(sidebar)
        expect(menu).not.toBeInTheDocument()
    })

    it('opens voice actions with keyboard and restores focus with Escape', () => {
        useAppStore.setState({
            servers: [server],
            activeServerId: server.id,
            channels: [voiceChannel],
            members: [remoteMember],
            voiceStates: { [remoteMember.user_id]: voiceChannel.id },
            voiceStateServerIds: { [remoteMember.user_id]: server.id },
        })

        render(<ChannelSidebar channelCategories={['Voice']} />)
        const participant = screen.getByRole('button', { name: `${remoteMember.username} in voice` })
        participant.focus()
        fireEvent.keyDown(participant, { key: 'F10', shiftKey: true })
        const menu = screen.getByRole('group', { name: `Voice actions for ${remoteMember.username}` })
        expect(menu.querySelector('button')).toHaveFocus()
        fireEvent.keyDown(window, { key: 'Escape' })
        expect(menu).not.toBeInTheDocument()
        expect(participant).toHaveFocus()
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

    it('moves a voice participant through the permission-gated channel picker', () => {
        const send = vi.fn()
        useSocketStore.setState({ send })
        useAppStore.setState({
            servers: [server],
            activeServerId: server.id,
            channels: [voiceChannel, supportVoiceChannel],
            members: [localMember, remoteMember],
            voiceStates: { [remoteMember.user_id]: voiceChannel.id },
            voiceStateServerIds: { [remoteMember.user_id]: server.id },
        })

        render(
            <ChannelSidebar
                channelCategories={['Voice']}
                canMoveMembers
            />,
        )

        fireEvent.contextMenu(screen.getByText(remoteMember.username))
        const picker = screen.getByLabelText(`Move ${remoteMember.username} to voice channel`)
        expect(picker.querySelector('option[value=""]')).toHaveAttribute('hidden')
        fireEvent.change(
            picker,
            { target: { value: supportVoiceChannel.id } },
        )

        expect(send).toHaveBeenCalledWith('MoveVoiceMember', {
            request_id: expect.any(String),
            target_user_id: remoteMember.user_id,
            channel_id: supportVoiceChannel.id,
        })
    })

    it('shows permission-gated voice actions for an equal or higher role', () => {
        useAppStore.setState({
            servers: [server],
            activeServerId: server.id,
            channels: [voiceChannel, supportVoiceChannel],
            members: [
                localMember,
                { ...remoteMember, highest_role_position: 0 },
            ],
            voiceStates: { [remoteMember.user_id]: voiceChannel.id },
            voiceStateServerIds: { [remoteMember.user_id]: server.id },
        })

        render(
            <ChannelSidebar
                channelCategories={['Voice']}
                canMuteMembers
                canDeafenMembers
                canMoveMembers
                canDisconnectMembers
            />,
        )

        fireEvent.contextMenu(screen.getByText(remoteMember.username))
        expect(screen.getByText('Server moderation')).toBeInTheDocument()
        expect(screen.getByLabelText(`Move ${remoteMember.username} to voice channel`)).toBeInTheDocument()
        expect(screen.getByText('Mute member (server)')).toBeInTheDocument()
        expect(screen.getByText('Deafen member (server)')).toBeInTheDocument()
        expect(screen.getByText('Disconnect from voice')).toBeInTheDocument()
    })

    it('opens a safe self participant menu without moderation permissions', () => {
        useAppStore.setState({
            servers: [server],
            activeServerId: server.id,
            channels: [voiceChannel, supportVoiceChannel],
            members: [localMember],
            voiceStates: { [localMember.user_id]: voiceChannel.id },
            voiceStateServerIds: { [localMember.user_id]: server.id },
        })

        render(<ChannelSidebar channelCategories={['Voice']} onOpenDirectMessage={vi.fn()} canMoveMembers canDisconnectMembers />)
        fireEvent.contextMenu(screen.getByRole('button', { name: 'local-user in voice' }))

        expect(screen.getByRole('group', { name: 'Voice actions for local-user' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'View profile (@local-user)' })).toBeVisible()
        expect(screen.queryByText('Server moderation')).not.toBeInTheDocument()
        expect(screen.queryByText('Your playback')).not.toBeInTheDocument()
        expect(screen.queryByText('Send direct message')).not.toBeInTheDocument()
        expect(screen.queryByText('Disconnect from voice')).not.toBeInTheDocument()
        expect(screen.queryByLabelText('Move local-user to voice channel')).not.toBeInTheDocument()
    })

    it('offers only permitted release actions for the current participant', () => {
        const send = vi.fn()
        useSocketStore.setState({ send })
        const voiceControls = {
            [localMember.user_id]: {
                muted: true, deafened: true, serverMuted: true, serverDeafened: true,
                screenSharing: false, cameraOn: false,
            },
        }
        useAppStore.setState({
            servers: [server],
            activeServerId: server.id,
            channels: [voiceChannel, supportVoiceChannel],
            members: [localMember],
            voiceStates: { [localMember.user_id]: voiceChannel.id },
            voiceStateServerIds: { [localMember.user_id]: server.id },
        })

        render(<ChannelSidebar channelCategories={['Voice']} voiceControls={voiceControls} canMuteMembers canDeafenMembers canMoveMembers canDisconnectMembers />)
        const participant = screen.getByRole('button', { name: 'local-user in voice' })
        fireEvent.contextMenu(participant)
        expect(screen.getByRole('button', { name: 'Unmute member (server)' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'Undeafen member (server)' })).toBeVisible()
        expect(screen.queryByText('Mute member (server)')).not.toBeInTheDocument()
        expect(screen.queryByText('Deafen member (server)')).not.toBeInTheDocument()
        expect(screen.queryByText('Disconnect from voice')).not.toBeInTheDocument()
        expect(screen.queryByLabelText('Move local-user to voice channel')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Unmute member (server)' }))
        expect(send).toHaveBeenCalledWith('SetVoiceControl', {
            target_user_id: localMember.user_id,
            muted: false, deafened: true, screen_sharing: false, camera_on: false,
        })
        fireEvent.contextMenu(participant)
        fireEvent.click(screen.getByRole('button', { name: 'Undeafen member (server)' }))
        expect(send).toHaveBeenCalledWith('SetVoiceControl', {
            target_user_id: localMember.user_id,
            muted: true, deafened: false, screen_sharing: false, camera_on: false,
        })
    })

    it('opens and closes the self participant menu from the keyboard', () => {
        useAppStore.setState({
            servers: [server],
            activeServerId: server.id,
            channels: [voiceChannel],
            members: [localMember],
            voiceStates: { [localMember.user_id]: voiceChannel.id },
            voiceStateServerIds: { [localMember.user_id]: server.id },
        })

        render(<ChannelSidebar channelCategories={['Voice']} />)
        const participant = screen.getByRole('button', { name: 'local-user in voice' })
        participant.focus()
        fireEvent.keyDown(participant, { key: 'F10', shiftKey: true })
        expect(screen.getByRole('group', { name: 'Voice actions for local-user' })).toBeVisible()
        expect(screen.getByRole('button', { name: 'View profile (@local-user)' })).toHaveFocus()
        fireEvent.keyDown(window, { key: 'Escape' })
        expect(screen.queryByRole('group', { name: 'Voice actions for local-user' })).not.toBeInTheDocument()
        expect(participant).toHaveFocus()
        fireEvent.keyDown(participant, { key: 'ContextMenu' })
        expect(screen.getByRole('group', { name: 'Voice actions for local-user' })).toBeVisible()
    })

    it('does not offer self-undeafen without deafen permission', () => {
        const voiceControls = {
            [localMember.user_id]: {
                muted: true, deafened: true, serverMuted: true, serverDeafened: true,
                screenSharing: false, cameraOn: false,
            },
        }
        useAppStore.setState({
            servers: [server],
            activeServerId: server.id,
            channels: [voiceChannel],
            members: [localMember],
            voiceStates: { [localMember.user_id]: voiceChannel.id },
            voiceStateServerIds: { [localMember.user_id]: server.id },
        })

        render(<ChannelSidebar channelCategories={['Voice']} voiceControls={voiceControls} canMuteMembers />)
        fireEvent.contextMenu(screen.getByRole('button', { name: 'local-user in voice' }))
        expect(screen.getByRole('button', { name: 'Unmute member (server)' })).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Undeafen member (server)' })).not.toBeInTheDocument()
    })

    it('opens the shared profile dialog and its member actions from a voice participant context menu', () => {
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
        fireEvent.click(screen.getByRole('button', { name: `View profile (@${remoteMember.username})` }))

        expect(screen.getByRole('dialog', { name: remoteMember.username })).toBeVisible()
        expect(screen.getByText('Here for voice nights.')).toBeVisible()
        fireEvent.click(screen.getByRole('button', { name: 'Send DM' }))
        expect(onOpenDirectMessage).toHaveBeenCalledWith(remoteMember.user_id)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
        fireEvent.click(screen.getByRole('menuitem', { name: 'Create Channel' }))
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

    it('keeps channel and category context menus inside the viewport', () => {
        const originalInnerWidth = window.innerWidth
        const originalInnerHeight = window.innerHeight
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 })

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
                onRenameChannel={vi.fn()}
                onRenameCategory={vi.fn()}
            />,
        )
        const sidebar = container.querySelector('.channel-sidebar') as HTMLDivElement
        vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({
            bottom: 900,
            height: 900,
            left: 0,
            right: 245,
            top: 0,
            width: 245,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        })

        fireEvent.contextMenu(screen.getByText(voiceChannel.name), { clientX: 315, clientY: 235 })
        let menu = container.querySelector('.channel-context-menu') as HTMLDivElement
        expect(menu.style.left).toBe('29px')
        expect(Number.parseInt(menu.style.top, 10)).toBeLessThan(235)

        fireEvent.contextMenu(screen.getByRole('button', { name: 'Voice' }), { clientX: 315, clientY: 235 })
        menu = container.querySelector('.channel-context-menu') as HTMLDivElement
        expect(menu.style.left).toBe('29px')
        expect(Number.parseInt(menu.style.top, 10)).toBeLessThan(235)

        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
    })
})
