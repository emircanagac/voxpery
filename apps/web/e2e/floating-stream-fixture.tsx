import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import FloatingScreenShare from '../src/components/FloatingScreenShare'

export function mountStreamPreviewFixture(withChatSurface = true) {
  const fixture = document.createElement('div')
  fixture.id = 'stream-preview-fixture'
  document.querySelector('.shell-content')!.appendChild(fixture)
  const actions = { returns: 0, stops: 0 }
  Reflect.set(window, '__previewActions', actions)
  createRoot(fixture).render(
    <MemoryRouter>
      {withChatSurface && <div className="chat-messages" style={{ position: 'fixed', left: innerWidth >= 1024 ? 310 : 70, right: innerWidth >= 1024 ? 240 : 0, top: 100, bottom: 150, background: 'var(--bg-primary)' }} />}
      <FloatingScreenShare visible owner="Test publisher" layoutKey="test-chat" onReturn={() => { actions.returns += 1 }} onStop={() => { actions.stops += 1 }}>
        <video autoPlay muted playsInline />
      </FloatingScreenShare>
    </MemoryRouter>,
  )
}
