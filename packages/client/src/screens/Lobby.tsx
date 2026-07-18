import type { PlayableFaction } from '@gwent/data';
import type { ServerMsg } from '@gwent/engine';
import { useEffect, useRef, useState } from 'react';
import { loadDeck } from '../game/decks.ts';
import { GwentSocket } from '../net/socket.ts';

const FACTIONS: Array<{ id: PlayableFaction; name: string }> = [
  { id: 'northern_realms', name: 'Northern Realms' },
  { id: 'nilfgaard', name: 'Nilfgaard' },
  { id: 'scoiatael', name: "Scoia'tael" },
  { id: 'monsters', name: 'Monsters' },
  { id: 'skellige', name: 'Skellige' },
];

export interface MultiplayerSession {
  socket: GwentSocket;
  roomId: string;
  you: 0 | 1;
  opponentFaction: PlayableFaction;
}

export function LobbyScreen({
  onBack,
  onJoined,
}: {
  onBack: () => void;
  onJoined: (session: MultiplayerSession) => void;
}) {
  const [faction, setFaction] = useState<PlayableFaction>('northern_realms');
  const [joinCode, setJoinCode] = useState('');
  const [status, setStatus] = useState<string>('Connecting…');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<GwentSocket | null>(null);
  const joinedRef = useRef(false);

  useEffect(() => {
    const sock = new GwentSocket();
    socketRef.current = sock;
    sock.connect((msg: ServerMsg) => {
      if (msg.t === 'error') {
        setError(`${msg.code}: ${msg.message}`);
        return;
      }
      if (msg.t === 'room_created') {
        setRoomId(msg.roomId);
        setStatus(`Room ${msg.roomId} — waiting for opponent…`);
        setError(null);
        return;
      }
      if (msg.t === 'joined') {
        if (joinedRef.current) return;
        joinedRef.current = true;
        onJoined({
          socket: sock,
          roomId: msg.roomId,
          you: msg.you,
          opponentFaction: msg.opponentFaction,
        });
      }
    });
    setStatus('Connected. Create a room or join with a code.');

    return () => {
      if (!joinedRef.current) sock.close();
    };
  }, [onJoined]);

  const create = () => {
    setError(null);
    const deck = loadDeck(faction);
    socketRef.current?.send({ t: 'create_room', deck });
    setStatus('Creating room…');
  };

  const join = () => {
    setError(null);
    const id = joinCode.trim().toLowerCase();
    if (!id) {
      setError('Enter a room code');
      return;
    }
    const deck = loadDeck(faction);
    socketRef.current?.send({ t: 'join_room', roomId: id, deck });
    setStatus(`Joining ${id}…`);
  };

  return (
    <div className="menu-screen">
      <h1 className="title">MULTIPLAYER</h1>
      <div className="menu-box">
        <h3>Your faction (uses saved deck)</h3>
        <div className="faction-picker">
          {FACTIONS.map((f) => (
            <button
              key={f.id}
              className={`btn ${faction === f.id ? 'btn-selected' : ''}`}
              onClick={() => setFaction(f.id)}
            >
              {f.name}
            </button>
          ))}
        </div>

        <button className="btn btn-primary" onClick={create} disabled={!!roomId}>
          Create room
        </button>

        {roomId && (
          <p className="room-code">
            Invite code: <strong>{roomId}</strong>
          </p>
        )}

        <h3>Or join</h3>
        <div className="join-row">
          <input
            className="code-input"
            placeholder="room code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            maxLength={8}
            disabled={!!roomId}
          />
          <button className="btn" onClick={join} disabled={!!roomId}>
            Join
          </button>
        </div>

        <p className="menu-note">{status}</p>
        {error && <p className="menu-error">{error}</p>}

        <button
          className="btn"
          onClick={() => {
            socketRef.current?.close();
            onBack();
          }}
        >
          Back
        </button>
      </div>
    </div>
  );
}
