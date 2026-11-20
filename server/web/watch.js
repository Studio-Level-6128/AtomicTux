import {draw, colors} from './arena.js';

const $ = id => document.getElementById(id);
const element = (tag, text) => Object.assign(document.createElement(tag), {textContent:text});
const labels = {waiting:'Waiting to start', playing:'Live now', finished:'Round finished'};
let socket, selected, audio, frame, previous, received, animation, lastHud;
const sounds = {};

$('audio').onclick = async () => {
  try {
    if (!audio) {
      audio = new AudioContext();
      for (const kind of ['boom','place','shield','pickup']) {
        fetch(`/${kind}.wav`).then(r => r.arrayBuffer()).then(b => audio.decodeAudioData(b))
          .then(buffer => sounds[kind] = buffer).catch(() => $('network').textContent = 'Could not load game audio.');
      }
      await audio.resume();
    } else if (audio.state === 'running') await audio.suspend();
    else await audio.resume();
    const on = audio.state === 'running';
    $('audio').textContent = on ? 'Mute sound' : 'Enable sound';
    $('audio').setAttribute('aria-pressed', String(on));
  } catch { $('network').textContent = 'Audio is unavailable in this browser.'; }
};

function effects(events) {
  if (audio?.state !== 'running') return;
  for (const kind of new Set(events.map(e => e.type === 'explosion' ? 'boom' : e.type))) {
    if (!sounds[kind]) continue;
    const source = audio.createBufferSource(), gain = audio.createGain();
    source.buffer = sounds[kind]; gain.gain.value = .35;
    source.connect(gain).connect(audio.destination); source.start();
  }
}

function stop() {
  if (socket) { socket.onclose = socket.onmessage = null; socket.close(); socket = null; }
  cancelAnimationFrame(animation); animation = frame = previous = lastHud = null;
  $('board').hidden = true; $('roster').replaceChildren();
}

function paint(now) {
  draw($('board'), frame.state, previous, Math.min(1,(now-received)/50), now/1000);
  animation = frame.state.finished ? null : requestAnimationFrame(paint);
}

function watch(room) {
  stop(); selected = room.id;
  $('lounge').hidden = true; $('viewer').hidden = false;
  $('title').textContent = room.name; $('status').textContent = 'Connecting…';
  socket = new WebSocket(`wss://${location.host}/watch/${room.id}`);
  socket.onclose = () => {
    cancelAnimationFrame(animation);
    $('status').textContent = 'Stream ended. Return to all games to reconnect.';
  };
  socket.onmessage = ({data}) => {
    const msg = JSON.parse(data);
    if (msg.type !== 'snapshot') {
      cancelAnimationFrame(animation); frame = previous = animation = lastHud = null;
      $('board').hidden = true; $('roster').replaceChildren();
      $('status').textContent = msg.type === 'waiting' ? 'Waiting for the host to start…' : 'Room closed.';
      if (msg.type === 'closed') socket.onclose = null;
      return;
    }
    const s = msg.state;
    previous = frame && !frame.state.finished ? frame.state : s; frame = msg; received = performance.now();
    $('board').hidden = false;
    const seconds = Math.ceil(s.remaining);
    const status = s.finished ? (s.winner < 0 ? 'Draw' : `${s.actors[s.winner].name} wins!`) :
      msg.countdown > 0 ? `Starting in ${Math.ceil(msg.countdown)}…` :
      `Live · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    if ($('status').textContent !== status) $('status').textContent = status;
    const hud = s.actors.map(a => `${a.name}${s.humans.includes(a.id) ? '' : ' · Bot'}${a.alive ? '' : ' · Out'}`);
    if (JSON.stringify(hud) !== lastHud) {
      lastHud = JSON.stringify(hud);
      $('roster').replaceChildren(...hud.map((text,i) => {
        const label = element('span',text); label.style.color = colors[i]; return label;
      }));
    }
    effects(msg.events);
    if (!animation) animation = requestAnimationFrame(paint);
  };
}

$('back').onclick = () => {
  stop(); selected = null; $('lounge').hidden = false; $('viewer').hidden = true; refresh();
};

let fetching = false, lastDirectory;
async function refresh() {
  if (fetching || selected) return;
  fetching = true;
  try {
    const r = await fetch('/api/lobby'); if (!r.ok) throw Error();
    const data = await r.json(); $('network').textContent = '';
    const key = JSON.stringify(data); if (key === lastDirectory) return; lastDirectory = key;
    $('rooms').replaceChildren(...data.rooms.map(room => {
      const button = element('button', room.name);
      button.append(element('span',`${labels[room.state]} · ${room.players.join(', ')}`));
      button.onclick = () => watch(room); return button;
    }));
    if (!data.rooms.length) $('rooms').textContent = 'No games yet. New rooms will appear here automatically.';
    $('leaders').replaceChildren(...data.leaders.map((p,i) => {
      const row = document.createElement('tr');
      for (const value of [i+1,p.name,p.rating,p.rounds]) row.append(element('td',value));
      return row;
    }));
    if (!data.leaders.length) {
      const cell = element('td','No rated rounds yet.'); cell.colSpan = 4;
      $('leaders').insertRow().append(cell);
    }
  } catch { $('network').textContent = 'Directory unavailable. Retrying…'; }
  finally { fetching = false; }
}
refresh(); setInterval(refresh, 2000);