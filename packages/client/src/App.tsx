import type { Difficulty } from '@gwent/ai';
import type { PlayableFaction } from '@gwent/data';
import { useCallback, useState } from 'react';
import { DeckEditorScreen } from './screens/DeckEditor.tsx';
import { GameScreen } from './screens/Game.tsx';
import { LobbyScreen, type MultiplayerSession } from './screens/Lobby.tsx';
import { MenuScreen } from './screens/Menu.tsx';
import { MultiplayerGameScreen } from './screens/MultiplayerGame.tsx';

type Screen =
  | { name: 'menu' }
  | { name: 'deck'; faction: PlayableFaction }
  | { name: 'game'; faction: PlayableFaction; aiFaction: PlayableFaction; difficulty: Difficulty }
  | { name: 'lobby' }
  | { name: 'mp'; session: MultiplayerSession };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });

  const onJoined = useCallback((session: MultiplayerSession) => {
    setScreen({ name: 'mp', session });
  }, []);

  if (screen.name === 'game') {
    return (
      <GameScreen
        faction={screen.faction}
        aiFaction={screen.aiFaction}
        difficulty={screen.difficulty}
        onExit={() => setScreen({ name: 'menu' })}
      />
    );
  }
  if (screen.name === 'deck') {
    return <DeckEditorScreen faction={screen.faction} onBack={() => setScreen({ name: 'menu' })} />;
  }
  if (screen.name === 'lobby') {
    return <LobbyScreen onBack={() => setScreen({ name: 'menu' })} onJoined={onJoined} />;
  }
  if (screen.name === 'mp') {
    return (
      <MultiplayerGameScreen
        session={screen.session}
        onExit={() => setScreen({ name: 'menu' })}
      />
    );
  }
  return (
    <MenuScreen
      onPlayAi={(faction, aiFaction, difficulty) =>
        setScreen({ name: 'game', faction, aiFaction, difficulty })
      }
      onEditDeck={(faction) => setScreen({ name: 'deck', faction })}
      onMultiplayer={() => setScreen({ name: 'lobby' })}
    />
  );
}
