import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DialoguePayload } from '../ai/dialogue-engine';

/**
 * Dialogue panel: text input + Send, microphone input with an explicit
 * state machine, and TTS controls (mute / replay / stop).
 *
 * Mic flow: press 🎤 → "listening" → recognized transcript appears in a
 * confirm bar with Send / Retry / Cancel — the transcript is NEVER
 * auto-submitted, so the player always sees and controls what is sent.
 *
 * Guards: mic is disabled while a reply is pending; pressing 🎤 while
 * listening cancels; Send clears the transcript immediately so a double
 * click cannot submit twice; speech playback can never overlap (VoiceIO
 * cancels the previous utterance before starting a new one).
 */
export function DialoguePanel({ data, onSubmit, onMic, onCancelMic, onStopSpeech, onReplaySpeech, onToggleMute }: {
  data: DialoguePayload | null;
  onSubmit: (text: string) => void;
  onMic: () => Promise<string | undefined> | undefined;
  onCancelMic?: () => void;
  onStopSpeech?: () => void;
  onReplaySpeech?: () => void;
  onToggleMute?: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  /** Synchronous re-entry guard: React state updates are async, so a rapid
   *  double-click on 🎤 could otherwise start recognition twice. */
  const micBusyRef = useRef(false);
  const [text, setText] = useState('');
  const [micState, setMicState] = useState<'idle' | 'listening'>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const sttOk = data?.sttSupported;
  const voice = data?.voice;
  const busy = !!data?.pending;

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [data?.messages?.length]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return; // one request at a time
    onSubmit(t);
    setText('');
  };

  const mic = async () => {
    if (micState === 'listening') { // second press = cancel
      onCancelMic?.();
      return;
    }
    if (micBusyRef.current) return; // same-frame double-click guard
    if (!sttOk) {
      setMicError('Speech recognition not supported in this browser (needs Chrome/Edge).');
      return;
    }
    if (busy || !onMic) return; // no mic submissions while a reply is pending
    micBusyRef.current = true;
    setMicState('listening');
    setMicError(null);
    try {
      const heard = await onMic();
      setMicState('idle');
      if (heard && heard.trim()) setTranscript(heard.trim());
      else setMicError(null); // '' = cancelled on purpose → silent
    } catch (err) {
      setMicState('idle');
      setMicError(err instanceof Error ? err.message : String(err));
    } finally {
      micBusyRef.current = false;
    }
  };

  const sendTranscript = () => {
    if (!transcript || busy) return;
    onSubmit(transcript); // engine guards re-entry via pending
    setTranscript(null);  // clear immediately → can't double-send
  };

  const retryListen = () => {
    setTranscript(null);
    void mic();
  };

  if (!data?.npc) return null;
  const { npc, messages, pending, status, warn } = data;

  // One live status line: listening > thinking > speaking > provider status.
  const statusLine = micState === 'listening'
    ? '🎤 Listening… (press 🎤 again to cancel)'
    : pending
      ? `⏳ ${npc.name} is thinking…`
      : voice?.phase === 'speaking'
        ? `🔊 ${npc.name} is speaking`
        : status;

  return (
    <div className="dialogue">
      <header>
        <div className="avatar" style={{ background: npc.color }} />
        <div>
          <h2>{npc.name}</h2>
          <div className="meta">{npc.role} · trust {npc.trust > 0 ? '+' : ''}{npc.trust} · {npc.memEventCount} memories</div>
        </div>
        <button className="close" onClick={() => onSubmit('/close')}>✕</button>
      </header>

      <div className="log" ref={logRef}>
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.who}`}>
            {m.who === 'npc' && m.badge === 'placeholder' && <b className="badge">placeholder</b>}
            <span>{m.text}</span>
          </div>
        ))}
        {pending && <div className="msg npc typing">…</div>}
      </div>

      {micError && <div className="status warn">🎤 {micError}</div>}

      {transcript && (
        <div className="transcript-bar">
          <span className="transcript-label">🎤 You said:</span>
          <span className="transcript-text">“{transcript}”</span>
          <div className="transcript-actions">
            <button type="button" className="tr-send" onClick={sendTranscript} disabled={busy} title="Send to the NPC">
              {busy ? 'Waiting…' : 'Send'}
            </button>
            <button type="button" onClick={retryListen} disabled={pending || micState === 'listening'} title="Discard and record again">
              Retry
            </button>
            <button type="button" onClick={() => setTranscript(null)} title="Discard transcript">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className={`status ${warn ? 'warn' : ''}`}>
        {statusLine}
        {voice?.phase === 'speaking' && (
          <span className="voice-controls">
            <button type="button" onClick={() => onStopSpeech?.()} title="Stop speaking">⏹ Stop</button>
          </span>
        )}
      </div>

      <div className="voice-bar">
        <button
          type="button"
          className="vc"
          onClick={() => onToggleMute?.()}
          title={voice?.muted ? 'Unmute NPC voice' : 'Mute NPC voice'}
        >{voice?.muted ? '🔇 Muted' : '🔊 Sound'}</button>
        <button
          type="button"
          className="vc"
          onClick={() => onReplaySpeech?.()}
          disabled={!voice?.canReplay || voice?.phase === 'speaking'}
          title={voice?.canReplay ? 'Replay the last reply' : 'Nothing to replay yet'}
        >🔁 Replay</button>
        <span className="vc-hint">voice replies play automatically · no lip-sync</span>
      </div>

      <form onSubmit={submit}>
        <button
          type="button"
          className={`mic ${micState === 'listening' ? 'listening' : ''} ${!sttOk || busy ? 'disabled' : ''}`}
          title={
            !sttOk ? 'Speech recognition unavailable in this browser'
              : micState === 'listening' ? 'Listening — click to cancel'
                : busy ? 'Waiting for the NPC’s reply…'
                  : 'Speak one sentence (browser STT)'
          }
          onClick={mic}
        >{micState === 'listening' ? '🎙…' : '🎤'}</button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={busy ? 'Waiting for reply…' : 'What do you say?'}
          maxLength={300}
          autoFocus
        />
        <button type="submit" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
