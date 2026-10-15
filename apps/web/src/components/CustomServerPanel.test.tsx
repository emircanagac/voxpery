import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CustomServerPanel from './CustomServerPanel'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const checkedServer = { apiOrigin: 'https://chat.example.org', voiceOrigin: 'wss://voice.example.org', insecure: false }

describe('CustomServerPanel', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockImplementation(async (command: string) => {
      if (command === 'desktop_custom_server') return null
      if (command === 'desktop_probe_custom_server') return checkedServer
      return undefined
    })
  })

  it('connects only after the server was checked and trusted', async () => {
    render(<CustomServerPanel variant="settings" />)
    expect(await screen.findByText('voxpery.com')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Self-hosted server address'), { target: { value: 'https://chat.example.org' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText(/Found a Voxpery server at/)).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith('desktop_probe_custom_server', { address: 'https://chat.example.org' })

    const connect = screen.getByRole('button', { name: 'Connect and restart' })
    expect(connect).toBeDisabled()
    fireEvent.click(screen.getByLabelText('I trust this server'))
    fireEvent.click(connect)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('desktop_set_custom_server', {
      address: 'https://chat.example.org',
      trusted: true,
    }))
  })

  it('warns about unencrypted servers and shows checking errors', async () => {
    invoke.mockImplementation(async (command: string, args?: { address?: string }) => {
      if (command === 'desktop_custom_server') return null
      if (command === 'desktop_probe_custom_server') {
        if (args?.address === 'http://example.org') throw 'Use https:// for servers outside your computer or local network'
        return { apiOrigin: 'http://localhost:3001', voiceOrigin: null, insecure: true }
      }
      return undefined
    })
    render(<CustomServerPanel variant="settings" />)
    const field = await screen.findByLabelText('Self-hosted server address')

    fireEvent.change(field, { target: { value: 'http://example.org' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Use https:// for servers outside')

    fireEvent.change(field, { target: { value: 'http://localhost:3001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText(/This address is not encrypted/)).toBeInTheDocument()
  })

  it('names the website when it pointed to the server', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'desktop_custom_server') return null
      if (command === 'desktop_probe_custom_server') return { ...checkedServer, siteOrigin: 'https://example.org' }
      return undefined
    })
    render(<CustomServerPanel variant="settings" />)
    expect(await screen.findByText("The server's website or its API address.")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Self-hosted server address'), { target: { value: 'https://example.org' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText(/named by/)).toHaveTextContent('named by https://example.org')
    expect(screen.getByText(/Found a Voxpery server at/)).toHaveTextContent('https://chat.example.org')
  })

  it('returns to voxpery.com from a custom server', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'desktop_custom_server') return checkedServer
      return undefined
    })
    render(<CustomServerPanel variant="login" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Server: chat.example.org' }))
    fireEvent.click(screen.getByRole('button', { name: /Use voxpery.com instead/ }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('desktop_set_custom_server', { address: null, trusted: false }))
  })
})
