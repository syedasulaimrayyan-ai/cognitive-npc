import React, { useEffect, useState } from 'react';

/**
 * Game HUD: mission tracker (top-left), transient objective notices (toast),
 * interaction prompt, controls help, and the mission completion screen.
 * All state arrives as one snapshot from GameClient — React stays dumb.
 */
export function HUD({ state, onResume }) {
  const [noticeVisible, setNoticeVisible] = useState(null); // { id, text }
  const [completionDismissed, setCompletionDismissed] = useState(false);

  // Show each new notice for a few seconds.
  useEffect(() => {
    if (!state?.notice) return;
    setNoticeVisible(state.notice);
    const t = setTimeout(() => setNoticeVisible(null), 7000);
    return () => clearTimeout(t);
  }, [state?.notice?.id]);

  // A fresh completion (new completedAt) re-shows the screen.
  useEffect(() => {
    setCompletionDismissed(false);
  }, [state?.mission?.completedAt]);

  if (!state) return null;
  const { pointerLocked, interaction, lookHint, mission, holdingCrate, notice } = state;

  return (
    <>
      {!pointerLocked && (
        <div className="resume-overlay" onClick={onResume}>
          <div className="resume-card">
            <h2>COGNITIVE NPC</h2>
            <p className="subtitle">THE MISSING SUPPLY</p>
            <p>Click to play · <kbd>WASD</kbd> move · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump · <kbd>E</kbd> interact / talk · <kbd>Esc</kbd> pause</p>
          </div>
        </div>
      )}

      <div className="hud">
        {lookHint && <div className="look-hint">{lookHint}</div>}

        {mission && (
          <div className="mission-card">
            <div className="mission-title">
              <span className="mission-icon">◆</span> THE MISSING SUPPLY
            </div>
            <div className={`mission-objective ${mission.done ? 'done' : ''}`}>
              {mission.objective}
            </div>
            {holdingCrate && <div className="mission-chip">📦 Carrying the crate</div>}
            {mission.done && <div className="mission-chip complete">✔ Mission complete</div>}
          </div>
        )}

        {noticeVisible && (
          <div key={noticeVisible.id} className="objective-toast">
            {noticeVisible.text}
          </div>
        )}

        {interaction && (
          <div className="interaction-prompt">
            Press <kbd>E</kbd> to {interaction}
          </div>
        )}

        <div className="controls-help">
          <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</div>
          <div><kbd>Shift</kbd> run · <kbd>Space</kbd> jump</div>
          <div><kbd>E</kbd> interact / talk · <kbd>Esc</kbd> pause</div>
        </div>

        <div className="crosshair" />

        {mission?.done && !completionDismissed && (
          <div className="completion-screen">
            <div className="completion-card">
              <h1>MISSION COMPLETE</h1>
              <h2>THE MISSING SUPPLY</h2>
              <p className="epilogue">{mission.epilogue}</p>
              <p className="stats">
                Millbrook, population: memorable. Your conversations left marks
                that persist between play sessions.
              </p>
              <button onClick={() => setCompletionDismissed(true)}>Keep exploring</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
