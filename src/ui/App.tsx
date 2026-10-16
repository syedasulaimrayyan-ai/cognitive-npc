import { useEffect, useRef, useState } from 'react';
import { GameClient, type HudState } from '../core/game-client';
import type { DialoguePayload } from '../ai/dialogue-engine';
import { LoadingOverlay } from './LoadingOverlay';
import { HUD } from './HUD.tsx'; // explicit .tsx: a legacy src/ui/hud.js otherwise wins on case-insensitive resolve
import { DialoguePanel } from './DialoguePanel';
import { TradingPanel } from './TradingPanel';

/**
 * Top-level React shell. Owns nothing about the 3D loop — the GameClient
 * (plain JS, imperative Three.js) runs the simulation and pushes small state
 * updates to React via callbacks.
 */
export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<GameClient | null>(null);
  const [phase, setPhase] = useState('loading'); // loading | ready
  const [loadMessage, setLoadMessage] = useState('Starting engine…');
  const [hud, setHud] = useState<HudState | null>(null);
  const [dialogue, setDialogue] = useState<DialoguePayload | null>(null);
  const [tradingNpc, setTradingNpc] = useState<string | null>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const client = new GameClient(el, {
      onProgress: setLoadMessage,
      onReady: () => setPhase('ready'),
      onHud: setHud,
      onDialogue: setDialogue,
    });
    clientRef.current = client;
    window.__game = client; // debug/verification handle (read-only use)
    (window as any).__openTrade = (npcId: string) => {
      setTradingNpc(npcId);
      client.tradingOpen = true;
    };
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
            onCancelMic={() => clientRef.current?.cancelVoiceInput()}
            onStopSpeech={() => clientRef.current?.stopSpeech()}
            onReplaySpeech={() => clientRef.current?.replaySpeech()}
            onToggleMute={() => clientRef.current?.toggleVoiceMute()}
          />
          {tradingNpc && (
            <TradingPanel
              npcId={tradingNpc}
              inventory={clientRef.current!.inventory}
              onClose={() => {
                setTradingNpc(null);
                if (clientRef.current) clientRef.current.tradingOpen = false;
              }}
              onBuy={(itemId) => {
                if (itemId === 'supplies') {
                  clientRef.current?.onSuppliesBought();
                }
              }}
            />
          )}
        </>
      )}
    </>
  );
}
