import { useState } from 'react';
import { Workout } from './components/Workout';
import { UserIdentification } from './components/UserIdentification';
import { LogPanel } from './components/LogPanel';
import { log } from './services/api';

interface User {
  id: string;
  name: string;
  primary_goal?: string;
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [workoutMembers, setWorkoutMembers] = useState<User[]>([]);
  const [showWorkout, setShowWorkout] = useState(false);
  const [workoutStream, setWorkoutStream] = useState<MediaStream | null>(null);

  const handleUserIdentified = (user: User, members: User[], stream?: MediaStream | null) => {
    log('APP', 'Usuario identificado -> mostrando Workout', { user: user.name, members: members.map(m => m.name), hasStream: !!stream });
    setCurrentUser(user);
    setWorkoutMembers(members);
    setWorkoutStream(stream || null);
    setShowWorkout(true);
  };

  const handleBackToIdentification = () => {
    log('APP', 'Volviendo a identificación');
    setShowWorkout(false);
    setCurrentUser(null);
    if (workoutStream) {
      workoutStream.getTracks().forEach(t => t.stop());
      setWorkoutStream(null);
    }
  };

  return (
    <>
      {!showWorkout ? (
        <UserIdentification onUserIdentified={handleUserIdentified} />
      ) : (
        <div>
          <Workout user={currentUser} members={workoutMembers} stream={workoutStream} onBack={handleBackToIdentification} />
          <button
            onClick={handleBackToIdentification}
            className="fixed top-4 right-4 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg z-50"
          >
            Cambiar Usuario
          </button>
        </div>
      )}
      <LogPanel />
    </>
  );
}

export default App;