import { useState } from 'react';
import { Workout } from './components/Workout';
import { UserIdentification } from './components/UserIdentification';

interface User {
  id: string;
  name: string;
  primary_goal?: string;
}

function App() {
  const [_currentUser, setCurrentUser] = useState<User | null>(null);
  const [showWorkout, setShowWorkout] = useState(false);

  const handleUserIdentified = (user: User) => {
    setCurrentUser(user);
    setShowWorkout(true);
  };

  const handleBackToIdentification = () => {
    setShowWorkout(false);
    setCurrentUser(null);
  };

  return (
    <>
      {!showWorkout ? (
        <UserIdentification onUserIdentified={handleUserIdentified} />
      ) : (
        <div>
          <Workout />
          <button
            onClick={handleBackToIdentification}
            className="fixed top-4 right-4 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg z-50"
          >
            Cambiar Usuario
          </button>
        </div>
      )}
    </>
  );
}

export default App;