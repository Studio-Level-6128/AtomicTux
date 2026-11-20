// Canvas counterpart to _draw_board in scripts/main.gd. Positions are in 52px cells.
export const colors = ['#68efcd','#ff8597','#b09aff','#ffc96a'];
const images = {};
for (const kind of ['tux','bomb','speed','kick','atomic','shield','fire']) {
  images[kind] = new Image(); images[kind].src = `/${kind}.${kind === 'tux' ? 'png' : 'svg'}`;
}

export function draw(canvas, state, prev, alpha, t) {
  const g = canvas.getContext('2d');
  function box(x,y,w,h,r,color,edge) {
    g.beginPath(); g.roundRect(x,y,w,h,r); g.fillStyle=color; g.fill();
    if (edge) { g.strokeStyle=edge; g.lineWidth=1; g.stroke(); }
  }
  function circle(x,y,r,color,stroke=0,end=2*Math.PI) {
    g.beginPath(); g.arc(x,y,r,-Math.PI/2,end-Math.PI/2);
    if (stroke) { g.strokeStyle=color; g.lineWidth=stroke; g.stroke(); }
    else { g.fillStyle=color; g.fill(); }
  }
  function line(x,y,u,v,color,w) {
    g.beginPath(); g.moveTo(x,y); g.lineTo(u,v); g.strokeStyle=color; g.lineWidth=w; g.stroke();
  }
  function image(kind,x,y,w,h) {
    const img = images[kind]; if (img?.naturalWidth) g.drawImage(img,x,y,w,h);
  }
  g.clearRect(0,0,canvas.width,canvas.height);
  state.grid.forEach((row,j) => row.forEach((tile,i) => {
    const x=i*52,y=j*52;
    box(x+2,y+2,48,48,5,(i+j)%2 ? '#18383e' : '#15323a');
    if (tile===1) {
      box(x+2,y+5,48,45,6,'#0b1c29'); box(x+3,y+1,46,42,6,'#355464','#446879');
      line(x+11,y+9,x+40,y+9,'#557b8c',2); circle(x+25,y+25,3,'#233d4d');
    } else if (tile===2) {
      box(x+4,y+7,44,42,5,'#4a3028'); box(x+4,y+3,44,42,5,'#b47e4e','#d4a16c');
      for (const dx of [14,36]) line(x+dx,y+6,x+dx,y+42,'#775032',2);
      line(x+9,y+37,x+42,y+11,'#e1b47c',6); line(x+9,y+39,x+42,y+13,'#93653f',2);
    }
  }));
  for (const {cell:[i,j],kind} of state.pickups) {
    if (state.flames.some(f => f.cell[0]===i && f.cell[1]===j)) continue;
    box(i*52+6,j*52+6,40,40,9,'#243845','#83caff'); image(kind,i*52+8,j*52+8,36,36);
  }
  for (const b of state.bombs) {
    const x=b.cell[0]*52+26,y=b.cell[1]*52+27,r=17*(1+.07*Math.sin(t*(b.fuse<1?12:5)));
    if (b.direction.some(Boolean)) for (let n=1;n<=3;n++)
      circle(x-b.direction[0]*9*n,y-b.direction[1]*9*n,5-n,'#83caff88');
    circle(x,y+4,r+2,'#0005'); circle(x,y,r,'#172331'); circle(x,y,r,'#657784',2);
    circle(x-5,y-5,4,'#465c6b'); line(x+3,y-r+2,x+7,y-r-8,'#ffc96a',3);
    circle(x+7,y-r-8,4+Math.sin(t*28)*1.5,'#ffc96a');
    circle(x,y,21,b.fuse>1?colors[0]:'#ff7d64',2,2*Math.PI*Math.max(0,b.fuse/3.2));
    if (b.power===-1) image('atomic',x-12,y-12,24,24);
  }
  for (const {cell:[i,j],time} of state.flames) {
    const x=i*52+26,y=j*52+26;
    circle(x,y,27,`rgba(255,79,26,${.28*time/.65})`);
    box(x-24,y-17,48,34,10,'#ff893e'); box(x-17,y-24,34,48,10,'#ffb84f');
    circle(x,y,12+Math.sin(t*40)*3,'#fff0af');
  }
  for (const a of state.actors) {
    if (!a.alive) continue;
    const old=prev.actors[a.id].position;
    const [x,y]=a.position.map((v,i)=>26+52*(old[i]+(v-old[i])*alpha));
    if (a.shield || a.invulnerable>0) {
      circle(x,y,29,'#79dfff22'); circle(x,y,29,'#a4edffcc',2); image('shield',x+13,y-33,18,18);
    }
    circle(x,y+15,21,'#0005'); circle(x,y+10,21,colors[a.id],3);
    const bob=Math.sin(t*2+a.id)*1.2;
    image('tux',x-26,y-34-bob,52,57); circle(x,y-31-bob,5,colors[a.id]);
  }
}