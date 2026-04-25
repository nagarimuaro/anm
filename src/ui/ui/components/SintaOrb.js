import React from 'react';
import './SintaOrb.css';

const SintaOrb = ({ state = 'idle', size = 300 }) => {
  return (
    <div className={`mood-orb-container ${state}`} style={{ '--orb-size': `${size}px` }}>
      <div className="mood-orb-blobs">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
        <div className="blob blob-3"></div>
        <div className="blob blob-4"></div>
        <div className="blob blob-5"></div>
      </div>
      {/* The "Hole" - larger as requested */}
      <div className="mood-orb-hole"></div>
      
      <div className="mood-orb-content">
        {state === 'idle' ? (
          <span className="hi-text">Hi</span>
        ) : (
          <div className="voice-waves">
            <span></span>
            <span></span>
            <span></span>
          </div>
        )}
      </div>
    </div>
  );
};

export default SintaOrb;
