import React, { useEffect, useRef, useState } from 'react';

export function DialoguePanel({ data, onSubmit, onMic }) {
  const logRef = useRef(null);
  const [text, setText] = useState('');
  const [micState, setMicState] = useState('idle'); // idle | listening | error
  const [micError, setMicError] = useState(null);
  const open = !!(data && data.npc);
  const sttOk = data?.sttSupported;

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [data?.messages?.length]);

  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || data?.pending) return;
    onSubmit(t);
    setText('');
  };

  const mic = async () => {
    if (!sttOk) {
      setMicState('error');
      setMicError('Speech recognition not supported in this browser (needs Chrome/Edge).');
      return;
    }
    setMicState('listening');
    setMicError(null);
    try {
      const heard = await onMic();
      setMicState(heard ? 'idle' : 'error');
      if (heard) onSubmit(heard);
      else setMicError('Nothing was heard.');
    } catch (err) {
      setMicState('error');
      setMicError(String(err?.message || err));
    }
  };

  if (!open) return null;
  const { npc, messages, pending, status, warn } = data;

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
      <div className={`status ${warn ? 'warn' : ''}`}>{status}</div>
      <form onSubmit={submit}>
        <button
          type="button"
          className={`mic ${micState === 'listening' ? 'listening' : ''}`}
          title={sttOk ? 'Speak one sentence (browser STT)' : 'Speech recognition unavailable in this browser'}
          onClick={mic}
        >{micState === 'listening' ? '🎙…' : '🎤'}</button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What do you say?"
          maxLength={300}
          autoFocus
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
