import React from 'react';
import './InstructorAvatar.css';

export type AvatarState = 'idle' | 'listening' | 'speaking';

interface InstructorAvatarProps {
  state: AvatarState;
  message?: string;
}

export const InstructorAvatar: React.FC<InstructorAvatarProps> = ({ state, message }) => {
  return (
    <div className="instructor-avatar-container">
      <div className={`avatar-orb avatar-orb--${state}`}>
        <div className="avatar-core"></div>
        <div className="avatar-ring avatar-ring--inner"></div>
        <div className="avatar-ring avatar-ring--outer"></div>
        {state === 'listening' && (
          <div className="avatar-waves">
            <div className="avatar-wave"></div>
            <div className="avatar-wave"></div>
            <div className="avatar-wave"></div>
          </div>
        )}
      </div>
      {message && (
        <div className="avatar-message">
          <p>{message}</p>
        </div>
      )}
    </div>
  );
};
