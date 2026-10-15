import React from 'react';

export function HUD({ state, onResume }) {
  if (!state) return null;
  const { pointerLocked, interaction } = state;
  return (
    <>
      {!pointerLocked && (
        <div className="resume-overlay" onClick={onResume}>
          <div className="resume-card">
            <h2>Paused</h2>
            <p>Click to resume · <kbd>WASD</kbd> move · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump · <kbd>E</kbd> talk · <kbd>Esc</kbd> pause</p>
          </div>
        </div>
      )}
      <div className="hud">
        {interaction && (
          <div className="interaction-prompt">
            Press <kbd>E</kbd> to talk to {interaction}
          </div>
        )}
        <div className="crosshair" />
      </div>
    </>
  );
}
