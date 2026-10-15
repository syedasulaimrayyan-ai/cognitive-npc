import React, { useEffect, useRef, useState } from 'react';
import { GameClient } from '../core/game-client.js';
import { LoadingOverlay } from './LoadingOverlay.jsx';
import { HUD } from './HUD.jsx';
import { DialoguePanel } from './DialoguePanel.jsx';

/**
 * Top-level React shell. Owns nothing about the 3D loop — the GameClient
 * (plain JS, imperative Three.js) runs the simulation and pushes small state
 * updates to React via callbacks.
 */
export function App() {
  const mountRef = useRef(null);
  const clientRef = useRef(null);
  const [phase, setPhase] = useState('loading'); // loading | ready
  const [loadMessage, setLoadMessage] = useState('Starting engine…');
  const [hud, setHud] = useState(null);          // { playerPos, npcName, hint }
  const [dialogue, setDialogue] = useState(null);// { npc, messages, pending, status }

  useEffect(() => {
    const client = new GameClient(mountRef.current, {
      onProgress: setLoadMessage,
      onReady: () => setPhase('ready'),
      onHud: setHud,
      onDialogue: setDialogue,
    });
    clientRef.current = client;
    window.__game = client; // debug/verification handle (read-only use)
    client.start();
    return () => client.dispose();
  }, []);

  return (
    <>
      <div ref={mountRef} className="viewport" />
      {phase !== 'ready' && <LoadingOverlay message={loadMessage} />}
      {phase === 'ready' && (
        <>
          <HUD state={hud} onResume={() => clientRef.current?.resumePointerLock()} />
          <DialoguePanel
            data={dialogue}
            onSubmit={(t) => clientRef.current?.sendDialogueText(t)}
            onMic={() => clientRef.current?.requestVoiceInput()}
          />
        </>
      )}
    </>
  );
}
